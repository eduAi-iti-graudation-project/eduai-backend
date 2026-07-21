import { Injectable } from '@nestjs/common';
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
}
