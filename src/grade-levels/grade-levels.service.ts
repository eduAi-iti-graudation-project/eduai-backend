import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GradeLevelsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(organizationId: string) {
    return this.prisma.gradeLevel.findMany({
      where: { organizationId },
      include: {
        _count: { select: { sections: true, courses: true, students: true } },
      },
      orderBy: { level: 'asc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const gradeLevel = await this.prisma.gradeLevel.findFirst({
      where: { id, organizationId },
      include: {
        sections: {
          include: {
            _count: { select: { enrollments: true } },
            offerings: { include: { course: true, teacher: true } },
          },
          orderBy: { name: 'asc' },
        },
        courses: { orderBy: { name: 'asc' } },
        _count: { select: { students: true } },
      },
    });
    if (!gradeLevel) {
      throw new ApiError(
        ErrorCode.GRADE_LEVEL_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This grade level could not be found.',
      );
    }
    return gradeLevel;
  }

  async create(dto: { level: number; name?: string }, organizationId: string) {
    const existing = await this.prisma.gradeLevel.findUnique({
      where: { organizationId_level: { organizationId, level: dto.level } },
    });
    if (existing) {
      throw new ApiError(
        ErrorCode.GRADE_LEVEL_CONFLICT,
        HttpStatus.CONFLICT,
        'This grade level already exists in your organization.',
      );
    }
    return this.prisma.gradeLevel.create({
      data: { level: dto.level, name: dto.name ?? null, organizationId },
    });
  }

  async update(
    id: string,
    dto: { level?: number; name?: string },
    organizationId: string,
  ) {
    const gradeLevel = await this.prisma.gradeLevel.findFirst({
      where: { id, organizationId },
    });
    if (!gradeLevel) {
      throw new ApiError(
        ErrorCode.GRADE_LEVEL_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This grade level could not be found.',
      );
    }
    if (dto.level !== undefined && dto.level !== gradeLevel.level) {
      const existing = await this.prisma.gradeLevel.findUnique({
        where: {
          organizationId_level: { organizationId, level: dto.level },
        },
      });
      if (existing) {
        throw new ApiError(
          ErrorCode.GRADE_LEVEL_CONFLICT,
          HttpStatus.CONFLICT,
          'This grade level already exists in your organization.',
        );
      }
    }
    const data: { level?: number; name?: string | null } = {};
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.name !== undefined) data.name = dto.name;
    return this.prisma.gradeLevel.update({ where: { id }, data });
  }

  async remove(id: string, organizationId: string) {
    const gradeLevel = await this.prisma.gradeLevel.findFirst({
      where: { id, organizationId },
    });
    if (!gradeLevel) {
      throw new ApiError(
        ErrorCode.GRADE_LEVEL_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This grade level could not be found.',
      );
    }
    return this.prisma.gradeLevel.delete({ where: { id } });
  }
}
