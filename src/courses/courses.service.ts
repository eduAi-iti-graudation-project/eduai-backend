import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';

export const COURSE_COLOR_TAGS = [
  '#3B82F6', // blue
  '#0D9488', // teal
  '#EC4899', // pink
  '#EA580C', // orange
  '#0891B2', // cyan
  '#C026D3', // fuchsia
  '#65A30D', // lime
  '#92400E', // brown
] as const;

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
        colorTag: await this.nextColorTag(organizationId),
        organizationId,
      },
    });
  }

  /**
   * Auto-assign the next unused palette color in sequence, cycling through
   * the palette once every color is taken. Stable per organization.
   */
  private async nextColorTag(organizationId: string): Promise<string> {
    const courses = await this.prisma.course.findMany({
      where: { organizationId },
      select: { colorTag: true },
      orderBy: { createdAt: 'asc' },
    });
    const used = new Set(courses.map((c) => c.colorTag));
    const unused = COURSE_COLOR_TAGS.find((c) => !used.has(c));
    if (unused) return unused;
    return COURSE_COLOR_TAGS[courses.length % COURSE_COLOR_TAGS.length];
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
