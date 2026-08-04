import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  BadGatewayException,
  Logger,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { chunkText } from '../common/chunker';
import { SupabaseService } from '../auth/supabase.service';
import pdfParse from 'pdf-parse';

const DEFAULT_BUCKET = 'materials';

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);
  private readonly maxSearchDistance: number;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly supabase: SupabaseService,
  ) {
    const configured = Number(process.env.SEARCH_MAX_COSINE_DISTANCE);
    this.maxSearchDistance = Number.isFinite(configured) ? configured : 0.45;
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;
  }

  async upload(
    title: string,
    classId: string,
    buffer: Buffer,
    filename: string,
  ) {
    const isPdf = filename.toLowerCase().endsWith('.pdf');
    let rawText: string;
    if (isPdf) {
      try {
        const pdfData = await pdfParse(buffer);
        rawText = pdfData.text;
      } catch (err) {
        throw new BadRequestException(
          `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      rawText = buffer.toString('utf-8');
    }

    if (!rawText || rawText.trim().length === 0) {
      throw new BadRequestException('File contained no extractable text');
    }

    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      throw new BadRequestException(
        'No chunks could be extracted from the file',
      );
    }

    const material = await this.prisma.material.create({
      data: {
        title,
        classId,
        fileUrl: isPdf ? null : filename,
        chunks: {
          create: chunks.map((content) => ({ content })),
        },
      },
      include: { chunks: true },
    });

    if (isPdf) {
      const objectPath = `${this.bucket}/${classId}/${material.id}.pdf`;
      let uploadFailed: string | null = null;
      try {
        const { error } = await this.supabase
          .getClient()
          .storage.from(this.bucket)
          .upload(objectPath, buffer, { contentType: 'application/pdf' });
        uploadFailed = error?.message ?? null;
      } catch (err) {
        uploadFailed =
          err instanceof Error ? err.message : 'Storage upload failed';
      }
      if (uploadFailed) {
        await this.prisma.material.delete({ where: { id: material.id } });
        throw new BadGatewayException(`Failed to store file: ${uploadFailed}`);
      }
      await this.prisma.material.update({
        where: { id: material.id },
        data: { fileUrl: objectPath },
      });
    }

    const errors: string[] = [];
    for (const chunk of material.chunks) {
      try {
        const embedding = await this.llm.embed(chunk.content);
        const vectorStr = `[${embedding.join(',')}]`;
        await this.prisma.$executeRawUnsafe(
          `UPDATE material_chunks SET embedding = $1::vector WHERE id = $2::uuid`,
          vectorStr,
          chunk.id,
        );
      } catch {
        errors.push(chunk.id);
      }
    }

    return {
      id: material.id,
      title: material.title,
      classId: material.classId,
      chunkCount: material.chunks.length,
      embedErrors: errors.length > 0 ? errors : undefined,
    };
  }

  async findByClass(classId: string) {
    return this.prisma.material.findMany({
      where: { classId },
      include: { _count: { select: { chunks: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const material = await this.prisma.material.findUnique({
      where: { id },
      include: { chunks: true },
    });
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  async searchChunks(classId: string, query: string, topK = 5) {
    const embedding = await this.llm.embed(query);
    const vectorStr = `[${embedding.join(',')}]`;
    const chunks = await this.prisma.$queryRaw<
      {
        id: string;
        content: string;
        distance: number;
        materialId: string;
        materialTitle: string;
      }[]
    >`
      SELECT mc.id, mc.content, mc.embedding <=> ${vectorStr}::vector AS distance,
             m.id AS "materialId", m.title AS "materialTitle"
      FROM material_chunks mc
      JOIN materials m ON m.id = mc."materialId"
      WHERE m."classId" = ${classId}::uuid
        AND mc.embedding IS NOT NULL
        AND mc.embedding <=> ${vectorStr}::vector < ${this.maxSearchDistance}
      ORDER BY distance ASC
      LIMIT ${topK}
    `;
    return chunks;
  }

  async getMaterialFileUrl(id: string, user: User) {
    const material = await this.prisma.material.findUnique({
      where: { id },
      include: {
        class: {
          include: {
            enrollments: {
              where: { status: 'APPROVED' },
              include: { student: true },
            },
          },
        },
      },
    });
    if (!material) throw new NotFoundException('Material not found');

    const cls = material.class;
    if (user.role === 'ADMIN') {
      // admins bypass the class-scope check
    } else if (user.role === 'TEACHER') {
      if (cls.teacherId !== user.id) {
        throw new ForbiddenException('Not your class');
      }
    } else if (user.role === 'STUDENT') {
      const enrolled = cls.enrollments.some((e) => e.studentId === user.id);
      if (!enrolled) {
        throw new ForbiddenException('Not enrolled in this class');
      }
    } else if (user.role === 'GUARDIAN') {
      const wardEnrolled = cls.enrollments.some(
        (e) => e.student.guardianId === user.id,
      );
      if (!wardEnrolled) {
        throw new ForbiddenException('No enrolled ward in this class');
      }
    } else {
      throw new ForbiddenException('Access denied');
    }

    if (!material.fileUrl?.startsWith(`${this.bucket}/`)) {
      throw new NotFoundException('Material has no stored file');
    }

    const { data, error } = await this.supabase
      .getClient()
      .storage.from(this.bucket)
      .createSignedUrl(material.fileUrl, 3600);
    if (error || !data) {
      throw new BadGatewayException('Failed to create download URL');
    }
    return { url: data.signedUrl };
  }

  async delete(id: string) {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) throw new NotFoundException('Material not found');

    if (material.fileUrl?.startsWith(`${this.bucket}/`)) {
      try {
        const { error } = await this.supabase
          .getClient()
          .storage.from(this.bucket)
          .remove([material.fileUrl]);
        if (error) {
          this.logger.warn(
            `Material ${id}: storage remove failed: ${error.message}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Material ${id}: storage remove errored: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await this.prisma.material.delete({ where: { id } });
    return { deleted: true };
  }
}
