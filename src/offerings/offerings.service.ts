import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OfferingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: { courseId: string; sectionId: string; teacherId: string },
    organizationId: string,
  ) {
    const [course, section, teacher] = await Promise.all([
      this.prisma.course.findFirst({
        where: { id: dto.courseId, organizationId },
      }),
      this.prisma.section.findFirst({
        where: { id: dto.sectionId, organizationId },
      }),
      this.prisma.user.findFirst({
        where: { id: dto.teacherId, organizationId, role: 'TEACHER' },
      }),
    ]);
    if (!course) {
      throw new ApiError(
        ErrorCode.COURSE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course could not be found.',
      );
    }
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This section could not be found.',
      );
    }
    if (!teacher) {
      throw new ApiError(
        ErrorCode.TEACHER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This teacher could not be found.',
      );
    }

    const existing = await this.prisma.courseOffering.findUnique({
      where: {
        courseId_sectionId: {
          courseId: dto.courseId,
          sectionId: dto.sectionId,
        },
      },
    });
    if (existing) {
      throw new ApiError(
        ErrorCode.OFFERING_CONFLICT,
        HttpStatus.CONFLICT,
        'This course is already offered in this section.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const offering = await tx.courseOffering.create({
        data: {
          courseId: dto.courseId,
          sectionId: dto.sectionId,
          teacherId: dto.teacherId,
          organizationId,
        },
      });
      await tx.classTeacherLog.create({
        data: {
          courseOfferingId: offering.id,
          teacherId: dto.teacherId,
          startedAt: offering.createdAt,
        },
      });
      return offering;
    });
  }

  findAll(
    organizationId: string,
    filters: { teacherId?: string; courseId?: string } = {},
  ) {
    return this.prisma.courseOffering.findMany({
      where: {
        organizationId,
        ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
        ...(filters.courseId ? { courseId: filters.courseId } : {}),
      },
      include: {
        course: true,
        section: { include: { gradeLevel: true } },
        teacher: true,
        _count: {
          select: { assignments: true, quizAssignments: true, materials: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id, organizationId },
      include: {
        course: true,
        section: {
          include: {
            gradeLevel: true,
            enrollments: { include: { student: true } },
          },
        },
        teacher: true,
      },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course offering could not be found.',
      );
    }
    return offering;
  }

  async update(
    id: string,
    dto: { teacherId?: string },
    organizationId: string,
  ) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id, organizationId },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course offering could not be found.',
      );
    }

    const data: { teacherId?: string } = {};
    if (dto.teacherId) {
      const teacher = await this.prisma.user.findFirst({
        where: { id: dto.teacherId, organizationId, role: 'TEACHER' },
      });
      if (!teacher) {
        throw new ApiError(
          ErrorCode.TEACHER_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This teacher could not be found.',
        );
      }
      data.teacherId = dto.teacherId;
    }

    if (data.teacherId && data.teacherId !== offering.teacherId) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.classTeacherLog.updateMany({
          where: { courseOfferingId: id, endedAt: null },
          data: { endedAt: now },
        }),
        this.prisma.classTeacherLog.create({
          data: {
            courseOfferingId: id,
            teacherId: data.teacherId,
            startedAt: now,
          },
        }),
      ]);
    }

    return this.prisma.courseOffering.update({ where: { id }, data });
  }

  async remove(id: string, organizationId: string) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id, organizationId },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course offering could not be found.',
      );
    }
    return this.prisma.courseOffering.delete({ where: { id } });
  }
}
