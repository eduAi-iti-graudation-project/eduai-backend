import { Injectable, HttpStatus } from '@nestjs/common';
import type { AiChatKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import type { AiChatConversationDto, AiChatMessageDto } from './dto';

export type AiChatRole = 'user' | 'assistant';

interface ConversationWithMeta {
  id: string;
  kind: AiChatKind;
  courseOfferingId: string | null;
  studentId: string | null;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{ content: string; role: string }>;
  _count: { messages: number };
}

/**
 * Shared persistence for the AI chats (assistant + guardian). Each
 * conversation is owned by a user, scoped by kind, and stores an ordered
 * message log so history survives refresh like a ChatGPT thread.
 */
@Injectable()
export class AiChatService {
  /**
   * Conversations are bounded on purpose: only the most recent ones are kept
   * per user + kind. Anything older is pruned so history never accumulates
   * into thousands of stale threads.
   */
  private readonly MAX_CONVERSATIONS = 20;

  constructor(private readonly prisma: PrismaService) {}

  async createConversation(
    userId: string,
    kind: AiChatKind,
    scope: { courseOfferingId?: string; studentId?: string },
  ): Promise<AiChatConversationDto> {
    const conversation = await this.prisma.aiChatConversation.create({
      data: {
        userId,
        kind,
        courseOfferingId: scope.courseOfferingId ?? null,
        studentId: scope.studentId ?? null,
      },
    });

    await this.pruneConversations(userId, kind);

    return this.mapConversation({
      ...conversation,
      messages: [],
      _count: { messages: 0 },
    });
  }

  async getOwnedConversation(
    userId: string,
    conversationId: string,
    kind: AiChatKind,
  ): Promise<AiChatConversationDto> {
    const conversation = await this.conversationWithMeta(
      userId,
      conversationId,
      kind,
    );
    return this.mapConversation(conversation);
  }

  async listConversations(
    userId: string,
    kind: AiChatKind,
  ): Promise<AiChatConversationDto[]> {
    await this.pruneConversations(userId, kind);

    const conversations = await this.prisma.aiChatConversation.findMany({
      where: { userId, kind },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return conversations.map((c) => this.mapConversation(c));
  }

  async getMessages(
    userId: string,
    conversationId: string,
    kind: AiChatKind,
  ): Promise<AiChatMessageDto[]> {
    await this.conversationWithMeta(userId, conversationId, kind);

    const messages = await this.prisma.aiChatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role as AiChatRole,
      content: m.content,
      sources: this.sourcesOf(m.sources),
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async addUserMessage(
    conversationId: string,
    content: string,
  ): Promise<AiChatMessageDto> {
    const message = await this.prisma.aiChatMessage.create({
      data: { conversationId, role: 'user', content },
    });

    // ChatGPT-style title: derived from the first user message, once.
    await this.prisma.aiChatConversation.updateMany({
      where: { id: conversationId, title: null },
      data: { title: content.slice(0, 80) },
    });

    return this.mapMessage(message);
  }

  async addAssistantMessage(
    conversationId: string,
    content: string,
    sources?: string[],
  ): Promise<AiChatMessageDto> {
    const message = await this.prisma.aiChatMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content,
        ...(sources && sources.length > 0 ? { sources } : {}),
      },
    });

    return this.mapMessage(message);
  }

  async deleteConversation(
    userId: string,
    conversationId: string,
    kind: AiChatKind,
  ): Promise<void> {
    await this.getOwnedConversation(userId, conversationId, kind);
    await this.prisma.aiChatConversation.delete({
      where: { id: conversationId },
    });
  }

  private async pruneConversations(
    userId: string,
    kind: AiChatKind,
  ): Promise<void> {
    const all = await this.prisma.aiChatConversation.findMany({
      where: { userId, kind },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

    const toDelete = all.slice(this.MAX_CONVERSATIONS).map((c) => c.id);
    if (toDelete.length > 0) {
      await this.prisma.aiChatConversation.deleteMany({
        where: { id: { in: toDelete } },
      });
    }
  }

  private async conversationWithMeta(
    userId: string,
    conversationId: string,
    kind: AiChatKind,
  ): Promise<ConversationWithMeta> {
    const conversation = await this.prisma.aiChatConversation.findFirst({
      where: { id: conversationId, userId, kind },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true },
        },
        _count: { select: { messages: true } },
      },
    });

    if (!conversation) {
      throw new ApiError(
        ErrorCode.CONVERSATION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This conversation could not be found.',
      );
    }

    return {
      id: conversation.id,
      kind: conversation.kind,
      courseOfferingId: conversation.courseOfferingId,
      studentId: conversation.studentId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages,
      _count: conversation._count,
    };
  }

  private mapConversation(
    conversation: ConversationWithMeta,
  ): AiChatConversationDto {
    const last = conversation.messages[0] ?? null;
    return {
      id: conversation.id,
      kind: conversation.kind,
      courseOfferingId: conversation.courseOfferingId,
      studentId: conversation.studentId,
      title: conversation.title,
      lastMessage: last?.content ?? null,
      lastMessageRole: (last?.role as AiChatRole) ?? null,
      messageCount: conversation._count.messages,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private mapMessage(message: {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    sources: unknown;
    createdAt: Date;
  }): AiChatMessageDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      role: message.role as AiChatRole,
      content: message.content,
      sources: this.sourcesOf(message.sources),
      createdAt: message.createdAt.toISOString(),
    };
  }

  private sourcesOf(sources: unknown): string[] | null {
    if (Array.isArray(sources) && sources.every((s) => typeof s === 'string')) {
      return sources;
    }
    return null;
  }
}
