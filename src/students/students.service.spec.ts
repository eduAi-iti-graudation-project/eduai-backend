import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { PrismaService } from '../prisma/prisma.service';

describe('StudentsService', () => {
  let service: StudentsService;

  const mockPrisma = {
    gradingScore: {
      findMany: jest.fn(),
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

      const result = await service.getGrades(studentId);

      expect(mockPrisma.gradingScore.findMany).toHaveBeenCalledWith({
        where: { submission: { studentId }, isConfirmed: true },
        include: { criteria: true, submission: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].isConfirmed).toBe(true);
    });

    it('should exclude unconfirmed grades', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([]);

      const result = await service.getGrades(studentId);

      expect(result).toHaveLength(0);
      expect(mockPrisma.gradingScore.findMany).toHaveBeenCalledWith({
        where: { submission: { studentId }, isConfirmed: true },
        include: { criteria: true, submission: true },
      });
    });

    it('should return empty array when student has no grades', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([]);

      const result = await service.getGrades(studentId);

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

      const result = await service.getGrades(studentId);

      expect(result[0]).toHaveProperty('criteria');
      expect(result[0]).toHaveProperty('submission');
    });
  });
});
