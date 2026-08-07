import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrisma = {
    notification: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    courseOffering: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  describe('notifyUser', () => {
    it('should create a notification row', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-id',
        userId: 'user-id',
        type: 'GRADING_READY',
        channel: 'EMAIL',
        title: 'Grading Complete',
        body: 'Submission has been graded.',
      });

      await service.notifyUser(
        'user-id',
        'GRADING_READY',
        'Grading Complete',
        'Submission has been graded.',
      );

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-id',
          type: 'GRADING_READY',
          channel: 'EMAIL',
          title: 'Grading Complete',
          body: 'Submission has been graded.',
        },
      });
    });
  });

  describe('notifyTeachers', () => {
    it('should resolve offering to teacher ID and notify', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue({
        id: 'offering-id',
        teacherId: 'teacher-id',
        teacher: { id: 'teacher-id', email: 'teacher@test.com' },
      });
      mockPrisma.notification.create.mockResolvedValue({ id: 'notif-id' });

      await service.notifyTeachers(
        'offering-id',
        'ALERT',
        'New Alert',
        'Student needs attention',
      );

      expect(mockPrisma.courseOffering.findUnique).toHaveBeenCalledWith({
        where: { id: 'offering-id' },
        include: { teacher: true },
      });
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'teacher-id',
          type: 'ALERT',
          channel: 'EMAIL',
          title: 'New Alert',
          body: 'Student needs attention',
        },
      });
    });

    it('should not crash when offering not found', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue(null);

      await expect(
        service.notifyTeachers('bad-id', 'ALERT', 'Title'),
      ).resolves.not.toThrow();
    });
  });

  describe('markRead', () => {
    it('should mark a notification as read', async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        id: 'notif-id',
        readAt: null,
      });
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif-id',
        readAt: new Date(),
      });

      await service.markRead('notif-id');

      expect(mockPrisma.notification.update).toHaveBeenCalledTimes(1);
    });

    it('should throw for missing notification', async () => {
      mockPrisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.markRead('bad-id')).rejects.toMatchObject({
        code: 'NOTIFICATION_NOT_FOUND',
      });
    });
  });
});
