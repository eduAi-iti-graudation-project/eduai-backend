import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HomeworkHelperAgent } from './homework-helper.agent';
import type {
  HomeworkHelpRequestDto,
  HomeworkHelpResponseDto,
  HomeworkHelpHistoryResponseDto,
} from './dto';

@Injectable()
export class HomeworkHelperService {
  constructor(
    private readonly agent: HomeworkHelperAgent,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async help(
    studentId: string,
    dto: HomeworkHelpRequestDto,
  ): Promise<HomeworkHelpResponseDto> {
    const activeAttempt = await this.prisma.quizAttempt.findFirst({
      where: { studentId, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    if (activeAttempt) {
      throw new ForbiddenException(
        'You cannot ask for help while a quiz is in progress',
      );
    }

    const result = await this.agent.help({
      classId: dto.classId,
      studentId,
      question: dto.question,
      assignmentId: dto.assignmentId,
    });

    if (result.action === 'REDIRECT_TEACHER') {
      await this.notifyTeacher(dto.classId, studentId, dto.question);
    }

    return {
      answer: result.answer,
      reply: result.answer,
      action: result.action,
      sources: result.sources,
      interactionId: result.interactionId,
      teacherNotified: result.action === 'REDIRECT_TEACHER',
    };
  }

  async getHistory(
    studentId: string,
    classId?: string,
  ): Promise<HomeworkHelpHistoryResponseDto> {
    const where: Record<string, unknown> = { studentId };
    if (classId) where.classId = classId;

    const interactions = await this.prisma.homeworkHelpInteraction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      interactions: interactions.map((i) => ({
        id: i.id,
        question: i.question,
        answer: i.answer,
        action: i.action as 'HINT' | 'EXPLANATION' | 'REDIRECT_TEACHER',
        sources: i.sources as string[],
        feedback: i.feedback,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  async submitFeedback(
    interactionId: string,
    feedback: 'HELPFUL' | 'NOT_HELPFUL',
    studentId: string,
  ): Promise<void> {
    const interaction = await this.prisma.homeworkHelpInteraction.findUnique({
      where: { id: interactionId },
    });

    if (!interaction) {
      throw new NotFoundException('Interaction not found');
    }

    if (interaction.studentId !== studentId) {
      throw new ForbiddenException(
        'You can only provide feedback on your own interactions',
      );
    }

    await this.prisma.homeworkHelpInteraction.update({
      where: { id: interactionId },
      data: { feedback },
    });
  }

  private async notifyTeacher(
    classId: string,
    studentId: string,
    question: string,
  ): Promise<void> {
    const [classInfo, student] = await Promise.all([
      this.prisma.class.findUnique({ where: { id: classId } }),
      this.prisma.user.findUnique({ where: { id: studentId } }),
    ]);

    if (!classInfo) return;

    await this.notificationsService.notifyUser(
      classInfo.teacherId,
      'HOMEWORK_HELP_REDIRECT',
      `${student?.name ?? 'A student'} needs your help`,
      `Student asked: "${question}"\n\nThe AI assistant redirected them to you because the question requires your judgment.`,
    );
  }
}
