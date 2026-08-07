import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';

function callArgs<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as T[][];
  return calls[0][0];
}

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  const mockPrisma = {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    membershipRequest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    gradeLevel: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockAuthClient = {
    auth: {
      admin: {
        inviteUserByEmail: jest.fn(),
      },
    },
  };

  const mockSupabase = {
    getClient: jest.fn(() => mockAuthClient),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
    jest.clearAllMocks();
  });

  describe('assertSeatAvailable', () => {
    it('allows when seatLimit is null (unlimited)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: null,
      });

      await expect(
        service.assertSeatAvailable('org-1'),
      ).resolves.toBeUndefined();
      expect(mockPrisma.user.count).not.toHaveBeenCalled();
    });

    it('allows when member count is below the seat limit', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(29);

      await expect(
        service.assertSeatAvailable('org-1'),
      ).resolves.toBeUndefined();
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', role: { not: 'ADMIN' } },
      });
    });

    it('rejects with 402 when member count reaches the seat limit', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(30);

      await expect(service.assertSeatAvailable('org-1')).rejects.toThrow(
        HttpException,
      );
      await expect(service.assertSeatAvailable('org-1')).rejects.toMatchObject({
        status: 402,
      });
    });

    it('throws NotFound for a missing organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.assertSeatAvailable('missing')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('getOrganizationSummary', () => {
    it('returns org details with non-admin member count', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        joinCode: 'DEMO2026',
        subscriptionStatus: 'TRIALING',
        subscriptionTier: 'TRIAL',
        seatLimit: 50,
      });
      mockPrisma.user.count.mockResolvedValue(7);

      const result = await service.getOrganizationSummary('org-1');

      expect(result).toEqual({
        id: 'org-1',
        name: 'Demo School',
        joinCode: 'DEMO2026',
        subscriptionStatus: 'TRIALING',
        subscriptionTier: 'TRIAL',
        seatLimit: 50,
        userCount: 7,
      });
    });
  });

  describe('inviteMember', () => {
    const dto = {
      email: 'new.teacher@test.com',
      name: 'New Teacher',
      role: 'TEACHER' as const,
    };

    it('invites a teacher, creates the local row, and returns the member', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'admin-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(5);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: dto.email,
        role: dto.role,
      });
      mockSupabase.getClient().auth.admin.inviteUserByEmail.mockResolvedValue({
        data: { user: { id: 'supabase-invited-id' } },
        error: null,
      });

      const result = await service.inviteMember('org-1', dto, 'admin-1');

      expect(
        mockSupabase.getClient().auth.admin.inviteUserByEmail,
      ).toHaveBeenCalledWith(dto.email, {
        redirectTo: process.env.FRONTEND_URL ?? undefined,
      });
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-invited-id',
          email: dto.email,
          name: dto.name,
          role: dto.role,
          organizationId: 'org-1',
        },
      });
      expect(result).toEqual({
        id: 'user-new',
        email: dto.email,
        role: dto.role,
      });
    });

    it('rejects a non-admin inviter with Forbidden', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.inviteMember('org-1', dto, 'teacher-1'),
      ).rejects.toThrow('Only an organization admin can invite members');
      expect(
        mockSupabase.getClient().auth.admin.inviteUserByEmail,
      ).not.toHaveBeenCalled();
    });

    it('rejects with 402 when the org has no seats left', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'admin-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(30);

      await expect(
        service.inviteMember('org-1', dto, 'admin-1'),
      ).rejects.toMatchObject({ status: 402 });
      expect(
        mockSupabase.getClient().auth.admin.inviteUserByEmail,
      ).not.toHaveBeenCalled();
    });

    it('rejects when a user with that email already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'admin-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(5);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'existing',
        email: dto.email,
      });

      await expect(
        service.inviteMember('org-1', dto, 'admin-1'),
      ).rejects.toThrow('A user with this email already exists');
      expect(
        mockSupabase.getClient().auth.admin.inviteUserByEmail,
      ).not.toHaveBeenCalled();
    });

    it('rejects when Supabase fails to send the invite', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'admin-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(5);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockSupabase.getClient().auth.admin.inviteUserByEmail.mockResolvedValue({
        data: { user: null },
        error: { message: 'invalid email' },
      });

      await expect(
        service.inviteMember('org-1', dto, 'admin-1'),
      ).rejects.toThrow('That email address is not valid.');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('regenerateJoinCode', () => {
    it('updates the org join code to a new 8-char code', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      mockPrisma.organization.update.mockResolvedValue({
        id: 'org-1',
        joinCode: 'NEWCODE1',
      });

      const result = await service.regenerateJoinCode('org-1');

      expect(mockPrisma.organization.update).toHaveBeenCalledTimes(1);
      const updateArgs = callArgs<{
        where: { id: string };
        data: { joinCode: string };
      }>(mockPrisma.organization.update);
      expect(updateArgs.where.id).toBe('org-1');
      expect(updateArgs.data.joinCode).toMatch(/^[A-Z0-9]{8}$/);
      expect(result.joinCode).toBe('NEWCODE1');
    });

    it('throws NotFound for a missing organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.regenerateJoinCode('missing')).rejects.toMatchObject(
        { status: 404 },
      );
    });
  });

  describe('listRequests', () => {
    it('lists PENDING requests by default, newest first', async () => {
      mockPrisma.membershipRequest.findMany.mockResolvedValue([
        { id: 'req-2', email: 'b@test.com', name: 'Bee', role: 'STUDENT' },
        { id: 'req-1', email: 'a@test.com', name: 'Ay', role: 'TEACHER' },
      ]);

      const result = await service.listRequests('org-1');

      expect(mockPrisma.membershipRequest.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          gradeLevel: true,
          status: true,
          createdAt: true,
        },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('approveRequest', () => {
    beforeEach(() => {
      mockPrisma.$transaction.mockImplementation(
        (promises: Promise<unknown>[]) => Promise.all(promises),
      );
    });

    function pendingRequest(overrides: Record<string, unknown> = {}) {
      return {
        id: 'req-1',
        organizationId: 'org-1',
        email: 'sam@test.com',
        name: 'Sam Learner',
        role: 'STUDENT',
        status: 'PENDING',
        authId: 'supabase-auth-1',
        ...overrides,
      };
    }

    it('creates the user with the requested role and marks the request APPROVED', async () => {
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(
        pendingRequest(),
      );
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(5);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'sam@test.com',
        name: 'Sam Learner',
        role: 'STUDENT',
      });
      mockPrisma.membershipRequest.update.mockResolvedValue({});

      const result = await service.approveRequest('req-1', 'org-1');

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-auth-1',
          email: 'sam@test.com',
          name: 'Sam Learner',
          role: 'STUDENT',
          organizationId: 'org-1',
        },
      });
      const updateArgs = callArgs<{
        where: { id: string };
        data: { status: string; resolvedAt: Date };
      }>(mockPrisma.membershipRequest.update);
      expect(updateArgs.where.id).toBe('req-1');
      expect(updateArgs.data.status).toBe('APPROVED');
      expect(updateArgs.data.resolvedAt).toBeInstanceOf(Date);
      expect(result).toEqual({
        id: 'user-1',
        email: 'sam@test.com',
        name: 'Sam Learner',
        role: 'STUDENT',
      });
    });

    it('applies the admin role override when provided', async () => {
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(
        pendingRequest(),
      );
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(5);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'user-1' });

      await service.approveRequest('req-1', 'org-1', 'TEACHER');

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-auth-1',
          email: 'sam@test.com',
          name: 'Sam Learner',
          role: 'TEACHER',
          organizationId: 'org-1',
        },
      });
    });

    it('links the created student to the grade level from the request', async () => {
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(
        pendingRequest({ gradeLevel: 10 }),
      );
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(5);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.gradeLevel.findFirst.mockResolvedValue({
        id: 'grade-10',
        level: 10,
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'sam@test.com',
        name: 'Sam Learner',
        role: 'STUDENT',
        gradeId: 'grade-10',
      });
      mockPrisma.membershipRequest.update.mockResolvedValue({});

      const result = await service.approveRequest('req-1', 'org-1');

      expect(mockPrisma.gradeLevel.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', level: 10 },
      });
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-auth-1',
          email: 'sam@test.com',
          name: 'Sam Learner',
          role: 'STUDENT',
          organizationId: 'org-1',
          gradeId: 'grade-10',
        },
      });
      expect(result).toMatchObject({ id: 'user-1', gradeId: 'grade-10' });
    });

    it('creates the student without a grade when the level has no Grade record', async () => {
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(
        pendingRequest({ gradeLevel: 11 }),
      );
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(5);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.gradeLevel.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        gradeId: null,
      });
      mockPrisma.membershipRequest.update.mockResolvedValue({});

      const result = await service.approveRequest('req-1', 'org-1');

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          authId: 'supabase-auth-1',
          email: 'sam@test.com',
          name: 'Sam Learner',
          role: 'STUDENT',
          organizationId: 'org-1',
        },
      });
      expect(result).toMatchObject({ gradeId: null });
    });

    it('rejects with 404 when the request is not in the org', async () => {
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.approveRequest('req-1', 'org-1'),
      ).rejects.toMatchObject({ status: 404 });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects with 409 when the request was already resolved', async () => {
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(
        pendingRequest({ status: 'APPROVED' }),
      );

      await expect(
        service.approveRequest('req-1', 'org-1'),
      ).rejects.toMatchObject({ status: 409 });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects with 402 when the org has no seats left', async () => {
      mockPrisma.membershipRequest.findFirst.mockResolvedValue(
        pendingRequest(),
      );
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        seatLimit: 30,
      });
      mockPrisma.user.count.mockResolvedValue(30);

      await expect(
        service.approveRequest('req-1', 'org-1'),
      ).rejects.toMatchObject({ status: 402 });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.membershipRequest.update).not.toHaveBeenCalled();
    });
  });

  describe('rejectRequest', () => {
    it('marks the request REJECTED with a resolvedAt timestamp', async () => {
      mockPrisma.membershipRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        organizationId: 'org-1',
        status: 'PENDING',
      });
      mockPrisma.membershipRequest.update.mockResolvedValue({});

      await service.rejectRequest('req-1', 'org-1');

      const updateArgs = callArgs<{
        where: { id: string };
        data: { status: string; resolvedAt: Date };
      }>(mockPrisma.membershipRequest.update);
      expect(updateArgs.where.id).toBe('req-1');
      expect(updateArgs.data.status).toBe('REJECTED');
      expect(updateArgs.data.resolvedAt).toBeInstanceOf(Date);
    });

    it('rejects with 409 when the request was already resolved', async () => {
      mockPrisma.membershipRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        organizationId: 'org-1',
        status: 'REJECTED',
      });

      await expect(
        service.rejectRequest('req-1', 'org-1'),
      ).rejects.toMatchObject({ status: 409 });
      expect(mockPrisma.membershipRequest.update).not.toHaveBeenCalled();
    });
  });
});
