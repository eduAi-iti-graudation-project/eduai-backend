import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';
import { SectionsService } from '../sections/sections.service';

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sectionsService: SectionsService,
  ) {}

  private decorate<
    T extends {
      id: string;
      organizationId: string;
      gradeLevelId: string;
      name: string;
    },
  >(
    section: T,
    offerings: Array<{
      teacherId: string | null;
      course?: { name: string } | null;
    }>,
  ) {
    const courses = offerings
      .map((o) => o.course?.name)
      .filter((name): name is string => Boolean(name));
    return {
      ...section,
      teacherId: offerings[0]?.teacherId ?? null,
      courses: [...new Set(courses)],
    };
  }

  findAll(organizationId: string, user?: { id: string; role: string } | null) {
    return this.prisma.section
      .findMany({
        where: {
          organizationId,
          // Teachers only see the sections they actually teach (a section
          // belongs to the teacher via its course offerings).
          ...(user?.role === 'TEACHER'
            ? { offerings: { some: { teacherId: user.id } } }
            : {}),
        },
        include: {
          gradeLevel: true,
          offerings: {
            include: { course: { select: { name: true } } },
          },
          _count: { select: { enrollments: true, offerings: true } },
        },
        orderBy: [{ gradeLevel: { level: 'asc' } }, { name: 'asc' }],
      })
      .then((sections) => sections.map((s) => this.decorate(s, s.offerings)));
  }

  async findByGrade(gradeId: string, organizationId: string) {
    const gradeLevel = await this.prisma.gradeLevel.findFirst({
      where: { id: gradeId, organizationId },
    });
    if (!gradeLevel) {
      throw new ApiError(
        ErrorCode.GRADE_LEVEL_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This grade level could not be found.',
      );
    }
    const sections = await this.prisma.section.findMany({
      where: { organizationId, gradeLevelId: gradeId },
      include: {
        gradeLevel: true,
        offerings: {
          include: { course: { select: { name: true } } },
        },
        _count: { select: { enrollments: true, offerings: true } },
      },
      orderBy: { name: 'asc' },
    });
    return sections.map((s) => this.decorate(s, s.offerings));
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
        offerings: {
          include: { course: true, teacher: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }
    return this.decorate(section, section.offerings);
  }

  create(
    dto: { gradeLevelId: string; name: string; description?: string },
    organizationId: string,
  ) {
    return this.sectionsService.create(dto, organizationId);
  }

  update(
    id: string,
    dto: { name?: string; description?: string },
    organizationId: string,
  ) {
    return this.sectionsService.update(id, dto, organizationId);
  }

  remove(id: string, organizationId: string) {
    return this.sectionsService.remove(id, organizationId);
  }

  addEnrollment(sectionId: string, studentId: string, organizationId: string) {
    return this.sectionsService.addEnrollment(
      sectionId,
      studentId,
      organizationId,
    );
  }

  removeEnrollment(
    sectionId: string,
    studentId: string,
    organizationId: string,
  ) {
    return this.sectionsService.removeEnrollment(
      sectionId,
      studentId,
      organizationId,
    );
  }

  async assignTeacher(id: string, teacherId: string, organizationId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id, organizationId },
    });
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }

    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId, organizationId },
    });
    if (!teacher) {
      throw new ApiError(
        ErrorCode.TEACHER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This teacher could not be found.',
      );
    }

    const course = await this.prisma.course.findFirst({
      where: { organizationId, gradeLevelId: section.gradeLevelId },
      orderBy: { name: 'asc' },
    });
    if (!course) {
      throw new ApiError(
        ErrorCode.COURSE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This grade has no course to attach the teacher to. Create a course for this grade first.',
      );
    }

    await this.prisma.courseOffering.upsert({
      where: {
        courseId_sectionId: { courseId: course.id, sectionId: section.id },
      },
      update: { teacherId },
      create: {
        courseId: course.id,
        sectionId: section.id,
        teacherId,
        organizationId,
      },
    });

    return this.findOne(id, organizationId);
  }
}
