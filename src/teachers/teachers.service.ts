import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TeachersService {
  constructor(private readonly prisma: PrismaService) {}

  async getGrades(teacherId: string) {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
    });
    if (!teacher) throw new NotFoundException('Teacher not found');

    return this.prisma.teacherGrade.findMany({
      where: { teacherId },
      include: { grade: true },
    });
  }

  async addGrade(teacherId: string, gradeId: string) {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
    });
    if (!teacher) throw new NotFoundException('Teacher not found');

    const grade = await this.prisma.grade.findUnique({
      where: { id: gradeId },
    });
    if (!grade) throw new NotFoundException('Grade not found');

    return this.prisma.teacherGrade.create({
      data: { teacherId, gradeId },
      include: { grade: true },
    });
  }

  async removeGrade(teacherId: string, gradeId: string) {
    const tg = await this.prisma.teacherGrade.findUnique({
      where: { teacherId_gradeId: { teacherId, gradeId } },
    });
    if (!tg) throw new NotFoundException('Grade assignment not found');

    return this.prisma.teacherGrade.delete({
      where: { teacherId_gradeId: { teacherId, gradeId } },
    });
  }
}
