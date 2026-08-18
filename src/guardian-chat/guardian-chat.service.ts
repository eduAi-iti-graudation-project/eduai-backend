import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { GuardianService } from '../guardian/guardian.service';
import { AiChatService } from '../ai-chat/ai-chat.service';
import type { AiChatConversationDto, AiChatMessageDto } from '../ai-chat/dto';
import { GuardianChatAgent } from './guardian-chat.agent';
import type { GuardianChatEvent, GuardianChatRequestDto } from './dto';

@Injectable()
export class GuardianChatService {
  private readonly logger = new Logger(GuardianChatService.name);

  constructor(
    private readonly guardianService: GuardianService,
    private readonly agent: GuardianChatAgent,
    private readonly aiChat: AiChatService,
  ) {}

  async chat(
    user: User,
    dto: GuardianChatRequestDto,
    onEvent?: (event: GuardianChatEvent) => void,
  ): Promise<{ reply: string; sources: string[]; conversationId: string }> {
    let conversation: AiChatConversationDto;
    if (dto.conversationId) {
      conversation = await this.aiChat.getOwnedConversation(
        user.id,
        dto.conversationId,
        'GUARDIAN',
      );
    } else {
      conversation = await this.aiChat.createConversation(user.id, 'GUARDIAN', {
        studentId: dto.studentId,
      });
    }

    const conversationId = conversation.id;
    const studentId = conversation.studentId ?? dto.studentId;

    const stored = dto.conversationId
      ? await this.aiChat.getMessages(user.id, conversationId, 'GUARDIAN')
      : [];
    const history = stored.map((m) => ({ role: m.role, content: m.content }));

    onEvent?.({ type: 'step', step: 'read_insights' });
    const insights = await this.guardianService.wardInsights(user, studentId);

    onEvent?.({ type: 'step', step: 'read_grades' });
    onEvent?.({ type: 'step', step: 'read_attendance' });
    onEvent?.({ type: 'step', step: 'read_classes' });
    onEvent?.({ type: 'step', step: 'read_alerts' });

    const wardContext = this.buildContext(insights);

    onEvent?.({ type: 'step', step: 'thinking' });

    await this.aiChat.addUserMessage(conversationId, dto.newMessage);

    try {
      const result = await this.agent.respond({
        wardContext,
        history: [...history, { role: 'user', content: dto.newMessage }],
        question: dto.newMessage,
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
        `Guardian chat generation failed; returning graceful reply: ${String(error)}`,
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

  async listConversations(
    userId: string,
  ): Promise<{ items: AiChatConversationDto[] }> {
    const items = await this.aiChat.listConversations(userId, 'GUARDIAN');
    return { items };
  }

  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<AiChatMessageDto[]> {
    return this.aiChat.getMessages(userId, conversationId, 'GUARDIAN');
  }

  async deleteConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.aiChat.deleteConversation(userId, conversationId, 'GUARDIAN');
  }

  private buildContext(
    insights: Awaited<ReturnType<GuardianService['wardInsights']>>,
  ): Record<string, unknown> {
    return {
      ward: insights.ward,
      grades: insights.grades,
      attendance: insights.attendance,
      quizzes: {
        completed: insights.quizzes.completed,
        averageScorePct: insights.quizzes.averageScorePct,
        attempts: insights.quizzes.attempts.map((a) => ({
          quizTitle: a.quizTitle,
          percentage: a.percentage,
          submittedAt: a.submittedAt,
        })),
      },
      fees: {
        unpaidCount: insights.fees.unpaidCount,
        unpaidTotal: insights.fees.unpaidTotal,
      },
      openAlerts: insights.openAlerts,
    };
  }
}
