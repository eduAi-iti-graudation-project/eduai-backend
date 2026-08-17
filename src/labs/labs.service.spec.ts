import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { LlmService } from '../common/llm/llm.service';
import { ApiError } from '../common/errors/api-error';
import { MaterialsService } from '../materials/materials.service';
import { PrismaService } from '../prisma/prisma.service';
import { LabsService } from './labs.service';

const mockChat = jest.fn();
const mockSearchChunks = jest.fn();
const mockSearchChunksByCourse = jest.fn();
const mockGetChunksByChapter = jest.fn();
const mockCourseOfferingFindMany = jest.fn();
const mockCourseOfferingFindFirst = jest.fn();
const mockLabCreate = jest.fn();
const mockLabUpdate = jest.fn();
const mockLabFindFirst = jest.fn();
const mockLabFindMany = jest.fn();
const mockLabDelete = jest.fn();

const teacher = {
  id: 'teacher-0001',
  organizationId: 'org-0001',
  role: 'TEACHER',
} as unknown as User;

const student = {
  id: 'student-0001',
  organizationId: 'org-0001',
  role: 'STUDENT',
} as unknown as User;

const offering = {
  id: 'offering-0001',
  organizationId: 'org-0001',
  courseId: 'course-0001',
};
const sectionOffering = {
  id: 'offering-0002',
  organizationId: 'org-0001',
  courseId: 'course-0001',
};

const unitChunk = {
  id: 'chunk-1',
  content: 'A pendulum swings with period 2π√(L/g).',
  materialTitle: 'Physics Ch 4',
  chapterTitle: 'Unit 1 — Forces',
  distance: 0.1,
};

const labRow = {
  id: 'lab-0001',
  organizationId: 'org-0001',
  courseOfferingId: 'offering-0001',
  createdBy: 'teacher-0001',
  topic: 'pendulums',
  chapterId: 'unit-0001',
  status: 'GENERATING',
  generatedCode: null,
  template: null,
  gameSpec: null,
  reviewApproved: null,
  reviewFlags: null,
  teacherNotes: null,
  publishedAt: null,
  createdAt: new Date('2026-08-12T10:00:00Z'),
  offerings: [{ courseOfferingId: 'offering-0001' }],
};

/** Valid generator output that passes the deterministic guards: it renders
 * into #sim (and uses Matter, which the sandbox now actually provides). */
const validCode =
  "const engine = Matter.Engine.create(); Matter.Render.create({ element: document.getElementById('sim'), engine });";

const dragSpec = {
  template: 'drag-to-regions',
  title: 'Construct the cell',
  instructions: 'Drag each organelle into its region.',
  objective: 'Place every organelle to win.',
  tabs: [
    {
      id: 'eukaryotic',
      label: 'Eukaryotic cell',
      regions: [{ id: 'nucleus', label: 'Nucleus' }],
    },
  ],
  items: [
    {
      id: 'item-1',
      label: 'Nucleus',
      tabId: 'eukaryotic',
      regionId: 'nucleus',
    },
  ],
};

describe('LabsService', () => {
  let service: LabsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockCourseOfferingFindMany.mockResolvedValue([offering]);
    mockCourseOfferingFindFirst.mockResolvedValue({ courseId: 'course-0001' });
    mockSearchChunks.mockResolvedValue([]);
    mockSearchChunksByCourse.mockResolvedValue([]);
    mockGetChunksByChapter.mockResolvedValue([]);
    mockLabCreate.mockResolvedValue(labRow);
    mockLabFindFirst.mockResolvedValue(labRow);
    mockLabUpdate.mockImplementation(
      (args: { data?: Record<string, unknown> }) =>
        Promise.resolve({ ...labRow, ...(args.data ?? {}) }),
    );
    mockLabFindMany.mockResolvedValue([]);
    mockLabDelete.mockResolvedValue(labRow);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabsService,
        { provide: LlmService, useValue: { chat: mockChat } },
        {
          provide: MaterialsService,
          useValue: {
            searchChunks: mockSearchChunks,
            searchChunksByCourse: mockSearchChunksByCourse,
            getChunksByChapter: mockGetChunksByChapter,
          },
        },
        {
          provide: PrismaService,
          useValue: {
            courseOffering: {
              findMany: mockCourseOfferingFindMany,
              findFirst: mockCourseOfferingFindFirst,
            },
            lab: {
              create: mockLabCreate,
              update: mockLabUpdate,
              findFirst: mockLabFindFirst,
              findMany: mockLabFindMany,
              delete: mockLabDelete,
            },
          },
        },
      ],
    }).compile();

    service = module.get<LabsService>(LabsService);
  });

  describe('generate', () => {
    it('returns a "not grounded" result and never invokes either agent when the unit has no curriculum material', async () => {
      mockSearchChunksByCourse.mockResolvedValue([]);
      mockGetChunksByChapter.mockResolvedValue([]);

      const result = await service.generate(teacher, {
        courseOfferingIds: ['offering-0001'],
        chapterId: 'unit-0001',
        prompt: 'quantum tunneling',
      });

      expect(result.grounded).toBe(false);
      expect(result.labId).toBeNull();
      expect(result.status).toBeNull();
      expect(result.message).toContain('no curriculum material');
      // Neither agent may run without grounding.
      expect(mockChat).not.toHaveBeenCalled();
      expect(mockLabCreate).not.toHaveBeenCalled();
    });

    it('builds a template game from the unit material in one agent pass — no code, no reviewer', async () => {
      mockSearchChunksByCourse.mockResolvedValue([unitChunk]);
      mockChat.mockResolvedValueOnce(JSON.stringify(dragSpec));

      const onStep = jest.fn();
      const result = await service.generate(
        teacher,
        {
          courseOfferingIds: ['offering-0001'],
          chapterId: 'unit-0001',
          prompt: 'build a construct-the-cell game',
        },
        onStep,
      );

      // Exactly one LLM call — the architect. No reviewer runs for templates.
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('PENDING_TEACHER_REVIEW');
      expect(result.reviewApproved).toBeNull();
      // The lab row stores the template + its spec, with a null review.
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data).toMatchObject({
        status: 'PENDING_TEACHER_REVIEW',
        template: 'drag-to-regions',
        gameSpec: dragSpec,
        reviewApproved: null,
      });
      expect(onStep.mock.calls.map(([s]) => s as string)).toEqual([
        'thinking',
        'search_curriculum',
        'design_game',
      ]);
    });

    it('falls back to the unit’s raw chunks when the semantic search comes up empty', async () => {
      mockSearchChunksByCourse.mockResolvedValue([]);
      mockGetChunksByChapter.mockResolvedValue([unitChunk]);
      mockChat.mockResolvedValueOnce(JSON.stringify({ code: validCode }));

      const result = await service.generate(teacher, {
        courseOfferingIds: ['offering-0001'],
        chapterId: 'unit-0001',
        prompt: 'pendulums',
        mode: 'advanced',
      });

      expect(mockGetChunksByChapter).toHaveBeenCalledWith(
        'course-0001',
        'unit-0001',
        expect.any(Number),
      );
      expect(result.status).toBe('PENDING_TEACHER_REVIEW');
    });

    it('generates for multiple sections of the same course, grounding on the unit and linking every selected offering', async () => {
      mockCourseOfferingFindMany.mockResolvedValue([offering, sectionOffering]);
      mockSearchChunksByCourse.mockResolvedValue([unitChunk]);
      mockChat.mockResolvedValueOnce(JSON.stringify({ code: validCode }));

      const onStep = jest.fn();
      const result = await service.generate(
        teacher,
        {
          courseOfferingIds: ['offering-0001', 'offering-0002'],
          chapterId: 'unit-0001',
          prompt: 'pendulums',
          mode: 'advanced',
        },
        onStep,
      );

      // Grounding ran against the course + unit, scoped to the chapter.
      expect(mockSearchChunksByCourse).toHaveBeenCalledWith(
        'course-0001',
        'pendulums',
        expect.any(Number),
        'unit-0001',
      );
      // The lab row links every selected section via the join table and records
      // the unit + the prompt as its topic.
      const createCalls = mockLabCreate.mock.calls as [
        {
          data: {
            courseOfferingId: string;
            chapterId: string;
            topic: string;
            offerings: { create: unknown[] };
          };
        },
      ][];
      expect(createCalls[0][0].data.courseOfferingId).toBe('offering-0001');
      expect(createCalls[0][0].data.chapterId).toBe('unit-0001');
      expect(createCalls[0][0].data.topic).toBe('pendulums');
      expect(createCalls[0][0].data.offerings.create).toEqual([
        { courseOfferingId: 'offering-0001' },
        { courseOfferingId: 'offering-0002' },
      ]);
      expect(result.status).toBe('PENDING_TEACHER_REVIEW');
      // The SSE steps stop at generate_code — no reviewer step anymore.
      expect(onStep.mock.calls.map(([s]) => s as string)).toEqual([
        'thinking',
        'search_curriculum',
        'generate_code',
      ]);
    });

    it('rejects generation when any selected offering is outside the org', async () => {
      mockCourseOfferingFindMany.mockResolvedValue([offering]);

      await expect(
        service.generate(teacher, {
          courseOfferingIds: ['offering-0001', 'offering-0002'],
          chapterId: 'unit-0001',
          prompt: 'pendulums',
        }),
      ).rejects.toMatchObject({
        code: 'LAB_FORBIDDEN',
        status: 404,
      });
      expect(mockSearchChunksByCourse).not.toHaveBeenCalled();
      expect(mockLabCreate).not.toHaveBeenCalled();
    });

    it('rejects generation when the selected sections span different courses', async () => {
      mockCourseOfferingFindMany.mockResolvedValue([
        offering,
        { ...sectionOffering, courseId: 'course-0002' },
      ]);

      await expect(
        service.generate(teacher, {
          courseOfferingIds: ['offering-0001', 'offering-0002'],
          chapterId: 'unit-0001',
          prompt: 'pendulums',
        }),
      ).rejects.toMatchObject({
        code: 'LAB_FORBIDDEN',
        status: 400,
      });
      expect(mockLabCreate).not.toHaveBeenCalled();
    });

    it('advanced generation is single-pass: one generator call, no reviewer, lands on PENDING_TEACHER_REVIEW', async () => {
      mockSearchChunksByCourse.mockResolvedValue([unitChunk]);
      mockChat.mockResolvedValueOnce(JSON.stringify({ code: validCode }));

      const onStep = jest.fn();
      const result = await service.generate(
        teacher,
        {
          courseOfferingIds: ['offering-0001'],
          chapterId: 'unit-0001',
          prompt: 'pendulums',
          mode: 'advanced',
        },
        onStep,
      );

      // Exactly ONE LLM call — the generator. No reviewer, no fix loop.
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('PENDING_TEACHER_REVIEW');
      expect(result.reviewApproved).toBeNull();
      expect(result.reviewFlags).toBeNull();
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][0].data).toEqual({
        status: 'PENDING_TEACHER_REVIEW',
        template: null,
        generatedCode: validCode,
        reviewApproved: null,
        reviewFlags: Prisma.DbNull,
      });
      expect(onStep.mock.calls.map(([s]) => s as string)).toEqual([
        'thinking',
        'search_curriculum',
        'generate_code',
      ]);
    });

    it('fails a whitespace-only result via the deterministic empty-code guard', async () => {
      mockSearchChunksByCourse.mockResolvedValue([unitChunk]);
      // The generator output schema requires >= 1 char, so whitespace slips
      // through the schema but must be caught by the plain-code guard.
      mockChat.mockResolvedValueOnce(JSON.stringify({ code: '   \n ' }));

      const result = await service.generate(teacher, {
        courseOfferingIds: ['offering-0001'],
        chapterId: 'unit-0001',
        prompt: 'pendulums',
        mode: 'advanced',
      });

      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewApproved).toBe(false);
      expect(result.reviewFlags?.flags).toEqual([
        'The generator returned empty code.',
      ]);
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data.status).toBe('AI_REVIEW_FAILED');
      expect(updateCalls[0][0].data.generatedCode).toBe('   \n ');
    });

    it('fails code that never renders into #sim via the deterministic render-target guard', async () => {
      mockSearchChunksByCourse.mockResolvedValue([unitChunk]);
      mockChat.mockResolvedValueOnce(
        JSON.stringify({ code: 'const engine = Matter.Engine.create();' }),
      );

      const result = await service.generate(teacher, {
        courseOfferingIds: ['offering-0001'],
        chapterId: 'unit-0001',
        prompt: 'pendulums',
        mode: 'advanced',
      });

      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewApproved).toBe(false);
      expect(result.reviewFlags?.flags).toEqual([
        'The generated code never renders into #sim.',
      ]);
    });

    it('marks the lab AI_REVIEW_FAILED with a truthful flag when the architect pipeline throws', async () => {
      mockSearchChunksByCourse.mockResolvedValue([unitChunk]);
      mockChat.mockRejectedValue(new Error('provider exploded'));

      const result = await service.generate(teacher, {
        courseOfferingIds: ['offering-0001'],
        chapterId: 'unit-0001',
        prompt: 'free fall',
      });

      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewApproved).toBe(false);
      expect(result.reviewFlags?.flags).toEqual([
        'The AI generation pipeline failed.',
      ]);
    });

    it('does not retry a provider timeout — a timed-out call fails fast instead of tripling the wait', async () => {
      mockSearchChunksByCourse.mockResolvedValue([unitChunk]);
      mockChat.mockRejectedValue(new Error('timeout of 180000ms exceeded'));

      const result = await service.generate(teacher, {
        courseOfferingIds: ['offering-0001'],
        chapterId: 'unit-0001',
        prompt: 'pendulums',
        mode: 'advanced',
      });

      // Exactly ONE provider call — AGENT_ATTEMPTS (3) applies only to
      // structured-output validation failures, never to provider timeouts.
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewApproved).toBe(false);
      expect(result.reviewFlags?.reasoning).toContain('timeout of 180000ms');
    });
  });

  describe('refine', () => {
    it('modifies the previous code in place in a single pass and reports the pipeline steps', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'PENDING_TEACHER_REVIEW',
        generatedCode: 'Matter.Engine.create(); // existing pendulum',
      });
      mockGetChunksByChapter.mockResolvedValue([unitChunk]);
      const refinedCode =
        "const engine = Matter.Engine.create(); // pendulum with an adjustable length slider\nMatter.Render.create({ element: document.getElementById('sim'), engine });";
      mockChat.mockResolvedValueOnce(JSON.stringify({ code: refinedCode }));

      const onStep = jest.fn();
      const result = await service.refine(
        teacher,
        'lab-0001',
        'add an adjustable length slider',
        onStep,
      );

      // Exactly ONE LLM call — the generator. No reviewer, no fix loop.
      expect(mockChat).toHaveBeenCalledTimes(1);
      // The generator prompt embeds the previous code AND the requested change
      // (modify-in-place, never a from-scratch rewrite).
      expect(mockChat).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.stringContaining('Matter.Engine.create(); // existing pendulum'),
      );
      expect(mockChat).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.stringContaining('add an adjustable length slider'),
      );
      // Re-grounding ran against the stored unit.
      expect(mockGetChunksByChapter).toHaveBeenCalledWith(
        'course-0001',
        'unit-0001',
        expect.any(Number),
      );
      // The lab row is updated in place with the refined code, review cleared.
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].where.id).toBe('lab-0001');
      expect(updateCalls[0][0].data).toEqual({
        status: 'PENDING_TEACHER_REVIEW',
        reviewApproved: null,
        generatedCode: refinedCode,
        reviewFlags: Prisma.DbNull,
      });
      expect(result.status).toBe('PENDING_TEACHER_REVIEW');
      expect(onStep.mock.calls.map(([s]) => s as string)).toEqual([
        'thinking',
        'load_lab',
        'modify_lab',
      ]);
    });

    it('refuses to refine PUBLISHED, REJECTED, or GENERATING labs without generated code', async () => {
      for (const status of ['PUBLISHED', 'REJECTED', 'GENERATING']) {
        mockLabFindFirst.mockResolvedValue({
          ...labRow,
          status,
          generatedCode:
            status === 'GENERATING' ? null : 'Matter.Engine.create()',
        });
        await expect(
          service.refine(teacher, 'lab-0001', 'change something'),
        ).rejects.toMatchObject({ code: 'LAB_NOT_REFINABLE' });
      }
      expect(mockChat).not.toHaveBeenCalled();
      expect(mockLabUpdate).not.toHaveBeenCalled();
    });

    it('returns LAB_NOT_FOUND for labs the teacher does not own', async () => {
      mockLabFindFirst.mockResolvedValue(null);

      await expect(
        service.refine(teacher, 'lab-0001', 'change something'),
      ).rejects.toMatchObject({
        code: 'LAB_NOT_FOUND',
      });
    });

    it('falls back to a semantic search when the lab predates units (no chapterId)', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        chapterId: null,
        status: 'PENDING_TEACHER_REVIEW',
        generatedCode: 'Matter.Engine.create(); // existing pendulum',
      });
      mockSearchChunks.mockResolvedValue([unitChunk]);
      mockChat.mockResolvedValueOnce(
        JSON.stringify({
          code: "Matter.Render.create({ element: document.getElementById('sim'), engine: Matter.Engine.create() });",
        }),
      );

      const result = await service.refine(teacher, 'lab-0001', 'tweak it');

      expect(mockSearchChunks).toHaveBeenCalledWith(
        'offering-0001',
        'pendulums',
        expect.any(Number),
      );
      expect(result.status).toBe('PENDING_TEACHER_REVIEW');
    });

    it('is single-pass: a refinement that fails the render-target guard returns immediately with the flag — no fix loop', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'PENDING_TEACHER_REVIEW',
        generatedCode: 'Matter.Engine.create(); // existing pendulum',
      });
      mockGetChunksByChapter.mockResolvedValue([unitChunk]);
      mockChat.mockResolvedValueOnce(
        JSON.stringify({
          code: 'Matter.Engine.create(); // refined, still blank',
        }),
      );

      const onStep = jest.fn();
      const result = await service.refine(
        teacher,
        'lab-0001',
        'add an adjustable length slider',
        onStep,
      );

      // One modify call and nothing else — a guarded refine lands straight on
      // AI_REVIEW_FAILED.
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewApproved).toBe(false);
      expect(result.reviewFlags?.flags).toEqual([
        'The generated code never renders into #sim.',
      ]);
      expect(onStep.mock.calls.map(([s]) => s as string)).toEqual([
        'thinking',
        'load_lab',
        'modify_lab',
      ]);
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data).toEqual({
        status: 'AI_REVIEW_FAILED',
        reviewApproved: false,
        generatedCode: 'Matter.Engine.create(); // refined, still blank',
        reviewFlags: {
          flags: ['The generated code never renders into #sim.'],
          reasoning:
            'The simulation never attaches a render target to the sandbox container, so students would see a blank screen.',
        },
      });
    });

    it('keeps the previous generated code and flags the lab when the refinement pipeline throws', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'PENDING_TEACHER_REVIEW',
        generatedCode: 'Matter.Engine.create(); // existing pendulum',
      });
      mockGetChunksByChapter.mockResolvedValue([unitChunk]);
      mockChat.mockRejectedValue(new Error('provider exploded'));

      const result = await service.refine(teacher, 'lab-0001', 'tweak it');

      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewApproved).toBe(false);
      expect(result.reviewFlags?.flags).toEqual([
        'The AI refinement pipeline failed.',
      ]);
      // The previous code is preserved — the update does NOT touch generatedCode.
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data.generatedCode).toBeUndefined();
    });

    it('modifies a template lab’s game spec in place — architect only, no code, no reviewer', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'PENDING_TEACHER_REVIEW',
        template: 'drag-to-regions',
        gameSpec: dragSpec,
      });
      mockGetChunksByChapter.mockResolvedValue([unitChunk]);
      const refined = { ...dragSpec, title: 'Construct the cell (harder)' };
      mockChat.mockResolvedValueOnce(JSON.stringify(refined));

      const onStep = jest.fn();
      const result = await service.refine(
        teacher,
        'lab-0001',
        'make it harder',
        onStep,
      );

      // Single architect pass — the previous spec and the instruction are both
      // embedded in the prompt.
      expect(result.status).toBe('PENDING_TEACHER_REVIEW');
      expect(mockChat).toHaveBeenCalledTimes(1);
      expect(mockChat).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.stringContaining('make it harder'),
      );
      expect(mockChat).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.stringContaining('drag-to-regions'),
      );
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data).toMatchObject({
        status: 'PENDING_TEACHER_REVIEW',
        gameSpec: refined,
      });
      expect(onStep.mock.calls.map(([s]) => s as string)).toEqual([
        'thinking',
        'load_lab',
        'modify_lab',
      ]);
    });
  });

  describe('publish', () => {
    it.each(['GENERATING', 'REJECTED', 'PUBLISHED'])(
      'rejects publishing from %s',
      async (status) => {
        mockLabFindFirst.mockResolvedValue({ ...labRow, status });

        await expect(
          service.publish(teacher, 'lab-0001'),
        ).rejects.toMatchObject({ code: 'LAB_NOT_PUBLISHABLE' });
        expect(mockLabUpdate).not.toHaveBeenCalled();
      },
    );

    it('publishes from PENDING_TEACHER_REVIEW', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'PENDING_TEACHER_REVIEW',
      });

      const result = await service.publish(teacher, 'lab-0001');

      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data.status).toBe('PUBLISHED');
      expect(updateCalls[0][0].data.publishedAt).toBeInstanceOf(Date);
      expect(result.status).toBe('PUBLISHED');
      expect(result.courseOfferingIds).toEqual(['offering-0001']);
    });

    it('allows a teacher override publish from AI_REVIEW_FAILED, keeping the review flags on the row', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'AI_REVIEW_FAILED',
        reviewApproved: false,
        reviewFlags: {
          flags: ['The generator returned empty code.'],
          reasoning: 'No code was produced, so the sandbox has nothing to run.',
        },
      });

      const result = await service.publish(teacher, 'lab-0001');

      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data.status).toBe('PUBLISHED');
      expect(updateCalls[0][0].data.publishedAt).toBeInstanceOf(Date);
      expect(updateCalls[0][0].data.reviewFlags).toBeUndefined();
      expect(result.status).toBe('PUBLISHED');
    });

    it('returns LAB_NOT_FOUND for labs the teacher does not own', async () => {
      mockLabFindFirst.mockResolvedValue(null);

      await expect(service.publish(teacher, 'lab-0001')).rejects.toMatchObject({
        code: 'LAB_NOT_FOUND',
      });
    });
  });

  describe('reject', () => {
    it('rejects any pending status with optional notes', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'AI_REVIEW_FAILED',
      });

      const result = await service.reject(
        teacher,
        'lab-0001',
        'flawed physics',
      );

      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data).toEqual({
        status: 'REJECTED',
        teacherNotes: 'flawed physics',
      });
      expect(result.status).toBe('REJECTED');
    });

    it('rejects REJECTED/PUBLISHED labs (final statuses are not rejectable)', async () => {
      mockLabFindFirst.mockResolvedValue({ ...labRow, status: 'REJECTED' });

      await expect(service.reject(teacher, 'lab-0001')).rejects.toMatchObject({
        code: 'LAB_NOT_REJECTABLE',
      });
    });
  });

  describe('regenerate', () => {
    it('rebuilds a template lab from scratch, in place, preserving its unit and offerings', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'AI_REVIEW_FAILED',
        template: 'drag-to-regions',
        gameSpec: dragSpec,
      });
      mockGetChunksByChapter.mockResolvedValue([unitChunk]);
      const fresh = { ...dragSpec, title: 'Construct the cell v2' };
      mockChat.mockResolvedValueOnce(JSON.stringify(fresh));

      const onStep = jest.fn();
      const result = await service.regenerate(teacher, 'lab-0001', onStep);

      expect(result.status).toBe('PENDING_TEACHER_REVIEW');
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].where.id).toBe('lab-0001');
      expect(updateCalls[0][0].data).toMatchObject({
        status: 'PENDING_TEACHER_REVIEW',
        template: 'drag-to-regions',
        gameSpec: fresh,
      });
      expect(onStep.mock.calls.map(([s]) => s as string)).toEqual([
        'thinking',
        'search_curriculum',
        'design_game',
      ]);
    });

    it('rebuilds a legacy lab through the generator in a single pass', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'AI_REVIEW_FAILED',
        generatedCode: 'Matter.Engine.create(); // broken',
      });
      mockGetChunksByChapter.mockResolvedValue([unitChunk]);
      mockChat.mockResolvedValueOnce(JSON.stringify({ code: validCode }));

      const result = await service.regenerate(teacher, 'lab-0001');

      expect(result.status).toBe('PENDING_TEACHER_REVIEW');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('returns "not grounded" and leaves the lab untouched when the unit has no material', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'AI_REVIEW_FAILED',
        template: 'drag-to-regions',
        gameSpec: dragSpec,
      });
      mockGetChunksByChapter.mockResolvedValue([]);
      mockSearchChunks.mockResolvedValue([]);

      const result = await service.regenerate(teacher, 'lab-0001');

      expect(result.grounded).toBe(false);
      expect(mockChat).not.toHaveBeenCalled();
      expect(mockLabUpdate).not.toHaveBeenCalled();
    });

    it('refuses to regenerate final-status labs', async () => {
      for (const status of ['PUBLISHED', 'REJECTED']) {
        mockLabFindFirst.mockResolvedValue({ ...labRow, status });
        await expect(
          service.regenerate(teacher, 'lab-0001'),
        ).rejects.toMatchObject({ code: 'LAB_NOT_RESTARTABLE' });
      }
      expect(mockChat).not.toHaveBeenCalled();
      expect(mockLabUpdate).not.toHaveBeenCalled();
    });

    it('returns LAB_NOT_FOUND for labs the teacher does not own', async () => {
      mockLabFindFirst.mockResolvedValue(null);

      await expect(
        service.regenerate(teacher, 'lab-0001'),
      ).rejects.toMatchObject({ code: 'LAB_NOT_FOUND' });
    });

    it('keeps the previous content and flags the lab when regeneration throws', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'AI_REVIEW_FAILED',
        template: 'drag-to-regions',
        gameSpec: dragSpec,
      });
      mockGetChunksByChapter.mockResolvedValue([unitChunk]);
      mockChat.mockRejectedValue(new Error('provider exploded'));

      const result = await service.regenerate(teacher, 'lab-0001');

      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewFlags?.flags).toEqual([
        'The AI generation pipeline failed.',
      ]);
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls[0][0].data.gameSpec).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('hard-deletes a lab the teacher owns and returns it', async () => {
      mockLabFindFirst.mockResolvedValue({ ...labRow, status: 'PUBLISHED' });

      const result = await service.delete(teacher, 'lab-0001');

      expect(mockLabDelete).toHaveBeenCalledWith({
        where: { id: 'lab-0001' },
      });
      expect(result.id).toBe('lab-0001');
    });

    it('returns LAB_NOT_FOUND for labs the teacher does not own', async () => {
      mockLabFindFirst.mockResolvedValue(null);

      await expect(service.delete(teacher, 'lab-0001')).rejects.toMatchObject({
        code: 'LAB_NOT_FOUND',
      });
      expect(mockLabDelete).not.toHaveBeenCalled();
    });
  });

  describe('student scoping', () => {
    it('lists only PUBLISHED labs, scoped to the student approved enrollments via the join table', async () => {
      mockLabFindMany.mockResolvedValue([
        { ...labRow, status: 'PUBLISHED', publishedAt: new Date() },
      ]);

      const labs = await service.listForUser(student, 'offering-0001');

      const findManyCalls = mockLabFindMany.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      expect(findManyCalls[0][0].where).toEqual({
        organizationId: 'org-0001',
        status: 'PUBLISHED',
        offerings: {
          some: {
            courseOfferingId: 'offering-0001',
            courseOffering: {
              section: {
                enrollments: {
                  some: { studentId: 'student-0001', status: 'APPROVED' },
                },
              },
            },
          },
        },
      });
      expect(labs).toHaveLength(1);
      expect(labs[0].status).toBe('PUBLISHED');
    });

    it('includes every selected section id in the teacher list result', async () => {
      mockLabFindMany.mockResolvedValue([
        {
          ...labRow,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          offerings: [
            { courseOfferingId: 'offering-0001' },
            { courseOfferingId: 'offering-0002' },
          ],
        },
      ]);

      const labs = await service.listForUser(teacher, 'offering-0002');

      const findManyCalls = mockLabFindMany.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      expect(findManyCalls[0][0].where).toEqual({
        organizationId: 'org-0001',
        createdBy: 'teacher-0001',
        offerings: { some: { courseOfferingId: 'offering-0002' } },
      });
      expect(labs[0].courseOfferingIds).toEqual([
        'offering-0001',
        'offering-0002',
      ]);
    });

    it('never returns a non-published lab to a student, even via direct id', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'PENDING_TEACHER_REVIEW',
      });

      await expect(service.getForUser(student, 'lab-0001')).rejects.toThrow(
        ApiError,
      );
      await expect(
        service.getForUser(student, 'lab-0001'),
      ).rejects.toMatchObject({ code: 'LAB_NOT_PUBLISHED' });
    });

    it('allows a student to retrieve a PUBLISHED lab', async () => {
      mockLabFindFirst.mockResolvedValue({
        ...labRow,
        status: 'PUBLISHED',
        generatedCode: 'Matter.Engine.create()',
      });

      const lab = await service.getForUser(student, 'lab-0001');

      expect(lab.status).toBe('PUBLISHED');
      expect(lab.generatedCode).toBe('Matter.Engine.create()');
    });
  });
});
