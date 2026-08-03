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
  });

  describe('getMessages', () => {
    it('rejects a non-participant', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);

      await expect(
        service.getMessages('thread-1', 'intruder-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns messages for a participant with a next cursor', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);
      mockPrisma.chatMessage.findUnique.mockResolvedValue(null);
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        {
          id: 'msg-1',
          threadId: 'thread-1',
          authorId: 'teacher-1',
          text: 'hello',
          readAt: null,
          createdAt: new Date('2026-01-01T00:00:01Z'),
        },
      ]);

      const result = await service.getMessages('thread-1', 'student-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].text).toBe('hello');
      expect(result.nextCursor).toBe('msg-1');
    });

    it('caps the page at the limit', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);
      mockPrisma.chatMessage.findUnique.mockResolvedValue(null);
      mockPrisma.chatMessage.findMany.mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => ({
          id: `msg-${i}`,
          threadId: 'thread-1',
          authorId: 'teacher-1',
          text: `m${i}`,
          readAt: null,
          createdAt: new Date(2026, 0, 1, 0, 0, i),
        })),
      );

      const result = await service.getMessages(
        'thread-1',
        'student-1',
        undefined,
        2,
      );
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('msg-1');
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
    it('scopes a teacher to threads they own', async () => {
      mockPrisma.chatThread.findMany.mockResolvedValue([
        {
          ...threadRow,
          class: { id: 'class-1', name: 'Math' },
          teacher: { id: 'teacher-1', name: 'T' },
          student: { id: 'student-1', name: 'S' },
          messages: [{ text: 'last' }],
        },
      ]);

      const result = await service.listThreads(teacher);

      expect(mockPrisma.chatThread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { teacherId: 'teacher-1' } }),
      );
      expect(result[0].peerId).toBe('student-1');
      expect(result[0].lastMessage).toBe('last');
    });
  });
});
