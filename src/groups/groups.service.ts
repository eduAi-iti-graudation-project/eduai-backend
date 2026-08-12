import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import type { User } from '@prisma/client';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  private async findGroupedOrg(user: User) {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        organization: {
          include: {
            group: {
              include: {
                organizations: {
                  select: {
                    id: true,
                    name: true,
                    joinCode: true,
                    _count: { select: { users: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const organization = row?.organization;
    if (!organization?.group) {
      throw new ApiError(
        ErrorCode.GROUP_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your school is not part of a group yet.',
      );
    }
    return organization;
  }

  async findMine(user: User) {
    const organization = await this.findGroupedOrg(user);
    const group = organization.group!;

    return {
      id: group.id,
      name: group.name,
      subscriptionTier: group.subscriptionTier,
      subscriptionStatus: group.subscriptionStatus,
      seatLimit: group.seatLimit,
      schools: group.organizations.map((school) => ({
        id: school.id,
        name: school.name,
        joinCode: school.joinCode,
        seatUsage: school._count.users,
        subscriptionTier: group.subscriptionTier,
      })),
    };
  }

  async insights(user: User) {
    const organization = await this.findGroupedOrg(user);
    const group = organization.group!;

    const schools = await Promise.all(
      group.organizations.map(async (school) => {
        const [students, teachers, activeAlerts, quizAttempts] =
          await Promise.all([
            this.prisma.user.count({
              where: { organizationId: school.id, role: 'STUDENT' },
            }),
            this.prisma.user.count({
              where: { organizationId: school.id, role: 'TEACHER' },
            }),
            this.prisma.alert.count({
              where: {
                status: 'ACTIVE',
                student: { organizationId: school.id },
              },
            }),
            this.prisma.quizAttempt.count({
              where: { student: { organizationId: school.id } },
            }),
          ]);
        return {
          id: school.id,
          name: school.name,
          users: school._count.users,
          students,
          teachers,
          activeAlerts,
          quizAttempts,
        };
      }),
    );

    const totals = schools.reduce(
      (acc, school) => ({
        users: acc.users + school.users,
        students: acc.students + school.students,
        teachers: acc.teachers + school.teachers,
        activeAlerts: acc.activeAlerts + school.activeAlerts,
        quizAttempts: acc.quizAttempts + school.quizAttempts,
      }),
      {
        users: 0,
        students: 0,
        teachers: 0,
        activeAlerts: 0,
        quizAttempts: 0,
      },
    );

    return {
      id: group.id,
      name: group.name,
      schools,
      totals,
    };
  }

  /** WP5: create a group, assign the current org, move its billing home. */
  async create(user: User, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: user.organizationId },
      });
      if (!organization) {
        throw new ApiError(
          ErrorCode.ORG_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'Your organization could not be found.',
        );
      }
      const group = await tx.schoolGroup.create({
        data: {
          name,
          stripeCustomerId: organization.stripeCustomerId,
          stripeSubscriptionId: organization.stripeSubscriptionId,
          subscriptionTier: organization.subscriptionTier,
          subscriptionStatus: organization.subscriptionStatus,
          seatLimit: organization.seatLimit,
        },
      });
      await tx.organization.update({
        where: { id: organization.id },
        data: {
          groupId: group.id,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
        },
      });
      return {
        id: group.id,
        name: group.name,
        message:
          'Your school group is ready. Schools can be added by their join code later.',
      };
    });
  }
}
