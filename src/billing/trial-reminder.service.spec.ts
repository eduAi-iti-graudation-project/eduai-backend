import { Test, TestingModule } from '@nestjs/testing';
import { TrialReminderService } from './trial-reminder.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('TrialReminderService', () => {
  let service: TrialReminderService;

  const mockPrisma = {
    organization: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  beforeEach(async () => {
    process.env.TRIAL_REMINDER_ENABLED = 'false';
    mockPrisma.organization.update.mockResolvedValue({ id: 'org-1' });
    mockNotifications.notifyUser.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrialReminderService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<TrialReminderService>(TrialReminderService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.TRIAL_REMINDER_ENABLED;
  });

  function orgWithAdmins(admins: string[] = ['admin-1']) {
    return {
      id: 'org-1',
      users: admins.map((id) => ({ id })),
    };
  }

  it('notifies admins and marks the org when the trial is expiring soon', async () => {
    mockPrisma.organization.findMany
      .mockResolvedValueOnce([orgWithAdmins()])
      .mockResolvedValueOnce([]);

    const result = await service.runSweep();

    expect(mockPrisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subscriptionStatus: 'TRIALING',
          trialReminderSentAt: null,
          createdAt: { lte: expect.any(Date) as Date },
        }) as object,
      }) as object,
    );
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'admin-1',
      'TRIAL_EXPIRING',
      expect.stringContaining('3 days'),
      expect.any(String),
    );
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { trialReminderSentAt: expect.any(Date) as Date },
    });
    expect(result).toEqual({ expiring: 1, expired: 0 });
  });

  it('notifies admins when the trial has already expired', async () => {
    mockPrisma.organization.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([orgWithAdmins()]);

    const result = await service.runSweep();

    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'admin-1',
      'TRIAL_EXPIRED',
      expect.any(String),
      expect.any(String),
    );
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { trialExpiredSentAt: expect.any(Date) as Date },
    });
    expect(result).toEqual({ expiring: 0, expired: 1 });
  });

  it('notifies every admin of the organization', async () => {
    mockPrisma.organization.findMany
      .mockResolvedValueOnce([orgWithAdmins(['admin-1', 'admin-2'])])
      .mockResolvedValueOnce([]);

    await service.runSweep();

    expect(mockNotifications.notifyUser).toHaveBeenCalledTimes(2);
  });

  it('still marks the org as reminded when it has no admins', async () => {
    mockPrisma.organization.findMany
      .mockResolvedValueOnce([orgWithAdmins([])])
      .mockResolvedValueOnce([]);

    const result = await service.runSweep();

    expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { trialReminderSentAt: expect.any(Date) as Date },
    });
    expect(result).toEqual({ expiring: 1, expired: 0 });
  });

  it('skips organizations already reminded', async () => {
    mockPrisma.organization.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.runSweep();

    expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    expect(result).toEqual({ expiring: 0, expired: 0 });
  });

  it('does not start the interval when disabled via env', () => {
    service.onModuleInit();

    expect(mockPrisma.organization.findMany).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });
});
