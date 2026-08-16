import {
  buildLabGenerationPrompt,
  GENERATOR_SYSTEM_PROMPT,
  LabGeneratorOutputSchema,
} from './lab-generator.agent';
import {
  ARCHITECT_SYSTEM_PROMPT,
  buildLabArchitectPrompt,
  LabGameSpecSchema,
} from './lab-architect.agent';

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
      'NEVER import, require, or load any library',
    );
    expect(GENERATOR_SYSTEM_PROMPT).toContain('reportLabObjectiveComplete');
    // The win condition must be real code logic inside the simulation.
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/win\/objective condition/i);
    expect(GENERATOR_SYSTEM_PROMPT).toContain('WIN CONDITION');
  });

  it('generator instructions allow any self-contained game and make Matter optional', () => {
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/self-contained interactive/i);
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/Matter\.js, which is preloaded/i);
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/OPTIONAL and never required/i);
    // No external assets (images, fonts, CDN) are allowed in the sandbox.
    expect(GENERATOR_SYSTEM_PROMPT).toContain(
      'including images, fonts, or CDN',
    );
    // Animation must never block the main thread.
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/requestAnimationFrame/i);
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/busy loop/i);
  });

  it('generator instructions encode win-state rules as generator guidance', () => {
    // The generator must produce honest win conditions. These are guidance for
    // output quality; they are no longer reviewer-enforced (the teacher reviews
    // the win condition manually).
    expect(GENERATOR_SYSTEM_PROMPT).toContain('STRICT WIN-STATE RULES');
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/physics measurement/i);
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(
      /genuine placement\/state objective/i,
    );
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/bare timer/i);
    // Modes/tabs that change the required objectives must fully reset state.
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/modes\/tabs/i);
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/reset/i);
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/CURRENT mode/i);
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/leftover state/i);
  });

  it('generator instructions document the working drag/click recipe', () => {
    // A lab nothing can interact with is a failed lab, so the prompt must teach
    // the canonical Matter.js MouseConstraint pattern plus a Pointer Events
    // fallback, and require canvas sizing that keeps mouse coords aligned.
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/drag\/click MUST work/i);
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/FAILED lab/i);
    expect(GENERATOR_SYSTEM_PROMPT).toContain('Matter.Mouse.create');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('Matter.MouseConstraint.create');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('Matter.Composite.add');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('clientWidth');
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/never a hard-coded size/i);
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/isStatic: false/i);
    expect(GENERATOR_SYSTEM_PROMPT).toContain('pointerdown');
    expect(GENERATOR_SYSTEM_PROMPT).toContain('setPointerCapture');
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(
      /never listen for drag on document or window/i,
    );
    // The modify path must preserve existing interaction.
    expect(GENERATOR_SYSTEM_PROMPT).toMatch(/preserve its interaction/i);
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

  it('the fresh-generation prompt scopes the topic to the curriculum', () => {
    const prompt = buildLabGenerationPrompt({
      topic: 'pendulums',
      curriculum: 'A pendulum swings with period 2π√(L/g).',
    });
    expect(prompt).toContain('Topic: pendulums');
    expect(prompt).toContain('Curriculum context:');
    expect(prompt).toContain('A pendulum swings with period 2π√(L/g).');
  });

  it('the refine prompt embeds the previous code and the requested change and forbids a from-scratch rewrite', () => {
    const previousCode = 'Matter.Engine.create(); // existing pendulum';
    const prompt = buildLabGenerationPrompt({
      topic: 'pendulums',
      curriculum: 'A pendulum swings with period 2π√(L/g).',
      previousCode,
      instruction: 'add an adjustable length slider',
    });

    expect(prompt).toContain('MODIFYING an existing lab simulation');
    expect(prompt).toContain(previousCode);
    expect(prompt).toContain('add an adjustable length slider');
    expect(prompt).toMatch(/never rewrite the simulation from scratch/i);
    expect(prompt).toMatch(/complete updated simulation/i);
  });

  describe('lab architect', () => {
    it('produces a DATA spec, never code — the engine renders and grades the game', () => {
      expect(ARCHITECT_SYSTEM_PROMPT).toContain(
        'you never write code — you only produce the game',
      );
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/fixed engine/i);
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/never invent facts/i);
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/grounded strictly/i);
    });

    it('catalog offers exactly the four hand-built templates', () => {
      for (const t of [
        'drag-to-regions',
        'sort-categories',
        'match-pairs',
        'flashcards',
      ]) {
        expect(ARCHITECT_SYSTEM_PROMPT).toContain(t);
      }
    });

    it('fresh prompt scopes the topic to the curriculum excerpt', () => {
      const prompt = buildLabArchitectPrompt({
        topic: 'build a construct-the-cell game',
        curriculum: 'Nucleus stores genetic material.',
      });
      expect(prompt).toContain('build a construct-the-cell game');
      expect(prompt).toContain('Nucleus stores genetic material.');
    });

    it('modify prompt embeds the previous spec and the requested change and forbids a from-scratch rewrite', () => {
      const previousSpec = {
        template: 'drag-to-regions',
        title: 'Construct the cell',
        instructions: 'Drag each organelle.',
        objective: 'Place all organelles.',
        tabs: [
          {
            id: 'e',
            label: 'Eukaryotic',
            regions: [{ id: 'n', label: 'Nucleus' }],
          },
        ],
        items: [{ id: 'i1', label: 'Nucleus', tabId: 'e', regionId: 'n' }],
      } as const;
      const prompt = buildLabArchitectPrompt({
        topic: 'construct-the-cell',
        curriculum: 'Nucleus stores genetic material.',
        previousSpec,
        instruction: 'add a nucleolus item',
      });

      expect(prompt).toContain('MODIFYING an existing lab game');
      expect(prompt).toContain('add a nucleolus item');
      expect(prompt).toContain('"template":"drag-to-regions"');
      expect(prompt).toMatch(/change only what the request needs/i);
      expect(prompt).toMatch(/COMPLETE updated spec JSON/i);
    });

    it('accepts all four template shapes and rejects unknown/incomplete specs', () => {
      const valid = {
        drag: {
          template: 'drag-to-regions',
          title: 'T',
          instructions: 'I',
          objective: 'O',
          tabs: [{ id: 't', label: 'L', regions: [{ id: 'r', label: 'R' }] }],
          items: [{ id: 'i', label: 'N', tabId: 't', regionId: 'r' }],
        },
        sort: {
          template: 'sort-categories',
          title: 'T',
          instructions: 'I',
          objective: 'O',
          categories: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          items: [
            { id: 'i1', label: 'x', categoryId: 'a' },
            { id: 'i2', label: 'y', categoryId: 'b' },
          ],
        },
        match: {
          template: 'match-pairs',
          title: 'T',
          instructions: 'I',
          objective: 'O',
          pairs: [
            { id: 'p1', term: 'Nucleus', definition: 'Stores DNA' },
            { id: 'p2', term: 'Ribosome', definition: 'Makes proteins' },
          ],
        },
        flash: {
          template: 'flashcards',
          title: 'T',
          instructions: 'I',
          objective: 'O',
          cards: [{ id: 'c1', front: 'Nucleus', back: 'Stores DNA' }],
        },
      };
      for (const spec of [valid.drag, valid.sort, valid.match, valid.flash]) {
        expect(LabGameSpecSchema.safeParse(spec).success).toBe(true);
      }
      expect(
        LabGameSpecSchema.safeParse({ template: 'new-thing' }).success,
      ).toBe(false);
      expect(LabGameSpecSchema.safeParse(valid.drag).success).toBe(true);
      expect(
        LabGameSpecSchema.safeParse({
          ...valid.sort,
          categories: [{ id: 'a', label: 'A' }],
        }).success,
      ).toBe(false);
    });
  });
});
