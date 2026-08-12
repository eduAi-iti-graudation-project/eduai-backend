import { Test, TestingModule } from '@nestjs/testing';
import { TeachersService } from './teachers.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TeachersService', () => {
  let service: TeachersService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    courseOffering: { findMany: jest.fn() },
    enrollment: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn() },
    gradeLevel: { findUnique: jest.fn() },
    teacherProfile: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeachersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TeachersService>(TeachersService);
    jest.clearAllMocks();
  });

  const gradeLevel = (id: string, level: number) => ({
    id,
    level,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  const offering = (id: string, grade?: ReturnType<typeof gradeLevel>) => ({
    id,
    course: { id: `course-${id}` },
    section: {
      id: `section-${id}`,
      gradeLevel: grade ?? null,
      _count: { enrollments: 0 },
    },
  });

  describe('getGrade', () => {
    it('throws when the teacher does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getGrade('t1', 'g1')).rejects.toMatchObject({
        code: 'TEACHER_NOT_FOUND',
      });
      expect(mockPrisma.gradeLevel.findUnique).not.toHaveBeenCalled();
    });

    it('throws when the grade level does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.gradeLevel.findUnique.mockResolvedValue(null);

      await expect(service.getGrade('t1', 'g1')).rejects.toMatchObject({
        code: 'GRADE_LEVEL_NOT_FOUND',
      });
      expect(mockPrisma.courseOffering.findMany).not.toHaveBeenCalled();
    });

    it('returns the grade with only the teacher sections and courses', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.gradeLevel.findUnique.mockResolvedValue({
        id: 'g1',
        level: 10,
        name: 'Grade 10',
      });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        {
          id: 'o1',
          course: { id: 'c1', name: 'Math', description: null },
          section: {
            id: 's1',
            name: '10A',
            description: 'Section A',
          },
        },
      ]);
      mockPrisma.enrollment.findMany.mockResolvedValue([
        { sectionId: 's1' },
        { sectionId: 's1' },
      ]);

      const result = await service.getGrade('t1', 'g1');

      expect(result).toEqual({
        id: 'g1',
        level: 10,
        name: 'Grade 10',
        students: 2,
        sections: [
          {
            id: 's1',
            name: '10A',
            description: 'Section A',
            enrollments: 2,
            courses: [{ id: 'c1', name: 'Math', description: null }],
          },
        ],
        courses: [{ id: 'c1', name: 'Math', description: null }],
      });
      expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
        where: { teacherId: 't1', section: { gradeLevelId: 'g1' } },
        include: {
          course: true,
          section: { select: { id: true, name: true, description: true } },
        },
      });
      expect(mockPrisma.enrollment.findMany).toHaveBeenCalledWith({
        where: { sectionId: { in: ['s1'] }, status: 'APPROVED' },
        select: { sectionId: true },
      });
    });
  });

  describe('getGrades', () => {
    it('throws when the teacher does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getGrades('t1')).rejects.toMatchObject({
        code: 'TEACHER_NOT_FOUND',
      });
      expect(mockPrisma.courseOffering.findMany).not.toHaveBeenCalled();
    });

    it('returns grade levels derived from the teacher offerings', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        offering('o1', gradeLevel('g1', 6)),
      ]);
      mockPrisma.enrollment.count.mockResolvedValue(3);

      const result = await service.getGrades('t1');

      expect(result).toEqual([
        {
          id: 'o1',
          teacherId: 't1',
          gradeId: 'g1',
          grade: gradeLevel('g1', 6),
          _count: { sections: 1, courses: 1, students: 3 },
        },
      ]);
      expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
        where: { teacherId: 't1' },
        include: {
          course: true,
          section: {
            include: {
              gradeLevel: true,
              _count: { select: { enrollments: true } },
            },
          },
        },
      });
      expect(mockPrisma.enrollment.count).toHaveBeenCalledWith({
        where: {
          sectionId: { in: ['section-o1'] },
          status: 'APPROVED',
        },
      });
    });

    it('dedupes a grade level linked by multiple offerings', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        offering('o1', gradeLevel('g1', 6)),
        offering('o2', gradeLevel('g2', 7)),
        offering('o3', gradeLevel('g1', 6)),
      ]);

      const result = await service.getGrades('t1');

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.gradeId)).toEqual(['g1', 'g2']);
    });

    it('skips offerings without a grade level', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        offering('o1', gradeLevel('g1', 6)),
        offering('o2'),
      ]);

      const result = await service.getGrades('t1');

      expect(result).toHaveLength(1);
      expect(result.map((r) => r.gradeId)).toEqual(['g1']);
    });

    it('returns an empty array when the teacher has no offerings', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.courseOffering.findMany.mockResolvedValue([]);

      const result = await service.getGrades('t1');

      expect(result).toEqual([]);
    });
  });

  describe('teacher personal profile', () => {
    const teacher = {
      id: 't1',
      name: 'Teacher One',
      email: 't1@eduai.test',
      role: 'TEACHER',
      organizationId: 'org1',
      avatarUrl: null,
      gender: null,
      createdAt: new Date(),
    };

    beforeEach(() => {
      process.env.TEACHER_SSN_ENCRYPTION_KEY = 'test-ssn-key-123456';
      mockPrisma.user.findFirst = jest.fn();
      mockPrisma.user.update = jest.fn();
      mockPrisma.teacherProfile = {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      };
      mockPrisma.$transaction = jest.fn((_txs: unknown[]) => _txs as never);
    });

    it('updates and encrypts the SSN when provided', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(teacher);
      mockPrisma.$transaction.mockResolvedValue([
        { id: 't1' },
        {
          phone: '+15551234567',
          ssnEncrypted: 'enc',
          ssnTail4: '6789',
        },
      ]);
      mockPrisma.teacherProfile.upsert.mockResolvedValue({
        ssnEncrypted: 'enc',
        ssnTail4: '6789',
      });

      const result = await service.updateProfile('t1', 'org1', {
        ssn: '123-45-6789',
        phone: '+15551234567',
      });

      const upsertCalls = mockPrisma.teacherProfile.upsert.mock.calls as [
        { update: Record<string, unknown> },
      ][];
      const update = upsertCalls[0][0].update;
      expect(update.ssnEncrypted).toMatch(/:/);
      expect(update.ssnEncrypted).not.toContain('123-45-6789');
      expect(update.ssnTail4).toBe('6789');
      expect(result.ssnMasked).toMatch(/6789$/);
      expect(result.phone).toBe('+15551234567');
    });

    it('reveals and decrypts the stored SSN', async () => {
      const ssnModule = jest.requireActual(
        '../common/crypto/ssn',
      ) as unknown as {
        encryptSsn: (plain: string) => string;
      };
      const encryptSsn = ssnModule.encryptSsn;
      mockPrisma.user.findFirst.mockResolvedValue(teacher);
      mockPrisma.teacherProfile.findUnique.mockResolvedValue({
        ssnEncrypted: encryptSsn('123-45-6789'),
      });

      const result = await service.getSsn('t1', 'org1');

      expect(result).toEqual({ ssn: '123-45-6789' });
    });

    it('throws TEACHER_NOT_FOUND for a non-teacher user on ssn reveal', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getSsn('t1', 'org1')).rejects.toMatchObject({
        code: 'TEACHER_NOT_FOUND',
      });
    });
  });
});
