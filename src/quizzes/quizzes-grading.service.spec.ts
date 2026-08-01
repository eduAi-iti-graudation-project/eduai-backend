import { Test, TestingModule } from '@nestjs/testing';
import { QuizzesGradingService } from './quizzes-grading.service';
import { LlmService } from '../common/llm/llm.service';

describe('QuizzesGradingService', () => {
  let service: QuizzesGradingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizzesGradingService,
        {
          provide: LlmService,
          useValue: { generateStructured: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<QuizzesGradingService>(QuizzesGradingService);
  });

  // ─── MCQ Grading ─────────────────────────────────────
  it('should grade correct MCQ answer', () => {
    const options = [
      { text: '3', isCorrect: false },
      { text: '4', isCorrect: true },
      { text: '5', isCorrect: false },
      { text: '6', isCorrect: false },
    ];
    const result = service.gradeMcq('4', options);
    expect(result.pointsAwarded).toBe(1);
    expect(result.isCorrect).toBe(true);
  });

  it('should grade incorrect MCQ answer', () => {
    const options = [
      { text: '3', isCorrect: false },
      { text: '4', isCorrect: true },
      { text: '5', isCorrect: false },
      { text: '6', isCorrect: false },
    ];
    const result = service.gradeMcq('5', options);
    expect(result.pointsAwarded).toBe(0);
    expect(result.isCorrect).toBe(false);
  });

  it('should handle case-insensitive MCQ matching', () => {
    const options = [
      { text: 'Paris', isCorrect: true },
      { text: 'London', isCorrect: false },
      { text: 'Berlin', isCorrect: false },
      { text: 'Madrid', isCorrect: false },
    ];
    const result = service.gradeMcq('paris', options);
    expect(result.isCorrect).toBe(true);
  });

  // ─── True/False Grading ──────────────────────────────
  it('should grade correct True/False answer', () => {
    const options = [
      { text: 'True', isCorrect: true },
      { text: 'False', isCorrect: false },
    ];
    const result = service.gradeTrueFalse('True', options);
    expect(result.isCorrect).toBe(true);
    expect(result.pointsAwarded).toBe(1);
  });

  it('should grade incorrect True/False answer', () => {
    const options = [
      { text: 'True', isCorrect: true },
      { text: 'False', isCorrect: false },
    ];
    const result = service.gradeTrueFalse('False', options);
    expect(result.isCorrect).toBe(false);
    expect(result.pointsAwarded).toBe(0);
  });
});
