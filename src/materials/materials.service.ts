import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { chunkText } from '../common/chunker';
import pdfParse from 'pdf-parse';

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async upload(
    title: string,
    classId: string,
    buffer: Buffer,
    filename: string,
  ) {
    let rawText: string;
    if (filename.endsWith('.pdf')) {
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
      SELECT mc.id, mc.content, mc.embedding <-> ${vectorStr}::vector AS distance,
             m.id AS "materialId", m.title AS "materialTitle"
      FROM material_chunks mc
      JOIN materials m ON m.id = mc."materialId"
      WHERE m."classId" = ${classId}::uuid
        AND mc.embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${topK}
    `;
    return chunks;
  }

  async delete(id: string) {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) throw new NotFoundException('Material not found');
    await this.prisma.material.delete({ where: { id } });
    return { deleted: true };
  }
}
