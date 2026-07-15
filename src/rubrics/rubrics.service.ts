import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RubricsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: {
    title: string;
    assignmentId: string;
    criteria: { description: string; maxPoints: number }[];
  }) {
    return this.prisma.rubric.create({
      data: {
        title: dto.title,
        assignmentId: dto.assignmentId,
        criteria: { create: dto.criteria },
      },
      include: { criteria: true },
    });
  }

  findAll(assignmentId?: string) {
    return assignmentId
      ? this.prisma.rubric.findMany({
          where: { assignmentId },
          include: { criteria: true },
        })
      : this.prisma.rubric.findMany({ include: { criteria: true } });
  }

  async findOne(id: string) {
    const rubric = await this.prisma.rubric.findUnique({
      where: { id },
      include: { criteria: true, assignment: true },
    });
    if (!rubric) throw new NotFoundException('Rubric not found');
    return rubric;
  }

  async confirm(id: string) {
    const rubric = await this.prisma.rubric.findUnique({ where: { id } });
    if (!rubric) throw new NotFoundException('Rubric not found');
    return this.prisma.rubric.update({
      where: { id },
      data: { isConfirmed: true },
      include: { criteria: true },
    });
  }

  importPdf() {
    throw new Error('Not implemented');
  }
}
