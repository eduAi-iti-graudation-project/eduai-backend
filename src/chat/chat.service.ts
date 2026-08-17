import { Injectable, HttpStatus } from '@nestjs/common';
import type { User, AdminChatPeerRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

type ThreadKind = 'CLASS' | 'ADMIN';

interface MessageModel {
  findUnique(args: {
    where: { id: string };
  }): Promise<{ id: string; createdAt: Date } | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, string>>;
    take: number;
  }): Promise<
    Array<{
      id: string;
      threadId: string;
      authorId: string;
      text: string;
      readAt: Date | null;
      createdAt: Date;
    }>
  >;
  create(args: {
    data: { threadId: string; authorId: string; text: string };
  }): Promise<{
    id: string;
    threadId: string;
    authorId: string;
    text: string;
    readAt: Date | null;
    createdAt: Date;
  }>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: { readAt: Date };
  }): Promise<{ count: number }>;
}

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async createThreadOrGet(
    user: User,
    courseOfferingId: string,
    studentId?: string,
  ): Promise<{
    id: string;
    type: ThreadKind;
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
      type: 'CLASS',
      courseOfferingId: thread.courseOfferingId,
      teacherId: thread.teacherId,
      studentId: thread.studentId,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    };
  }

  async createAdminThreadOrGet(
    user: User,
    peerId: string,
    peerRole: AdminChatPeerRole,
  ): Promise<{
    id: string;
    type: ThreadKind;
    adminId: string;
    peerId: string;
    peerRole: AdminChatPeerRole;
    createdAt: string;
    updatedAt: string;
  }> {
    if (user.role !== 'ADMIN') {
      throw new ApiError(
        ErrorCode.CHAT_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'Only an admin can start a conversation with a teacher or guardian.',
      );
    }

    const peer = await this.prisma.user.findUnique({ where: { id: peerId } });
    if (
      !peer ||
      (peerRole === 'TEACHER' && peer.role !== 'TEACHER') ||
      (peerRole === 'GUARDIAN' && peer.role !== 'GUARDIAN')
    ) {
      throw new ApiError(
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'The person you are trying to message could not be found.',
      );
    }

    if (peer.organizationId !== user.organizationId) {
      throw new ApiError(
        ErrorCode.CHAT_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'You can only message people from your own organization.',
      );
    }

    const thread = await this.prisma.adminChatThread.upsert({
      where: {
        adminId_peerId_peerRole: {
          adminId: user.id,
          peerId,
          peerRole,
        },
      },
      update: {},
      create: { adminId: user.id, peerId, peerRole },
    });

    return {
      id: thread.id,
      type: 'ADMIN',
      adminId: thread.adminId,
      peerId: thread.peerId,
      peerRole: thread.peerRole,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    };
  }

  async listThreads(user: User): Promise<
    Array<{
      id: string;
      type: ThreadKind;
      courseOfferingId: string | null;
      teacherId: string | null;
      studentId: string | null;
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
    const classWhere =
      user.role === 'TEACHER' ? { teacherId: user.id } : { studentId: user.id };

    const classThreads = await this.prisma.chatThread.findMany({
      where: classWhere,
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

    const adminThreads =
      user.role === 'STUDENT'
        ? []
        : await this.prisma.adminChatThread.findMany({
            where:
              user.role === 'ADMIN'
                ? { adminId: user.id }
                : { peerId: user.id },
            include: {
              admin: { select: { id: true, name: true } },
              peer: { select: { id: true, name: true } },
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

    const classMapped = classThreads.map((thread) => {
      const isTeacher = user.role === 'TEACHER';
      const peer = isTeacher ? thread.student : thread.teacher;
      const lastMessage = thread.messages[0] ?? null;
      return {
        id: thread.id,
        type: 'CLASS' as const,
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

    const adminMapped = adminThreads.map((thread) => {
      const isAdmin = user.role === 'ADMIN';
      const peer = isAdmin ? thread.peer : thread.admin;
      const lastMessage = thread.messages[0] ?? null;
      return {
        id: thread.id,
        type: 'ADMIN' as const,
        courseOfferingId: null,
        teacherId: null,
        studentId: null,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        className: isAdmin
          ? thread.peerRole === 'GUARDIAN'
            ? 'Parent / Guardian'
            : 'Teacher'
          : 'School admin',
        peerId: peer.id,
        peerName: peer.name,
        lastMessage: lastMessage?.text ?? null,
        lastMessageAuthorId: lastMessage?.authorId ?? null,
        unreadCount: thread._count.messages,
      };
    });

    return [...classMapped, ...adminMapped].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
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
    const kind = await this.resolveThreadKind(threadId);
    await this.assertParticipant(threadId, userId, kind);
    const messagesModel = this.messageModel(kind);

    const pageSize = Math.max(1, Math.min(200, Number(limit) || 100));

    const cursor = before
      ? await messagesModel.findUnique({ where: { id: before } })
      : null;

    const messages = await messagesModel.findMany({
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
    const kind = await this.resolveThreadKind(threadId);
    await this.assertParticipant(threadId, userId, kind);
    const messagesModel = this.messageModel(kind);

    const message = await messagesModel.create({
      data: { threadId, authorId: userId, text },
    });

    if (kind === 'ADMIN') {
      await this.prisma.adminChatThread.update({
        where: { id: threadId },
        data: { updatedAt: new Date() },
      });
    } else {
      await this.prisma.chatThread.update({
        where: { id: threadId },
        data: { updatedAt: new Date() },
      });
    }

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
    const kind = await this.resolveThreadKind(threadId);
    await this.assertParticipant(threadId, userId, kind);

    await this.messageModel(kind).updateMany({
      where: { threadId, authorId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
  }

  private messageModel(kind: ThreadKind): MessageModel {
    return kind === 'ADMIN'
      ? this.prisma.adminChatMessage
      : this.prisma.chatMessage;
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

  private async resolveThreadKind(threadId: string): Promise<ThreadKind> {
    const [classThread, adminThread] = await Promise.all([
      this.prisma.chatThread.findUnique({ where: { id: threadId } }),
      this.prisma.adminChatThread.findUnique({ where: { id: threadId } }),
    ]);

    if (adminThread) return 'ADMIN';
    if (classThread) return 'CLASS';

    throw new ApiError(
      ErrorCode.THREAD_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'This conversation could not be found.',
    );
  }

  private async assertParticipant(
    threadId: string,
    userId: string,
    kind?: ThreadKind,
  ): Promise<void> {
    const resolvedKind = kind ?? (await this.resolveThreadKind(threadId));

    if (resolvedKind === 'ADMIN') {
      const thread = await this.prisma.adminChatThread.findUnique({
        where: { id: threadId },
      });
      if (!thread) {
        throw new ApiError(
          ErrorCode.THREAD_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This conversation could not be found.',
        );
      }
      if (thread.adminId !== userId && thread.peerId !== userId) {
        throw new ApiError(
          ErrorCode.THREAD_NOT_PARTICIPANT,
          HttpStatus.FORBIDDEN,
          'You are not a participant in this conversation.',
        );
      }
      return;
    }

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
