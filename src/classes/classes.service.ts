import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClassesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: { name: string; description?: string },
    teacherId: string,
    organizationId: string,
  ) {
    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId, organizationId },
    });
    if (!teacher) throw new NotFoundException('Teacher not found');
    return this.prisma.class.create({
      data: {
        name: dto.name,
        description: dto.description,
        teacherId,
        organizationId,
      },
    });
  }

  findAll(organizationId: string) {
    return this.prisma.class.findMany({
      where: { organizationId },
      include: { teacher: true, enrollments: true },
    });
  }

  async findOne(id: string, organizationId: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id, organizationId },
      include: { teacher: true, enrollments: { include: { student: true } } },
    });
    if (!cls) throw new NotFoundException('Class not found');
    return cls;
  }

  async update(
    id: string,
    dto: { name?: string; description?: string },
    organizationId: string,
  ) {
    const cls = await this.prisma.class.findFirst({
      where: { id, organizationId },
    });
    if (!cls) throw new NotFoundException('Class not found');
    return this.prisma.class.update({ where: { id }, data: dto });
  }

  async remove(id: string, organizationId: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id, organizationId },
    });
    if (!cls) throw new NotFoundException('Class not found');
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
        organizationId: student.organizationId,
        gradeLinks: { some: { gradeId: student.grade.id } },
        enrollments: { none: { studentId } },
      },
      include: { teacher: true },
    });
  }

  async joinClass(classId: string, studentId: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: { organizationId: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    const cls = await this.prisma.class.findFirst({
      where: { id: classId, organizationId: student.organizationId },
    });
    if (!cls) throw new NotFoundException('Class not found');
    const existing = await this.prisma.enrollment.findUnique({
      where: { classId_studentId: { classId, studentId } },
    });
    if (existing) throw new ConflictException('Already enrolled or pending');
    return this.prisma.enrollment.create({
      data: { classId, studentId, status: 'PENDING' },
    });
  }

  async getRequests(classId: string, organizationId: string) {
    return this.prisma.enrollment.findMany({
      where: { classId, status: 'PENDING', class: { organizationId } },
      include: { student: true },
    });
  }

  async addEnrollment(
    classId: string,
    studentId: string,
    organizationId: string,
  ) {
    const cls = await this.prisma.class.findFirst({
      where: { id: classId, organizationId },
    });
    if (!cls) throw new NotFoundException('Class not found');
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, organizationId },
    });
    if (!student) throw new NotFoundException('Student not found');
    return this.prisma.enrollment.create({
      data: { classId, studentId, status: 'APPROVED' },
    });
  }

  async removeEnrollment(
    classId: string,
    studentId: string,
    organizationId: string,
  ) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { classId, studentId, class: { organizationId } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return this.prisma.enrollment.delete({
      where: { id: enrollment.id },
    });
  }

  async approveEnrollment(enrollmentId: string, organizationId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, class: { organizationId } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return this.prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { status: 'APPROVED' },
    });
  }

  async rejectEnrollment(enrollmentId: string, organizationId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, class: { organizationId } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return this.prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { status: 'REJECTED' },
    });
  }
}
