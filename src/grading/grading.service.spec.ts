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
