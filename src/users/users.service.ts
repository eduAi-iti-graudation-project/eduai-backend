import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: { role?: string; q?: string }) {
    const filters: Record<string, unknown> = {};

    if (query.role) {
      filters.role = query.role;
    }

    if (query.q) {
      filters.name = { contains: query.q, mode: 'insensitive' };
    }

    return this.prisma.user.findMany({
      where: filters as never,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        gradeId: true,
        guardianId: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
