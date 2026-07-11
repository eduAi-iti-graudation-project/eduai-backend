import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GradingService {
  constructor(private readonly prisma: PrismaService) {}

  confirm(id: string, dto: { pointsAwarded: number; teacherNotes?: string }) {
    return this.prisma.gradingScore.update({
      where: { id },
      data: {
        pointsAwarded: dto.pointsAwarded,
        teacherNotes: dto.teacherNotes,
      },
    });
  }
}
