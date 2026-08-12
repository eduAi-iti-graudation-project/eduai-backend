import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  findAll(
    query: { role?: string; q?: string; take?: number },
    organizationId: string,
  ) {
    const filters: Record<string, unknown> = {
      organizationId,
    };

    if (query.role) {
      filters.role = query.role;
    }

    const searchLimit = 20;
    const search = query.q?.trim();
    if (search) {
      filters.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.user.findMany({
      where: filters as never,
      take: search
        ? Math.min(query.take ?? searchLimit, searchLimit)
        : undefined,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        gradeId: true,
        guardianId: true,
        organizationId: true,
        createdAt: true,
        grade: { select: { id: true, level: true, name: true } },
        guardian: { select: { id: true, name: true, email: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
      include: {
        grade: { select: { id: true, level: true, name: true } },
        guardian: { select: { id: true, name: true, email: true } },
        wards: {
          select: {
            id: true,
            name: true,
            email: true,
            grade: { select: { id: true, level: true, name: true } },
          },
        },
        teacherOfferings: {
          include: {
            course: true,
            section: {
              include: {
                gradeLevel: true,
                enrollments: {
                  where: { status: 'APPROVED' },
                  select: { id: true },
                },
              },
            },
          },
        },
        enrollments: {
          select: {
            id: true,
            status: true,
            section: {
              select: {
                id: true,
                name: true,
                offerings: {
                  include: { teacher: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new ApiError(
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This user could not be found.',
      );
    }

    const base = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      hasAuthAccount: user.authId !== null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    switch (user.role) {
      case 'STUDENT': {
        const [submissionCount, activeAlertCount] = await Promise.all([
          this.prisma.submission.count({ where: { studentId: user.id } }),
          this.prisma.alert.count({
            where: { studentId: user.id, status: 'ACTIVE' },
          }),
        ]);

        return {
          ...base,
          grade: user.grade,
          guardian: user.guardian,
          enrollments: user.enrollments.map((e) => ({
            id: e.id,
            status: e.status,
            classId: e.section.id,
            className: e.section.name,
            teacherName: e.section.offerings[0]?.teacher?.name ?? null,
          })),
          submissionCount,
          activeAlertCount,
        };
      }
      case 'TEACHER': {
        const quizCount = await this.prisma.quiz.count({
          where: { teacherId: user.id },
        });

        return {
          ...base,
          taughtGrades: user.teacherOfferings
            .map((o) => o.section.gradeLevel)
            .filter((g) => g !== null),
          taughtClasses: user.teacherOfferings.map((o) => ({
            id: o.id,
            name: o.course.name,
            description: o.course.description ?? o.section.description,
            studentCount: o.section.enrollments.length,
          })),
          quizCount,
        };
      }
      case 'GUARDIAN':
        return {
          ...base,
          wards: user.wards.map((w) => ({
            id: w.id,
            name: w.name,
            email: w.email,
            grade: w.grade,
          })),
        };
      default:
        return base;
    }
  }

  async getAvatarById(id: string) {
    return this.prisma.user.findFirst({
      where: { id },
      select: { avatarUrl: true },
    });
  }

  async remove(id: string, organizationId: string, adminId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
    });
    if (!user) {
      throw new ApiError(
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This user could not be found.',
      );
    }

    if (user.id === adminId || user.role === 'ADMIN') {
      throw new ApiError(
        ErrorCode.USER_DELETE_FORBIDDEN,
        HttpStatus.CONFLICT,
        user.id === adminId
          ? 'You cannot delete your own account.'
          : 'Admin accounts cannot be deleted.',
      );
    }

    if (user.role === 'TEACHER') {
      const offeringCount = await this.prisma.courseOffering.count({
        where: { teacherId: user.id },
      });
      if (offeringCount > 0) {
        throw new ApiError(
          ErrorCode.TEACHER_HAS_OFFERINGS,
          HttpStatus.CONFLICT,
          `This teacher still teaches ${offeringCount} offering${
            offeringCount === 1 ? '' : 's'
          }. Reassign or delete their offerings before removing them.`,
        );
      }
    }

    if (user.authId) {
      const { error } = await this.supabaseService
        .getClient()
        .auth.admin.deleteUser(user.authId);
      if (error) {
        throw new ApiError(
          ErrorCode.INTERNAL_ERROR,
          HttpStatus.INTERNAL_SERVER_ERROR,
          "Could not remove this user's account. Please try again.",
          { hint: ErrorHint.RETRY, cause: error },
        );
      }
    }

    const deleted = await this.prisma.$transaction(async (tx) => {
      if (user.role === 'GUARDIAN') {
        await tx.user.updateMany({
          where: { guardianId: user.id },
          data: { guardianId: null },
        });
      }
      return tx.user.delete({ where: { id: user.id } });
    });

    return {
      id: deleted.id,
      email: deleted.email,
      name: deleted.name,
      role: deleted.role,
      deletedAt: new Date().toISOString(),
    };
  }
}
