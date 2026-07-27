import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GradesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.grade.findMany({
      orderBy: { level: 'asc' },
    });
  }

  async findOne(id: string) {
    const grade = await this.prisma.grade.findUnique({
      where: { id },
      include: {
        classes: {
          include: { class: true },
        },
      },
    });
    if (!grade) throw new NotFoundException('Grade not found');
    return grade;
  }

  async create(dto: { level: number; name: string }) {
    const existing = await this.prisma.grade.findUnique({
      where: { level: dto.level },
    });
    if (existing)
      throw new ConflictException(`Grade ${dto.level} already exists`);
    return this.prisma.grade.create({ data: dto });
  }

  async addClass(gradeId: string, classId: string) {
    const grade = await this.prisma.grade.findUnique({
      where: { id: gradeId },
    });
    if (!grade) throw new NotFoundException('Grade not found');

    const cls = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Class not found');

    const existing = await this.prisma.gradeClass.findUnique({
      where: { gradeId_classId: { gradeId, classId } },
    });
    if (existing)
      throw new ConflictException('Class already linked to this grade');

    return this.prisma.gradeClass.create({ data: { gradeId, classId } });
  }

  async removeClass(gradeId: string, classId: string) {
    const gc = await this.prisma.gradeClass.findUnique({
      where: { gradeId_classId: { gradeId, classId } },
    });
    if (!gc) throw new NotFoundException('Class not found in this grade');
    return this.prisma.gradeClass.delete({ where: { id: gc.id } });
  }

  async getClasses(gradeId: string) {
    const grade = await this.prisma.grade.findUnique({
      where: { id: gradeId },
    });
    if (!grade) throw new NotFoundException('Grade not found');
    const gradeClasses = await this.prisma.gradeClass.findMany({
      where: { gradeId },
      include: { class: { include: { teacher: true } } },
    });
    return gradeClasses.map((gc) => gc.class);
  }
}
