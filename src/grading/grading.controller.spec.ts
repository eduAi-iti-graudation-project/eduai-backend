import { Test, TestingModule } from '@nestjs/testing';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';

describe('GradingController', () => {
  let controller: GradingController;

  const mockGradingService = {
    gradeSubmission: jest.fn(),
    confirmAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GradingController],
      providers: [{ provide: GradingService, useValue: mockGradingService }],
    }).compile();

    controller = module.get<GradingController>(GradingController);
    jest.clearAllMocks();
  });

  describe('grade', () => {
    it('should call gradingService.gradeSubmission', async () => {
      const submissionId = 'sub-1';
      const expected = { id: submissionId, chunks: [], scores: [] };
      mockGradingService.gradeSubmission.mockResolvedValue(expected);

      const result = await controller.grade(submissionId);

      expect(mockGradingService.gradeSubmission).toHaveBeenCalledWith(
        submissionId,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('confirmAll', () => {
    it('should call gradingService.confirmAll', async () => {
      const submissionId = 'sub-1';
      const expected = { id: submissionId, scores: [], status: 'CONFIRMED' };
      mockGradingService.confirmAll.mockResolvedValue(expected);

      const result = await controller.confirmAll(submissionId);

      expect(mockGradingService.confirmAll).toHaveBeenCalledWith(submissionId);
      expect(result).toEqual(expected);
    });
  });
});
