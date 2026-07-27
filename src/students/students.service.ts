import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  getGrades(id: string) {
    return this.prisma.gradingScore.findMany({
      where: { submission: { studentId: id }, isConfirmed: true },
      include: { criteria: true, submission: true },
    });
  }

  async getClasses(studentId: string) {
    return this.prisma.class.findMany({
      where: {
        enrollments: {
          some: { studentId, status: 'APPROVED' },
        },
      },
      include: {
        teacher: true,
        assignments: { include: { rubrics: true } },
      },
    });
  }

  async update(
    studentId: string,
    dto: {
      name?: string;
      email?: string;
      gradeId?: string;
      guardianId?: string;
    },
  ) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException('Student not found');
    return this.prisma.user.update({ where: { id: studentId }, data: dto });
  }

  async linkGuardian(studentId: string, guardianId: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException('Student not found');
    return this.prisma.user.update({
      where: { id: studentId },
      data: { guardianId },
    });
  }
}
