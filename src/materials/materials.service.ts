import {
  Injectable,
  HttpStatus,
  NotFoundException,
  ForbiddenException,
  BadGatewayException,
  Logger,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { chunkText } from '../common/chunker';
import { detectChapters } from './chapter-detector';
import { SupabaseService } from '../auth/supabase.service';
import pdfParse from 'pdf-parse';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

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
    courseOfferingId: string,
    buffer: Buffer,
    filename: string,
    organizationId: string,
    assignmentId?: string,
    chapterId?: string,
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
    const courseId = offering.courseId;
    if (assignmentId) {
      const assignment = await this.prisma.assignment.findFirst({
        where: { id: assignmentId, courseOfferingId },
      });
      if (!assignment) {
        throw new ApiError(
          ErrorCode.ASSIGNMENT_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This assignment could not be found in the selected class.',
        );
      }
    }
    let linkedChapterId: string | null = null;
    if (chapterId) {
      const chapter = await this.prisma.materialChapter.findFirst({
        where: {
          id: chapterId,
          OR: [{ courseOfferingId }, { courseId }],
        },
      });
      if (!chapter) {
        throw new ApiError(
          ErrorCode.CHAPTER_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This chapter could not be found in the selected class.',
        );
      }
      linkedChapterId = chapter.id;
    }
    const isPdf = filename.toLowerCase().endsWith('.pdf');
    let rawText: string;
    if (isPdf) {
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

    let detectedCount = 0;
    if (!linkedChapterId) {
      const detected = detectChapters(rawText);
      if (detected.length >= 2) {
        const current = await this.prisma.materialChapter.aggregate({
          where: { courseOfferingId },
          _max: { order: true },
        });
        const base = (current._max.order ?? -1) + 1;
        const created = await Promise.all(
          detected.map((d, i) =>
            this.prisma.materialChapter.create({
              data: {
                courseOfferingId,
                courseId,
                title: d.title,
                order: base + i,
              },
            }),
          ),
        );
        linkedChapterId = created[0].id;
        detectedCount = created.length;
      }
    }

    const material = await this.prisma.material.create({
      data: {
        title,
        courseOfferingId,
        courseId,
        assignmentId: assignmentId ?? null,
        chapterId: linkedChapterId,
        fileUrl: filename,
        chunks: {
          create: chunks.map((content) => ({ content })),
        },
      },
      include: { chunks: true },
    });

    if (isPdf) {
      const objectPath = `${this.bucket}/${courseOfferingId}/${material.id}.pdf`;
      let uploadFailed: string | null = null;
      try {
        const { error } = await this.supabase
          .getStorageClient()
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
      courseOfferingId: material.courseOfferingId,
      courseId,
      chunkCount: material.chunks.length,
      chapterId: material.chapterId,
      detectedChapterCount: detectedCount,
      embedErrors: errors.length > 0 ? errors : undefined,
    };
  }

  findByOffering(courseOfferingId: string, organizationId: string) {
    return this.prisma.material.findMany({
      where: { courseOfferingId, offering: { organizationId } },
      include: { _count: { select: { chunks: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByOfferingGrouped(
    courseOfferingId: string,
    organizationId: string,
  ) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId },
      select: { id: true },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }
    const materialSelect = {
      id: true,
      title: true,
      fileUrl: true,
      assignmentId: true,
      chapterId: true,
      createdAt: true,
      _count: { select: { chunks: true } },
    } as const;
    const [chapters, unassigned] = await Promise.all([
      this.prisma.materialChapter.findMany({
        where: { courseOfferingId },
        include: {
          materials: {
            select: materialSelect,
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      }),
      this.prisma.material.findMany({
        where: { courseOfferingId, chapterId: null },
        select: materialSelect,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { chapters, unassigned };
  }

  async createChapter(
    courseOfferingId: string,
    title: string,
    organizationId: string,
  ) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId },
      select: { id: true, courseId: true },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }
    const current = await this.prisma.materialChapter.aggregate({
      where: { courseOfferingId },
      _max: { order: true },
    });
    return this.prisma.materialChapter.create({
      data: {
        courseOfferingId,
        courseId: offering.courseId,
        title,
        order: (current._max.order ?? -1) + 1,
      },
    });
  }

  async assertCourseInOrganization(courseId: string, organizationId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, organizationId },
      select: { id: true },
    });
    if (!course) {
      throw new ApiError(
        ErrorCode.COURSE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course could not be found.',
      );
    }
    return course;
  }

  async findByCourse(courseId: string, organizationId: string) {
    await this.assertCourseInOrganization(courseId, organizationId);
    return this.prisma.material.findMany({
      where: { courseId },
      include: { _count: { select: { chunks: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByCourseGrouped(courseId: string, organizationId: string) {
    await this.assertCourseInOrganization(courseId, organizationId);
    const materialSelect = {
      id: true,
      title: true,
      fileUrl: true,
      assignmentId: true,
      chapterId: true,
      createdAt: true,
      _count: { select: { chunks: true } },
    } as const;
    const [chapters, unassigned] = await Promise.all([
      this.prisma.materialChapter.findMany({
        where: { courseId },
        include: {
          materials: {
            where: { courseId },
            select: materialSelect,
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      }),
      this.prisma.material.findMany({
        where: { courseId, chapterId: null },
        select: materialSelect,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { chapters, unassigned };
  }

  async createCourseChapter(
    courseId: string,
    title: string,
    organizationId: string,
  ) {
    await this.assertCourseInOrganization(courseId, organizationId);
    const current = await this.prisma.materialChapter.aggregate({
      where: { courseId },
      _max: { order: true },
    });
    return this.prisma.materialChapter.create({
      data: {
        courseId,
        title,
        order: (current._max.order ?? -1) + 1,
      },
    });
  }

  async updateChapter(
    id: string,
    organizationId: string,
    data: { title?: string; order?: number },
  ) {
    await this.assertChapterAccess(id, organizationId);
    return this.prisma.materialChapter.update({
      where: { id },
      data,
    });
  }

  async deleteChapter(id: string, organizationId: string) {
    await this.assertChapterAccess(id, organizationId);
    await this.prisma.materialChapter.delete({ where: { id } });
    return { deleted: true };
  }

  async moveMaterialToChapter(
    materialId: string,
    chapterId: string | null,
    organizationId: string,
  ) {
    const material = await this.prisma.material.findFirst({
      where: { id: materialId, offering: { organizationId } },
      select: { id: true, courseOfferingId: true, courseId: true },
    });
    if (!material) {
      throw new ApiError(
        ErrorCode.MATERIAL_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This material could not be found.',
      );
    }
    if (chapterId) {
      const chapter = await this.prisma.materialChapter.findFirst({
        where: {
          id: chapterId,
          OR: [
            { courseOfferingId: material.courseOfferingId },
            { courseId: material.courseId },
          ],
        },
        select: { id: true },
      });
      if (!chapter) {
        throw new ApiError(
          ErrorCode.CHAPTER_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This chapter could not be found in the same class.',
        );
      }
    }
    return this.prisma.material.update({
      where: { id: materialId },
      data: { chapterId },
      select: { id: true, chapterId: true },
    });
  }

  private async assertChapterAccess(id: string, organizationId: string) {
    const chapter = await this.prisma.materialChapter.findFirst({
      where: {
        id,
        OR: [{ offering: { organizationId } }, { course: { organizationId } }],
      },
      select: { id: true },
    });
    if (!chapter) {
      throw new ApiError(
        ErrorCode.CHAPTER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This chapter could not be found.',
      );
    }
    return chapter;
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

  async searchChunks(
    courseOfferingId: string,
    query: string,
    topK = 5,
    chapterId?: string,
  ) {
    const embedding = await this.llm.embed(query);
    const vectorStr = `[${embedding.join(',')}]`;
    const chapterFilter = chapterId
      ? Prisma.sql`AND m."chapterId" = ${chapterId}::uuid`
      : Prisma.empty;
    const chunks = await this.prisma.$queryRaw<
      {
        id: string;
        content: string;
        distance: number;
        materialId: string;
        materialTitle: string;
        chapterId: string | null;
        chapterTitle: string | null;
      }[]
    >`
      SELECT mc.id, mc.content, mc.embedding <=> ${vectorStr}::vector AS distance,
             m.id AS "materialId", m.title AS "materialTitle",
             m."chapterId", ch.title AS "chapterTitle"
      FROM material_chunks mc
      JOIN materials m ON m.id = mc."materialId"
      LEFT JOIN material_chapters ch ON ch.id = m."chapterId"
      WHERE m."courseOfferingId" = ${courseOfferingId}::uuid
        ${chapterFilter}
        AND mc.embedding IS NOT NULL
        AND mc.embedding <=> ${vectorStr}::vector < ${this.maxSearchDistance}
      ORDER BY distance ASC
      LIMIT ${topK}
    `;
    return chunks;
  }

  async searchChunksByCourse(
    courseId: string,
    query: string,
    topK = 5,
    chapterId?: string,
  ) {
    const embedding = await this.llm.embed(query);
    const vectorStr = `[${embedding.join(',')}]`;
    const chapterFilter = chapterId
      ? Prisma.sql`AND m."chapterId" = ${chapterId}::uuid`
      : Prisma.empty;
    const chunks = await this.prisma.$queryRaw<
      {
        id: string;
        content: string;
        distance: number;
        materialId: string;
        materialTitle: string;
        chapterId: string | null;
        chapterTitle: string | null;
      }[]
    >`
      SELECT mc.id, mc.content, mc.embedding <=> ${vectorStr}::vector AS distance,
             m.id AS "materialId", m.title AS "materialTitle",
             m."chapterId", ch.title AS "chapterTitle"
      FROM material_chunks mc
      JOIN materials m ON m.id = mc."materialId"
      JOIN course_offerings co ON co.id = m."courseOfferingId"
      LEFT JOIN material_chapters ch ON ch.id = m."chapterId"
      WHERE co."courseId" = ${courseId}::uuid
        ${chapterFilter}
        AND mc.embedding IS NOT NULL
        AND mc.embedding <=> ${vectorStr}::vector < ${this.maxSearchDistance}
      ORDER BY distance ASC
      LIMIT ${topK}
    `;
    return chunks;
  }

  private async findMaterialWithAccess(id: string, user: User) {
    const material = await this.prisma.material.findUnique({
      where: { id },
      include: {
        offering: {
          select: {
            teacherId: true,
            section: {
              select: {
                enrollments: {
                  where: { status: 'APPROVED' },
                  select: {
                    student: { select: { id: true, guardianId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!material) throw new NotFoundException('Material not found');
    this.assertCanAccess(
      user,
      material.offering.teacherId,
      material.offering.section.enrollments,
    );
    return material;
  }

  private assertCanAccess(
    user: User,
    teacherId: string,
    enrollments: { student: { id: string; guardianId: string | null } }[],
  ) {
    if (user.role === 'ADMIN') {
      // admins bypass the offering-scope check
      return;
    }
    if (user.role === 'TEACHER') {
      if (teacherId !== user.id) {
        throw new ForbiddenException('Not your class');
      }
      return;
    }
    if (user.role === 'STUDENT') {
      const enrolled = enrollments.some((e) => e.student.id === user.id);
      if (!enrolled) {
        throw new ForbiddenException('Not enrolled in this class');
      }
      return;
    }
    if (user.role === 'GUARDIAN') {
      const wardEnrolled = enrollments.some(
        (e) => e.student.guardianId === user.id,
      );
      if (!wardEnrolled) {
        throw new ForbiddenException('No enrolled ward in this class');
      }
      return;
    }
    throw new ForbiddenException('Access denied');
  }

  async findByAssignment(assignmentId: string, user: User) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        offering: {
          select: {
            teacherId: true,
            section: {
              select: {
                enrollments: {
                  where: { status: 'APPROVED' },
                  select: {
                    student: { select: { id: true, guardianId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!assignment) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This assignment could not be found.',
      );
    }
    this.assertCanAccess(
      user,
      assignment.offering.teacherId,
      assignment.offering.section.enrollments,
    );
    return this.prisma.material.findMany({
      where: { assignmentId },
      select: { id: true, title: true, fileUrl: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMaterialFileUrl(id: string, user: User) {
    const material = await this.findMaterialWithAccess(id, user);

    if (!material.fileUrl?.startsWith(`${this.bucket}/`)) {
      throw new NotFoundException('Material has no stored file');
    }

    const { data, error } = await this.supabase
      .getStorageClient()
      .storage.from(this.bucket)
      .createSignedUrl(material.fileUrl, 3600);
    if (error || !data) {
      throw new BadGatewayException('Failed to create download URL');
    }
    return { url: data.signedUrl };
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

    if (material.fileUrl?.startsWith(`${this.bucket}/`)) {
      try {
        const { error } = await this.supabase
          .getStorageClient()
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
