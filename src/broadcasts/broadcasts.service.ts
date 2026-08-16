import { Injectable, HttpStatus } from '@nestjs/common';
import type { User, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import type { CreateBroadcastDto } from './dto';

const AUDIENCE_ROLES = ['STUDENT', 'TEACHER', 'GUARDIAN', 'ADMIN'] as const;

@Injectable()
export class BroadcastsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async resolveAudience(
    organizationId: string,
    roles: (typeof AUDIENCE_ROLES)[number][],
    targetGradeId?: string,
  ): Promise<string[]> {
    const whereByRole: Record<string, Prisma.UserWhereInput> = {
      STUDENT: {
        role: 'STUDENT',
        ...(targetGradeId ? { gradeId: targetGradeId } : {}),
      },
      TEACHER: { role: 'TEACHER' },
      GUARDIAN: {
        role: 'GUARDIAN',
        ...(targetGradeId
          ? { wards: { some: { gradeId: targetGradeId } } }
          : {}),
      },
      ADMIN: { role: 'ADMIN' },
    };

    const users = await this.prisma.user.findMany({
      where: {
        organizationId,
        OR: roles
          .filter((role): role is (typeof AUDIENCE_ROLES)[number] =>
            AUDIENCE_ROLES.includes(role as never),
          )
          .map((role) => whereByRole[role]),
      },
      select: { id: true },
    });

    return users.map((u) => u.id);
  }

  async create(user: User, dto: CreateBroadcastDto) {
    const organizationId = user.organizationId;
    if (!organizationId) {
      throw new ApiError(
        ErrorCode.ORG_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'You must belong to an organization to send a broadcast.',
      );
    }

    const recipientIds = await this.resolveAudience(
      organizationId,
      dto.targetRoles,
      dto.targetGradeId,
    );

    const broadcast = await this.prisma.broadcast.create({
      data: {
        title: dto.title,
        body: dto.body ?? null,
        targetRoles: dto.targetRoles,
        targetGradeId: dto.targetGradeId ?? null,
        createdById: user.id,
        organizationId,
        deliveredCount: 0,
      },
    });

    let delivered = 0;
    if (recipientIds.length > 0) {
      delivered = await this.notificationsService.notifyMany(
        recipientIds,
        'BROADCAST',
        dto.title,
        dto.body,
      );
      await this.prisma.broadcast.update({
        where: { id: broadcast.id },
        data: { deliveredCount: delivered },
      });
    }

    return this.findDetailed(broadcast.id, organizationId);
  }

  async findAll(organizationId: string) {
    const broadcasts = await this.prisma.broadcast.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { name: true } },
        grade: { select: { name: true, level: true } },
      },
    });

    return broadcasts.map((b) => ({
      id: b.id,
      title: b.title,
      body: b.body,
      targetRoles: b.targetRoles,
      targetGradeId: b.targetGradeId,
      createdById: b.createdById,
      organizationId: b.organizationId,
      deliveredCount: b.deliveredCount,
      createdAt: b.createdAt.toISOString(),
      createdByName: b.createdBy.name,
      targetGradeName: b.grade?.name ?? null,
      targetGradeLevel: b.grade?.level ?? null,
    }));
  }

  private async findDetailed(id: string, organizationId: string) {
    const b = await this.prisma.broadcast.findFirst({
      where: { id, organizationId },
      include: {
        createdBy: { select: { name: true } },
        grade: { select: { name: true, level: true } },
      },
    });
    if (!b) {
      throw new ApiError(
        ErrorCode.BROADCAST_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This broadcast could not be found.',
      );
    }
    return {
      id: b.id,
      title: b.title,
      body: b.body,
      targetRoles: b.targetRoles,
      targetGradeId: b.targetGradeId,
      createdById: b.createdById,
      organizationId: b.organizationId,
      deliveredCount: b.deliveredCount,
      createdAt: b.createdAt.toISOString(),
      createdByName: b.createdBy.name,
      targetGradeName: b.grade?.name ?? null,
      targetGradeLevel: b.grade?.level ?? null,
    };
  }
}
