import { Test, TestingModule } from '@nestjs/testing';
import { JoinRequestsService } from './join-requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import { MailerService } from '../common/mailer/mailer.service';
import { EnrollSyncService } from '../roster/enroll-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { encryptCredential } from '../common/crypto/credentials';

// Deterministic RNG for generatePassword/gmail suffixes.
jest.mock('../common/mailer/generated-credentials', () => ({
  gmailLocal: jest.fn(() => 'jane.doe'),
  gmailCandidate: jest.fn(
    (local: string, suffix = 0) =>
      `${local}${suffix > 0 ? `.${suffix}` : ''}@gmail.com`,
  ),
  schoolEmailCandidate: jest.fn(
    (local: string, domain?: string | null) =>
      `${local}@${(domain ?? 'eduai.org').toLowerCase()}`,
  ),
  uniqueEmail: jest.fn((taken: Set<string>, base: string) =>
    [...taken].includes(base) ? `${base}.2` : base,
  ),
  generatePassword: jest.fn(() => 'T3stPassw0rd'),
}));

async function expectApiError(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  try {
    await promise;
    fail('expected an ApiError to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(code);
    expect((err as ApiError).getStatus()).toBe(status);
  }
}

describe('JoinRequestsService', () => {
  let service: JoinRequestsService;

  const mockPrisma = {
    organization: { findUnique: jest.fn() },
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    joinRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    gradeLevel: { findMany: jest.fn() },
    enrollment: { create: jest.fn() },
    guardianProfile: { findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };

  const adminAuthClient = {
    auth: {
      admin: { createUser: jest.fn(), updateUserById: jest.fn() },
      signInWithPassword: jest.fn(),
    },
  };
  const mockSupabase = { getClient: jest.fn(() => adminAuthClient) };
  const mockMailer = { send: jest.fn().mockResolvedValue({ sent: false }) };
  const mockEnrollSync = {
    syncStudentToGrade: jest.fn().mockResolvedValue(undefined),
    syncSectionToStudents: jest.fn().mockResolvedValue(undefined),
  };
  const mockNotifications = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    // Provisioned-credential encryption needs a key (WP1).
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-credentials-key';
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JoinRequestsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: MailerService, useValue: mockMailer },
        { provide: EnrollSyncService, useValue: mockEnrollSync },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<JoinRequestsService>(JoinRequestsService);
  });

  const org = {
    id: 'org-1',
    name: 'Org 1',
    joinCode: 'ABC12345',
    seatLimit: null,
  };

  describe('schoolByCode', () => {
    it('returns the school name and its grade levels', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.gradeLevel.findMany.mockResolvedValue([
        { id: 'g7', level: 7, name: 'Grade 7' },
      ]);

      const result = await service.schoolByCode(' abc123 ');

      expect(result).toEqual({
        id: 'org-1',
        name: 'Org 1',
        gradeLevels: [{ id: 'g7', level: 7, name: 'Grade 7' }],
      });
    });

    it('rejects an unknown code with SCHOOL_CODE_INVALID', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expectApiError(
        service.schoolByCode('NOPE123'),
        ErrorCode.SCHOOL_CODE_INVALID,
        404,
      );
    });
  });

  describe('applyAsStudent', () => {
    const dto = {
      schoolCode: 'ABC123',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      password: 'supersecret',
    };

    it('creates a SELF request and auto-fills the grade from a roster row', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.joinRequest.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          gradeId: 'g7',
          gradeLevelName: 'Grade 7',
          source: 'ROSTER',
        });
      adminAuthClient.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'auth-1' } },
        error: null,
      });
      mockPrisma.joinRequest.create.mockResolvedValue({ id: 'req-1' });

      const result = await service.applyAsStudent(dto);

      expect(result).toMatchObject({
        requestId: 'req-1',
        matchedFromRoster: true,
        gradeLevelName: 'Grade 7',
        status: 'PENDING',
      });
      const createCalls = mockPrisma.joinRequest.create.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0][0].data).toEqual(
        expect.objectContaining({
          source: 'SELF',
          email: 'jane@example.com',
          gradeId: 'g7',
          authId: 'auth-1',
        }),
      );
    });

    it('rejects an email already used by a member', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });

      await expectApiError(
        service.applyAsStudent(dto),
        ErrorCode.EMAIL_IN_USE,
        409,
      );
    });

    it('rejects a duplicate pending request', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.joinRequest.findFirst.mockResolvedValue({ id: 'r1' });

      await expectApiError(
        service.applyAsStudent(dto),
        ErrorCode.ALREADY_APPLIED,
        409,
      );
    });
  });

  describe('applyAsGuardian', () => {
    const dto = {
      schoolCode: 'ABC123',
      name: 'Jane Parent',
      personalEmail: 'parent@example.com',
      password: 'supersecret',
      childSchoolEmail: 'jane.doe@eduai.org',
      phone: '+1 555 000 0000',
      nationality: 'American',
    };

    it('creates a GUARDIAN request linked to a known child', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.guardianProfile.findFirst.mockResolvedValue(null);
      mockPrisma.joinRequest.findFirst.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'child-1' });
      mockPrisma.joinRequest.create.mockResolvedValue({ id: 'req-1' });

      const result = await service.applyAsGuardian(dto);

      expect(result).toEqual({ requestId: 'req-1', status: 'PENDING' });
      const createCalls = mockPrisma.joinRequest.create.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(createCalls[0][0].data).toEqual(
        expect.objectContaining({
          source: 'SELF',
          kind: 'GUARDIAN',
          email: 'parent@example.com',
          name: 'Jane Parent',
          targetStudentEmail: 'jane.doe@eduai.org',
          guardianEmail: 'parent@example.com',
        }),
      );
    });

    it('also accepts a child with a pending roster row (not yet provisioned)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.guardianProfile.findFirst.mockResolvedValue(null);
      mockPrisma.joinRequest.findFirst.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.joinRequest.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'pending-row' });
      mockPrisma.joinRequest.create.mockResolvedValue({ id: 'req-1' });

      const result = await service.applyAsGuardian(dto);

      expect(result.requestId).toBe('req-1');
    });

    it('rejects an existing guardian with the same personal email', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.guardianProfile.findFirst.mockResolvedValue({
        guardianId: 'g-1',
      });

      await expectApiError(
        service.applyAsGuardian(dto),
        ErrorCode.EMAIL_IN_USE,
        409,
      );
    });

    it('rejects an unknown child school email', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.guardianProfile.findFirst.mockResolvedValue(null);
      mockPrisma.joinRequest.findFirst.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expectApiError(
        service.applyAsGuardian(dto),
        ErrorCode.STUDENT_NOT_FOUND,
        404,
      );
    });
  });

  describe('stageRoster', () => {
    beforeEach(() => {
      mockPrisma.user.findMany.mockResolvedValue([
        { email: 'existing@member.com' },
      ]);
      mockPrisma.joinRequest.findMany.mockResolvedValue([
        { email: 'pending@already.com' },
      ]);
    });

    it('stages new rows and skips members / duplicates / already-pending', async () => {
      mockPrisma.joinRequest.createMany.mockResolvedValue({ count: 2 });

      const result = await service.stageRoster('org-1', [
        { row: 2, email: 'a@example.com', firstName: 'A' },
        { row: 3, email: 'b@example.com', firstName: 'B' },
        { row: 4, email: 'existing@member.com', firstName: 'X' },
        { row: 5, email: 'pending@already.com', firstName: 'Y' },
        { row: 6, email: 'a@example.com', firstName: 'A2' },
      ]);

      expect(result.staged).toBe(2);
      expect(result.notStaged).toEqual([
        { row: 4, reason: 'already a member of this school' },
        { row: 5, reason: 'already pending review' },
        { row: 6, reason: 'duplicate row in file' },
      ]);
    });
  });

  describe('approve', () => {
    const rosterRequest = (overrides: Record<string, unknown> = {}) => ({
      id: 'r1',
      source: 'ROSTER',
      email: 'input@example.com',
      name: 'Jane Doe',
      authId: null,
      gradeId: 'g7',
      gradeLevelName: 'Grade 7',
      sectionId: 's1',
      sectionName: 'A',
      ...overrides,
    });
    const selfRequest = (overrides: Record<string, unknown> = {}) =>
      rosterRequest({
        id: 'r2',
        source: 'SELF',
        email: 'jane@example.com',
        authId: 'auth-1',
        ...overrides,
      });

    beforeEach(() => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);
    });

    it('approves a ROSTER row with a generated gmail + supabase identity + enrollment', async () => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([rosterRequest()]);
      adminAuthClient.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'auth-new' } },
        error: null,
      });
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: { create: jest.fn().mockResolvedValue({ id: 'u1' }) },
            enrollment: { create: jest.fn().mockResolvedValue({ id: 'e1' }) },
            joinRequest: { update: jest.fn().mockResolvedValue({}) },
          };
          await fn(tx);
          return tx;
        },
      );

      const result = await service.approve('org-1', ['r1'], 'admin-1');

      expect(result.approved).toEqual([
        {
          id: 'r1',
          email: 'jane.doe@eduai.org',
          name: 'Jane Doe',
          generatedPassword: true,
          kind: 'STUDENT',
          guardian: undefined,
        },
      ]);
      expect(adminAuthClient.auth.admin.createUser).toHaveBeenCalledWith({
        email: 'jane.doe@eduai.org',
        password: 'T3stPassw0rd',
        email_confirm: true,
      });
      // WP1: the invite goes ONLY to the real inbox (the CSV EMAIL), not the
      // school identity — the school mailbox does not exist.
      const sendCalls = mockMailer.send.mock.calls as [
        { to: string; subject: string; html: string },
      ][];
      expect(sendCalls[0][0].to).toBe('input@example.com');
      expect(sendCalls[0][0].subject).toContain('ready');
      expect(sendCalls[0][0].html).toContain('/verify?token=');
    });

    it('approves a SELF row by moving its identity onto a school email with a verify invite', async () => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([selfRequest()]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      adminAuthClient.auth.admin.updateUserById.mockResolvedValue({
        data: { user: { id: 'auth-1' } },
        error: null,
      });
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: { create: jest.fn().mockResolvedValue({ id: 'u1' }) },
            enrollment: { create: jest.fn().mockResolvedValue({ id: 'e1' }) },
            joinRequest: { update: jest.fn().mockResolvedValue({}) },
          };
          await fn(tx);
          return tx;
        },
      );

      const result = await service.approve('org-1', ['r2'], 'admin-1');

      expect(result.approved).toEqual([
        {
          id: 'r2',
          email: 'jane.doe@eduai.org',
          name: 'Jane Doe',
          kind: 'STUDENT',
          generatedPassword: false,
          guardian: undefined,
        },
      ]);
      // The existing identity is re-keyed to the school email — no second
      // account is created, and the chosen password is kept.
      expect(adminAuthClient.auth.admin.createUser).not.toHaveBeenCalled();
      const updateCalls = adminAuthClient.auth.admin.updateUserById.mock
        .calls as [string, Record<string, unknown>][];
      expect(updateCalls[0][0]).toBe('auth-1');
      expect(updateCalls[0][1]).toEqual({
        email: 'jane.doe@eduai.org',
        email_confirm: true,
        password: 'T3stPassw0rd',
      });
      // The verify invite (school login reveal) goes to the real inbox only.
      const sendCalls = mockMailer.send.mock.calls as [
        { to: string; subject: string; html: string },
      ][];
      expect(sendCalls[0][0].to).toBe('jane@example.com');
      expect(sendCalls[0][0].html).toContain('/verify?token=');
    });

    it('approves a SELF row that stored its chosen password without resetting it', async () => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([
        selfRequest({
          email: 'jane@example.com',
          authId: 'auth-1',
          chosenPasswordEncrypted: encryptCredential('MychosenPass1'),
        }),
      ]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      adminAuthClient.auth.admin.updateUserById.mockResolvedValue({
        data: { user: { id: 'auth-1' } },
        error: null,
      });
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: { create: jest.fn().mockResolvedValue({ id: 'u1' }) },
            enrollment: { create: jest.fn().mockResolvedValue({ id: 'e1' }) },
            joinRequest: { update: jest.fn().mockResolvedValue({}) },
          };
          await fn(tx);
          return tx;
        },
      );

      const result = await service.approve('org-1', ['r2'], 'admin-1');

      const updateCalls = adminAuthClient.auth.admin.updateUserById.mock
        .calls as [string, Record<string, unknown>][];
      expect(updateCalls[0][1]).toEqual({
        email: 'jane.doe@eduai.org',
        email_confirm: true,
      });
      expect(result.approved[0].generatedPassword).toBe(false);
    });

    it('approves a GUARDIAN request and links the parent to the child', async () => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([
        rosterRequest({
          id: 'r3',
          source: 'SELF',
          kind: 'GUARDIAN',
          email: 'parent@example.com',
          name: 'Jane Parent',
          targetStudentEmail: 'jane.doe@eduai.org',
        }),
      ]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'child-1',
        guardianId: null,
        name: 'Jane Doe',
      });
      adminAuthClient.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'auth-g' } },
        error: null,
      });
      mockPrisma.user.create.mockResolvedValue({ id: 'g-1' });
      mockPrisma.guardianProfile.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.joinRequest.update.mockResolvedValue({});

      const result = await service.approve('org-1', ['r3'], 'admin-1');

      expect(result.approved).toEqual([
        {
          id: 'r3',
          email: 'jane.doe@eduai.org',
          name: 'Jane Parent',
          kind: 'GUARDIAN',
          generatedPassword: true,
        },
      ]);
      const linkCalls = mockPrisma.user.update.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(linkCalls[0][0]).toEqual({
        where: { id: 'child-1' },
        data: { guardianId: 'g-1' },
      });
      const inviteCalls = mockMailer.send.mock.calls as [
        { to: string; html: string },
      ][];
      expect(inviteCalls[0][0].to).toBe('parent@example.com');
      expect(inviteCalls[0][0].html).toContain('/verify?token=');
    });

    it('keeps a GUARDIAN request pending when the child is unknown', async () => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([
        rosterRequest({
          id: 'r3',
          source: 'SELF',
          kind: 'GUARDIAN',
          email: 'parent@example.com',
          name: 'Jane Parent',
          targetStudentEmail: 'unknown@eduai.org',
        }),
      ]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.approve('org-1', ['r3'], 'admin-1');

      expect(result.approved).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain('No student');
    });

    it('surfaces approval failures per-request without blocking the batch', async () => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([
        rosterRequest({ id: 'r1' }),
        rosterRequest({ id: 'r2' }),
      ]);
      adminAuthClient.auth.admin.createUser
        .mockResolvedValueOnce({ data: { user: { id: 'a1' } }, error: null })
        .mockResolvedValue({ data: null, error: { message: 'boom' } });
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            user: { create: jest.fn().mockResolvedValue({ id: 'u1' }) },
            enrollment: { create: jest.fn().mockResolvedValue({ id: 'e1' }) },
            joinRequest: { update: jest.fn().mockResolvedValue({}) },
          };
          await fn(tx);
          return tx;
        },
      );

      const result = await service.approve('org-1', ['r1', 'r2'], 'admin-1');

      expect(result.approved).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe('r2');
    });

    it('throws JOIN_REQUEST_NOT_FOUND when nothing is pending', async () => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([]);

      await expectApiError(
        service.approve('org-1', ['r1'], 'admin-1'),
        ErrorCode.JOIN_REQUEST_NOT_FOUND,
        404,
      );
    });
  });

  describe('reject / reopen', () => {
    it('rejects pending requests only', async () => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([
        { id: 'r1', status: 'PENDING' },
      ]);
      mockPrisma.joinRequest.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.reject('org-1', ['r1'], 'admin-1');

      expect(result).toEqual({ rejected: 1 });
      const updateCalls = mockPrisma.joinRequest.updateMany.mock.calls as [
        { where: Record<string, unknown>; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].where).toEqual({
        id: { in: ['r1'] },
        organizationId: 'org-1',
      });
      expect(updateCalls[0][0].data.status).toBe('REJECTED');
      expect(updateCalls[0][0].data.decidedById).toBe('admin-1');
      expect(updateCalls[0][0].data.decidedAt).toBeInstanceOf(Date);
    });

    it('refuses to reject a request that is not pending', async () => {
      mockPrisma.joinRequest.findMany.mockResolvedValue([
        { id: 'r1', status: 'APPROVED' },
      ]);

      await expectApiError(
        service.reject('org-1', ['r1'], 'admin-1'),
        ErrorCode.JOIN_REQUEST_NOT_PENDING,
        409,
      );
    });

    it('reopens a rejected request', async () => {
      mockPrisma.joinRequest.findFirst.mockResolvedValue({
        id: 'r1',
        status: 'REJECTED',
      });
      mockPrisma.joinRequest.update.mockResolvedValue({ id: 'r1' });

      await service.reopen('org-1', 'r1');

      expect(mockPrisma.joinRequest.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: 'PENDING', decidedById: null, decidedAt: null },
      });
    });

    it('refuses to reopen a pending request', async () => {
      mockPrisma.joinRequest.findFirst.mockResolvedValue({
        id: 'r1',
        status: 'PENDING',
      });

      await expectApiError(
        service.reopen('org-1', 'r1'),
        ErrorCode.JOIN_REQUEST_NOT_PENDING,
        409,
      );
    });
  });
});
