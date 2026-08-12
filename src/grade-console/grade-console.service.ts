import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';
import { GradeLevelsService } from '../grade-levels/grade-levels.service';
import { ClassesService } from '../classes/classes.service';

@Injectable()
export class GradeConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradeLevelsService: GradeLevelsService,
    private readonly classesService: ClassesService,
  ) {}

  findAll(organizationId: string) {
    return this.gradeLevelsService.findAll(organizationId);
  }

  create(dto: { level: number; name?: string }, organizationId: string) {
    return this.gradeLevelsService.create(dto, organizationId);
  }

  getGradeClasses(gradeId: string, organizationId: string) {
    return this.classesService.findByGrade(gradeId, organizationId);
  }

  async addClassToGrade(
    gradeId: string,
    classId: string,
    organizationId: string,
  ) {
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
    const section = await this.prisma.section.findFirst({
      where: { id: classId, organizationId },
    });
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }
    return this.prisma.section.update({
      where: { id: classId },
      data: { gradeLevelId: gradeId },
    });
  }

  removeClassFromGrade(classId: string, organizationId: string) {
    return this.classesService.remove(classId, organizationId);
  }
}
