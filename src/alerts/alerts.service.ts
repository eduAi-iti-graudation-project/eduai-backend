import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(status?: string) {
    const where: Record<string, string> = {};
    if (status) where.status = status;
    return this.prisma.alert.findMany({ where });
  }

  async resolve(id: string, status: 'RESOLVED' | 'DISMISSED') {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');
    return this.prisma.alert.update({
      where: { id },
      data: { status },
    });
  }
}
