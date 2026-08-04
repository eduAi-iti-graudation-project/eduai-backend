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

    const [explicit, classes] = await Promise.all([
      this.prisma.teacherGrade.findMany({
        where: { teacherId },
        include: { grade: true },
      }),
      this.prisma.class.findMany({
        where: { teacherId },
        include: { gradeLinks: { include: { grade: true } } },
      }),
    ]);

    const rows: Array<{
      id: string;
      teacherId: string;
      gradeId: string;
      grade: object;
    }> = [];
    const seen = new Set<string>();

    for (const tg of explicit) {
      seen.add(tg.gradeId);
      rows.push({ id: tg.id, teacherId, gradeId: tg.gradeId, grade: tg.grade });
    }

    for (const cls of classes) {
      for (const link of cls.gradeLinks) {
        if (seen.has(link.gradeId)) continue;
        seen.add(link.gradeId);
        rows.push({
          id: link.id,
          teacherId,
          gradeId: link.gradeId,
          grade: link.grade,
        });
      }
    }

    return rows;
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
