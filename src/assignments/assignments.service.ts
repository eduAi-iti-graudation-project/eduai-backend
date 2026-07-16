import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: {
    title: string;
    description?: string;
    dueDate: string;
    totalPoints: number;
    classId: string;
  }) {
    return this.prisma.assignment.create({
      data: { ...dto, dueDate: new Date(dto.dueDate) },
    });
  }

  findAll(classId?: string) {
    return classId
      ? this.prisma.assignment.findMany({ where: { classId } })
      : this.prisma.assignment.findMany();
  }

  async findOne(id: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      include: { class: true, rubrics: { include: { criteria: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }

  update(
    id: string,
    dto: {
      title?: string;
      description?: string;
      dueDate?: string;
      totalPoints?: number;
    },
  ) {
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

  remove(id: string) {
    return this.prisma.assignment.delete({ where: { id } });
  }
}
