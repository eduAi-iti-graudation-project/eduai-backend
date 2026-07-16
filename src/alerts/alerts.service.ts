import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(status?: string) {
    const where: Record<string, string> = {};
    if (status) where.status = status;
    return this.prisma.alert.findMany({ where });
  }
}
