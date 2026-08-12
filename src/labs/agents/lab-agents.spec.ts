import {
  GENERATOR_SYSTEM_PROMPT,
  LabGeneratorOutputSchema,
} from './lab-generator.agent';
import {
  LabReviewerOutputSchema,
  REVIEWER_SYSTEM_PROMPT,
} from './lab-reviewer.agent';

describe('lab agents', () => {
  it('generator instructions forbid every dangerous API and allow only the sandbox helpers', () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain('fetch');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('XMLHttpRequest');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('WebSocket');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('eval');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('Function constructor');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('window.parent');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('document.cookie');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('localStorage');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('sessionStorage');
    expect(GENERATOR_SYSTEM_PROMPT).toContain(
      'never import, require, or load any library',
    );
    expect(GENERATOR_SYSTEM_PROMPT).toContain('reportLabObjectiveComplete');
    // The win condition must be real code logic inside the simulation.
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/win\/objective condition/i);
    expect(GENERATOR_SYSTEM_PROMPT).toContain('WIN CONDITION');
  });

  it('reviewer instructions are adversarial and treat a single flag as a rejection', () => {
    expect(REVIEWER_SYSTEM_PROMPT).toContain('adversarial');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('hostile until proven clean');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('fetch');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('XMLHttpRequest');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('eval');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('window.parent');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('localStorage');
    expect(REVIEWER_SYSTEM_PROMPT).toMatch(/obfuscation/i);
    expect(REVIEWER_SYSTEM_PROMPT).toContain(
      'Even ONE flag means approved must be false',
    );
    expect(REVIEWER_SYSTEM_PROMPT).toContain(
      'Do not average or soften multiple minor flags into an approval',
    );
    // The reviewer must also enforce contract compliance, not just security.
    expect(REVIEWER_SYSTEM_PROMPT).toContain('missing_objective_hook');
    expect(REVIEWER_SYSTEM_PROMPT).toContain('missing_render_target');
    expect(REVIEWER_SYSTEM_PROMPT).toContain(
      'reportLabObjectiveComplete()',
    );
    expect(REVIEWER_SYSTEM_PROMPT).toMatch(/bare timer/i);
    expect(REVIEWER_SYSTEM_PROMPT).toContain(
      'approved MUST be false',
    );
    expect(REVIEWER_SYSTEM_PROMPT).toContain(
      'document.getElementById(\'sim\')',
    );
  });

  it('generator output schema requires non-empty code', () => {
    expect(LabGeneratorOutputSchema.safeParse({ code: '' }).success).toBe(
      false,
    );
    expect(
      LabGeneratorOutputSchema.safeParse({ code: 'Matter.Engine.create()' })
        .success,
    ).toBe(true);
    expect(LabGeneratorOutputSchema.safeParse({}).success).toBe(false);
  });

  it('reviewer output schema matches the documented shape', () => {
    const ok = LabReviewerOutputSchema.safeParse({
      approved: false,
      flags: ['fetch() call'],
      reasoning: 'forbidden API used',
    });
    expect(ok.success).toBe(true);

    // Missing reasoning is invalid.
    expect(
      LabReviewerOutputSchema.safeParse({ approved: true, flags: [] }).success,
    ).toBe(false);
  });
});
