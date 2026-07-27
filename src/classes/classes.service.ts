import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClassesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: { name: string; description?: string }, teacherId: string) {
    return this.prisma.class.create({
      data: {
        name: dto.name,
        description: dto.description,
        teacherId,
      },
    });
  }

  findAll() {
    return this.prisma.class.findMany({
      include: { teacher: true, enrollments: true },
    });
  }

  async findOne(id: string) {
    const cls = await this.prisma.class.findUnique({
      where: { id },
      include: { teacher: true, enrollments: { include: { student: true } } },
    });
    if (!cls) throw new NotFoundException('Class not found');
    return cls;
  }

  update(id: string, dto: { name?: string; description?: string }) {
    return this.prisma.class.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.class.delete({ where: { id } });
  }

  async findAvailable(studentId: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      include: { grade: true },
    });
    if (!student?.grade) return [];

    return this.prisma.class.findMany({
      where: {
        gradeLinks: { some: { gradeId: student.grade.id } },
        enrollments: { none: { studentId } },
      },
      include: { teacher: true },
    });
  }

  async joinClass(classId: string, studentId: string) {
    return this.prisma.enrollment.create({
      data: { classId, studentId, status: 'PENDING' },
    });
  }

  async getRequests(classId: string) {
    return this.prisma.enrollment.findMany({
      where: { classId, status: 'PENDING' },
      include: { student: true },
    });
  }

  addEnrollment(classId: string, studentId: string) {
    return this.prisma.enrollment.create({
      data: { classId, studentId, status: 'APPROVED' },
    });
  }

  removeEnrollment(classId: string, studentId: string) {
    return this.prisma.enrollment.delete({
      where: { classId_studentId: { classId, studentId } },
    });
  }
}
