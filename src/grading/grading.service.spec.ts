import { Test, TestingModule } from '@nestjs/testing';
import { GradingService } from './grading.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { RubricsService } from '../rubrics/rubrics.service';
import { NotFoundException } from '@nestjs/common';

describe('GradingService', () => {
  let service: GradingService;

  const mockPrisma = {
    submission: {
      findUnique: jest.fn(),
    },
    gradingScore: {
      findUnique: jest.fn(),
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
    findConfirmedRubric: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: RubricsService, useValue: mockRubrics },
      ],
    }).compile();

    service = module.get<GradingService>(GradingService);
    jest.clearAllMocks();
  });

  describe('confirm', () => {
    it('should set isConfirmed to true', async () => {
      const scoreId = 'test-score-id';
      const dto = { pointsAwarded: 8 };
      const existingScore = {
        id: scoreId,
        pointsAwarded: 5,
        teacherNotes: null,
      };
      const updatedScore = {
        ...existingScore,
        pointsAwarded: 8,
        teacherNotes: null,
        isConfirmed: true,
      };

      mockPrisma.gradingScore.findUnique.mockResolvedValue(existingScore);
      mockPrisma.gradingScore.update.mockResolvedValue(updatedScore);

      const result = await service.confirm(scoreId, dto);

      expect(mockPrisma.gradingScore.findUnique).toHaveBeenCalledWith({
        where: { id: scoreId },
      });
      expect(mockPrisma.gradingScore.update).toHaveBeenCalledWith({
        where: { id: scoreId },
        data: {
          pointsAwarded: 8,
          teacherNotes: undefined,
          isConfirmed: true,
        },
      });
      expect(result.isConfirmed).toBe(true);
    });

    it('should accept optional teacherNotes', async () => {
      const scoreId = 'test-score-id';
      const dto = { pointsAwarded: 10, teacherNotes: 'Good work' };
      const existingScore = {
        id: scoreId,
        pointsAwarded: 7,
        teacherNotes: null,
      };

      mockPrisma.gradingScore.findUnique.mockResolvedValue(existingScore);
      mockPrisma.gradingScore.update.mockResolvedValue({
        ...existingScore,
        ...dto,
        isConfirmed: true,
      });

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
      chunks: [chunk],
      assignment: { id: 'assign-1' },
    };

    const rubric = { id: 'rubric-1', criteria };

    const llmOutput = {
      scores: [
        { criterionId: 'c1', pointsAwarded: 8, feedback: 'Good thesis' },
        { criterionId: 'c2', pointsAwarded: 12, feedback: 'Solid evidence' },
      ],
    };

    const fakeEmbedding = Array.from({ length: 1024 }, () => Math.random());

    beforeEach(() => {
      mockPrisma.submission.findUnique.mockResolvedValue(submission);
      mockRubrics.findConfirmedRubric.mockResolvedValue(rubric);
      mockLlm.embed.mockResolvedValue(fakeEmbedding);
      mockLlm.generateStructured.mockResolvedValue(llmOutput);
      mockPrisma.gradingScore.upsert.mockResolvedValue({});
      mockPrisma.$executeRawUnsafe.mockResolvedValue({});
    });

    it('should embed chunk, call LLM, and upsert scores', async () => {
      const expectedChunkWithScores = {
        ...submission,
        chunks: [chunk],
        scores: [
          { criteria: { id: 'c1' }, pointsAwarded: 8 },
          { criteria: { id: 'c2' }, pointsAwarded: 12 },
        ],
      };
      mockPrisma.submission.findUnique
        .mockResolvedValueOnce(submission)
        .mockResolvedValueOnce(expectedChunkWithScores);

      const result = await service.gradeSubmission(submissionId);

      expect(mockLlm.embed).toHaveBeenCalledWith(chunk.content);
      expect(mockLlm.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: expect.any(Object),
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
          create: expect.objectContaining({ pointsAwarded: 8 }),
          update: expect.objectContaining({ pointsAwarded: 8 }),
        }),
      );
      expect(result).toEqual(expectedChunkWithScores);
    });

    it('should throw NotFoundException for missing submission', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(null);

      await expect(
        service.gradeSubmission('bad-id'),
      ).rejects.toThrow(NotFoundException);
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
  });
});
