import { Test, TestingModule } from '@nestjs/testing';
import { GradingService } from './grading.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationAgentService } from '../communication-agent/communication-agent.service';
import { FeedbackWriterService } from '../feedback-writer/feedback-writer.service';
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
      upsert: jest.fn(),
    },
    rubricCriteria: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockCommunicationAgentService = {
    analyze: jest.fn().mockResolvedValue(undefined),
  };

  const mockFeedbackWriterService = {
    write: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: CommunicationAgentService,
          useValue: mockCommunicationAgentService,
        },
        {
          provide: FeedbackWriterService,
          useValue: mockFeedbackWriterService,
        },
      ],
    }).compile();

    service = module.get<GradingService>(GradingService);
    jest.clearAllMocks();
  });

  describe('gradeSubmission', () => {
    it('should upsert scores and set status to REVIEW_READY', async () => {
      mockPrisma.rubricCriteria.findMany.mockResolvedValue([
        { id: 'c1', maxPoints: 10 },
        { id: 'c2', maxPoints: 15 },
      ]);

      await service.gradeSubmission('submission-id');

      expect(mockPrisma.gradingScore.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrisma.submission.update).toHaveBeenLastCalledWith({
        where: { id: 'submission-id' },
        data: { status: 'REVIEW_READY' },
      });
    });

    it('should not call FeedbackWriterService during gradeSubmission', async () => {
      mockPrisma.rubricCriteria.findMany.mockResolvedValue([]);

      await service.gradeSubmission('submission-id');

      expect(mockFeedbackWriterService.write).not.toHaveBeenCalled();
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
      expect(result?.status).toBe('CONFIRMED');
    });

    it('should call CommunicationAgentService.analyze and FeedbackWriterService.write after confirm', async () => {
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

      expect(mockCommunicationAgentService.analyze).toHaveBeenCalledWith(
        'submission-id',
      );
      expect(mockFeedbackWriterService.write).toHaveBeenCalledWith(
        'submission-id',
      );
    });

    it('should throw NotFoundException for missing submission', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(null);

      await expect(service.confirmAll('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getScores', () => {
    it('should return scores with criteria for a submission', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue({ id: 's1' });
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        {
          id: 'score-1',
          pointsAwarded: 7,
          criteria: { description: 'Thesis' },
        },
      ]);

      const result = await service.getScores('s1');

      expect(mockPrisma.gradingScore.findMany).toHaveBeenCalledWith({
        where: { submissionId: 's1' },
        include: { criteria: true },
      });
      expect(result).toHaveLength(1);
    });

    it('should throw NotFoundException for missing submission', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(null);

      await expect(service.getScores('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateScore', () => {
    it('should update pointsAwarded on an unconfirmed score', async () => {
      mockPrisma.gradingScore.findUnique.mockResolvedValue({
        id: 'score-1',
        isConfirmed: false,
        pointsAwarded: 5,
      });
      mockPrisma.gradingScore.update.mockResolvedValue({
        id: 'score-1',
        pointsAwarded: 8,
        criteria: { description: 'Thesis' },
      });

      const result = await service.updateScore('score-1', 8);

      expect(mockPrisma.gradingScore.update).toHaveBeenCalledWith({
        where: { id: 'score-1' },
        data: { pointsAwarded: 8 },
        include: { criteria: true },
      });
      expect(result.pointsAwarded).toBe(8);
    });

    it('should reject update on a confirmed score', async () => {
      mockPrisma.gradingScore.findUnique.mockResolvedValue({
        id: 'score-1',
        isConfirmed: true,
      });

      await expect(service.updateScore('score-1', 10)).rejects.toThrow(
        'Cannot edit a confirmed score',
      );
    });

    it('should throw NotFoundException for missing score', async () => {
      mockPrisma.gradingScore.findUnique.mockResolvedValue(null);

      await expect(service.updateScore('bad-id', 5)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
