import { PrismaService } from '../prisma/prisma.service';
import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import * as nodemailer from 'nodemailer';
import { Prisma } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly prisma: PrismaService) {
    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    ) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT ?? '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
  }

  async notifyTeacher(
    submission: { id: string; assignmentId: string; studentId: string },
    event: string,
  ): Promise<void> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: submission.assignmentId },
      include: { offering: true },
    });
    if (assignment?.offering) {
      await this.notifyUser(
        assignment.offering.teacherId,
        event,
        'Grading complete',
        `Submission ${submission.id} has been graded and is ready for review.`,
      );
    }
  }

  async notifyUser(
    userId: string,
    type: string,
    title: string,
    body?: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        type,
        channel: 'EMAIL',
        title,
        body,
        data: data as Prisma.InputJsonValue | undefined,
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (this.transporter && user?.email) {
      this.transporter
        .sendMail({
          from: process.env.SMTP_FROM || 'noreply@eduai.app',
          to: user.email,
          subject: title,
          text: body ?? title,
        })
        .catch((err) =>
          this.logger.error(`Failed to send email to ${user.email}`, err),
        );
    }
  }

  async notifyTeachers(
    courseOfferingId: string,
    type: string,
    title: string,
    body?: string,
  ): Promise<void> {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: courseOfferingId },
      include: { teacher: true },
    });
    if (!offering) {
      this.logger.warn(`Class ${courseOfferingId} not found for notification`);
      return;
    }
    await this.notifyUser(offering.teacherId, type, title, body);
  }

  async notifyMany(
    userIds: string[],
    type: string,
    title: string,
    body?: string,
    data?: Record<string, unknown>,
  ): Promise<number> {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return 0;

    await this.prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        type,
        channel: 'EMAIL' as const,
        title,
        body,
        data: data as Prisma.InputJsonValue | undefined,
      })),
    });

    if (this.transporter) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { email: true },
      });
      for (const user of users) {
        if (!user.email) continue;
        this.transporter
          .sendMail({
            from: process.env.SMTP_FROM || 'noreply@eduai.app',
            to: user.email,
            subject: title,
            text: body ?? title,
          })
          .catch((err) =>
            this.logger.error(`Failed to send email to ${user.email}`, err),
          );
      }
    }

    return ids.length;
  }

  async findAll(userId?: string): Promise<unknown[]> {
    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(id: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) {
      throw new ApiError(
        ErrorCode.NOTIFICATION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This notification could not be found.',
      );
    }
    await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
