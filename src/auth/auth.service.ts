import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  signup(dto: {
    email: string;
    password: string;
    name: string;
    role: 'TEACHER' | 'STUDENT';
  }) {
    return this.prisma.user.create({
      data: { email: dto.email, name: dto.name, role: dto.role },
    });
  }

  login(dto: { email: string; password: string }) {
    return this.prisma.user.findUnique({ where: { email: dto.email } });
  }

  me() {
    return this.prisma.user.findFirst();
  }
}
