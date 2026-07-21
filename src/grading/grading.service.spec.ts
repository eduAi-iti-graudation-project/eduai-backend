import { Test, TestingModule } from '@nestjs/testing';
import { GradingService } from './grading.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisService } from '../analysis/analysis.service';
import { NotFoundException } from '@nestjs/common';

describe('GradingService', () => {
  let service: GradingService;

  const mockPrisma = {
    submission: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    gradingScore: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    submission: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockAnalysisService = {
    evaluateStudent: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalysisService, useValue: mockAnalysisService },
      ],
    }).compile();

    service = module.get<GradingService>(GradingService);
    jest.clearAllMocks();
  });

  describe('confirm', () => {
    const scoreId = 'test-score-id';
    const submissionId = 'sub-1';
    const baseScore = {
      id: scoreId,
      submissionId,
      pointsAwarded: 5,
      teacherNotes: null,
      submission: { id: submissionId, status: 'REVIEW_READY' },
    };

    it('should set isConfirmed to true', async () => {
      const dto = { pointsAwarded: 8 };
      const updatedScore = {
        ...baseScore,
        pointsAwarded: 8,
        isConfirmed: true,
      };

      mockPrisma.gradingScore.findUnique.mockResolvedValue(baseScore);
      mockPrisma.gradingScore.findMany.mockResolvedValue([updatedScore]);
      mockPrisma.gradingScore.update.mockResolvedValue(updatedScore);

      const result = await service.confirm(scoreId, dto);

      expect(mockPrisma.gradingScore.findUnique).toHaveBeenCalledWith({
        where: { id: scoreId },
        include: { submission: true },
      });
      expect(mockPrisma.gradingScore.update).toHaveBeenCalledWith({
        where: { id: scoreId },
        data: { pointsAwarded: 8, teacherNotes: undefined, isConfirmed: true },
      });
      expect(result.isConfirmed).toBe(true);
    });

    it('should transition submission to CONFIRMED when all scores confirmed', async () => {
      const dto = { pointsAwarded: 8 };
      const updatedScore = {
        ...baseScore,
        pointsAwarded: 8,
        isConfirmed: true,
      };

      mockPrisma.gradingScore.findUnique.mockResolvedValue(baseScore);
      mockPrisma.gradingScore.findMany.mockResolvedValue([updatedScore]);
      mockPrisma.gradingScore.update.mockResolvedValue(updatedScore);

      await service.confirm(scoreId, dto);

      expect(mockPrisma.submission.update).toHaveBeenCalledWith({
        where: { id: submissionId },
        data: { status: 'CONFIRMED' },
      });
    });

    it('should not transition submission when not all scores confirmed', async () => {
      const dto = { pointsAwarded: 8 };
      const updatedScore = {
        ...baseScore,
        pointsAwarded: 8,
        isConfirmed: true,
      };
      const unconfirmedScore = { id: 'other-score', isConfirmed: false };

      mockPrisma.gradingScore.findUnique.mockResolvedValue(baseScore);
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        updatedScore,
        unconfirmedScore,
      ]);
      mockPrisma.gradingScore.update.mockResolvedValue(updatedScore);

      await service.confirm(scoreId, dto);

      expect(mockPrisma.submission.update).not.toHaveBeenCalled();
    });

    it('should accept optional teacherNotes', async () => {
      const dto = { pointsAwarded: 10, teacherNotes: 'Good work' };
      const existingScore = { ...baseScore, pointsAwarded: 7 };
      const updatedScore = { ...existingScore, ...dto, isConfirmed: true };

      mockPrisma.gradingScore.findUnique.mockResolvedValue(existingScore);
      mockPrisma.gradingScore.findMany.mockResolvedValue([updatedScore]);
      mockPrisma.gradingScore.update.mockResolvedValue(updatedScore);

      const result = await service.confirm(scoreId, dto);

      expect(mockPrisma.gradingScore.update).toHaveBeenCalledWith({
        where: { id: scoreId },
        data: {
          pointsAwarded: 10,
          teacherNotes: 'Good work',
          isConfirmed: true,
        },
      });
      expect(result.teacherNotes).toBe('Good work');
    });

    it('should throw NotFoundException for missing GradingScore', async () => {
      mockPrisma.gradingScore.findUnique.mockResolvedValue(null);

      await expect(
        service.confirm('non-existent-id', { pointsAwarded: 5 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmAll', () => {
    it('should confirm all scores and update submission status to CONFIRMED', async () => {
      const submission = {
        id: 'submission-id',
        studentId: 'student-id',
        status: 'REVIEWED',
        scores: [{ id: 's1' }, { id: 's2' }],
      };
      const updatedSubmission = {
        ...submission,
        status: 'CONFIRMED',
        scores: [
          { id: 's1', isConfirmed: true },
          { id: 's2', isConfirmed: true },
        ],
      };

      mockPrisma.submission.findUnique
        .mockResolvedValueOnce(submission)
        .mockResolvedValueOnce(updatedSubmission);

      mockPrisma.$transaction.mockImplementation(
        async (cb: (tx: typeof mockPrisma) => Promise<void>) => {
          if (typeof cb === 'function') {
            return cb(mockPrisma);
          }
        },
      );

      const result = await service.confirmAll('submission-id');

      expect(mockPrisma.submission.findUnique).toHaveBeenCalledWith({
        where: { id: 'submission-id' },
        include: { scores: true },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result.status).toBe('CONFIRMED');
    });

    it('should call AnalysisService.evaluateStudent after confirm', async () => {
      const submission = {
        id: 'submission-id',
        studentId: 'student-id',
        status: 'REVIEWED',
        scores: [{ id: 's1' }],
      };
      const updatedSubmission = {
        ...submission,
        status: 'CONFIRMED',
        scores: [{ id: 's1', isConfirmed: true }],
      };

      mockPrisma.submission.findUnique
        .mockResolvedValueOnce(submission)
        .mockResolvedValueOnce(updatedSubmission);

      mockPrisma.$transaction.mockImplementation(
        async (cb: (tx: typeof mockPrisma) => Promise<void>) => {
          if (typeof cb === 'function') {
            return cb(mockPrisma);
          }
        },
      );

      await service.confirmAll('submission-id');

      expect(mockAnalysisService.evaluateStudent).toHaveBeenCalledWith(
        'student-id',
      );
    });

    it('should throw NotFoundException for missing submission', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(null);

      await expect(service.confirmAll('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
