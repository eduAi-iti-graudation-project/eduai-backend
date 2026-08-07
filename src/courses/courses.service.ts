import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CoursesService {
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
    const existing = await this.prisma.course.findUnique({
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
        ErrorCode.COURSE_CONFLICT,
        HttpStatus.CONFLICT,
        'A course with this name already exists in this grade level.',
      );
    }
    return this.prisma.course.create({
      data: {
        gradeLevelId: dto.gradeLevelId,
        name: dto.name,
        description: dto.description,
        organizationId,
      },
    });
  }

  findAll(organizationId: string) {
    return this.prisma.course.findMany({
      where: { organizationId },
      include: {
        gradeLevel: true,
        _count: { select: { offerings: true } },
      },
      orderBy: [{ gradeLevel: { level: 'asc' } }, { name: 'asc' }],
    });
  }

  async findOne(id: string, organizationId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id, organizationId },
      include: {
        gradeLevel: true,
        offerings: {
          include: { section: true, teacher: true },
          orderBy: { createdAt: 'asc' },
        },
      },
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

  async update(
    id: string,
    dto: { name?: string; description?: string },
    organizationId: string,
  ) {
    const course = await this.prisma.course.findFirst({
      where: { id, organizationId },
    });
    if (!course) {
      throw new ApiError(
        ErrorCode.COURSE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course could not be found.',
      );
    }
    if (dto.name !== undefined && dto.name !== course.name) {
      const existing = await this.prisma.course.findUnique({
        where: {
          organizationId_gradeLevelId_name: {
            organizationId,
            gradeLevelId: course.gradeLevelId,
            name: dto.name,
          },
        },
      });
      if (existing) {
        throw new ApiError(
          ErrorCode.COURSE_CONFLICT,
          HttpStatus.CONFLICT,
          'A course with this name already exists in this grade level.',
        );
      }
    }
    const data: { name?: string; description?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    return this.prisma.course.update({ where: { id }, data });
  }

  async remove(id: string, organizationId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id, organizationId },
    });
    if (!course) {
      throw new ApiError(
        ErrorCode.COURSE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course could not be found.',
      );
    }
    return this.prisma.course.delete({ where: { id } });
  }
}
