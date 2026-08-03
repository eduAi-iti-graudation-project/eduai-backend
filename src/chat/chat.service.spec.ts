import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '@prisma/client';

describe('ChatService', () => {
  let service: ChatService;

  const student = { id: 'student-1', role: 'STUDENT' } as User;
  const teacher = { id: 'teacher-1', role: 'TEACHER' } as User;

  const threadRow = {
    id: 'thread-1',
    classId: 'class-1',
    teacherId: 'teacher-1',
    studentId: 'student-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const mockPrisma = {
    class: { findUnique: jest.fn() },
    enrollment: { findUnique: jest.fn() },
    chatThread: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    chatMessage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    jest.clearAllMocks();
  });

  describe('createThreadOrGet', () => {
    it('creates a thread when the student is APPROVED in the class', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        status: 'APPROVED',
      });
      mockPrisma.chatThread.upsert.mockResolvedValue(threadRow);

      const result = await service.createThreadOrGet(student, 'class-1');

      expect(mockPrisma.chatThread.upsert).toHaveBeenCalledWith({
        where: {
          teacherId_studentId_classId: {
            teacherId: 'teacher-1',
            studentId: 'student-1',
            classId: 'class-1',
          },
        },
        update: {},
        create: {
          teacherId: 'teacher-1',
          studentId: 'student-1',
          classId: 'class-1',
        },
      });
      expect(result.id).toBe('thread-1');
    });

    it('rejects when enrollment is not APPROVED', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'PENDING' });

      await expect(
        service.createThreadOrGet(student, 'class-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.chatThread.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFound when the class does not exist', async () => {
      mockPrisma.class.findUnique.mockResolvedValue(null);

      await expect(
        service.createThreadOrGet(student, 'class-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a thread when the class teacher initiates with an approved student', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        status: 'APPROVED',
      });
      mockPrisma.chatThread.upsert.mockResolvedValue(threadRow);

      const result = await service.createThreadOrGet(
        teacher,
        'class-1',
        'student-1',
      );

      expect(mockPrisma.chatThread.upsert).toHaveBeenCalledWith({
        where: {
          teacherId_studentId_classId: {
            teacherId: 'teacher-1',
            studentId: 'student-1',
            classId: 'class-1',
          },
        },
        update: {},
        create: {
          teacherId: 'teacher-1',
          studentId: 'student-1',
          classId: 'class-1',
        },
      });
      expect(result.id).toBe('thread-1');
    });

    it('rejects a teacher who does not own the class', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'teacher-other',
      });

      await expect(
        service.createThreadOrGet(teacher, 'class-1', 'student-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.chatThread.upsert).not.toHaveBeenCalled();
    });

    it('rejects a teacher initiating with a non-approved student', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'PENDING' });

      await expect(
        service.createThreadOrGet(teacher, 'class-1', 'student-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.chatThread.upsert).not.toHaveBeenCalled();
    });

    it('rejects a student passing a studentId', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'teacher-1',
      });

      await expect(
        service.createThreadOrGet(student, 'class-1', 'student-other'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.chatThread.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    it('rejects a non-participant', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);

      await expect(
        service.getMessages('thread-1', 'intruder-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns the latest messages ascending with a next cursor when older exist', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { id: 'm5', createdAt: new Date('2026-01-01T00:00:05Z') },
        { id: 'm4', createdAt: new Date('2026-01-01T00:00:04Z') },
        { id: 'm3', createdAt: new Date('2026-01-01T00:00:03Z') },
      ]);

      const result = await service.getMessages(
        'thread-1',
        'student-1',
        undefined,
        2,
      );

      expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 3,
        }),
      );
      expect(result.items.map((m) => m.id)).toEqual(['m4', 'm5']);
      expect(result.nextCursor).toBe('m4');
    });

    it('returns nextCursor null when the tail is exhausted', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { id: 'm2', createdAt: new Date('2026-01-01T00:00:02Z') },
        { id: 'm1', createdAt: new Date('2026-01-01T00:00:01Z') },
      ]);

      const result = await service.getMessages(
        'thread-1',
        'student-1',
        undefined,
        2,
      );

      expect(result.items.map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(result.nextCursor).toBeNull();
    });

    it('returns the messages strictly older than the cursor, newest page first', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);
      mockPrisma.chatMessage.findUnique.mockResolvedValue({
        id: 'm4',
        createdAt: new Date('2026-01-01T00:00:04Z'),
      });
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { id: 'm3', createdAt: new Date('2026-01-01T00:00:03Z') },
        { id: 'm2', createdAt: new Date('2026-01-01T00:00:02Z') },
      ]);

      const result = await service.getMessages(
        'thread-1',
        'student-1',
        'm4',
        1,
      );

      expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            threadId: 'thread-1',
            OR: [
              { createdAt: { lt: new Date('2026-01-01T00:00:04Z') } },
              {
                createdAt: new Date('2026-01-01T00:00:04Z'),
                id: { lt: 'm4' },
              },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 2,
        }),
      );
      expect(result.items.map((m) => m.id)).toEqual(['m3']);
      expect(result.nextCursor).toBe('m3');
    });

    it('coerces a string limit without 500ing', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { id: 'm2', createdAt: new Date('2026-01-01T00:00:02Z') },
        { id: 'm1', createdAt: new Date('2026-01-01T00:00:01Z') },
      ]);

      const result = await service.getMessages(
        'thread-1',
        'student-1',
        undefined,
        '2' as unknown as number,
      );

      expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
      expect(result.items).toHaveLength(2);
    });
  });

  describe('sendMessage', () => {
    it('rejects a non-participant', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);

      await expect(
        service.sendMessage('thread-1', 'intruder-1', 'hi'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('persists a message for a participant authored by the sender', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'msg-9',
        threadId: 'thread-1',
        authorId: 'student-1',
        text: 'hi',
        readAt: null,
        createdAt: new Date('2026-01-01T00:00:05Z'),
      });
      mockPrisma.chatThread.update.mockResolvedValue(threadRow);

      const result = await service.sendMessage('thread-1', 'student-1', 'hi');

      expect(mockPrisma.chatMessage.create).toHaveBeenCalledWith({
        data: { threadId: 'thread-1', authorId: 'student-1', text: 'hi' },
      });
      expect(result.authorId).toBe('student-1');
    });
  });

  describe('markRead', () => {
    it('marks only counterparty messages as read', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);

      await service.markRead('thread-1', 'student-1');

      expect(mockPrisma.chatMessage.updateMany).toHaveBeenCalledWith({
        where: {
          threadId: 'thread-1',
          authorId: { not: 'student-1' },
          readAt: null,
        },
        data: { readAt: expect.any(Date) as Date },
      });
    });
  });

  describe('listThreads', () => {
    it('scopes a teacher to threads they own and reports unread counts', async () => {
      mockPrisma.chatThread.findMany.mockResolvedValue([
        {
          ...threadRow,
          class: { id: 'class-1', name: 'Math' },
          teacher: { id: 'teacher-1', name: 'T' },
          student: { id: 'student-1', name: 'S' },
          messages: [{ text: 'last', authorId: 'student-1' }],
          _count: { messages: 3 },
        },
      ]);

      const result = await service.listThreads(teacher);

      expect(mockPrisma.chatThread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { teacherId: 'teacher-1' } }),
      );
      expect(result[0].peerId).toBe('student-1');
      expect(result[0].lastMessage).toBe('last');
      expect(result[0].lastMessageAuthorId).toBe('student-1');
      expect(result[0].unreadCount).toBe(3);
    });
  });
});
