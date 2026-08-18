import { CommunicationWorkflow } from './communication-workflow';
import type { CommunicationWorkflowInput } from './communication-workflow';
import type { LlmService } from '../common/llm/llm.service';

describe('CommunicationWorkflow', () => {
  type Chat = (systemPrompt: string, userPrompt: string) => Promise<string>;

  function makeWorkflow(chat: Chat): CommunicationWorkflow {
    const llm = { chat } as unknown as LlmService;
    return new CommunicationWorkflow(llm);
  }

  function input(overrides: Partial<CommunicationWorkflowInput> = {}): CommunicationWorkflowInput {
    return {
      studentName: 'Sam Learner',
      decision: {
        flagged: true,
        type: 'FAILING',
        severity: 'HIGH',
        attribution: 'STUDENT',
      },
      studentStats: { count: 3, last3AvgPct: 57.7, consecutiveDrops: 2, deltaPct: -25 },
      classStats: { studentCount: 3, classAvgPct: 73, droppingCount: 0, belowAverageCount: 1 },
      criterionStats: [
        { criteriaId: 'c1', criteriaDescription: 'Argument', count: 3, last3AvgPct: 60, consecutiveDrops: 1 },
        { criteriaId: 'c2', criteriaDescription: 'Using evidence', count: 3, last3AvgPct: 40, consecutiveDrops: 2 },
      ],
      weakCriteria: [{ criteriaId: 'c2', description: 'Using evidence', avgPct: 40 }],
      recentGrades: [{ pct: 45, criteria: 'Argument' }],
      offeringName: null,
      ...overrides,
    };
  }

  function defaultStub(): Chat {
    return async (systemPrompt) => {
      if (systemPrompt.includes('educational analyst')) {
        return JSON.stringify({
          reason: 'The average has dropped below the class average over recent submissions.',
          headline: 'Sam Learner is at risk',
          highlights: ['3 recent submissions'],
          strengths: ['—'],
          concerns: ['Using evidence (40%)'],
          recommendation: 'Assign the recommended practice set.',
        });
      }
      if (systemPrompt.includes('independent educational auditor')) {
        return JSON.stringify({ flagged: true, reason: 'numbers support the flag', confidence: 'HIGH' });
      }
      if (systemPrompt.includes('teacher advisor')) {
        return JSON.stringify({ analysis: 'needs fundamentals', skillGaps: ['fractions'], interventions: ['extra practice'], resourceSuggestions: ['Khan Academy'] });
      }
      if (systemPrompt.includes('parent liaison')) {
        return JSON.stringify({ message: 'Your child needs some support.', homeSupport: ['set a study routine'] });
      }
      if (systemPrompt.includes('peer coach')) {
        return JSON.stringify({ feedback: 'Try smaller steps.', patternAnalysis: 'Flat trend.', strategies: ['retrieval practice'] });
      }
      if (systemPrompt.includes('school management advisor')) {
        return JSON.stringify({ summary: 'Class below expectations.', classTrend: 'holding steady', recommendation: 'Monitor next batch.' });
      }
      if (systemPrompt.includes('final reviewer')) {
        return JSON.stringify({ approved: true, note: 'grounded and scoped correctly' });
      }
      throw new Error(`unhandled agent: ${systemPrompt.slice(0, 60)}`);
    };
  }

  it('consults the council on HIGH verdicts and keeps HIGH when both auditors flag', async () => {
    const workflow = makeWorkflow(defaultStub());

    const result = await workflow.run(input());

    expect(result.council).not.toBeNull();
    expect(result.council?.confirmed).toBe(true);
    expect(result.council?.unanimous).toBe(true);
    expect(result.council?.note).toContain('confirmed');
    expect(result.decision.severity).toBe('HIGH');
  });

  it('downgrades to MEDIUM when both council auditors clear the student', async () => {
    const chat: Chat = async (systemPrompt) => {
      if (systemPrompt.includes('independent educational auditor')) {
        return JSON.stringify({ flagged: false, reason: 'numbers do not support a flag', confidence: 'HIGH' });
      }
      return defaultStub()(systemPrompt, '');
    };
    const workflow = makeWorkflow(chat);

    const result = await workflow.run(input());

    expect(result.council?.downgraded).toBe(true);
    expect(result.council?.confirmed).toBe(false);
    expect(result.council?.note).toContain('Downgraded');
    expect(result.decision.severity).toBe('MEDIUM');
  });

  it('keeps HIGH when the council is split', async () => {
    const chat: Chat = async (systemPrompt) => {
      if (systemPrompt.includes('Auditor A')) {
        return JSON.stringify({ flagged: true, reason: 'supports flag', confidence: 'HIGH' });
      }
      if (systemPrompt.includes('Auditor B')) {
        return JSON.stringify({ flagged: false, reason: 'numbers are borderline', confidence: 'MEDIUM' });
      }
      return defaultStub()(systemPrompt, '');
    };
    const workflow = makeWorkflow(chat);

    const result = await workflow.run(input());

    expect(result.council?.unanimous).toBe(false);
    expect(result.council?.downgraded).toBe(false);
    expect(result.council?.note).toContain('split');
    expect(result.decision.severity).toBe('HIGH');
  });

  it('skips the council entirely for MEDIUM verdicts', async () => {
    const workflow = makeWorkflow(defaultStub());

    const result = await workflow.run(
      input({ decision: { flagged: true, type: 'WEAK_CRITERION', severity: 'MEDIUM', attribution: 'STUDENT' } }),
    );

    expect(result.council).toBeNull();
    expect(result.decision.severity).toBe('MEDIUM');
  });

  it('only produces class-level content for CLASS attribution', async () => {
    const workflow = makeWorkflow(defaultStub());

    const studentOnly = await workflow.run(input({ decision: { flagged: true, type: 'FAILING', severity: 'HIGH', attribution: 'STUDENT' } }));
    expect(studentOnly.teacherFeedback).toBeNull();
    expect(studentOnly.managementSummary).toBeNull();

    const classIssue = await workflow.run(
      input({
        decision: { flagged: true, type: 'FAILING', severity: 'HIGH', attribution: 'CLASS' },
        classStats: { studentCount: 3, classAvgPct: 41, droppingCount: 2, belowAverageCount: 3 },
      }),
    );
    expect(classIssue.teacherFeedback).not.toBeNull();
    expect(classIssue.managementSummary).not.toBeNull();
  });

  it('skips class-level content when attribution is CLASS but the class has a single student', async () => {
    const workflow = makeWorkflow(defaultStub());

    const result = await workflow.run(
      input({
        decision: { flagged: true, type: 'FAILING', severity: 'HIGH', attribution: 'CLASS' },
        classStats: { studentCount: 1, classAvgPct: 41, droppingCount: 0, belowAverageCount: 1 },
      }),
    );

    expect(result.teacherFeedback).toBeNull();
    expect(result.managementSummary).toBeNull();
  });

  it('runs the reviewer last and records its assessment', async () => {
    const workflow = makeWorkflow(defaultStub());

    const result = await workflow.run(input());

    expect(result.review).toEqual({ approved: true, note: 'grounded and scoped correctly' });
  });

  it('degrades gracefully to deterministic content when every agent fails', async () => {
    const workflow = makeWorkflow(async () => {
      throw new Error('upstream 503');
    });

    const result = await workflow.run(input());

    expect(result.explanation.reason).toContain('is flagged');
    expect(result.teacherContent.analysis).toContain('showing a');
    expect(result.guardianContent.message).toContain('difficulty');
    expect(result.decision.severity).toBe('HIGH');
    expect(result.council).not.toBeNull();
    expect(result.review).toBeNull();
  });

  it('keeps writing when a single writer agent fails', async () => {
    const chat: Chat = async (systemPrompt, userPrompt) => {
      if (systemPrompt.includes('parent liaison')) throw new Error('parent liaison down');
      return defaultStub()(systemPrompt, userPrompt);
    };
    const workflow = makeWorkflow(chat);

    const result = await workflow.run(input());

    expect(result.guardianContent.message).toContain('difficulty');
    expect(result.teacherContent.analysis).toBe('needs fundamentals');
  });
});