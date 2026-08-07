import { Test, TestingModule } from '@nestjs/testing';
import { GradingAgent, selectSubmissionChunks } from './grading.agent';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';

const uuid1 = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const uuid2 = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

describe('GradingAgent', () => {
  let agent: GradingAgent;

  const mockPrisma = {
    submission: { findUnique: jest.fn() },
  };

  const mockLlm = {
    generateStructured: jest.fn(),
  };

  const buildSubmission = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    assignment: {
      title: 'Essay on photosynthesis',
      description: 'Write a 500-word essay',
      rubrics: [
        {
          id: 'r1',
          isConfirmed: true,
          criteria: [
            { id: uuid1, description: 'Thesis clarity', maxPoints: 10 },
            { id: uuid2, description: 'Use of evidence', maxPoints: 15 },
          ],
        },
      ],
    },
    chunks: [
      { id: 'ch1', content: 'Photosynthesis converts light into energy.' },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingAgent,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
      ],
    }).compile();

    agent = module.get<GradingAgent>(GradingAgent);
  });

  describe('grade', () => {
    it('returns LLM scores mapped to criteria', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(buildSubmission());
      mockLlm.generateStructured.mockResolvedValue({
        scores: [
          { criterionId: uuid1, pointsAwarded: 8, feedback: 'Clear thesis' },
          {
            criterionId: uuid2,
            pointsAwarded: 12,
            feedback: 'Good evidence',
          },
        ],
        overallFeedback: 'Well done',
      });

      const result = await agent.grade('sub-1');

      expect(result.scores).toEqual([
        { criterionId: uuid1, pointsAwarded: 8, feedback: 'Clear thesis' },
        { criterionId: uuid2, pointsAwarded: 12, feedback: 'Good evidence' },
      ]);
      expect(result.overallFeedback).toBe('Well done');
      expect(mockLlm.generateStructured).toHaveBeenCalledTimes(1);
    });

    it('clamps pointsAwarded to the criterion maxPoints', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(buildSubmission());
      mockLlm.generateStructured.mockResolvedValue({
        scores: [
          { criterionId: uuid1, pointsAwarded: 99, feedback: 'Over max' },
          { criterionId: uuid2, pointsAwarded: 2, feedback: 'Under' },
        ],
      });

      const result = await agent.grade('sub-1');

      expect(result.scores[0]?.pointsAwarded).toBe(10);
      expect(result.scores[1]?.pointsAwarded).toBe(2);
    });

    it('drops unknown criterionIds and fills missing criteria with 0', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(buildSubmission());
      mockLlm.generateStructured.mockResolvedValue({
        scores: [
          {
            criterionId: uuid1,
            pointsAwarded: 8,
            feedback: 'Clear thesis',
          },
          {
            criterionId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
            pointsAwarded: 5,
            feedback: 'Unknown criterion',
          },
        ],
      });

      const result = await agent.grade('sub-1');

      expect(result.scores).toHaveLength(2);
      expect(result.scores[0]).toEqual({
        criterionId: uuid1,
        pointsAwarded: 8,
        feedback: 'Clear thesis',
      });
      expect(result.scores[1]).toEqual({
        criterionId: uuid2,
        pointsAwarded: 0,
        feedback: 'No evidence was found in the submission for this criterion.',
      });
    });

    it('returns empty scores without calling the LLM when no rubric is confirmed', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(
        buildSubmission({
          assignment: {
            title: 'Essay',
            description: null,
            rubrics: [{ id: 'r1', isConfirmed: false, criteria: [] }],
          },
        }),
      );

      const result = await agent.grade('sub-1');

      expect(result.scores).toEqual([]);
      expect(mockLlm.generateStructured).not.toHaveBeenCalled();
    });

    it('propagates LLM failures', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(buildSubmission());
      mockLlm.generateStructured.mockRejectedValue(new Error('LLM down'));

      await expect(agent.grade('sub-1')).rejects.toThrow('LLM down');
    });

    it('rejects when the submission does not exist', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(null);

      await expect(agent.grade('missing')).rejects.toThrow(
        'Submission missing not found',
      );
    });
  });
});

describe('selectSubmissionChunks', () => {
  it('returns all chunks when content fits within the budget', () => {
    const chunks = ['short chunk one', 'short chunk two'];

    const result = selectSubmissionChunks(chunks, ['Thesis clarity'], 12000);

    expect(result).toBe('short chunk one\n\nshort chunk two');
  });

  it('returns all chunks for a single long chunk', () => {
    const chunk = 'x'.repeat(20000);

    const result = selectSubmissionChunks([chunk], ['Thesis'], 12000);

    expect(result).toBe(chunk);
  });

  it('selects chunks matching criterion keywords and preserves original order', () => {
    const chunks = [
      'Introduction with some background text.',
      'This section explains photosynthesis and chlorophyll absorption.',
      'Discussion of evidence and experiments.',
      'Conclusion wrapping everything up.',
    ];
    const criteriaDescriptions = ['Photosynthesis explanation', 'Evidence'];

    const result = selectSubmissionChunks(chunks, criteriaDescriptions, 140);

    expect(result).toContain('photosynthesis');
    expect(result).toContain('evidence');
    expect(result.indexOf('photosynthesis')).toBeLessThan(
      result.indexOf('evidence'),
    );
    expect(result).not.toContain('Conclusion');
  });

  it('falls back to the first chunks when nothing matches', () => {
    const chunks = [
      'aaaa ' + 'x'.repeat(50),
      'bbbb ' + 'y'.repeat(50),
      'cccc ' + 'z'.repeat(50),
    ];
    const criteriaDescriptions = ['photosynthesis'];

    const result = selectSubmissionChunks(chunks, criteriaDescriptions, 120);

    expect(result).toContain('aaaa');
    expect(result).toContain('bbbb');
    expect(result).not.toContain('cccc');
  });
});
