import { Test, TestingModule } from '@nestjs/testing';
import { GradingService } from './grading.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { RubricsService } from '../rubrics/rubrics.service';
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
      upsert: jest.fn(),
    },
    $executeRawUnsafe: jest.fn(),
  };

  const mockLlm = {
    embed: jest.fn(),
    generateStructured: jest.fn(),
  };

  const mockRubrics = {
    findSimilarCriteria: jest.fn(),
    findConfirmedRubric: jest.fn(),
  };

  const mockAnalysis = {
    evaluateStudent: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: RubricsService, useValue: mockRubrics },
        { provide: AnalysisService, useValue: mockAnalysis },
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

  describe('gradeSubmission', () => {
    const submissionId = 'sub-1';
    const criteria = [
      { id: 'c1', description: 'Thesis', maxPoints: 10 },
      { id: 'c2', description: 'Evidence', maxPoints: 15 },
    ];

    const chunk = {
      id: 'chunk-1',
      submissionId,
      content: 'Student essay text here.',
    };

    const submission = {
      id: submissionId,
      assignmentId: 'assign-1',
      status: 'SUBMITTED',
      chunks: [chunk],
      assignment: { id: 'assign-1' },
    };

    const llmOutput = {
      scores: [
        { criterionId: 'c1', pointsAwarded: 8, feedback: 'Good thesis' },
        { criterionId: 'c2', pointsAwarded: 12, feedback: 'Solid evidence' },
      ],
    };

    const fakeEmbedding = Array.from({ length: 1024 }, () => Math.random());

    beforeEach(() => {
      mockPrisma.submission.findUnique.mockResolvedValue(submission);
      mockPrisma.submission.update.mockResolvedValue(submission);
      mockRubrics.findSimilarCriteria.mockResolvedValue(criteria);
      mockLlm.embed.mockResolvedValue(fakeEmbedding);
      mockLlm.generateStructured.mockResolvedValue(llmOutput);
      mockPrisma.gradingScore.upsert.mockResolvedValue({});
      mockPrisma.$executeRawUnsafe.mockResolvedValue({});
    });

    it('should embed chunk, call LLM, and upsert scores', async () => {
      const gradedSubmission = {
        ...submission,
        status: 'REVIEW_READY',
        chunks: [chunk],
        scores: [
          { criteria: { id: 'c1' }, pointsAwarded: 8 },
          { criteria: { id: 'c2' }, pointsAwarded: 12 },
        ],
      };
      mockPrisma.submission.findUnique
        .mockResolvedValueOnce(submission)
        .mockResolvedValueOnce(gradedSubmission);

      const result = await service.gradeSubmission(submissionId);

      expect(mockLlm.embed).toHaveBeenCalledWith(chunk.content);
      expect(mockRubrics.findSimilarCriteria).toHaveBeenCalledWith(
        fakeEmbedding,
        submission.assignmentId,
      );
      expect(mockLlm.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: expect.any(Object) as object,
        }),
      );
      expect(mockPrisma.gradingScore.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrisma.gradingScore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            submissionId_criteriaId: {
              submissionId,
              criteriaId: 'c1',
            },
          },
          create: expect.objectContaining({ pointsAwarded: 8 }) as object,
          update: expect.objectContaining({ pointsAwarded: 8 }) as object,
        }),
      );
      expect(result).toEqual(gradedSubmission);
      expect(mockPrisma.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: submissionId },
          data: { status: 'GRADING_IN_PROGRESS' },
        }),
      );
      expect(mockPrisma.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: submissionId },
          data: { status: 'REVIEW_READY' },
        }),
      );
    });

    it('should throw NotFoundException for missing submission', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(null);

      await expect(service.gradeSubmission('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should still grade remaining chunks when one chunk LLM call fails', async () => {
      const chunks = [
        { id: 'chunk-1', submissionId, content: 'First part.' },
        { id: 'chunk-2', submissionId, content: 'Second part.' },
      ];
      const submissionWithTwoChunks = {
        ...submission,
        chunks,
      };
      mockPrisma.submission.findUnique
        .mockResolvedValueOnce(submissionWithTwoChunks)
        .mockResolvedValueOnce(submissionWithTwoChunks);

      mockLlm.generateStructured
        .mockRejectedValueOnce(new Error('LLM error'))
        .mockResolvedValueOnce(llmOutput);

      await service.gradeSubmission(submissionId);

      expect(mockPrisma.gradingScore.upsert).toHaveBeenCalledTimes(2);
    });

    it('should fall back to findConfirmedRubric when embedding fails', async () => {
      mockLlm.embed.mockRejectedValue(new Error('Embedding API error'));
      const rubric = { id: 'rubric-1', criteria };
      mockRubrics.findConfirmedRubric.mockResolvedValue(rubric);
      mockPrisma.submission.findUnique
        .mockResolvedValueOnce(submission)
        .mockResolvedValueOnce(submission);

      const result = await service.gradeSubmission(submissionId);

      expect(mockRubrics.findSimilarCriteria).not.toHaveBeenCalled();
      expect(mockRubrics.findConfirmedRubric).toHaveBeenCalledWith(
        submission.assignmentId,
      );
      expect(mockLlm.generateStructured).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});
