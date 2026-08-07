import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES } from '../common/llm/formatting-rules';
import { z } from 'zod';

const EssayGradeSchema = z.object({
  pointsAwarded: z.number().int().min(0),
  feedback: z.string(),
});

type EssayGrade = z.infer<typeof EssayGradeSchema>;

@Injectable()
export class QuizzesGradingService {
  private readonly logger = new Logger(QuizzesGradingService.name);

  constructor(private readonly llmService: LlmService) {}

  gradeMcq(
    selectedOptions: string,
    correctOptions: { text: string; isCorrect: boolean }[],
  ): { pointsAwarded: number; isCorrect: boolean } {
    const correctText = correctOptions
      .filter((o) => o.isCorrect)
      .map((o) => o.text.trim().toLowerCase());
    const selected = selectedOptions.trim().toLowerCase();

    const isCorrect = correctText.includes(selected);
    return { pointsAwarded: isCorrect ? 1 : 0, isCorrect };
  }

  gradeTrueFalse(
    selectedAnswer: string,
    correctOptions: { text: string; isCorrect: boolean }[],
  ): { pointsAwarded: number; isCorrect: boolean } {
    const correctText = correctOptions
      .filter((o) => o.isCorrect)
      .map((o) => o.text.trim().toLowerCase());
    const selected = selectedAnswer.trim().toLowerCase();

    const isCorrect = correctText.includes(selected);
    return { pointsAwarded: isCorrect ? 1 : 0, isCorrect };
  }

  async gradeEssay(
    question: string,
    studentAnswer: string,
    maxPoints: number,
    context?: string,
  ): Promise<EssayGrade> {
    this.logger.debug(`Grading essay: "${question.substring(0, 60)}..."`);

    const result = await this.llmService.generateStructured<EssayGrade>({
      systemPrompt:
        'You are a fair grader. Given a question, student answer, and maximum points, ' +
        'award a score based on correctness, completeness, and clarity. ' +
        'Return valid JSON with EXACTLY these fields:\n' +
        '{\n' +
        '  "pointsAwarded": 0-{maxPoints},\n' +
        '  "feedback": "string with specific, actionable feedback"\n' +
        '}\n' +
        'Do not omit any fields.' +
        FORMATTING_RULES,
      userPrompt: JSON.stringify({
        question,
        studentAnswer,
        maxPoints,
        context: context ?? null,
      }),
      schema: EssayGradeSchema,
    });

    return result;
  }
}
