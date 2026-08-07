jest.mock('@mastra/core/tools', () => ({
  createTool: (def: { execute: (...args: unknown[]) => unknown }) => ({
    execute: def.execute,
  }),
}));

import { createWriteFeedbackTool } from './write-feedback.tool';
import { generateFeedback, FeedbackSchema } from './feedback-generator';
import { LlmService } from '../../common/llm/llm.service';

describe('generateFeedback', () => {
  const generateStructuredMock = jest.fn();
  const mockLlmService = {
    generateStructured: generateStructuredMock,
  } as unknown as LlmService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call LlmService.generateStructured with correct prompt', async () => {
    generateStructuredMock.mockResolvedValue({
      feedback: 'Good thesis but needs more evidence.',
    });

    const result: { feedback: string } = await generateFeedback(
      mockLlmService,
      {
        criterionDescription: 'Clarity of thesis statement',
        maxPoints: 10,
        pointsAwarded: 7,
        submissionContent: 'The quick brown fox jumps over the lazy dog.',
      },
    );

    expect(generateStructuredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: FeedbackSchema,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        systemPrompt: expect.stringContaining('Clarity of thesis statement'),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        userPrompt: expect.stringContaining('The quick brown fox jumps'),
      }),
    );
    expect(result).toEqual({
      feedback: 'Good thesis but needs more evidence.',
    });
  });

  it('should include score ratio in the prompt', async () => {
    generateStructuredMock.mockResolvedValue({
      feedback: 'Needs improvement.',
    });

    await generateFeedback(mockLlmService, {
      criterionDescription: 'Grammar',
      maxPoints: 20,
      pointsAwarded: 10,
      submissionContent: 'Some text.',
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const callArg = generateStructuredMock.mock.calls[0][0] as {
      systemPrompt: string;
    };
    expect(callArg.systemPrompt).toContain('50%');
  });

  it('should truncate submission content to 3000 chars', async () => {
    generateStructuredMock.mockResolvedValue({
      feedback: 'Good.',
    });

    const longContent = 'a'.repeat(5000);
    await generateFeedback(mockLlmService, {
      criterionDescription: 'Length',
      maxPoints: 5,
      pointsAwarded: 5,
      submissionContent: longContent,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const callArg2 = generateStructuredMock.mock.calls[0][0] as {
      userPrompt: string;
    };
    expect(callArg2.userPrompt.length).toBeLessThanOrEqual(3100);
  });

  it('should propagate LlmService errors', async () => {
    generateStructuredMock.mockRejectedValue(new Error('API error'));

    await expect(
      generateFeedback(mockLlmService, {
        criterionDescription: 'Test',
        maxPoints: 10,
        pointsAwarded: 5,
        submissionContent: 'Test content.',
      }),
    ).rejects.toThrow('API error');
  });
});

describe('createWriteFeedbackTool', () => {
  it('should create a tool that wraps generateFeedback', () => {
    const tool = createWriteFeedbackTool({} as LlmService);
    expect(tool.execute).toBeDefined();
  });
});
