import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TeachersService } from './teachers.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TeachersService', () => {
  let service: TeachersService;

  const mockPrisma = {
    user: { findUnique: jest.fn() },
    teacherGrade: {
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    class: { findMany: jest.fn() },
    grade: { findUnique: jest.fn() },
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

  const grade = (id: string, level: number) => ({
    id,
    level,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  describe('getGrades', () => {
    it('throws NotFoundException when the teacher does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getGrades('t1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.teacherGrade.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.class.findMany).not.toHaveBeenCalled();
    });

    it('returns grades derived from the teacher class links', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.teacherGrade.findMany.mockResolvedValue([]);
      mockPrisma.class.findMany.mockResolvedValue([
        {
          id: 'c1',
          gradeLinks: [
            {
              id: 'gc1',
              gradeId: 'g1',
              grade: grade('g1', 6),
            },
          ],
        },
      ]);

      const result = await service.getGrades('t1');

      expect(result).toEqual([
        { id: 'gc1', teacherId: 't1', gradeId: 'g1', grade: grade('g1', 6) },
      ]);
      expect(mockPrisma.class.findMany).toHaveBeenCalledWith({
        where: { teacherId: 't1' },
        include: { gradeLinks: { include: { grade: true } } },
      });
    });

    it('dedupes a grade linked by multiple classes', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.teacherGrade.findMany.mockResolvedValue([]);
      mockPrisma.class.findMany.mockResolvedValue([
        {
          id: 'c1',
          gradeLinks: [
            { id: 'gc1', gradeId: 'g1', grade: grade('g1', 6) },
            { id: 'gc2', gradeId: 'g2', grade: grade('g2', 7) },
          ],
        },
        {
          id: 'c2',
          gradeLinks: [{ id: 'gc3', gradeId: 'g1', grade: grade('g1', 6) }],
        },
      ]);

      const result = await service.getGrades('t1');

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.gradeId)).toEqual(['g1', 'g2']);
    });

    it('unions explicit TeacherGrade rows with derived grades, explicit first, no duplicates', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.teacherGrade.findMany.mockResolvedValue([
        { id: 'tg1', teacherId: 't1', gradeId: 'g1', grade: grade('g1', 6) },
      ]);
      mockPrisma.class.findMany.mockResolvedValue([
        {
          id: 'c1',
          gradeLinks: [
            { id: 'gc1', gradeId: 'g1', grade: grade('g1', 6) },
            { id: 'gc2', gradeId: 'g2', grade: grade('g2', 7) },
          ],
        },
      ]);

      const result = await service.getGrades('t1');

      expect(result.map((r) => r.gradeId)).toEqual(['g1', 'g2']);
      expect(result[0]).toEqual({
        id: 'tg1',
        teacherId: 't1',
        gradeId: 'g1',
        grade: grade('g1', 6),
      });
      expect(result[1]).toEqual({
        id: 'gc2',
        teacherId: 't1',
        gradeId: 'g2',
        grade: grade('g2', 7),
      });
    });

    it('returns an empty array when the teacher has no classes or links', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.teacherGrade.findMany.mockResolvedValue([]);
      mockPrisma.class.findMany.mockResolvedValue([]);

      const result = await service.getGrades('t1');

      expect(result).toEqual([]);
    });
  });
});
