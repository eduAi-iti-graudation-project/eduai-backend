import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { chunkText } from '../common/chunker';
import pdfParse from 'pdf-parse';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

@Injectable()
export class MaterialsService {
  private readonly maxSearchDistance: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {
    const configured = Number(process.env.SEARCH_MAX_COSINE_DISTANCE);
    this.maxSearchDistance = Number.isFinite(configured) ? configured : 0.45;
  }

  async upload(
    title: string,
    courseOfferingId: string,
    buffer: Buffer,
    filename: string,
    organizationId: string,
  ) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }
    let rawText: string;
    if (filename.endsWith('.pdf')) {
      try {
        const pdfData = await pdfParse(buffer);
        rawText = pdfData.text;
      } catch (err) {
        throw new ApiError(
          ErrorCode.FILE_NO_TEXT,
          HttpStatus.BAD_REQUEST,
          'This PDF could not be read. Please try another file.',
          { cause: err },
        );
      }
    } else {
      rawText = buffer.toString('utf-8');
    }

    if (!rawText || rawText.trim().length === 0) {
      throw new ApiError(
        ErrorCode.FILE_NO_TEXT,
        HttpStatus.BAD_REQUEST,
        'The uploaded file contained no extractable text.',
      );
    }

    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      throw new ApiError(
        ErrorCode.FILE_NO_TEXT,
        HttpStatus.BAD_REQUEST,
        'The uploaded file contained no readable content.',
      );
    }

    const material = await this.prisma.material.create({
      data: {
        title,
        courseOfferingId,
        fileUrl: filename,
        chunks: {
          create: chunks.map((content) => ({ content })),
        },
      },
      include: { chunks: true },
    });

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
      courseOfferingId: material.courseOfferingId,
      chunkCount: material.chunks.length,
      embedErrors: errors.length > 0 ? errors : undefined,
    };
  }

  async findByClass(courseOfferingId: string, organizationId: string) {
    return this.prisma.material.findMany({
      where: { courseOfferingId, offering: { organizationId } },
      include: { _count: { select: { chunks: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const material = await this.prisma.material.findFirst({
      where: { id, offering: { organizationId } },
      include: { chunks: true },
    });
    if (!material) {
      throw new ApiError(
        ErrorCode.MATERIAL_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This material could not be found.',
      );
    }
    return material;
  }

  async searchChunks(courseOfferingId: string, query: string, topK = 5) {
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
      WHERE m."courseOfferingId" = ${courseOfferingId}::uuid
        AND mc.embedding IS NOT NULL
        AND mc.embedding <=> ${vectorStr}::vector < ${this.maxSearchDistance}
      ORDER BY distance ASC
      LIMIT ${topK}
    `;
    return chunks;
  }

  async delete(id: string, organizationId: string) {
    const material = await this.prisma.material.findFirst({
      where: { id, offering: { organizationId } },
    });
    if (!material) {
      throw new ApiError(
        ErrorCode.MATERIAL_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This material could not be found.',
      );
    }
    await this.prisma.material.delete({ where: { id } });
    return { deleted: true };
  }
}
