import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from './supabase.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async signup(dto: {
    email: string;
    password: string;
    name: string;
    role: 'TEACHER' | 'STUDENT' | 'GUARDIAN' | 'ADMIN';
  }) {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: true,
      });

    if (error || !data.user) {
      throw new UnauthorizedException(error?.message || 'Signup failed');
    }

    const user = await this.prisma.user.create({
      data: {
        authId: data.user.id,
        email: dto.email,
        name: dto.name,
        role: dto.role,
      },
    });

    const {
      data: { session },
    } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({ email: dto.email, password: dto.password });

    return {
      accessToken: session?.access_token ?? '',
      user,
    };
  }

  async login(dto: { email: string; password: string }) {
    const {
      data: { session },
      error,
    } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({ email: dto.email, password: dto.password });

    if (error || !session) {
      throw new UnauthorizedException(error?.message || 'Login failed');
    }

    const user = await this.prisma.user.findUnique({
      where: { authId: session.user.id },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      accessToken: session.access_token,
      user,
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}
