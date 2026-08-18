import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatService } from '../chat/chat.service';
import { HomeworkHelperAgent } from './homework-helper.agent';
import type {
  HomeworkHelpRequestDto,
  HomeworkHelpResponseDto,
  HomeworkHelpHistoryResponseDto,
  HomeworkHelpEvent,
} from './dto';

@Injectable()
export class HomeworkHelperService {
  private readonly logger = new Logger(HomeworkHelperService.name);

  constructor(
    private readonly agent: HomeworkHelperAgent,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly chatService: ChatService,
  ) {}

  async help(
    studentId: string,
    dto: HomeworkHelpRequestDto,
    onEvent?: (event: HomeworkHelpEvent) => void,
  ): Promise<HomeworkHelpResponseDto> {
    if (!dto.courseOfferingId) {
      throw new ApiError(
        ErrorCode.BAD_REQUEST,
        HttpStatus.BAD_REQUEST,
        'A course offering must be selected before asking for help.',
      );
    }

    const activeAttempt = await this.prisma.quizAttempt.findFirst({
      where: { studentId, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    if (activeAttempt) {
      throw new ApiError(
        ErrorCode.HOMEWORK_FORBIDDEN,
        HttpStatus.CONFLICT,
        'You cannot ask for help while a quiz is in progress.',
      );
    }

    const result = await this.agent.help({
      courseOfferingId: dto.courseOfferingId,
      studentId,
      question: dto.question,
      assignmentId: dto.assignmentId,
      onStep: (step) => onEvent?.({ type: 'step', step }),
    });

    let threadId: string | undefined;
    if (result.action === 'REDIRECT_TEACHER') {
      onEvent?.({ type: 'step', step: 'teacher' });
      threadId = await this.openTeacherThread(studentId, dto.courseOfferingId);
      await this.notifyTeacher(
        dto.courseOfferingId,
        studentId,
        dto.question,
        threadId,
      );
    }

    const response: HomeworkHelpResponseDto = {
      answer: result.answer,
      reply: threadId
        ? `${result.answer}\n\nI've opened a chat thread with your teacher — you can continue the conversation there.`
        : result.answer,
      action: result.action,
      sources: result.sources,
      interactionId: result.interactionId,
      teacherNotified: result.action === 'REDIRECT_TEACHER',
      ...(threadId ? { threadId } : {}),
    };

    onEvent?.({ type: 'done', data: response });
    return response;
  }

  async getHistory(
    studentId: string,
    courseOfferingId?: string,
  ): Promise<HomeworkHelpHistoryResponseDto> {
    const where: Record<string, unknown> = { studentId };
    if (courseOfferingId) where.courseOfferingId = courseOfferingId;

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
      throw new ApiError(
        ErrorCode.INTERACTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This interaction could not be found.',
      );
    }

    if (interaction.studentId !== studentId) {
      throw new ApiError(
        ErrorCode.HOMEWORK_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'You can only provide feedback on your own interactions.',
      );
    }

    await this.prisma.homeworkHelpInteraction.update({
      where: { id: interactionId },
      data: { feedback },
    });
  }

  private async openTeacherThread(
    studentId: string,
    courseOfferingId: string,
  ): Promise<string | undefined> {
    try {
      const student = await this.prisma.user.findUnique({
        where: { id: studentId },
      });
      if (!student) return undefined;

      const thread = await this.chatService.createThreadOrGet(
        student,
        courseOfferingId,
      );
      return thread.id;
    } catch (error) {
      this.logger.warn(
        `Could not open teacher chat thread for student ${studentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private async notifyTeacher(
    courseOfferingId: string,
    studentId: string,
    question: string,
    threadId?: string,
  ): Promise<void> {
    const [offering, student] = await Promise.all([
      this.prisma.courseOffering.findUnique({
        where: { id: courseOfferingId },
      }),
      this.prisma.user.findUnique({ where: { id: studentId } }),
    ]);

    if (!offering) return;

    await this.notificationsService.notifyUser(
      offering.teacherId,
      'HOMEWORK_HELP_REDIRECT',
      `${student?.name ?? 'A student'} needs your help`,
      `Student asked: "${question}"\n\nThe AI assistant redirected them to you because the question requires your judgment.` +
        (threadId
          ? `\n\nYou can reply to them in the class chat thread: ${threadId}`
          : ''),
      {
        threadId: threadId ?? null,
        studentId,
        studentName: student?.name ?? 'Student',
      },
    );
  }
}
