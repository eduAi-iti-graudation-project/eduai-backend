import { Injectable, HttpStatus } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async createThreadOrGet(
    user: User,
    courseOfferingId: string,
    studentId?: string,
  ): Promise<{
    id: string;
    courseOfferingId: string;
    teacherId: string;
    studentId: string;
    createdAt: string;
    updatedAt: string;
  }> {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: courseOfferingId },
    });

    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }

    const teacherInitiated = studentId !== undefined;
    if (teacherInitiated) {
      if (offering.teacherId !== user.id) {
        throw new ApiError(
          ErrorCode.CHAT_FORBIDDEN,
          HttpStatus.FORBIDDEN,
          'Only the class teacher can start a conversation with a student.',
        );
      }
    }

    const targetStudentId = teacherInitiated ? studentId : user.id;
    await this.assertApprovedEnrollment(offering.sectionId, targetStudentId);

    const thread = await this.prisma.chatThread.upsert({
      where: {
        teacherId_studentId_courseOfferingId: {
          teacherId: offering.teacherId,
          studentId: targetStudentId,
          courseOfferingId,
        },
      },
      update: {},
      create: {
        teacherId: offering.teacherId,
        studentId: targetStudentId,
        courseOfferingId,
      },
    });

    return {
      id: thread.id,
      courseOfferingId: thread.courseOfferingId,
      teacherId: thread.teacherId,
      studentId: thread.studentId,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    };
  }

  async listThreads(user: User): Promise<
    Array<{
      id: string;
      courseOfferingId: string;
      teacherId: string;
      studentId: string;
      createdAt: string;
      updatedAt: string;
      className: string | null;
      peerId: string;
      peerName: string;
      lastMessage: string | null;
      lastMessageAuthorId: string | null;
      unreadCount: number;
    }>
  > {
    const where =
      user.role === 'TEACHER' ? { teacherId: user.id } : { studentId: user.id };

    const threads = await this.prisma.chatThread.findMany({
      where,
      include: {
        offering: {
          select: {
            id: true,
            course: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
        teacher: { select: { id: true, name: true } },
        student: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { text: true, authorId: true },
        },
        _count: {
          select: {
            messages: {
              where: { authorId: { not: user.id }, readAt: null },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return threads.map((thread) => {
      const isTeacher = user.role === 'TEACHER';
      const peer = isTeacher ? thread.student : thread.teacher;
      const lastMessage = thread.messages[0] ?? null;
      return {
        id: thread.id,
        courseOfferingId: thread.courseOfferingId,
        teacherId: thread.teacherId,
        studentId: thread.studentId,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        className:
          thread.offering.course.name ?? thread.offering.section.name ?? null,
        peerId: peer.id,
        peerName: peer.name,
        lastMessage: lastMessage?.text ?? null,
        lastMessageAuthorId: lastMessage?.authorId ?? null,
        unreadCount: thread._count.messages,
      };
    });
  }

  async getMessages(
    threadId: string,
    userId: string,
    before?: string,
    limit = 100,
  ): Promise<{
    items: Array<{
      id: string;
      threadId: string;
      authorId: string;
      text: string;
      readAt: string | null;
      createdAt: string;
    }>;
    nextCursor: string | null;
  }> {
    await this.assertParticipant(threadId, userId);

    const pageSize = Math.max(1, Math.min(200, Number(limit) || 100));

    const cursor = before
      ? await this.prisma.chatMessage.findUnique({ where: { id: before } })
      : null;

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        threadId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  createdAt: cursor.createdAt,
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
    });

    const hasMore = messages.length > pageSize;
    const page = (hasMore ? messages.slice(0, pageSize) : messages).reverse();

    return {
      items: page.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        authorId: m.authorId,
        text: m.text,
        readAt: m.readAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      nextCursor: page.length > 0 && hasMore ? page[0].id : null,
    };
  }

  async sendMessage(
    threadId: string,
    userId: string,
    text: string,
  ): Promise<{
    id: string;
    threadId: string;
    authorId: string;
    text: string;
    readAt: string | null;
    createdAt: string;
  }> {
    await this.assertParticipant(threadId, userId);

    const message = await this.prisma.chatMessage.create({
      data: { threadId, authorId: userId, text },
    });

    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });

    return {
      id: message.id,
      threadId: message.threadId,
      authorId: message.authorId,
      text: message.text,
      readAt: message.readAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  async markRead(threadId: string, userId: string): Promise<void> {
    await this.assertParticipant(threadId, userId);

    await this.prisma.chatMessage.updateMany({
      where: { threadId, authorId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
  }

  private async assertApprovedEnrollment(
    sectionId: string,
    studentId: string,
  ): Promise<void> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { sectionId_studentId: { sectionId, studentId } },
    });

    if (!enrollment || enrollment.status !== 'APPROVED') {
      throw new ApiError(
        ErrorCode.CHAT_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'A conversation requires an approved enrollment in this class.',
      );
    }
  }

  private async assertParticipant(
    threadId: string,
    userId: string,
  ): Promise<void> {
    const thread = await this.prisma.chatThread.findUnique({
      where: { id: threadId },
    });

    if (!thread) {
      throw new ApiError(
        ErrorCode.THREAD_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This conversation could not be found.',
      );
    }

    if (thread.teacherId !== userId && thread.studentId !== userId) {
      throw new ApiError(
        ErrorCode.THREAD_NOT_PARTICIPANT,
        HttpStatus.FORBIDDEN,
        'You are not a participant in this conversation.',
      );
    }
  }
}
