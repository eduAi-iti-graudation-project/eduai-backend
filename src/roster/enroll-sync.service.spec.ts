import { Test, TestingModule } from '@nestjs/testing';
import { EnrollSyncService } from './enroll-sync.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EnrollSyncService', () => {
  let service: EnrollSyncService;

  const mockPrisma = {
    user: { findUnique: jest.fn() },
    section: { findMany: jest.fn(), findUnique: jest.fn() },
    enrollment: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollSyncService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EnrollSyncService>(EnrollSyncService);
  });

  describe('syncStudentToGrade', () => {
    const student = { organizationId: 'org-1', gradeId: 'g7' };

    it('enrolls the student in exactly one section (round-robin: least populated)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(student);
      mockPrisma.section.findMany.mockResolvedValue([
        { id: 's1', name: 'A' },
        { id: 's2', name: 'B' },
      ]);
      mockPrisma.enrollment.groupBy.mockResolvedValue([
        { sectionId: 's1', _count: { sectionId: 3 } },
      ]);
      mockPrisma.enrollment.upsert.mockResolvedValue({ id: 'e1' });
      mockPrisma.enrollment.findMany.mockResolvedValue([]);
      mockPrisma.enrollment.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.syncStudentToGrade('u1', 'org-1', 'g7');

      expect(result).toEqual({ added: 1, removed: 0 });
      const upsertCalls = mockPrisma.enrollment.upsert.mock.calls as [
        { create: { sectionId: string; studentId: string } },
      ][];
      expect(upsertCalls[0][0].create).toEqual({
        sectionId: 's2',
        studentId: 'u1',
        status: 'APPROVED',
      });
    });

    it('enrolls in the preferred section when one is requested', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(student);
      mockPrisma.section.findMany.mockResolvedValue([
        { id: 's1', name: 'A' },
        { id: 's2', name: 'B' },
      ]);
      mockPrisma.enrollment.upsert.mockResolvedValue({ id: 'e2' });
      mockPrisma.enrollment.findMany.mockResolvedValue([]);

      const result = await service.syncStudentToGrade(
        'u1',
        'org-1',
        'g7',
        's2',
      );

      expect(result).toEqual({ added: 1, removed: 0 });
      const upsertCalls = mockPrisma.enrollment.upsert.mock.calls as [
        { create: { sectionId: string; studentId: string } },
      ][];
      expect(upsertCalls[0][0].create).toEqual({
        sectionId: 's2',
        studentId: 'u1',
        status: 'APPROVED',
      });
      expect(mockPrisma.enrollment.groupBy).not.toHaveBeenCalled();
    });

    it('re-adds a student previously excluded (REJECTED) and clears the marker', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(student);
      mockPrisma.section.findMany.mockResolvedValue([{ id: 's1', name: 'A' }]);
      mockPrisma.enrollment.upsert.mockResolvedValue({ id: 'e1' });
      mockPrisma.enrollment.findMany.mockResolvedValue([]);

      const result = await service.syncStudentToGrade('u1', 'org-1', 'g7');

      expect(result).toEqual({ added: 1, removed: 0 });
      expect(mockPrisma.enrollment.upsert).toHaveBeenCalledWith({
        where: { sectionId_studentId: { sectionId: 's1', studentId: 'u1' } },
        update: { status: 'APPROVED' },
        create: { sectionId: 's1', studentId: 'u1', status: 'APPROVED' },
      });
    });

    it('removes APPROVED enrollments in other sections and other grades', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(student);
      mockPrisma.section.findMany.mockResolvedValue([{ id: 's1', name: 'A' }]);
      mockPrisma.enrollment.upsert.mockResolvedValue({ id: 'e1' });
      mockPrisma.enrollment.findMany.mockResolvedValue([
        { id: 'e8' },
        { id: 's2x' },
      ]);
      mockPrisma.enrollment.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.syncStudentToGrade('u1', 'org-1', 'g7');

      expect(result).toEqual({ added: 1, removed: 2 });
      expect(mockPrisma.enrollment.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['e8', 's2x'] } },
      });
    });

    it('is a no-op for a missing student or cross-org student', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.syncStudentToGrade('u1', 'org-1', 'g7')).toEqual({
        added: 0,
        removed: 0,
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        ...student,
        organizationId: 'other-org',
      });
      expect(await service.syncStudentToGrade('u1', 'org-1', 'g7')).toEqual({
        added: 0,
        removed: 0,
      });
    });
  });

  describe('syncSectionToStudents', () => {
    it('is a no-op (sections fill up via round-robin as students are added)', () => {
      expect(service.syncSectionToStudents()).toEqual({ added: 0 });
      expect(mockPrisma.enrollment.upsert).not.toHaveBeenCalled();
    });
  });
});
