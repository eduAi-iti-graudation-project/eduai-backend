import { ApiError } from '../common/errors/api-error';
import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { PrismaService } from '../prisma/prisma.service';

describe('StudentsService', () => {
  let service: StudentsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    gradingScore: {
      findMany: jest.fn(),
    },
    submission: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StudentsService>(StudentsService);
    jest.clearAllMocks();
  });

  describe('getSubmissionGrades', () => {
    const studentId = 'student-uuid';
    const submissionId = 'sub-1';

    it('should return grades filtered by student and submission', async () => {
      mockPrisma.submission.findFirst.mockResolvedValue({
        id: submissionId,
        studentId,
        assignmentId: 'a-1',
      });
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        {
          id: 's1',
          submissionId,
          criteriaId: 'c1',
          pointsAwarded: 8,
          aiFeedback: null,
          teacherNotes: null,
          isConfirmed: true,
          createdAt: new Date(),
          criteria: { id: 'c1', description: 'Thesis', maxPoints: 10 },
        },
      ]);

      const result = await service.getSubmissionGrades(
        studentId,
        submissionId,
        organizationId,
      );

      expect(mockPrisma.gradingScore.findMany).toHaveBeenCalledWith({
        where: { submissionId, isConfirmed: true },
        include: { criteria: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        assignmentId: 'a-1',
        criterionDescription: 'Thesis',
        criterionMaxPoints: 10,
      });
    });

    it('should throw if submission does not belong to student', async () => {
      mockPrisma.submission.findFirst.mockResolvedValue(null);

      try {
        await service.getSubmissionGrades(
          studentId,
          submissionId,
          organizationId,
        );
        expect('should have thrown').toBe('but did not');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('SUBMISSION_NOT_FOUND');
      }

      expect(mockPrisma.submission.findFirst).toHaveBeenCalledWith({
        where: { id: submissionId, studentId, student: { organizationId } },
      });
    });

    it('should throw if submission does not exist', async () => {
      mockPrisma.submission.findFirst.mockResolvedValue(null);

      try {
        await service.getSubmissionGrades(
          studentId,
          submissionId,
          organizationId,
        );
        expect('should have thrown').toBe('but did not');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('SUBMISSION_NOT_FOUND');
      }
    });
  });

  describe('getGrades', () => {
    const studentId = 'student-uuid';

    it('should only return confirmed grades', async () => {
      const confirmedScore = {
        id: 's1',
        pointsAwarded: 9,
        isConfirmed: true,
        criteria: { id: 'c1' },
        submission: { id: 'sub-1' },
      };
      mockPrisma.gradingScore.findMany.mockResolvedValue([confirmedScore]);

      const result = await service.getGrades(studentId, organizationId);

      expect(mockPrisma.gradingScore.findMany).toHaveBeenCalledWith({
        where: {
          submission: { studentId, student: { organizationId } },
          isConfirmed: true,
        },
        include: { criteria: true, submission: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].isConfirmed).toBe(true);
    });

    it('should exclude unconfirmed grades', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([]);

      const result = await service.getGrades(studentId, organizationId);

      expect(result).toHaveLength(0);
      expect(mockPrisma.gradingScore.findMany).toHaveBeenCalledWith({
        where: {
          submission: { studentId, student: { organizationId } },
          isConfirmed: true,
        },
        include: { criteria: true, submission: true },
      });
    });

    it('should return empty array when student has no grades', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([]);

      const result = await service.getGrades(studentId, organizationId);

      expect(result).toEqual([]);
    });

    it('should flatten criteria and submission into the grade object', async () => {
      const grade = {
        id: 's1',
        submissionId: 'sub-1',
        criteriaId: 'c1',
        pointsAwarded: 8,
        aiFeedback: null,
        teacherNotes: null,
        isConfirmed: true,
        createdAt: new Date(),
        criteria: { id: 'c1', description: 'Thesis', maxPoints: 10 },
        submission: { id: 'sub-1', assignmentId: 'a-1' },
      };
      mockPrisma.gradingScore.findMany.mockResolvedValue([grade]);

      const result = await service.getGrades(studentId, organizationId);

      expect(result[0]).toMatchObject({
        assignmentId: 'a-1',
        criterionDescription: 'Thesis',
        criterionMaxPoints: 10,
        criteriaId: 'c1',
      });
      expect(result[0]).not.toHaveProperty('submission');
      expect(result[0]).not.toHaveProperty('criteria');
    });
  });
});
