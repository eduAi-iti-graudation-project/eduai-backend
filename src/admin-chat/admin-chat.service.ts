import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { InsightsService } from '../dashboard/insights.service';
import { AiChatService } from '../ai-chat/ai-chat.service';
import type { AiChatConversationDto, AiChatMessageDto } from '../ai-chat/dto';
import { AdminSupervisor } from './admin-supervisor.agent';
import type { AdminChatEvent, AdminChatRequestDto } from './dto';

@Injectable()
export class AdminChatService {
  private readonly logger = new Logger(AdminChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardService: DashboardService,
    private readonly insightsService: InsightsService,
    private readonly supervisor: AdminSupervisor,
    private readonly aiChat: AiChatService,
  ) {}

  async chat(
    user: User,
    dto: AdminChatRequestDto,
    onEvent?: (event: AdminChatEvent) => void,
  ): Promise<{ reply: string; sources: string[]; conversationId: string }> {
    let conversation: AiChatConversationDto;
    if (dto.conversationId) {
      conversation = await this.aiChat.getOwnedConversation(
        user.id,
        dto.conversationId,
        'ADMIN',
      );
    } else {
      conversation = await this.aiChat.createConversation(user.id, 'ADMIN', {
        studentId: dto.scopeStudentId,
      });
    }

    const conversationId = conversation.id;
    const scopeStudentId = conversation.studentId ?? dto.scopeStudentId;

    const stored = dto.conversationId
      ? await this.aiChat.getMessages(user.id, conversationId, 'ADMIN')
      : [];
    const history = stored.map((m) => ({ role: m.role, content: m.content }));

    const schoolContext = await this.buildContext(
      user,
      scopeStudentId,
      dto.scopeTeacherId,
    );

    await this.aiChat.addUserMessage(conversationId, dto.newMessage);

    try {
      const result = await this.supervisor.respond({
        schoolContext,
        history: [...history, { role: 'user', content: dto.newMessage }],
        question: dto.newMessage,
        onStep: (step) => onEvent?.({ type: 'step', step }),
      });
      const data = { ...result, conversationId };
      await this.aiChat.addAssistantMessage(
        conversationId,
        result.reply,
        result.sources,
      );
      onEvent?.({ type: 'done', data });
      return data;
    } catch (error) {
      this.logger.warn(
        `Admin chat generation failed; returning graceful reply: ${String(error)}`,
      );
      const fallback = {
        reply:
          'I hit a snag pulling together that answer. Please try again in a moment.',
        sources: [] as string[],
        conversationId,
      };
      await this.aiChat.addAssistantMessage(
        conversationId,
        fallback.reply,
        fallback.sources,
      );
      onEvent?.({ type: 'done', data: fallback });
      return fallback;
    }
  }

  private async buildContext(
    user: User,
    scopeStudentId?: string,
    scopeTeacherId?: string,
  ): Promise<Record<string, unknown>> {
    const orgId = user.organizationId!;

    const [overview, alerts, pendingJoinRequests, organization] =
      await Promise.all([
        this.dashboardService.getOverview(user).catch(() => null),
        this.prisma.alert.findMany({
          where: { status: 'ACTIVE', student: { organizationId: orgId } },
          include: { student: true },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
        this.prisma.joinRequest.count({
          where: { organizationId: orgId, status: 'PENDING' },
        }),
        this.prisma.organization.findUnique({
          where: { id: orgId },
          select: {
            name: true,
            subscriptionStatus: true,
            subscriptionTier: true,
            trialReminderSentAt: true,
            trialExpiredSentAt: true,
            createdAt: true,
          },
        }),
      ]);

    let insights: unknown = null;
    try {
      insights = await this.insightsService.getInsights(user, 'week');
    } catch (error) {
      this.logger.warn(
        `Admin insights unavailable for chat context: ${String(error)}`,
      );
    }

    let scope: Record<string, unknown> | null = null;
    if (scopeStudentId) {
      scope = await this.studentProfile(orgId, scopeStudentId);
    } else if (scopeTeacherId) {
      scope = await this.teacherProfile(orgId, scopeTeacherId);
    }

    return {
      overview,
      insights,
      activeAlerts: alerts.map((a) => ({
        studentName: a.student.name,
        type: a.type,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
        severity: a.type === 'FAILING' ? 'HIGH' : 'MEDIUM',
      })),
      pendingJoinRequests,
      billing: organization,
      scope,
    };
  }

  private async studentProfile(
    orgId: string,
    studentId: string,
  ): Promise<Record<string, unknown> | null> {
    const [student, attendance, grades, alerts, enrollments] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: studentId },
          select: { id: true, name: true, organizationId: true },
        }),
        this.prisma.attendance.findMany({ where: { studentId } }),
        this.prisma.gradingScore.findMany({
          where: { isConfirmed: true, submission: { studentId } },
          include: {
            criteria: true,
            submission: {
              include: { assignment: { select: { title: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.alert.findMany({
          where: { studentId, status: 'ACTIVE' },
        }),
        this.prisma.enrollment.findMany({
          where: { studentId },
          include: {
            section: {
              include: { offerings: { include: { course: true } } },
            },
          },
        }),
      ]);

    if (!student || student.organizationId !== orgId) return null;

    const present = attendance.filter((a) => a.status === 'PRESENT').length;
    const classes = Array.from(
      new Set(
        enrollments.flatMap((e) =>
          e.section.offerings.map((o) => o.course.name ?? e.section.name),
        ),
      ),
    );

    return {
      kind: 'student',
      name: student.name,
      attendance: {
        total: attendance.length,
        present,
        absent: attendance.filter((a) => a.status === 'ABSENT').length,
        late: attendance.filter((a) => a.status === 'LATE').length,
        excused: attendance.filter((a) => a.status === 'EXCUSED').length,
        rate:
          attendance.length > 0
            ? Math.round((present / attendance.length) * 100)
            : 0,
      },
      classes,
      confirmedGrades: grades.map((g) => ({
        assignment: g.submission.assignment.title,
        pointsAwarded: g.pointsAwarded,
        maxPoints: g.criteria.maxPoints,
      })),
      activeAlerts: alerts.map((a) => ({ type: a.type, reason: a.reason })),
    };
  }

  private async teacherProfile(
    orgId: string,
    teacherId: string,
  ): Promise<Record<string, unknown> | null> {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { id: true, name: true, organizationId: true },
    });
    if (!teacher || teacher.organizationId !== orgId) return null;

    const offerings = await this.prisma.courseOffering.findMany({
      where: { teacherId, organizationId: orgId },
      include: {
        course: true,
        section: true,
        assignments: {
          include: {
            submissions: {
              include: {
                scores: { where: { isConfirmed: true } },
              },
            },
          },
        },
      },
      take: 50,
    });

    const confirmedScores = offerings.reduce(
      (sum, o) =>
        sum +
        o.assignments.reduce(
          (s, a) => s + a.submissions.reduce((x, sub) => x + sub.scores.length, 0),
          0,
        ),
      0,
    );

    return {
      kind: 'teacher',
      name: teacher.name,
      classes: Array.from(
        new Set(
          offerings.map((o) => o.course.name ?? o.section.name),
        ),
      ),
      classCount: offerings.length,
      confirmedScores,
    };
  }

  async listConversations(
    userId: string,
  ): Promise<{ items: AiChatConversationDto[] }> {
    const items = await this.aiChat.listConversations(userId, 'ADMIN');
    return { items };
  }

  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<AiChatMessageDto[]> {
    return this.aiChat.getMessages(userId, conversationId, 'ADMIN');
  }

  async deleteConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.aiChat.deleteConversation(userId, conversationId, 'ADMIN');
  }
}