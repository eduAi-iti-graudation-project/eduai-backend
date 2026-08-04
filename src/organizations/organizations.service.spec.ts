import { HttpException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  const mockPrisma = {
    organization: {
      findUnique: jest.fn(),
    },
    user: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
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
        NotFoundException,
      );
    });
  });

  describe('getOrganizationSummary', () => {
    it('returns org details with non-admin member count', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Demo School',
        subscriptionStatus: 'TRIALING',
        subscriptionTier: 'TRIAL',
        seatLimit: 50,
      });
      mockPrisma.user.count.mockResolvedValue(7);

      const result = await service.getOrganizationSummary('org-1');

      expect(result).toEqual({
        id: 'org-1',
        name: 'Demo School',
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
      ).rejects.toThrow('invalid email');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });
});
