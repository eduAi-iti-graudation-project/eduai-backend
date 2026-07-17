import { Test, TestingModule } from '@nestjs/testing';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';

describe('GradingController', () => {
  let controller: GradingController;

  const mockGradingService = {
    gradeSubmission: jest.fn(),
    confirm: jest.fn(),
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

  describe('confirm', () => {
    it('should call gradingService.confirm', async () => {
      const id = 'score-1';
      const dto = { pointsAwarded: 8, teacherNotes: 'Good' };
      const expected = { id, isConfirmed: true };
      mockGradingService.confirm.mockResolvedValue(expected);

      const result = await controller.confirm(id, dto);

      expect(mockGradingService.confirm).toHaveBeenCalledWith(id, dto);
      expect(result).toEqual(expected);
    });
  });
});
