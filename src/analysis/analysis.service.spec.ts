import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from './analysis.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';

describe('AnalysisService', () => {
  let service: AnalysisService;

  const mockPrisma = {
    gradingScore: { findMany: jest.fn() },
    alert: { count: jest.fn(), create: jest.fn() },
  };

  const mockLlm = {
    generateStructured: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
    jest.clearAllMocks();
  });

  describe('evaluateStudent', () => {
    const studentId = 'student-uuid';

    it('should not create alert when no confirmed grades exist', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([]);

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });

    it('should not create alert when grades are above threshold', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        {
          pointsAwarded: 8,
          criteria: { maxPoints: 10 },
          submissionId: 's1',
          submission: { id: 's1', assignment: { totalPoints: 10 } },
        },
        {
          pointsAwarded: 9,
          criteria: { maxPoints: 10 },
          submissionId: 's2',
          submission: { id: 's2', assignment: { totalPoints: 10 } },
        },
        {
          pointsAwarded: 8,
          criteria: { maxPoints: 10 },
          submissionId: 's3',
          submission: { id: 's3', assignment: { totalPoints: 10 } },
        },
      ]);

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });

    it('should create FAILING alert when average is below 60%', async () => {
      const scores = [
        {
          pointsAwarded: 4,
          criteria: { maxPoints: 10 },
          submissionId: 's1',
          submission: { id: 's1', assignment: { totalPoints: 10 } },
        },
        {
          pointsAwarded: 5,
          criteria: { maxPoints: 10 },
          submissionId: 's2',
          submission: { id: 's2', assignment: { totalPoints: 10 } },
        },
        {
          pointsAwarded: 3,
          criteria: { maxPoints: 10 },
          submissionId: 's3',
          submission: { id: 's3', assignment: { totalPoints: 10 } },
        },
      ];
      mockPrisma.gradingScore.findMany.mockResolvedValue(scores);
      mockPrisma.alert.count.mockResolvedValue(0);
      mockLlm.generateStructured.mockResolvedValue({
        reason: 'Student is struggling with the material.',
      });
      mockPrisma.alert.create.mockResolvedValue({});

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).toHaveBeenCalledWith({
        data: {
          studentId,
          type: 'FAILING',
          reason: 'Student is struggling with the material.',
          status: 'ACTIVE',
        },
      });
    });

    it('should create DOWNWARD_TREND alert when last 2 grades drop', async () => {
      const scores = [
        {
          pointsAwarded: 9,
          criteria: { maxPoints: 10 },
          submissionId: 's1',
          submission: { id: 's1', assignment: { totalPoints: 10 } },
        },
        {
          pointsAwarded: 8,
          criteria: { maxPoints: 10 },
          submissionId: 's2',
          submission: { id: 's2', assignment: { totalPoints: 10 } },
        },
        {
          pointsAwarded: 7,
          criteria: { maxPoints: 10 },
          submissionId: 's3',
          submission: { id: 's3', assignment: { totalPoints: 10 } },
        },
      ];
      mockPrisma.gradingScore.findMany.mockResolvedValue(scores);
      mockPrisma.alert.count.mockResolvedValue(0);
      mockLlm.generateStructured.mockResolvedValue({
        reason: 'Grades have been declining.',
      });

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).toHaveBeenCalledWith({
        data: {
          studentId,
          type: 'DOWNWARD_TREND',
          reason: 'Grades have been declining.',
          status: 'ACTIVE',
        },
      });
    });

    it('should create CONSISTENT_STRUGGLE when student already has alerts', async () => {
      const scores = [
        {
          pointsAwarded: 4,
          criteria: { maxPoints: 10 },
          submissionId: 's1',
          submission: { id: 's1', assignment: { totalPoints: 10 } },
        },
        {
          pointsAwarded: 5,
          criteria: { maxPoints: 10 },
          submissionId: 's2',
          submission: { id: 's2', assignment: { totalPoints: 10 } },
        },
        {
          pointsAwarded: 3,
          criteria: { maxPoints: 10 },
          submissionId: 's3',
          submission: { id: 's3', assignment: { totalPoints: 10 } },
        },
      ];
      mockPrisma.gradingScore.findMany.mockResolvedValue(scores);
      mockPrisma.alert.count.mockResolvedValue(1);
      mockLlm.generateStructured.mockResolvedValue({
        reason: 'Persistent struggles.',
      });

      await service.evaluateStudent(studentId);

      expect(mockPrisma.alert.create).toHaveBeenCalledWith({
        data: {
          studentId,
          type: 'CONSISTENT_STRUGGLE',
          reason: 'Persistent struggles.',
          status: 'ACTIVE',
        },
      });
    });
  });
});
