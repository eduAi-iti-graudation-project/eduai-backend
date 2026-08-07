import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';

function callArgs<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as T[][];
  return calls[0][0];
}

describe('UsersService', () => {
  let service: UsersService;

  const tx = {
    user: {
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockPrisma = {
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    submission: { count: jest.fn() },
    alert: { count: jest.fn() },
    quiz: { count: jest.fn() },
    courseOffering: { count: jest.fn() },
    $transaction: jest.fn((cb: (tx: typeof tx) => unknown) => cb(tx)),
  };

  const mockAuthClient = {
    auth: {
      admin: {
        deleteUser: jest.fn(),
      },
    },
  };

  const mockSupabase = {
    getClient: jest.fn(() => mockAuthClient),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    const userRow = {
      id: 'u-1',
      email: 'a@test.com',
      name: 'Alice',
      role: 'STUDENT',
      gradeId: 'g-1',
      guardianId: 'grd-1',
      organizationId: 'org-1',
      createdAt: new Date('2026-01-01'),
      grade: { id: 'g-1', level: 5, name: null },
      guardian: { id: 'grd-1', name: 'Guardian', email: 'g@test.com' },
    };

    it('scopes the query to the organization', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findAll({}, 'org-1');

      const arg = callArgs<{
        where: Record<string, unknown>;
        select: unknown;
        orderBy: unknown;
      }>(mockPrisma.user.findMany);
      expect(arg.where).toEqual({ organizationId: 'org-1' });
      expect(arg.orderBy).toEqual({ name: 'asc' });
    });

    it('applies the role filter when provided', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ role: 'TEACHER' }, 'org-1');

      const arg = callArgs<{ where: Record<string, unknown> }>(
        mockPrisma.user.findMany,
      );
      expect(arg.where).toEqual({ organizationId: 'org-1', role: 'TEACHER' });
    });

    it('searches name OR email case-insensitively when q is provided', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ q: 'ali' }, 'org-1');

      const arg = callArgs<{ where: Record<string, unknown> }>(
        mockPrisma.user.findMany,
      );
      expect(arg.where).toEqual({
        organizationId: 'org-1',
        OR: [
          { name: { contains: 'ali', mode: 'insensitive' } },
          { email: { contains: 'ali', mode: 'insensitive' } },
        ],
      });
    });

    it('caps search results to the limit', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ q: 'ali' }, 'org-1');

      const arg = callArgs<{ take?: number }>(mockPrisma.user.findMany);
      expect(arg.take).toBe(20);
    });

    it('respects a smaller requested take cap', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ q: 'ali', take: 5 }, 'org-1');

      const arg = callArgs<{ take?: number }>(mockPrisma.user.findMany);
      expect(arg.take).toBe(5);
    });

    it('does not cap listings without a search query', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findAll({}, 'org-1');

      const arg = callArgs<{ take?: number }>(mockPrisma.user.findMany);
      expect(arg.take).toBeUndefined();
    });

    it('includes linked grade and guardian details in the result', async () => {
      mockPrisma.user.findMany.mockResolvedValue([userRow]);

      const result = await service.findAll({}, 'org-1');

      expect(result).toEqual([userRow]);
      expect(result[0].grade).toEqual({ id: 'g-1', level: 5, name: null });
      expect(result[0].guardian.name).toBe('Guardian');
    });
  });

  describe('findOne', () => {
    const baseUser = {
      id: 'u-1',
      authId: 'auth-1',
      email: 'a@test.com',
      name: 'Alice',
      role: 'STUDENT',
      organizationId: 'org-1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    };

    it('throws USER_NOT_FOUND for an unknown or cross-org user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.findOne('u-1', 'org-1')).rejects.toMatchObject({
        status: 404,
        code: 'USER_NOT_FOUND',
      });
    });

    it('looks the user up scoped to the organization', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        role: 'ADMIN',
      });

      await service.findOne('u-1', 'org-1');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-1', organizationId: 'org-1' },
        }),
      );
    });

    it('returns base fields for an admin user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        role: 'ADMIN',
      });

      const result = await service.findOne('u-1', 'org-1');

      expect(result).toEqual({
        id: 'u-1',
        email: 'a@test.com',
        name: 'Alice',
        role: 'ADMIN',
        organizationId: 'org-1',
        hasAuthAccount: true,
        createdAt: baseUser.createdAt,
        updatedAt: baseUser.updatedAt,
      });
    });

    it('returns role-aware details for a student with activity counts', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        role: 'STUDENT',
        grade: { id: 'g-1', level: 5, name: null },
        guardian: { id: 'grd-1', name: 'Guardian', email: 'g@test.com' },
        wards: [],
        teacherOfferings: [],
        enrollments: [
          {
            id: 'e-1',
            status: 'APPROVED',
            section: {
              id: 'c-1',
              name: 'Math',
              offerings: [{ teacher: { id: 't-1', name: 'Mr. Smith' } }],
            },
          },
        ],
      });
      mockPrisma.submission.count.mockResolvedValue(3);
      mockPrisma.alert.count.mockResolvedValue(1);

      const result = await service.findOne('u-1', 'org-1');

      expect(mockPrisma.submission.count).toHaveBeenCalledWith({
        where: { studentId: 'u-1' },
      });
      expect(mockPrisma.alert.count).toHaveBeenCalledWith({
        where: { studentId: 'u-1', status: 'ACTIVE' },
      });
      expect(result).toMatchObject({
        role: 'STUDENT',
        grade: { id: 'g-1', level: 5 },
        guardian: { id: 'grd-1', name: 'Guardian' },
        submissionCount: 3,
        activeAlertCount: 1,
        enrollments: [
          {
            id: 'e-1',
            status: 'APPROVED',
            classId: 'c-1',
            className: 'Math',
            teacherName: 'Mr. Smith',
          },
        ],
      });
    });

    it('returns taught grades, classes with student counts and quiz count for a teacher', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        role: 'TEACHER',
        grade: null,
        guardian: null,
        wards: [],
        teacherOfferings: [
          {
            id: 'o-1',
            course: { id: 'co-1', name: 'Math', description: 'Algebra' },
            section: {
              description: null,
              gradeLevel: { id: 'g-1', level: 5, name: 'Grade 5' },
              enrollments: [{ id: 'e-1' }, { id: 'e-2' }],
            },
          },
          {
            id: 'o-2',
            course: { id: 'co-2', name: 'Science', description: null },
            section: {
              description: null,
              gradeLevel: { id: 'g-2', level: 6, name: 'Grade 6' },
              enrollments: [],
            },
          },
        ],
        enrollments: [],
      });
      mockPrisma.quiz.count.mockResolvedValue(4);

      const result = await service.findOne('u-1', 'org-1');

      expect(mockPrisma.quiz.count).toHaveBeenCalledWith({
        where: { teacherId: 'u-1' },
      });
      expect(result).toMatchObject({
        role: 'TEACHER',
        taughtGrades: [
          { id: 'g-1', level: 5, name: 'Grade 5' },
          { id: 'g-2', level: 6, name: 'Grade 6' },
        ],
        taughtClasses: [
          { id: 'o-1', name: 'Math', description: 'Algebra', studentCount: 2 },
          {
            id: 'o-2',
            name: 'Science',
            description: null,
            studentCount: 0,
          },
        ],
        quizCount: 4,
      });
    });

    it('returns wards with their grades for a guardian', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        role: 'GUARDIAN',
        grade: null,
        guardian: null,
        wards: [
          {
            id: 's-1',
            name: 'Kid',
            email: 'kid@test.com',
            grade: { id: 'g-1', level: 5, name: null },
          },
        ],
        teacherOfferings: [],
        enrollments: [],
      });

      const result = await service.findOne('u-1', 'org-1');

      expect(result).toMatchObject({
        role: 'GUARDIAN',
        wards: [
          {
            id: 's-1',
            name: 'Kid',
            email: 'kid@test.com',
            grade: { level: 5 },
          },
        ],
      });
    });
  });

  describe('remove', () => {
    const teacher = {
      id: 'u-1',
      authId: 'auth-1',
      email: 't@test.com',
      name: 'Teacher',
      role: 'TEACHER',
      organizationId: 'org-1',
    };
    const guardian = { ...teacher, id: 'u-2', role: 'GUARDIAN' };

    it('throws USER_NOT_FOUND for an unknown or cross-org user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('u-x', 'org-1', 'admin-1'),
      ).rejects.toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });
    });

    it('rejects deleting your own account', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...teacher,
        id: 'admin-1',
      });

      await expect(
        service.remove('admin-1', 'org-1', 'admin-1'),
      ).rejects.toMatchObject({ status: 409, code: 'USER_DELETE_FORBIDDEN' });
      expect(mockAuthClient.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it('rejects deleting another admin account', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...teacher,
        role: 'ADMIN',
        id: 'admin-2',
      });

      await expect(
        service.remove('admin-2', 'org-1', 'admin-1'),
      ).rejects.toMatchObject({ status: 409, code: 'USER_DELETE_FORBIDDEN' });
      expect(mockAuthClient.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it('rejects deleting a teacher who still teaches offerings', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(teacher);
      mockPrisma.courseOffering.count.mockResolvedValue(2);

      await expect(
        service.remove('u-1', 'org-1', 'admin-1'),
      ).rejects.toMatchObject({ status: 409, code: 'TEACHER_HAS_OFFERINGS' });
      expect(mockPrisma.courseOffering.count).toHaveBeenCalledWith({
        where: { teacherId: 'u-1' },
      });
      expect(mockAuthClient.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it('deletes the Supabase auth account then the local user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(teacher);
      mockPrisma.courseOffering.count.mockResolvedValue(0);
      mockAuthClient.auth.admin.deleteUser.mockResolvedValue({ error: null });
      tx.user.delete.mockResolvedValue(teacher);

      const result = await service.remove('u-1', 'org-1', 'admin-1');

      expect(mockAuthClient.auth.admin.deleteUser).toHaveBeenCalledWith(
        'auth-1',
      );
      expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'u-1' } });
      expect(result.id).toBe('u-1');
      expect(result.email).toBe('t@test.com');
      expect(result.name).toBe('Teacher');
      expect(result.role).toBe('TEACHER');
      expect(typeof result.deletedAt).toBe('string');
    });

    it('unlinks wards before deleting a guardian', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(guardian);
      mockAuthClient.auth.admin.deleteUser.mockResolvedValue({ error: null });
      tx.user.delete.mockResolvedValue(guardian);

      await service.remove('u-2', 'org-1', 'admin-1');

      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { guardianId: 'u-2' },
        data: { guardianId: null },
      });
    });

    it('skips the Supabase call when the user has no auth account', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...teacher,
        authId: null,
      });
      mockPrisma.courseOffering.count.mockResolvedValue(0);
      tx.user.delete.mockResolvedValue({ ...teacher, authId: null });

      await service.remove('u-1', 'org-1', 'admin-1');

      expect(mockAuthClient.auth.admin.deleteUser).not.toHaveBeenCalled();
      expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'u-1' } });
    });

    it('aborts with 500 when the Supabase delete fails', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(teacher);
      mockPrisma.courseOffering.count.mockResolvedValue(0);
      mockAuthClient.auth.admin.deleteUser.mockResolvedValue({
        error: new Error('boom'),
      });

      await expect(service.remove('u-1', 'org-1', 'admin-1')).rejects.toThrow(
        HttpException,
      );
      await expect(
        service.remove('u-1', 'org-1', 'admin-1'),
      ).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
      expect(tx.user.delete).not.toHaveBeenCalled();
    });
  });
});
