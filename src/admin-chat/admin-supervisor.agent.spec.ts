import { AdminSupervisor } from './admin-supervisor.agent';
import type { LlmService } from '../common/llm/llm.service';
import type { AdminAgentStep } from './dto';

describe('AdminSupervisor', () => {
  type Chat = (systemPrompt: string, userPrompt: string) => string | Promise<string>;

  function makeSupervisor(chat: Chat): AdminSupervisor {
    const llm = { chat } as unknown as LlmService;
    return new AdminSupervisor(llm);
  }

  function stubRouter(domains: string[]): Chat {
    return (systemPrompt, userPrompt) => {
      if (systemPrompt.includes('routing supervisor')) {
        return JSON.stringify({ domains });
      }
      if (systemPrompt.includes('lead writer')) {
        return JSON.stringify({
          reply: '**2** students are flagged.',
          sources: ['Active alerts'],
        });
      }
      if (systemPrompt.includes('specialist')) {
        return JSON.stringify({ summary: 'summary', facts: ['fact-1'] });
      }
      return JSON.stringify({ reply: 'fallback', sources: [] });
    };
  }

  it('routes to specialists, streams real steps, and returns reply + sources', async () => {
    const supervisor = makeSupervisor(stubRouter(['overview', 'alerts']));
    const steps: AdminAgentStep[] = [];

    const result = await supervisor.respond({
      schoolContext: {
        overview: { studentCount: 31, flaggedStudentCount: 2 },
        activeAlerts: [{ studentName: 'Sam', severity: 'HIGH' }],
        insights: null,
        pendingJoinRequests: 0,
        billing: null,
        scope: null,
      },
      history: [],
      question: 'Who is at risk?',
      onStep: (step) => steps.push(step),
    });

    expect(steps).toContain('routing');
    expect(steps).toContain('read_overview');
    expect(steps).toContain('read_alerts');
    expect(steps[steps.length - 1]).toBe('thinking');
    expect(result.reply).toBe('**2** students are flagged.');
    expect(result.sources).toEqual(['Active alerts']);
  });

  it('emits no specialist steps for a greeting with an empty plan', async () => {
    const supervisor = makeSupervisor(stubRouter([]));
    const steps: AdminAgentStep[] = [];

    const result = await supervisor.respond({
      schoolContext: { overview: null, activeAlerts: [], scope: null },
      history: [],
      question: 'hello',
      onStep: (step) => steps.push(step),
    });

    expect(steps).toEqual(['routing', 'thinking']);
    expect(result.reply).toBe('**2** students are flagged.');
  });

  it('uses the read_profile step when the plan scopes to a student', async () => {
    const supervisor = makeSupervisor(stubRouter(['student']));
    const steps: AdminAgentStep[] = [];

    await supervisor.respond({
      schoolContext: {
        scope: { kind: 'student', name: 'Sam', attendance: { total: 3 } },
      },
      history: [],
      question: 'How is Sam doing?',
      onStep: (step) => steps.push(step),
    });

    expect(steps).toContain('read_profile');
    expect(steps).not.toContain('read_overview');
  });

  it('skips domains with no data even when the router asked for them', async () => {
    const supervisor = makeSupervisor(stubRouter(['insights']));
    const steps: AdminAgentStep[] = [];

    await supervisor.respond({
      schoolContext: {
        insights: null,
        overview: { studentCount: 31 },
        scope: null,
      },
      history: [],
      question: 'Tell me the trend',
      onStep: (step) => steps.push(step),
    });

    expect(steps).not.toContain('read_insights');
    expect(steps[steps.length - 1]).toBe('thinking');
  });

  it('falls back to all available domains when the router fails', async () => {
    const chat: Chat = async (systemPrompt, userPrompt) => {
      if (systemPrompt.includes('routing supervisor')) {
        throw new Error('router down');
      }
      if (systemPrompt.includes('lead writer')) {
        return JSON.stringify({ reply: 'ok', sources: ['Overview'] });
      }
      return JSON.stringify({ summary: 's', facts: ['f'] });
    };
    const supervisor = makeSupervisor(chat);
    const steps: AdminAgentStep[] = [];

    const result = await supervisor.respond({
      schoolContext: {
        overview: { studentCount: 31 },
        activeAlerts: [],
        insights: null,
        pendingJoinRequests: 0,
        billing: { subscriptionTier: 'PRO' },
        scope: null,
      },
      history: [],
      question: 'summary',
      onStep: (step) => steps.push(step),
    });

    expect(steps).toContain('read_overview');
    expect(steps).toContain('read_billing');
    expect(result.reply).toBe('ok');
  });

  it('keeps writing even when a specialist fails', async () => {
    const chat: Chat = async (systemPrompt, userPrompt) => {
      if (systemPrompt.includes('routing supervisor')) {
        return JSON.stringify({ domains: ['overview', 'alerts'] });
      }
      if (systemPrompt.includes('admin-overview')) {
        throw new Error('overview specialist down');
      }
      if (systemPrompt.includes('lead writer')) {
        return JSON.stringify({ reply: 'alerts ok', sources: ['Active alerts'] });
      }
      return JSON.stringify({ summary: 's', facts: ['f'] });
    };
    const supervisor = makeSupervisor(chat);

    const result = await supervisor.respond({
      schoolContext: {
        overview: { studentCount: 31 },
        activeAlerts: [{ studentName: 'Sam', severity: 'HIGH' }],
        scope: null,
      },
      history: [],
      question: 'at risk?',
    });

    expect(result.reply).toBe('alerts ok');
  });

  it('uses the specialist raw text as findings when the specialist returns prose', async () => {
    const chat: Chat = async (systemPrompt, userPrompt) => {
      if (systemPrompt.includes('routing supervisor')) {
        return JSON.stringify({ domains: ['alerts'] });
      }
      if (systemPrompt.includes('active-alerts specialist')) {
        return 'One student is at risk: Sam (HIGH severity).';
      }
      if (systemPrompt.includes('lead writer')) {
        return JSON.stringify({
          reply: '**1** student is at risk.',
          sources: ['Active alerts'],
        });
      }
      return JSON.stringify({ summary: 's', facts: ['f'] });
    };
    const supervisor = makeSupervisor(chat);

    const result = await supervisor.respond({
      schoolContext: {
        activeAlerts: [{ studentName: 'Sam', severity: 'HIGH' }],
        scope: null,
      },
      history: [],
      question: 'Who is at risk?',
    });

    expect(result.reply).toBe('**1** student is at risk.');
    expect(result.sources).toEqual(['Active alerts']);
  });

  it('falls back to the writer raw text when the writer returns prose', async () => {
    const chat: Chat = async (systemPrompt, userPrompt) => {
      if (systemPrompt.includes('routing supervisor')) {
        return JSON.stringify({ domains: ['alerts'] });
      }
      if (systemPrompt.includes('active-alerts specialist')) {
        return JSON.stringify({
          summary: 'Sam is flagged HIGH',
          facts: ['Sam: HIGH'],
        });
      }
      if (systemPrompt.includes('lead writer')) {
        return 'One student is at risk: Sam (HIGH severity).';
      }
      return JSON.stringify({ summary: 's', facts: ['f'] });
    };
    const supervisor = makeSupervisor(chat);

    const result = await supervisor.respond({
      schoolContext: {
        activeAlerts: [{ studentName: 'Sam', severity: 'HIGH' }],
        scope: null,
      },
      history: [],
      question: 'Who is at risk?',
    });

    expect(result.reply).toContain('One student is at risk');
    expect(result.sources).toEqual([]);
  });
});