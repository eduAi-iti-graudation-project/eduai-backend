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
    buffer: Buffer,
    filename: string,
    user: User,
    opts: {
      courseOfferingId?: string;
      sectionId?: string;
      courseId?: string;
      assignmentId?: string;
      chapterId?: string;
    } = {},
  ) {
    const { courseOfferingId, sectionId, courseId, assignmentId, chapterId } =
      opts;
    const organizationId = user.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('You are not part of an organization.');
    }

    // Resolve the target scope. A material's visibility is the set of
    // sections (offerings) it was scoped to.
    let scopeOfferingIds: string[] = [];
    let linkedOfferingId: string | null = null;
    let linkedCourseId: string | null = null;

    if (courseOfferingId) {
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
      const offering = await this.prisma.courseOffering.findFirst({
        where: { id: courseOfferingId, organizationId },
        select: { id: true, teacherId: true, courseId: true },
      });
      if (!offering) {
        throw new ApiError(
          ErrorCode.OFFERING_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This class could not be found.',
        );
      }
      if (user.role !== 'ADMIN' && offering.teacherId !== user.id) {
        throw new ForbiddenException(
          'You can only upload materials to sections you teach.',
        );
      }
      linkedOfferingId = offering.id;
      linkedCourseId = offering.courseId;
      scopeOfferingIds = [offering.id];
    } else if (sectionId) {
      if (assignmentId) {
        throw new ApiError(
          ErrorCode.ASSIGNMENT_NOT_FOUND,
          HttpStatus.BAD_REQUEST,
          'Assignments are per-section; section uploads cannot attach to an assignment.',
        );
      }
      const section = await this.prisma.section.findFirst({
        where: { id: sectionId, organizationId },
        select: { id: true },
      });
      if (!section) {
        throw new ApiError(
          ErrorCode.SECTION_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This section could not be found.',
        );
      }
      const offerings = await this.prisma.courseOffering.findMany({
        where: {
          sectionId,
          organizationId,
          ...(courseId ? { courseId } : {}),
          ...(user.role === 'ADMIN' ? {} : { teacherId: user.id }),
        },
        select: { id: true, courseId: true },
      });
      if (offerings.length === 0) {
        throw new ForbiddenException(
          courseId
            ? 'You can only upload materials for courses you teach in this section.'
            : 'You can only upload materials to sections you teach.',
        );
      }
      linkedOfferingId = offerings[0].id;
      linkedCourseId = courseId ?? offerings[0].courseId;
      scopeOfferingIds = offerings.map((o) => o.id);
    } else if (courseId) {
      if (assignmentId) {
        throw new ApiError(
          ErrorCode.ASSIGNMENT_NOT_FOUND,
          HttpStatus.BAD_REQUEST,
          'Assignments are per-section; course-level uploads cannot attach to an assignment.',
        );
      }
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
      const offerings = await this.prisma.courseOffering.findMany({
        where:
          user.role === 'ADMIN'
            ? { courseId, organizationId }
            : { courseId, organizationId, teacherId: user.id },
        select: { id: true },
      });
      if (offerings.length === 0) {
        throw new ForbiddenException(
          'You can only upload course materials for sections you teach.',
        );
      }
      linkedCourseId = courseId;
      scopeOfferingIds = offerings.map((o) => o.id);
    } else {
      throw new ApiError(
        ErrorCode.INVALID_UPLOAD_TARGET,
        HttpStatus.BAD_REQUEST,
        'One of courseOfferingId, sectionId or courseId is required.',
      );
    }

    let linkedChapterId: string | null = null;
    if (chapterId) {
      const chapterScope = linkedOfferingId
        ? [{ courseOfferingId: linkedOfferingId }]
        : [];
      const chapter = await this.prisma.materialChapter.findFirst({
        where: {
          id: chapterId,
          OR: [
            ...chapterScope,
            ...(linkedCourseId ? [{ courseId: linkedCourseId }] : []),
          ],
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
      if (detected.length >= 1) {
        const chapterScope = linkedOfferingId
          ? { courseOfferingId: linkedOfferingId }
          : { courseId: linkedCourseId, courseOfferingId: null };
        const current = await this.prisma.materialChapter.aggregate({
          where: chapterScope,
          _max: { order: true },
        });
        const base = (current._max.order ?? -1) + 1;
        const created = await Promise.all(
          detected.map((d, i) =>
            this.prisma.materialChapter.create({
              data: {
                ...(linkedOfferingId
                  ? { courseOfferingId: linkedOfferingId }
                  : {}),
                ...(linkedCourseId ? { courseId: linkedCourseId } : {}),
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
        courseOfferingId: linkedOfferingId,
        courseId: linkedCourseId,
        assignmentId: assignmentId ?? null,
        chapterId: linkedChapterId,
        createdById: user.id,
        fileUrl: filename,
        scopes: {
          create: scopeOfferingIds.map((id) => ({ courseOfferingId: id })),
        },
        chunks: {
          create: chunks.map((content) => ({ content })),
        },
      },
      include: { chunks: true },
    });

    if (isPdf) {
      const objectPath = linkedOfferingId
        ? `${this.bucket}/${linkedOfferingId}/${material.id}.pdf`
        : `${this.bucket}/${linkedCourseId}/${material.id}.pdf`;
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
      courseId: linkedCourseId,
      chunkCount: material.chunks.length,
      chapterId: material.chapterId,
      detectedChapterCount: detectedCount,
      embedErrors: errors.length > 0 ? errors : undefined,
    };
  }

  async findByOffering(courseOfferingId: string, organizationId: string) {
    const offeringIds = await this.resolveOfferingIds(
      courseOfferingId,
      organizationId,
    );
    return this.prisma.material.findMany({
      where: {
        OR: [
          {
            courseOfferingId: { in: offeringIds },
            offering: { organizationId },
          },
          {
            scopes: {
              some: {
                courseOfferingId: { in: offeringIds },
                offering: { organizationId },
              },
            },
          },
        ],
      },
      include: {
        _count: { select: { chunks: true } },
        course: { select: { name: true } },
        offering: { select: { course: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Resolves a course offering id OR a section id to the list of offering
   * ids in scope. Students navigate by section; teachers by offering.
   */
  private async resolveOfferingIds(
    courseOfferingIdOrSectionId: string,
    organizationId: string,
  ): Promise<string[]> {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: courseOfferingIdOrSectionId, organizationId },
      select: { id: true },
    });
    if (offering) return [offering.id];

    const section = await this.prisma.section.findFirst({
      where: { id: courseOfferingIdOrSectionId, organizationId },
      select: { offerings: { select: { id: true } } },
    });
    if (!section || section.offerings.length === 0) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }
    return section.offerings.map((o) => o.id);
  }

  async findByOfferingGrouped(
    courseOfferingId: string,
    organizationId: string,
  ) {
    const offeringIds = await this.resolveOfferingIds(
      courseOfferingId,
      organizationId,
    );
    const courseIds = (
      await this.prisma.courseOffering.findMany({
        where: { id: { in: offeringIds } },
        select: { courseId: true },
      })
    ).map((o) => o.courseId);
    const materialSelect = {
      id: true,
      title: true,
      fileUrl: true,
      assignmentId: true,
      chapterId: true,
      courseId: true,
      createdAt: true,
      _count: { select: { chunks: true } },
      course: { select: { name: true } },
      offering: { select: { course: { select: { name: true } } } },
    } as const;
    // A material is visible in this view when it is legacy-scoped to one of
    // the resolved offerings OR covered by a section scope for one of them.
    const visibleMaterial = {
      OR: [
        { courseOfferingId: { in: offeringIds } },
        { scopes: { some: { courseOfferingId: { in: offeringIds } } } },
      ],
    };
    const chapterInclude = {
      course: { select: { name: true } },
      offering: { select: { course: { select: { name: true } } } },
    } as const;
    const [offeringChapters, courseChapters, unassigned] = await Promise.all([
      this.prisma.materialChapter.findMany({
        where: { courseOfferingId: { in: offeringIds } },
        include: {
          ...chapterInclude,
          materials: {
            where: visibleMaterial,
            select: materialSelect,
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      }),
      // Course-level chapters (courseOfferingId null) group course-scoped
      // materials; only sections in scope see them.
      this.prisma.materialChapter.findMany({
        where: { courseId: { in: courseIds }, courseOfferingId: null },
        include: {
          ...chapterInclude,
          materials: {
            where: visibleMaterial,
            select: materialSelect,
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      }),
      this.prisma.material.findMany({
        where: { chapterId: null, ...visibleMaterial },
        select: materialSelect,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const chapters = [...offeringChapters, ...courseChapters].sort(
      (a, b) => a.order - b.order,
    );
    return { chapters, unassigned };
  }

  async createChapter(
    opts: { courseOfferingId?: string; sectionId?: string; courseId?: string },
    title: string,
    organizationId: string,
  ) {
    let offering: { id: string; courseId: string } | null = null;
    if (opts.courseOfferingId) {
      offering = await this.prisma.courseOffering.findFirst({
        where: { id: opts.courseOfferingId, organizationId },
        select: { id: true, courseId: true },
      });
      if (!offering) {
        throw new ApiError(
          ErrorCode.OFFERING_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This class could not be found.',
        );
      }
    } else if (opts.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: opts.sectionId, organizationId },
        select: { id: true },
      });
      if (!section) {
        throw new ApiError(
          ErrorCode.SECTION_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This section could not be found.',
        );
      }
      if (!opts.courseId) {
        const sectionOfferings = await this.prisma.courseOffering.findMany({
          where: { sectionId: opts.sectionId, organizationId },
          select: { id: true, courseId: true },
        });
        if (sectionOfferings.length === 0) {
          throw new ApiError(
            ErrorCode.OFFERING_NOT_FOUND,
            HttpStatus.NOT_FOUND,
            'This class could not be found.',
          );
        }
        if (sectionOfferings.length > 1) {
          throw new ApiError(
            ErrorCode.INVALID_UPLOAD_TARGET,
            HttpStatus.BAD_REQUEST,
            'This section has multiple courses; provide a courseId for the chapter.',
          );
        }
        offering = sectionOfferings[0];
      } else {
        offering = await this.prisma.courseOffering.findFirst({
          where: {
            sectionId: opts.sectionId,
            courseId: opts.courseId,
            organizationId,
          },
          select: { id: true, courseId: true },
        });
        if (!offering) {
          throw new ApiError(
            ErrorCode.OFFERING_NOT_FOUND,
            HttpStatus.NOT_FOUND,
            'This class could not be found.',
          );
        }
      }
    } else if (opts.courseId) {
      await this.assertCourseInOrganization(opts.courseId, organizationId);
      const current = await this.prisma.materialChapter.aggregate({
        where: { courseId: opts.courseId },
        _max: { order: true },
      });
      return this.prisma.materialChapter.create({
        data: {
          courseId: opts.courseId,
          title,
          order: (current._max.order ?? -1) + 1,
        },
      });
    } else {
      throw new ApiError(
        ErrorCode.INVALID_UPLOAD_TARGET,
        HttpStatus.BAD_REQUEST,
        'One of courseOfferingId, sectionId or courseId is required.',
      );
    }
    const current = await this.prisma.materialChapter.aggregate({
      where: { courseOfferingId: offering.id },
      _max: { order: true },
    });
    return this.prisma.materialChapter.create({
      data: {
        courseOfferingId: offering.id,
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

  async findByCourse(courseId: string, organizationId: string, user?: User) {
    await this.assertCourseInOrganization(courseId, organizationId);
    const scopedWhere = await this.buildCourseScopeWhere(
      courseId,
      organizationId,
      user,
    );
    return this.prisma.material.findMany({
      where: { courseId, ...scopedWhere },
      include: {
        _count: { select: { chunks: true } },
        course: { select: { name: true } },
        offering: { select: { course: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Course-level read scope: teachers only ever see materials scoped to the
   * sections they teach; students/guardians only see sections they are
   * enrolled in. Admins (and anonymous org lookups) see everything in the org.
   */
  private async buildCourseScopeWhere(
    courseId: string,
    organizationId: string,
    user?: User,
  ): Promise<Prisma.MaterialWhereInput> {
    if (!user || user.role === 'ADMIN') return {};
    let offeringIds: string[];
    if (user.role === 'TEACHER') {
      offeringIds = (
        await this.prisma.courseOffering.findMany({
          where: { courseId, organizationId, teacherId: user.id },
          select: { id: true },
        })
      ).map((o) => o.id);
    } else {
      offeringIds = (
        await this.prisma.courseOffering.findMany({
          where: {
            courseId,
            organizationId,
            section: {
              enrollments: {
                some:
                  user.role === 'GUARDIAN'
                    ? { student: { guardianId: user.id }, status: 'APPROVED' }
                    : { studentId: user.id, status: 'APPROVED' },
              },
            },
          },
          select: { id: true },
        })
      ).map((o) => o.id);
    }
    if (offeringIds.length === 0) {
      // No offerings in scope — match nothing.
      return { id: '00000000-0000-0000-0000-000000000000' };
    }
    return {
      OR: [
        { courseOfferingId: { in: offeringIds } },
        { scopes: { some: { courseOfferingId: { in: offeringIds } } } },
      ],
    };
  }

  async findByCourseGrouped(
    courseId: string,
    organizationId: string,
    user?: User,
  ) {
    await this.assertCourseInOrganization(courseId, organizationId);
    const scopedWhere = await this.buildCourseScopeWhere(
      courseId,
      organizationId,
      user,
    );
    const materialSelect = {
      id: true,
      title: true,
      fileUrl: true,
      assignmentId: true,
      chapterId: true,
      courseId: true,
      createdAt: true,
      _count: { select: { chunks: true } },
      course: { select: { name: true } },
      offering: { select: { course: { select: { name: true } } } },
    } as const;
    const [chapters, unassigned] = await Promise.all([
      this.prisma.materialChapter.findMany({
        where: { courseId },
        include: {
          course: { select: { name: true } },
          offering: { select: { course: { select: { name: true } } } },
          materials: {
            where: { courseId, ...scopedWhere },
            select: materialSelect,
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      }),
      this.prisma.material.findMany({
        where: { courseId, chapterId: null, ...scopedWhere },
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
      where: {
        id: materialId,
        OR: [{ offering: { organizationId } }, { course: { organizationId } }],
      },
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
      where: {
        id,
        OR: [{ offering: { organizationId } }, { course: { organizationId } }],
      },
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

  async listMaterialTitles(courseOfferingId: string) {
    return this.prisma.material.findMany({
      where: { courseOfferingId },
      select: { id: true, title: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async searchChunks(
    courseOfferingId: string,
    query: string,
    topK = 5,
    chapterId?: string,
    organizationId?: string,
  ) {
    const embedding = await this.llm.embed(query);
    const vectorStr = `[${embedding.join(',')}]`;
    const ids = organizationId
      ? await this.resolveOfferingIds(courseOfferingId, organizationId)
      : [courseOfferingId];
    const idList = Prisma.join(ids);
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
      WHERE (
        m."courseOfferingId" IN (${idList})
        OR EXISTS (
          SELECT 1 FROM material_section_scopes mss
          WHERE mss."materialId" = m.id
            AND mss."courseOfferingId" IN (${idList})
        )
      )
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
      LEFT JOIN material_chapters ch ON ch.id = m."chapterId"
      WHERE m."courseId" = ${courseId}::uuid
        ${chapterFilter}
        AND mc.embedding IS NOT NULL
        AND mc.embedding <=> ${vectorStr}::vector < ${this.maxSearchDistance}
      ORDER BY distance ASC
      LIMIT ${topK}
    `;
    return chunks;
  }

  /**
   * Returns an offering's material chunks directly, without any embedding
   * similarity threshold. Used as a fallback when a semantic search comes back
   * empty (e.g. the search query didn't embed close to the content) so the
   * class's actual uploaded text is still available for generation.
   * Applies the same visibility filter as `searchChunks` (direct offering link
   * OR section scopes).
   */
  async getChunksByOffering(courseOfferingId: string, limit = 50) {
    const idList = Prisma.join([courseOfferingId]);
    return this.prisma.$queryRaw<
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
      SELECT mc.id, mc.content, 0::float8 AS distance,
             m.id AS "materialId", m.title AS "materialTitle",
             m."chapterId", ch.title AS "chapterTitle"
      FROM material_chunks mc
      JOIN materials m ON m.id = mc."materialId"
      LEFT JOIN material_chapters ch ON ch.id = m."chapterId"
      WHERE (
        m."courseOfferingId" IN (${idList})
        OR EXISTS (
          SELECT 1 FROM material_section_scopes mss
          WHERE mss."materialId" = m.id
            AND mss."courseOfferingId" IN (${idList})
        )
      )
        AND mc.embedding IS NOT NULL
      ORDER BY m."createdAt" ASC, mc."createdAt" ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Returns a unit's material chunks directly, without any embedding similarity
   * threshold. Used as a fallback when a semantic search within a unit comes
   * back empty (e.g. the search query didn't embed close to the content) so the
   * unit's actual text is still available for generation.
   */
  async getChunksByChapter(courseId: string, chapterId: string, limit = 50) {
    return this.prisma.$queryRaw<
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
      SELECT mc.id, mc.content, 0::float8 AS distance,
             m.id AS "materialId", m.title AS "materialTitle",
             m."chapterId", ch.title AS "chapterTitle"
      FROM material_chunks mc
      JOIN materials m ON m.id = mc."materialId"
      LEFT JOIN material_chapters ch ON ch.id = m."chapterId"
      WHERE m."courseId" = ${courseId}::uuid
        AND m."chapterId" = ${chapterId}::uuid
      ORDER BY m."createdAt" ASC, mc."createdAt" ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Returns a course's material chunks directly, without any embedding
   * similarity threshold or unit filter. Used as a fallback when generating
   * from the entire course (no unit selected) and a semantic search comes back
   * empty, so the course's actual uploaded text is still available.
   */
  async getChunksByCourse(courseId: string, limit = 50) {
    return this.prisma.$queryRaw<
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
      SELECT mc.id, mc.content, 0::float8 AS distance,
             m.id AS "materialId", m.title AS "materialTitle",
             m."chapterId", ch.title AS "chapterTitle"
      FROM material_chunks mc
      JOIN materials m ON m.id = mc."materialId"
      LEFT JOIN material_chapters ch ON ch.id = m."chapterId"
      WHERE m."courseId" = ${courseId}::uuid
      ORDER BY m."createdAt" ASC, mc."createdAt" ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Lists a course's units (chapters) that actually have material with chunks.
   * Used to resolve a unit by title when a semantic match comes up empty.
   */
  async listChaptersWithMaterial(courseId: string) {
    return this.prisma.materialChapter.findMany({
      where: {
        courseId,
        materials: { some: { chunks: { some: {} } } },
      },
      select: { id: true, title: true },
      orderBy: { order: 'asc' },
    });
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
        scopes: {
          select: {
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
        },
      },
    });
    if (!material) throw new NotFoundException('Material not found');

    // Build the material's scope offerings: legacy single-section rows plus
    // any section scopes the course-level upload was granted.
    const scopedOfferings = material.scopes?.map((s) => s.offering) ?? [];
    const scopeOfferings = material.offering
      ? [material.offering, ...scopedOfferings]
      : scopedOfferings;

    this.assertCanAccess(user, scopeOfferings);
    return material;
  }

  private assertCanAccess(
    user: User,
    offerings: {
      teacherId: string;
      section: {
        enrollments: { student: { id: string; guardianId: string | null } }[];
      };
    }[],
  ) {
    if (user.role === 'ADMIN') {
      // admins bypass the offering-scope check
      return;
    }
    if (user.role === 'TEACHER') {
      const teaches = offerings.some((o) => o.teacherId === user.id);
      if (!teaches) {
        throw new ForbiddenException('Not your class');
      }
      return;
    }
    if (user.role === 'STUDENT') {
      const enrolled = offerings.some((o) =>
        o.section.enrollments.some((e) => e.student.id === user.id),
      );
      if (!enrolled) {
        throw new ForbiddenException('Not enrolled in this class');
      }
      return;
    }
    if (user.role === 'GUARDIAN') {
      const wardEnrolled = offerings.some((o) =>
        o.section.enrollments.some((e) => e.student.guardianId === user.id),
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
    this.assertCanAccess(user, [assignment.offering]);
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

  async getMaterialDownload(id: string, user: User) {
    const material = await this.findMaterialWithAccess(id, user);
    const title = material.title || 'material';
    const isPdf = material.fileUrl?.toLowerCase().endsWith('.pdf') ?? false;

    if (material.fileUrl?.startsWith(`${this.bucket}/`)) {
      const { data, error } = await this.supabase
        .getStorageClient()
        .storage.from(this.bucket)
        .download(material.fileUrl);
      if (error || !data) {
        throw new BadGatewayException('Failed to download the material file');
      }
      return {
        buffer: Buffer.from(await data.arrayBuffer()),
        contentType: isPdf ? 'application/pdf' : 'application/octet-stream',
        filename: `${title}.${isPdf ? 'pdf' : 'bin'}`,
      };
    }

    const chunks = await this.prisma.materialChunk.findMany({
      where: { materialId: material.id },
      select: { content: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      buffer: Buffer.from(chunks.map((c) => c.content).join('\n\n'), 'utf-8'),
      contentType: 'text/plain; charset=utf-8',
      filename: `${title}.txt`,
    };
  }

  async delete(id: string, organizationId: string) {
    const material = await this.prisma.material.findFirst({
      where: {
        id,
        OR: [{ offering: { organizationId } }, { course: { organizationId } }],
      },
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
