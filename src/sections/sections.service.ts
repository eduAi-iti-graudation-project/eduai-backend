import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SectionsService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.section.create({
      data: {
        gradeLevelId: dto.gradeLevelId,
        name: dto.name,
        description: dto.description,
        organizationId,
      },
    });
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

  async findAvailable(studentId: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      include: { grade: true },
    });
    if (!student?.grade) return [];

    return this.prisma.section.findMany({
      where: {
        organizationId: student.organizationId,
        gradeLevelId: student.grade.id,
        enrollments: { none: { studentId } },
      },
      include: { gradeLevel: true, offerings: { include: { course: true } } },
    });
  }

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
    if (existing) {
      throw new ApiError(
        ErrorCode.ALREADY_ENROLLED,
        HttpStatus.CONFLICT,
        'This student is already enrolled in this section.',
      );
    }
    return this.prisma.enrollment.create({
      data: { sectionId, studentId, status: 'APPROVED' },
    });
  }

  async joinSection(sectionId: string, studentId: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: { organizationId: true },
    });
    if (!student) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, organizationId: student.organizationId },
    });
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This section could not be found.',
      );
    }
    const existing = await this.prisma.enrollment.findUnique({
      where: { sectionId_studentId: { sectionId, studentId } },
    });
    if (existing) {
      throw new ApiError(
        ErrorCode.ALREADY_ENROLLED,
        HttpStatus.CONFLICT,
        'You are already enrolled in this section.',
      );
    }
    return this.prisma.enrollment.create({
      data: { sectionId, studentId, status: 'PENDING' },
    });
  }

  async getRequests(sectionId: string, organizationId: string) {
    return this.prisma.enrollment.findMany({
      where: { sectionId, status: 'PENDING', section: { organizationId } },
      include: { student: true },
    });
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
    return this.prisma.enrollment.delete({ where: { id: enrollment.id } });
  }

  async approveEnrollment(enrollmentId: string, organizationId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, section: { organizationId } },
    });
    if (!enrollment) {
      throw new ApiError(
        ErrorCode.ENROLLMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This enrollment could not be found.',
      );
    }
    return this.prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { status: 'APPROVED' },
    });
  }

  async rejectEnrollment(enrollmentId: string, organizationId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, section: { organizationId } },
    });
    if (!enrollment) {
      throw new ApiError(
        ErrorCode.ENROLLMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This enrollment could not be found.',
      );
    }
    return this.prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { status: 'REJECTED' },
    });
  }
}
