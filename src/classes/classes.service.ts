import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClassesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: { name: string; description?: string }) {
    return this.prisma.class.create({
      data: { name: dto.name, description: dto.description, teacherId: '00000000-0000-0000-0000-000000000000' },
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

  addEnrollment(classId: string, studentId: string) {
    return this.prisma.enrollment.create({ data: { classId, studentId } });
  }

  removeEnrollment(classId: string, studentId: string) {
    return this.prisma.enrollment.delete({
      where: { classId_studentId: { classId, studentId } },
    });
  }
}
