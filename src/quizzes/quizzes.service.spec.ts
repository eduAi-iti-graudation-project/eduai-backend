import { Test, TestingModule } from '@nestjs/testing';
import { QuizzesService } from './quizzes.service';
import { QuizzesGradingService } from './quizzes-grading.service';
import { QuizGenerationAgent } from './agents/quiz-generation.agent';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  quiz: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  quizQuestion: {
    deleteMany: jest.fn(),
  },
  quizAttempt: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  quizAnswer: {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockGradingService = {
  gradeMcq: jest.fn(),
  gradeTrueFalse: jest.fn(),
  gradeEssay: jest.fn(),
};

const mockGenerationAgent = {
  generate: jest.fn(),
};

describe('QuizzesService', () => {
  let service: QuizzesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizzesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuizzesGradingService, useValue: mockGradingService },
        { provide: QuizGenerationAgent, useValue: mockGenerationAgent },
      ],
    }).compile();

    service = module.get<QuizzesService>(QuizzesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── Create ──────────────────────────────────────────
  it('should create a quiz with questions', async () => {
    const dto = {
      title: 'Test Quiz',
      courseOfferingId: 'offering-1',
      teacherId: 'teacher-1',
      questions: [
        {
          type: 'MCQ' as const,
          question: 'Q1',
          options: [
            { text: 'A', isCorrect: true },
            { text: 'B', isCorrect: false },
          ],
          points: 1,
          order: 0,
        },
        { type: 'ESSAY' as const, question: 'Q2', points: 5, order: 1 },
      ],
    };

    mockPrisma.quiz.create.mockResolvedValue({
      id: 'quiz-1',
      ...dto,
      description: null,
      timeLimit: null,
      passingScore: null,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
      questions: [
        {
          id: 'q-1',
          type: 'MCQ',
          question: 'Q1',
          options: [
            { text: 'A', isCorrect: true },
            { text: 'B', isCorrect: false },
          ],
          points: 1,
          order: 0,
        },
        {
          id: 'q-2',
          type: 'ESSAY',
          question: 'Q2',
          options: null,
          points: 5,
          order: 1,
        },
      ],
    });

    const result = await service.create(dto);
    expect(result.id).toBe('quiz-1');
    expect(result.questions).toHaveLength(2);
    expect(mockPrisma.quiz.create).toHaveBeenCalled();
  });

  // ─── Find All ────────────────────────────────────────
  it('should list quizzes with question count', async () => {
    mockPrisma.quiz.findMany.mockResolvedValue([
      {
        id: 'quiz-1',
        title: 'Quiz 1',
        description: null,
        courseOfferingId: 'offering-1',
        teacherId: 'teacher-1',
        timeLimit: null,
        passingScore: null,
        status: 'DRAFT',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { questions: 3 },
      },
    ]);

    const result = await service.findAll('offering-1');
    expect(result).toHaveLength(1);
    expect(result[0].questionCount).toBe(3);
  });

  // ─── Find One (student view hides answers) ───────────
  it('should return quiz without correct answers for student view', async () => {
    mockPrisma.quiz.findUnique.mockResolvedValue({
      id: 'quiz-1',
      title: 'Quiz 1',
      description: null,
      courseOfferingId: 'offering-1',
      teacherId: 'teacher-1',
      timeLimit: null,
      passingScore: null,
      status: 'PUBLISHED',
      createdAt: new Date(),
      updatedAt: new Date(),
      questions: [
        {
          id: 'q-1',
          type: 'MCQ',
          question: 'Q1',
          options: [
            { text: 'A', isCorrect: true },
            { text: 'B', isCorrect: false },
          ],
          points: 1,
          order: 0,
        },
      ],
    });

    const result = await service.findOne('quiz-1', true);
    expect(result.questions[0].options?.[0]).not.toHaveProperty('isCorrect');
  });

  // ─── Publish ─────────────────────────────────────────
  it('should publish a draft quiz', async () => {
    mockPrisma.quiz.findUnique.mockResolvedValue({
      id: 'quiz-1',
      status: 'DRAFT',
    });
    mockPrisma.quiz.update.mockResolvedValue({
      id: 'quiz-1',
      status: 'PUBLISHED',
    });

    const result = await service.publish('quiz-1');
    expect(result.status).toBe('PUBLISHED');
  });

  it('should reject publishing a non-draft quiz', async () => {
    mockPrisma.quiz.findUnique.mockResolvedValue({
      id: 'quiz-1',
      status: 'PUBLISHED',
    });

    await expect(service.publish('quiz-1')).rejects.toMatchObject({
      code: 'QUIZ_DRAFT_ONLY',
    });
  });

  // ─── Delete ──────────────────────────────────────────
  it('should delete a quiz', async () => {
    mockPrisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
    mockPrisma.quiz.delete.mockResolvedValue({ id: 'quiz-1' });

    await service.remove('quiz-1');
    expect(mockPrisma.quiz.delete).toHaveBeenCalledWith({
      where: { id: 'quiz-1' },
    });
  });

  // ─── Start Attempt ───────────────────────────────────
  it('should start a quiz attempt', async () => {
    mockPrisma.quiz.findUnique.mockResolvedValue({
      id: 'quiz-1',
      status: 'PUBLISHED',
    });
    mockPrisma.quizAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.quizAttempt.create.mockResolvedValue({
      id: 'attempt-1',
      quizId: 'quiz-1',
      studentId: 'student-1',
      status: 'IN_PROGRESS',
    });

    const result = await service.startAttempt('quiz-1', 'student-1');
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.serverNow).toEqual(expect.any(String));
  });

  it('should reject duplicate attempts', async () => {
    mockPrisma.quiz.findUnique.mockResolvedValue({
      id: 'quiz-1',
      status: 'PUBLISHED',
    });
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1',
    });

    await expect(
      service.startAttempt('quiz-1', 'student-1'),
    ).rejects.toMatchObject({ code: 'QUIZ_ALREADY_ATTEMPTED' });
  });

  it('should reject starting on non-published quiz', async () => {
    mockPrisma.quiz.findUnique.mockResolvedValue({
      id: 'quiz-1',
      status: 'DRAFT',
    });

    await expect(
      service.startAttempt('quiz-1', 'student-1'),
    ).rejects.toMatchObject({ code: 'QUIZ_NOT_PUBLISHED' });
  });

  it('should return expiresAt when the quiz has a time limit', async () => {
    mockPrisma.quiz.findUnique.mockResolvedValue({
      id: 'quiz-1',
      status: 'PUBLISHED',
      timeLimit: 10,
    });
    mockPrisma.quizAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.quizAttempt.create.mockResolvedValue({
      id: 'attempt-1',
      quizId: 'quiz-1',
      studentId: 'student-1',
      startedAt: new Date('2026-07-31T10:00:00.000Z'),
      status: 'IN_PROGRESS',
    });

    const result = (await service.startAttempt('quiz-1', 'student-1')) as {
      expiresAt: Date;
      serverNow: string;
    };
    expect(result.expiresAt).toEqual(new Date('2026-07-31T10:10:00.000Z'));
    expect(result.serverNow).toEqual(expect.any(String));
  });

  // ─── Submit Attempt ──────────────────────────────────
  it('should submit MCQ answers and grade by code', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1',
      quizId: 'quiz-1',
      studentId: 'student-1',
      status: 'IN_PROGRESS',
      answers: [],
      quiz: {
        questions: [
          {
            id: 'q-1',
            type: 'MCQ',
            question: 'What is 2+2?',
            options: [
              { text: '3', isCorrect: false },
              { text: '4', isCorrect: true },
              { text: '5', isCorrect: false },
              { text: '6', isCorrect: false },
            ],
            points: 1,
          },
        ],
      },
    });

    mockGradingService.gradeMcq.mockReturnValue({
      pointsAwarded: 1,
      isCorrect: true,
    });

    mockPrisma.quizAttempt.update.mockResolvedValue({
      id: 'attempt-1',
      status: 'COMPLETED',
      answers: [
        {
          id: 'a-1',
          questionId: 'q-1',
          answer: '4',
          pointsAwarded: 1,
          isConfirmed: true,
        },
      ],
    });

    mockPrisma.quizAttempt.findUnique
      .mockResolvedValueOnce({
        id: 'attempt-1',
        quizId: 'quiz-1',
        studentId: 'student-1',
        status: 'IN_PROGRESS',
        answers: [],
        quiz: {
          questions: [
            {
              id: 'q-1',
              type: 'MCQ',
              question: 'What is 2+2?',
              options: [
                { text: '3', isCorrect: false },
                { text: '4', isCorrect: true },
                { text: '5', isCorrect: false },
                { text: '6', isCorrect: false },
              ],
              points: 1,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        id: 'attempt-1',
        status: 'COMPLETED',
        answers: [
          {
            id: 'a-1',
            questionId: 'q-1',
            answer: '4',
            pointsAwarded: 1,
            isConfirmed: true,
          },
        ],
      });

    const result = (await service.submitAttempt('quiz-1', 'student-1', [
      { questionId: 'q-1', answer: '4' },
    ])) as { status: string };

    expect(result.status).toBe('COMPLETED');
    expect(mockGradingService.gradeMcq).toHaveBeenCalledWith('4', [
      { text: '3', isCorrect: false },
      { text: '4', isCorrect: true },
      { text: '5', isCorrect: false },
      { text: '6', isCorrect: false },
    ]);
  });

  it('should grade essay answers via LLM and leave unconfirmed', async () => {
    mockPrisma.quizAttempt.findUnique
      .mockResolvedValueOnce({
        id: 'attempt-2',
        quizId: 'quiz-1',
        studentId: 'student-1',
        status: 'IN_PROGRESS',
        answers: [],
        quiz: {
          questions: [
            {
              id: 'q-2',
              type: 'ESSAY',
              question: 'Explain photosynthesis',
              options: null,
              points: 5,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        id: 'attempt-2',
        status: 'COMPLETED',
        answers: [
          {
            id: 'a-2',
            questionId: 'q-2',
            answer: 'Plants use sunlight...',
            pointsAwarded: 4,
            isConfirmed: false,
            aiFeedback: 'Good explanation',
          },
        ],
      });

    mockGradingService.gradeEssay.mockResolvedValue({
      pointsAwarded: 4,
      feedback: 'Good explanation',
    });

    mockPrisma.quizAttempt.update.mockResolvedValue({
      id: 'attempt-2',
      status: 'COMPLETED',
      answers: [],
    });

    await service.submitAttempt('quiz-1', 'student-1', [
      { questionId: 'q-2', answer: 'Plants use sunlight...' },
    ]);

    expect(mockGradingService.gradeEssay).toHaveBeenCalled();
  });

  it('should reject already-submitted attempts', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1',
      status: 'COMPLETED',
      answers: [],
      quiz: { questions: [] },
    });

    await expect(
      service.submitAttempt('quiz-1', 'student-1', []),
    ).rejects.toMatchObject({ code: 'ATTEMPT_ALREADY_SUBMITTED' });
  });

  it('should reject submission after the time limit expires', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1',
      quizId: 'quiz-1',
      studentId: 'student-1',
      status: 'IN_PROGRESS',
      startedAt: new Date(Date.now() - 30 * 60_000),
      answers: [],
      quiz: {
        timeLimit: 10,
        questions: [],
      },
    });

    await expect(
      service.submitAttempt('quiz-1', 'student-1', [
        { questionId: 'q-1', answer: '4' },
      ]),
    ).rejects.toMatchObject({ code: 'ATTEMPT_NOT_IN_PROGRESS' });
  });

  it('should accept submission within the grace period after the deadline', async () => {
    mockPrisma.quizAttempt.findUnique
      .mockResolvedValueOnce({
        id: 'attempt-1',
        quizId: 'quiz-1',
        studentId: 'student-1',
        status: 'IN_PROGRESS',
        startedAt: new Date(Date.now() - 10 * 60_000 + 10_000),
        answers: [],
        quiz: {
          timeLimit: 10,
          questions: [],
        },
      })
      .mockResolvedValueOnce({
        id: 'attempt-1',
        status: 'COMPLETED',
        answers: [],
      });

    mockPrisma.quizAttempt.update.mockResolvedValue({
      id: 'attempt-1',
    });

    const result = (await service.submitAttempt('quiz-1', 'student-1', [])) as {
      status: string;
    };

    expect(result.status).toBe('COMPLETED');
    expect(mockPrisma.quizAttempt.update).toHaveBeenCalled();
  });

  // ─── Violations ──────────────────────────────────────
  it('should append a violation to an in-progress attempt', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1',
      studentId: 'student-1',
      status: 'IN_PROGRESS',
      violations: [
        { type: 'TAB_SWITCH', occurredAt: '2026-07-31T10:00:00.000Z' },
      ],
    });
    mockPrisma.quizAttempt.update.mockResolvedValue({
      id: 'attempt-1',
      violations: [
        { type: 'TAB_SWITCH', occurredAt: '2026-07-31T10:00:00.000Z' },
        { type: 'FULLSCREEN_EXIT', occurredAt: '2026-07-31T10:05:00.000Z' },
      ],
    });

    const result = await service.reportViolation(
      'attempt-1',
      'student-1',
      'FULLSCREEN_EXIT',
    );

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(
      expect.objectContaining({ type: 'FULLSCREEN_EXIT' }),
    );

    const calls = mockPrisma.quizAttempt.update.mock.calls as [
      {
        where: { id: string };
        data: { violations: { type: string; occurredAt: string }[] };
      },
    ][];
    const updateArg = calls[0][0];
    expect(updateArg.where).toEqual({ id: 'attempt-1' });
    expect(updateArg.data.violations).toHaveLength(2);
    expect(updateArg.data.violations[1]).toEqual(
      expect.objectContaining({ type: 'FULLSCREEN_EXIT' }),
    );
  });

  it('should reject violation reports on another students attempt', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1',
      studentId: 'student-2',
      status: 'IN_PROGRESS',
      violations: [],
    });

    await expect(
      service.reportViolation('attempt-1', 'student-1', 'TAB_SWITCH'),
    ).rejects.toMatchObject({ code: 'ATTEMPT_FORBIDDEN' });
  });

  it('should reject violation reports on completed attempts', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1',
      studentId: 'student-1',
      status: 'COMPLETED',
      violations: [],
    });

    await expect(
      service.reportViolation('attempt-1', 'student-1', 'TAB_SWITCH'),
    ).rejects.toMatchObject({ code: 'ATTEMPT_NOT_IN_PROGRESS' });
  });

  it('should reject violation reports for missing attempts', async () => {
    mockPrisma.quizAttempt.findUnique.mockResolvedValue(null);

    await expect(
      service.reportViolation('missing', 'student-1', 'TAB_SWITCH'),
    ).rejects.toMatchObject({ code: 'ATTEMPT_NOT_FOUND' });
  });

  // ─── Confirm Attempt ─────────────────────────────────
  it('should confirm all unconfirmed answers and recalculate score', async () => {
    mockPrisma.quizAttempt.findUnique
      .mockResolvedValueOnce({
        id: 'attempt-1',
        answers: [
          { id: 'a-1', isConfirmed: false },
          { id: 'a-2', isConfirmed: true },
        ],
      })
      .mockResolvedValueOnce({
        id: 'attempt-1',
        quizId: 'quiz-1',
        studentId: 'student-1',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        submittedAt: new Date('2026-01-01T10:05:00Z'),
        totalScore: 7,
        status: 'COMPLETED',
        violations: [],
        quiz: {
          id: 'quiz-1',
          title: 'Test Quiz',
          description: null,
          courseOfferingId: 'offering-1',
          teacherId: 'teacher-1',
          timeLimit: null,
          passingScore: null,
          status: 'PUBLISHED',
          createdAt: new Date('2026-01-01T09:00:00Z'),
          updatedAt: new Date('2026-01-01T09:00:00Z'),
          questions: [],
        },
        student: { id: 'student-1', name: 'Test Student' },
        answers: [
          {
            id: 'a-1',
            questionId: 'q-1',
            answer: 'answer',
            pointsAwarded: 4,
            isConfirmed: true,
            aiFeedback: null,
            question: {
              id: 'q-1',
              type: 'MCQ',
              question: 'Q1',
              points: 5,
              order: 0,
            },
          },
          {
            id: 'a-2',
            questionId: 'q-2',
            answer: 'answer',
            pointsAwarded: 3,
            isConfirmed: true,
            aiFeedback: null,
            question: {
              id: 'q-2',
              type: 'ESSAY',
              question: 'Q2',
              points: 5,
              order: 1,
            },
          },
        ],
      });

    mockPrisma.quizAnswer.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.quizAnswer.findMany.mockResolvedValue([
      { pointsAwarded: 4 },
      { pointsAwarded: 3 },
    ]);
    mockPrisma.quizAttempt.update.mockResolvedValue({
      id: 'attempt-1',
      totalScore: 7,
    });

    const result = await service.confirmAttempt('attempt-1');
    expect(mockPrisma.quizAnswer.updateMany).toHaveBeenCalledWith({
      where: { attemptId: 'attempt-1', isConfirmed: false },
      data: { isConfirmed: true },
    });
    expect(result.totalScore).toBe(7);
  });

  // ─── Get Attempt ─────────────────────────────────────
  describe('getAttempt', () => {
    it('should return full quiz and student objects', async () => {
      mockPrisma.quizAttempt.findUnique.mockResolvedValue({
        id: 'attempt-1',
        quizId: 'quiz-1',
        studentId: 'student-1',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        submittedAt: new Date('2026-01-01T10:05:00Z'),
        totalScore: 7,
        status: 'COMPLETED',
        violations: [
          { type: 'TAB_SWITCH', occurredAt: '2026-01-01T10:02:00Z' },
        ],
        quiz: {
          id: 'quiz-1',
          title: 'Test Quiz',
          description: null,
          courseOfferingId: 'offering-1',
          teacherId: 'teacher-1',
          timeLimit: 15,
          passingScore: 5,
          status: 'PUBLISHED',
          createdAt: new Date('2026-01-01T09:00:00Z'),
          updatedAt: new Date('2026-01-01T09:30:00Z'),
          questions: [{ id: 'q-1', question: 'Q1', points: 5, order: 0 }],
        },
        student: { id: 'student-1', name: 'Test Student' },
        answers: [
          {
            id: 'a-1',
            questionId: 'q-1',
            answer: 'answer',
            pointsAwarded: 4,
            isConfirmed: true,
            aiFeedback: 'Good',
            question: {
              id: 'q-1',
              type: 'MCQ',
              question: 'Q1',
              points: 5,
              order: 0,
            },
          },
        ],
      });

      const result = await service.getAttempt('attempt-1');

      expect((result as { quizTitle?: unknown }).quizTitle).toBeUndefined();
      expect(result.quiz.title).toBe('Test Quiz');
      expect(result.quiz.questions).toEqual([
        { id: 'q-1', question: 'Q1', points: 5, order: 0 },
      ]);
      expect(result.quiz.createdAt).toBe('2026-01-01T09:00:00.000Z');
      expect(result.quiz.updatedAt).toBe('2026-01-01T09:30:00.000Z');
      expect(result.student).toEqual({ id: 'student-1', name: 'Test Student' });
      expect(result.violations).toEqual([
        { type: 'TAB_SWITCH', occurredAt: '2026-01-01T10:02:00Z' },
      ]);
      expect(result.answers[0].question.question).toBe('Q1');
      expect(result.answers[0].aiFeedback).toBe('Good');
    });

    it('should throw NotFound for missing attempt', async () => {
      mockPrisma.quizAttempt.findUnique.mockResolvedValue(null);

      await expect(service.getAttempt('missing')).rejects.toMatchObject({
        code: 'ATTEMPT_NOT_FOUND',
      });
    });
  });

  // ─── Get Attempts By Quiz ────────────────────────────
  describe('getAttemptsByQuiz', () => {
    it('should return student objects and violations arrays', async () => {
      mockPrisma.quizAttempt.findMany.mockResolvedValue([
        {
          id: 'attempt-1',
          quizId: 'quiz-1',
          studentId: 'student-1',
          startedAt: new Date('2026-01-01T10:00:00Z'),
          submittedAt: new Date('2026-01-01T10:05:00Z'),
          totalScore: 7,
          status: 'COMPLETED',
          violations: [
            { type: 'FULLSCREEN_EXIT', occurredAt: '2026-01-01T10:03:00Z' },
          ],
          student: { id: 'student-1', name: 'Test Student' },
          _count: { answers: 3 },
        },
      ]);

      const result = await service.getAttemptsByQuiz('quiz-1');

      expect(
        (result[0] as { studentName?: unknown; violationCount?: unknown })
          .studentName,
      ).toBeUndefined();
      expect(
        (result[0] as { studentName?: unknown; violationCount?: unknown })
          .violationCount,
      ).toBeUndefined();
      expect(result[0].student).toEqual({
        id: 'student-1',
        name: 'Test Student',
      });
      expect(result[0].violations).toEqual([
        { type: 'FULLSCREEN_EXIT', occurredAt: '2026-01-01T10:03:00Z' },
      ]);
      expect(result[0].answerCount).toBe(3);
    });
  });

  // ─── Update Answer ───────────────────────────────────
  it('should update a single answer score', async () => {
    mockPrisma.quizAnswer.findUnique.mockResolvedValue({ id: 'a-1' });
    mockPrisma.quizAnswer.update.mockResolvedValue({
      id: 'a-1',
      pointsAwarded: 5,
      isConfirmed: true,
    });

    const result = await service.updateAnswer('a-1', 5);
    expect(result.pointsAwarded).toBe(5);
    expect(result.isConfirmed).toBe(true);
  });
});
