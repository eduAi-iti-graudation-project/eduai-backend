import { Test, TestingModule } from '@nestjs/testing';
import { TeachersService } from './teachers.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TeachersService', () => {
  let service: TeachersService;

  const mockPrisma = {
    user: { findUnique: jest.fn() },
    courseOffering: { findMany: jest.fn() },
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
    section: { gradeLevel: grade ?? null },
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

      const result = await service.getGrades('t1');

      expect(result).toEqual([
        {
          id: 'o1',
          teacherId: 't1',
          gradeId: 'g1',
          grade: gradeLevel('g1', 6),
        },
      ]);
      expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
        where: { teacherId: 't1' },
        include: { course: true, section: { include: { gradeLevel: true } } },
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
});
