import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';
import { EnrollSyncService } from '../roster/enroll-sync.service';

@Injectable()
export class SectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollSync: EnrollSyncService,
  ) {}

  async create(
    dto: { gradeLevelId: string; name: string; description?: string },
    organizationId: string,
  ) {
    const gradeLevel = await this.prisma.gradeLevel.findFirst({
      where: { id: dto.gradeLevelId, organizationId },
    });
    if (!gradeLevel) {
      throw new ApiError(
        ErrorCode.GRADE_LEVEL_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This grade level could not be found.',
      );
    }
    const existing = await this.prisma.section.findUnique({
      where: {
        organizationId_gradeLevelId_name: {
          organizationId,
          gradeLevelId: dto.gradeLevelId,
          name: dto.name,
        },
      },
    });
    if (existing) {
      throw new ApiError(
        ErrorCode.SECTION_CONFLICT,
        HttpStatus.CONFLICT,
        'A section with this name already exists in this grade level.',
      );
    }
    const section = await this.prisma.section.create({
      data: {
        gradeLevelId: dto.gradeLevelId,
        name: dto.name,
        description: dto.description,
        organizationId,
      },
    });
    return section;
  }

  findAll(organizationId: string) {
    return this.prisma.section.findMany({
      where: { organizationId },
      include: {
        gradeLevel: true,
        _count: { select: { enrollments: true, offerings: true } },
      },
      orderBy: [{ gradeLevel: { level: 'asc' } }, { name: 'asc' }],
    });
  }

  async findOne(id: string, organizationId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id, organizationId },
      include: {
        gradeLevel: true,
        enrollments: {
          include: { student: true },
          orderBy: { createdAt: 'asc' },
        },
        offerings: { include: { course: true, teacher: true } },
      },
    });
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This section could not be found.',
      );
    }
    return section;
  }

  async update(
    id: string,
    dto: { name?: string; description?: string },
    organizationId: string,
  ) {
    const section = await this.prisma.section.findFirst({
      where: { id, organizationId },
    });
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This section could not be found.',
      );
    }
    if (dto.name !== undefined && dto.name !== section.name) {
      const existing = await this.prisma.section.findUnique({
        where: {
          organizationId_gradeLevelId_name: {
            organizationId,
            gradeLevelId: section.gradeLevelId,
            name: dto.name,
          },
        },
      });
      if (existing) {
        throw new ApiError(
          ErrorCode.SECTION_CONFLICT,
          HttpStatus.CONFLICT,
          'A section with this name already exists in this grade level.',
        );
      }
    }
    const data: { name?: string; description?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    return this.prisma.section.update({ where: { id }, data });
  }

  async remove(id: string, organizationId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id, organizationId },
    });
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This section could not be found.',
      );
    }
    return this.prisma.section.delete({ where: { id } });
  }

  // ── Enrollments (sections carry enrolled students) ─────────────────

  async addEnrollment(
    sectionId: string,
    studentId: string,
    organizationId: string,
  ) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, organizationId },
    });
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This section could not be found.',
      );
    }
    const [student, existing] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: studentId, organizationId },
      }),
      this.prisma.enrollment.findUnique({
        where: { sectionId_studentId: { sectionId, studentId } },
      }),
    ]);
    if (!student) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }
    if (existing && existing.status === 'APPROVED') {
      throw new ApiError(
        ErrorCode.ALREADY_ENROLLED,
        HttpStatus.CONFLICT,
        'This student is already enrolled in this section.',
      );
    }
    const enrollment = await this.prisma.enrollment.upsert({
      where: { sectionId_studentId: { sectionId, studentId } },
      update: { status: 'APPROVED' },
      create: { sectionId, studentId, status: 'APPROVED' },
    });
    if (enrollment) {
      await this.prisma.enrollment.deleteMany({
        where: {
          studentId,
          status: 'APPROVED',
          sectionId: { not: sectionId },
          section: { organizationId, gradeLevelId: section.gradeLevelId },
        },
      });
    }
    return enrollment;
  }

  async removeEnrollment(
    sectionId: string,
    studentId: string,
    organizationId: string,
  ) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { sectionId, studentId, section: { organizationId } },
    });
    if (!enrollment) {
      throw new ApiError(
        ErrorCode.ENROLLMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This enrollment could not be found.',
      );
    }
    // Persist the exclusion: the student stays out of this section even
    // though grade-based sync would otherwise re-enroll them.
    return this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'REJECTED' },
    });
  }
}
