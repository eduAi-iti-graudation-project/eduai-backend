import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';

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
      include: { class: true },
    });
    if (assignment?.class) {
      await this.notifyUser(
        assignment.class.teacherId,
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
  ): Promise<void> {
    await this.prisma.notification.create({
      data: { userId, type, channel: 'EMAIL', title, body },
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
    classId: string,
    type: string,
    title: string,
    body?: string,
  ): Promise<void> {
    const classEntity = await this.prisma.class.findUnique({
      where: { id: classId },
      include: { teacher: true },
    });
    if (!classEntity) {
      this.logger.warn(`Class ${classId} not found for notification`);
      return;
    }
    await this.notifyUser(classEntity.teacherId, type, title, body);
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
    if (!notification) throw new NotFoundException('Notification not found');
    await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
