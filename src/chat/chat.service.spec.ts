import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '@prisma/client';

describe('ChatService', () => {
  let service: ChatService;

  const student = { id: 'student-1', role: 'STUDENT' } as User;
  const teacher = { id: 'teacher-1', role: 'TEACHER' } as User;

  const threadRow = {
    id: 'thread-1',
    courseOfferingId: 'offering-1',
    teacherId: 'teacher-1',
    studentId: 'student-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const mockPrisma = {
    courseOffering: { findUnique: jest.fn() },
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
    adminChatThread: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    adminChatMessage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
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
    mockPrisma.adminChatThread.findUnique.mockResolvedValue(null);
    mockPrisma.adminChatThread.findMany.mockResolvedValue([]);
  });

  describe('createThreadOrGet', () => {
    it('creates a thread when the student is APPROVED in the class', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue({
        id: 'offering-1',
        sectionId: 'section-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        status: 'APPROVED',
      });
      mockPrisma.chatThread.upsert.mockResolvedValue(threadRow);

      const result = await service.createThreadOrGet(student, 'offering-1');

      expect(mockPrisma.chatThread.upsert).toHaveBeenCalledWith({
        where: {
          teacherId_studentId_courseOfferingId: {
            teacherId: 'teacher-1',
            studentId: 'student-1',
            courseOfferingId: 'offering-1',
          },
        },
        update: {},
        create: {
          teacherId: 'teacher-1',
          studentId: 'student-1',
          courseOfferingId: 'offering-1',
        },
      });
      expect(result.id).toBe('thread-1');
    });

    it('rejects when enrollment is not APPROVED', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue({
        id: 'offering-1',
        sectionId: 'section-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'PENDING' });

      await expect(
        service.createThreadOrGet(student, 'offering-1'),
      ).rejects.toMatchObject({ code: 'CHAT_FORBIDDEN' });
      expect(mockPrisma.chatThread.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFound when the class does not exist', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue(null);

      await expect(
        service.createThreadOrGet(student, 'offering-1'),
      ).rejects.toMatchObject({ code: 'OFFERING_NOT_FOUND' });
    });

    it('creates a thread when the class teacher initiates with an approved student', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue({
        id: 'offering-1',
        sectionId: 'section-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        status: 'APPROVED',
      });
      mockPrisma.chatThread.upsert.mockResolvedValue(threadRow);

      const result = await service.createThreadOrGet(
        teacher,
        'offering-1',
        'student-1',
      );

      expect(mockPrisma.chatThread.upsert).toHaveBeenCalledWith({
        where: {
          teacherId_studentId_courseOfferingId: {
            teacherId: 'teacher-1',
            studentId: 'student-1',
            courseOfferingId: 'offering-1',
          },
        },
        update: {},
        create: {
          teacherId: 'teacher-1',
          studentId: 'student-1',
          courseOfferingId: 'offering-1',
        },
      });
      expect(result.id).toBe('thread-1');
    });

    it('rejects a teacher who does not own the class', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue({
        id: 'offering-1',
        sectionId: 'section-1',
        teacherId: 'teacher-other',
      });

      await expect(
        service.createThreadOrGet(teacher, 'offering-1', 'student-1'),
      ).rejects.toMatchObject({ code: 'CHAT_FORBIDDEN' });
      expect(mockPrisma.chatThread.upsert).not.toHaveBeenCalled();
    });

    it('rejects a teacher initiating with a non-approved student', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue({
        id: 'offering-1',
        sectionId: 'section-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'PENDING' });

      await expect(
        service.createThreadOrGet(teacher, 'offering-1', 'student-1'),
      ).rejects.toMatchObject({ code: 'CHAT_FORBIDDEN' });
      expect(mockPrisma.chatThread.upsert).not.toHaveBeenCalled();
    });

    it('rejects a student passing a studentId', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue({
        id: 'offering-1',
        sectionId: 'section-1',
        teacherId: 'teacher-1',
      });

      await expect(
        service.createThreadOrGet(student, 'offering-1', 'student-other'),
      ).rejects.toMatchObject({ code: 'CHAT_FORBIDDEN' });
      expect(mockPrisma.chatThread.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    it('rejects a non-participant', async () => {
      mockPrisma.chatThread.findUnique.mockResolvedValue(threadRow);

      await expect(
        service.getMessages('thread-1', 'intruder-1'),
      ).rejects.toMatchObject({ code: 'THREAD_NOT_PARTICIPANT' });
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
      ).rejects.toMatchObject({ code: 'THREAD_NOT_PARTICIPANT' });
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
          offering: {
            id: 'offering-1',
            course: { name: 'Math' },
            section: { name: 'Math 101' },
          },
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

    it('merges admin threads for an admin user', async () => {
      const admin = { id: 'admin-1', role: 'ADMIN' } as User;
      mockPrisma.chatThread.findMany.mockResolvedValue([]);
      mockPrisma.adminChatThread.findMany.mockResolvedValue([
        {
          id: 'adm-thread-1',
          adminId: 'admin-1',
          peerId: 'teacher-9',
          peerRole: 'TEACHER',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          admin: { id: 'admin-1', name: 'Admin A' },
          peer: { id: 'teacher-9', name: 'T9' },
          messages: [{ text: 'hello admin', authorId: 'teacher-9' }],
          _count: { messages: 1 },
        },
      ]);

      const result = await service.listThreads(admin);

      expect(mockPrisma.adminChatThread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { adminId: 'admin-1' } }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('ADMIN');
      expect(result[0].peerId).toBe('teacher-9');
      expect(result[0].peerName).toBe('T9');
      expect(result[0].className).toBe('Teacher');
      expect(result[0].unreadCount).toBe(1);
    });

    it('merges admin threads for a teacher peer with the admin as peer', async () => {
      mockPrisma.chatThread.findMany.mockResolvedValue([]);
      mockPrisma.adminChatThread.findMany.mockResolvedValue([
        {
          id: 'adm-thread-2',
          adminId: 'admin-1',
          peerId: 'teacher-1',
          peerRole: 'TEACHER',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          admin: { id: 'admin-1', name: 'Admin A' },
          peer: { id: 'teacher-1', name: 'T' },
          messages: [{ text: 'see you monday', authorId: 'admin-1' }],
          _count: { messages: 2 },
        },
      ]);

      const result = await service.listThreads(teacher);

      expect(mockPrisma.adminChatThread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { peerId: 'teacher-1' } }),
      );
      expect(result[0].type).toBe('ADMIN');
      expect(result[0].peerId).toBe('admin-1');
      expect(result[0].className).toBe('School admin');
    });

    it('never queries admin threads for students', async () => {
      mockPrisma.chatThread.findMany.mockResolvedValue([]);

      await service.listThreads(student);

      expect(mockPrisma.adminChatThread.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createAdminThreadOrGet', () => {
    const admin = { id: 'admin-1', role: 'ADMIN' } as User;
    const adminRow = {
      id: 'adm-thread-1',
      adminId: 'admin-1',
      peerId: 'teacher-9',
      peerRole: 'TEACHER',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };

    it('creates a thread with a teacher peer in the same organization', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'teacher-9',
        role: 'TEACHER',
        organizationId: 'org-1',
      });
      mockPrisma.adminChatThread.upsert.mockResolvedValue(adminRow);

      const result = await service.createAdminThreadOrGet(
        { ...admin, organizationId: 'org-1' },
        'teacher-9',
        'TEACHER',
      );

      expect(mockPrisma.adminChatThread.upsert).toHaveBeenCalledWith({
        where: {
          adminId_peerId_peerRole: {
            adminId: 'admin-1',
            peerId: 'teacher-9',
            peerRole: 'TEACHER',
          },
        },
        update: {},
        create: {
          adminId: 'admin-1',
          peerId: 'teacher-9',
          peerRole: 'TEACHER',
        },
      });
      expect(result.type).toBe('ADMIN');
    });

    it('rejects non-admin callers', async () => {
      await expect(
        service.createAdminThreadOrGet(
          { ...teacher, organizationId: 'org-1' },
          'guardian-1',
          'GUARDIAN',
        ),
      ).rejects.toMatchObject({ code: 'CHAT_FORBIDDEN' });
    });

    it('rejects a peer whose role does not match the requested peerRole', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'teacher-9',
        role: 'STUDENT',
        organizationId: 'org-1',
      });

      await expect(
        service.createAdminThreadOrGet(
          { ...admin, organizationId: 'org-1' },
          'teacher-9',
          'TEACHER',
        ),
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
      expect(mockPrisma.adminChatThread.upsert).not.toHaveBeenCalled();
    });

    it('rejects a peer from a different organization', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'guardian-1',
        role: 'GUARDIAN',
        organizationId: 'org-2',
      });

      await expect(
        service.createAdminThreadOrGet(
          { ...admin, organizationId: 'org-1' },
          'guardian-1',
          'GUARDIAN',
        ),
      ).rejects.toMatchObject({ code: 'CHAT_FORBIDDEN' });
      expect(mockPrisma.adminChatThread.upsert).not.toHaveBeenCalled();
    });
  });

  describe('admin thread message dispatch', () => {
    it('getMessages dispatches to the admin message table', async () => {
      mockPrisma.adminChatThread.findUnique.mockResolvedValue({
        id: 'adm-thread-1',
        adminId: 'admin-1',
        peerId: 'teacher-9',
        peerRole: 'TEACHER',
      });
      mockPrisma.adminChatMessage.findMany.mockResolvedValue([
        {
          id: 'am2',
          threadId: 'adm-thread-1',
          authorId: 'admin-1',
          text: 'b',
          readAt: null,
          createdAt: new Date('2026-01-01T00:00:02Z'),
        },
        {
          id: 'am1',
          threadId: 'adm-thread-1',
          authorId: 'teacher-9',
          text: 'a',
          readAt: null,
          createdAt: new Date('2026-01-01T00:00:01Z'),
        },
      ]);

      const result = await service.getMessages(
        'adm-thread-1',
        'admin-1',
        undefined,
        2,
      );

      expect(mockPrisma.adminChatMessage.findMany).toHaveBeenCalled();
      expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled();
      expect(result.items.map((m) => m.id)).toEqual(['am1', 'am2']);
      expect(result.nextCursor).toBeNull();
    });

    it('getMessages rejects a non-participant admin thread user', async () => {
      mockPrisma.adminChatThread.findUnique.mockResolvedValue({
        id: 'adm-thread-1',
        adminId: 'admin-1',
        peerId: 'teacher-9',
        peerRole: 'TEACHER',
      });

      await expect(
        service.getMessages('adm-thread-1', 'intruder-1'),
      ).rejects.toMatchObject({ code: 'THREAD_NOT_PARTICIPANT' });
    });

    it('sendMessage writes to the admin message table and touches the admin thread', async () => {
      mockPrisma.adminChatThread.findUnique.mockResolvedValue({
        id: 'adm-thread-1',
        adminId: 'admin-1',
        peerId: 'teacher-9',
        peerRole: 'TEACHER',
      });
      mockPrisma.adminChatMessage.create.mockResolvedValue({
        id: 'am9',
        threadId: 'adm-thread-1',
        authorId: 'admin-1',
        text: 'hi',
        readAt: null,
        createdAt: new Date('2026-01-01T00:00:03Z'),
      });
      mockPrisma.adminChatThread.update.mockResolvedValue({});

      const result = await service.sendMessage('adm-thread-1', 'admin-1', 'hi');

      expect(mockPrisma.adminChatMessage.create).toHaveBeenCalledWith({
        data: { threadId: 'adm-thread-1', authorId: 'admin-1', text: 'hi' },
      });
      expect(mockPrisma.adminChatThread.update).toHaveBeenCalled();
      expect(result.authorId).toBe('admin-1');
    });

    it('markRead clears unread admin messages from the counterparty', async () => {
      mockPrisma.adminChatThread.findUnique.mockResolvedValue({
        id: 'adm-thread-1',
        adminId: 'admin-1',
        peerId: 'teacher-9',
        peerRole: 'TEACHER',
      });

      await service.markRead('adm-thread-1', 'teacher-9');

      expect(mockPrisma.adminChatMessage.updateMany).toHaveBeenCalledWith({
        where: {
          threadId: 'adm-thread-1',
          authorId: { not: 'teacher-9' },
          readAt: null,
        },
        data: { readAt: expect.any(Date) as Date },
      });
    });
  });
});
