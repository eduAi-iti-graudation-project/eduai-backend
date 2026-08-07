import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

@Injectable()
export class AssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: {
    title: string;
    description?: string;
    dueDate: string;
    totalPoints: number;
    courseOfferingId: string;
  }) {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: dto.courseOfferingId },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }
    return this.prisma.assignment.create({
      data: { ...dto, dueDate: new Date(dto.dueDate) },
    });
  }

  findAll(courseOfferingId?: string) {
    return courseOfferingId
      ? this.prisma.assignment.findMany({ where: { courseOfferingId } })
      : this.prisma.assignment.findMany();
  }

  async findOne(id: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        offering: {
          include: { course: true, section: true, teacher: true },
        },
        rubrics: { include: { criteria: true } },
      },
    });
    if (!assignment) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This assignment could not be found.',
      );
    }
    return assignment;
  }

  async update(
    id: string,
    dto: {
      title?: string;
      description?: string;
      dueDate?: string;
      totalPoints?: number;
    },
  ) {
    const existing = await this.prisma.assignment.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This assignment could not be found.',
      );
    }
    return this.prisma.assignment.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
        ...(dto.totalPoints !== undefined && { totalPoints: dto.totalPoints }),
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.assignment.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This assignment could not be found.',
      );
    }
    return this.prisma.assignment.delete({ where: { id } });
  }
}
