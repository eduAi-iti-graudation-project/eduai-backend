import { Test, TestingModule } from '@nestjs/testing';
import { GradingService } from './grading.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('GradingService', () => {
  let service: GradingService;

  const mockPrisma = {
    gradingScore: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingService,
        { provide: PrismaService, useValue: mockPrisma },
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
      const existingScore = { id: scoreId, pointsAwarded: 7, teacherNotes: null };

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
});
