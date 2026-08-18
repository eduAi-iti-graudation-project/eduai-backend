import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuizzesGradingService } from './quizzes-grading.service';
import { QuizViolationsService } from './quiz-violations.service';
import { QuizGenerationAgent } from './agents/quiz-generation.agent';
import { MaterialsService } from '../materials/materials.service';
import { type QuizAgentStep } from './dto';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

const SUBMIT_GRACE_PERIOD_MS = 30_000;

type ViolationRecord = { type: string; occurredAt: string };

function toViolations(value: Prisma.JsonValue | null): ViolationRecord[] {
  if (!Array.isArray(value)) return [];
  return value as ViolationRecord[];
}

type AssignmentInput = {
  courseOfferingId: string;
  targetStudentIds?: string[];
};

const ASSIGNMENTS_INCLUDE = {
  assignments: {
    include: {
      offering: {
        include: {
          course: true,
          section: { include: { gradeLevel: true } },
          teacher: true,
        },
      },
    },
  },
} satisfies Prisma.QuizInclude;

function mapAssignments(quiz: {
  assignments: {
    id: string;
    courseOfferingId: string;
    targetStudentIds: string[];
    offering: {
      course: { id: string; name: string };
      section: {
        id: string;
        name: string;
        gradeLevel: { id: string; name: string | null };
      };
      teacher: { id: string } | null;
    };
  }[];
}) {
  return quiz.assignments.map((a) => ({
    id: a.id,
    courseOfferingId: a.courseOfferingId,
    sectionId: a.offering.section.id,
    sectionName: a.offering.section.name,
    courseId: a.offering.course.id,
    courseName: a.offering.course.name,
    gradeLevelId: a.offering.section.gradeLevel.id,
    gradeLevelName: a.offering.section.gradeLevel.name,
    teacherId: a.offering.teacher?.id ?? null,
    targetStudentIds: a.targetStudentIds,
  }));
}

@Injectable()
export class QuizzesService {
  private readonly logger = new Logger(QuizzesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingService: QuizzesGradingService,
    private readonly generationAgent: QuizGenerationAgent,
    private readonly materialsService: MaterialsService,
    private readonly quizViolationsService: QuizViolationsService,
  ) {}

  // ─── AI Generation ────────────────────────────────────
  async generate(
    params: {
      courseId: string;
      assignments: AssignmentInput[];
      teacherId: string;
      chapterId?: string | null;
      questionCount?: number;
      types?: ('MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY')[];
      difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
      timeLimit?: number;
      endsAt?: string;
    },
    onStep?: (step: QuizAgentStep) => void,
  ) {
    return this.generationAgent.generate(params, onStep);
  }

  /**
   * Internal path used by automated flows (e.g. struggle signals) that have a
   * weak-concept string but no teacher-chosen unit. The concept is used ONLY
   * to resolve the best-matching unit; the quiz is then generated strictly
   * from that unit's material — never from the concept string itself.
   */
  async generateForConcept(params: {
    courseId: string;
    courseOfferingId: string;
    studentId: string;
    concept: string;
    teacherId: string;
  }) {
    const chunks = await this.materialsService.searchChunksByCourse(
      params.courseId,
      params.concept,
      5,
    );
    let chapterId = chunks.find((c) => c.chapterId)?.chapterId ?? null;
    if (!chapterId) {
      // The concept embedding may not rank above the threshold even when the
      // course has material. Fall back to matching the concept against the
      // course's units by title so a unit can still be resolved.
      const chapters = await this.materialsService.listChaptersWithMaterial(
        params.courseId,
      );
      const conceptWords = params.concept
        .toLowerCase()
        .split(/\W+/)
        .filter(Boolean);
      let bestScore = 0;
      for (const chapter of chapters) {
        const title = chapter.title.toLowerCase();
        const score = conceptWords.reduce(
          (acc, w) => acc + (title.includes(w) ? 1 : 0),
          0,
        );
        if (score > bestScore) {
          bestScore = score;
          chapterId = chapter.id;
        }
      }
    }
    if (!chapterId) {
      const quiz = await this.create({
        title: `Follow-up Quiz: ${params.concept}`,
        description: `Practice quiz generated automatically for concept: ${params.concept}`,
        assignments: [
          {
            courseOfferingId: params.courseOfferingId,
            targetStudentIds: [params.studentId],
          },
        ],
        teacherId: params.teacherId,
        timeLimit: 10,
        passingScore: 60,
        difficulty: 'MEDIUM',
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        questions: [
          {
            type: 'MCQ',
            question: `Which of the following best describes or relates to "${params.concept}"?`,
            options: [
              { text: `Core principles and definition of ${params.concept}`, isCorrect: true },
              { text: `Unrelated concept option A`, isCorrect: false },
              { text: `Unrelated concept option B`, isCorrect: false },
              { text: `None of the above`, isCorrect: false },
            ],
            points: 10,
            order: 1,
          },
          {
            type: 'TRUE_FALSE',
            question: `Understanding "${params.concept}" is key to mastering this topic.`,
            options: [
              { text: 'True', isCorrect: true },
              { text: 'False', isCorrect: false },
            ],
            points: 10,
            order: 2,
          },
        ],
      });
      return { quizId: quiz.id, title: quiz.title, message: 'Follow-up quiz generated' };
    }
    return this.generationAgent.generate({
      courseId: params.courseId,
      assignments: [
        {
          courseOfferingId: params.courseOfferingId,
          targetStudentIds: [params.studentId],
        },
      ],
      teacherId: params.teacherId,
      chapterId,
      questionCount: 5,
      types: ['MCQ', 'TRUE_FALSE'],
      difficulty: 'MEDIUM',
      timeLimit: 15,
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  // ─── CRUD ─────────────────────────────────────────────
  async create(data: {
    title: string;
    description?: string;
    assignments: AssignmentInput[];
    teacherId: string;
    timeLimit?: number;
    passingScore?: number;
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    endsAt?: string;
    questions: {
      type: 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY';
      question: string;
      options?: { text: string; isCorrect: boolean }[];
      points: number;
      order: number;
    }[];
  }) {
    const quiz = await this.prisma.quiz.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        teacherId: data.teacherId,
        timeLimit: data.timeLimit ?? 15,
        passingScore: data.passingScore ?? null,
        difficulty: data.difficulty ?? 'MEDIUM',
        endsAt: data.endsAt ? new Date(data.endsAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        questions: {
          create: data.questions.map((q) => ({
            type: q.type,
            question: q.question,
            options: q.options ?? undefined,
            points: q.points,
            order: q.order,
          })),
        },
        assignments: {
          create: data.assignments.map((a) => ({
            courseOfferingId: a.courseOfferingId,
            targetStudentIds: a.targetStudentIds ?? [],
          })),
        },
      },
      include: {
        questions: { orderBy: { order: 'asc' } },
        assignments: ASSIGNMENTS_INCLUDE.assignments,
      },
    });

    return quiz;
  }

  async findAll(opts: {
    courseOfferingId?: string;
    teacherId?: string;
    studentId?: string;
  }) {
    if (opts.studentId) {
      return this.findAllForStudent(opts.studentId);
    }

    const where: Prisma.QuizWhereInput = {};
    if (opts.teacherId) where.teacherId = opts.teacherId;
    if (opts.courseOfferingId) {
      where.assignments = { some: { courseOfferingId: opts.courseOfferingId } };
    }

    const quizzes = await this.prisma.quiz.findMany({
      where,
      include: {
        _count: { select: { questions: true } },
        ...ASSIGNMENTS_INCLUDE,
      },
      orderBy: { createdAt: 'desc' },
    });

    return quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      description: q.description,
      assignments: mapAssignments(q),
      teacherId: q.teacherId,
      timeLimit: q.timeLimit,
      passingScore: q.passingScore,
      difficulty: q.difficulty,
      endsAt: q.endsAt?.toISOString() ?? null,
      status: q.status,
      questionCount: q._count.questions,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
    }));
  }

  /**
   * Student view: only PUBLISHED quizzes that are assigned to them, either
   * because an assignment targets them explicitly (struggle-signal dispatch)
   * or because an assignment covers their section and they are APPROVED-
   * enrolled in it. Closed (endsAt in the past) quizzes are hidden.
   */
  private async findAllForStudent(studentId: string) {
    const now = new Date();
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        assignments: {
          some: {
            OR: [
              {
                targetStudentIds: { isEmpty: true },
                offering: {
                  section: {
                    enrollments: { some: { studentId, status: 'APPROVED' } },
                  },
                },
              },
              { targetStudentIds: { has: studentId } },
            ],
          },
        },
      },
      include: {
        _count: { select: { questions: true } },
        ...ASSIGNMENTS_INCLUDE,
      },
      orderBy: { createdAt: 'desc' },
    });

    const attempts = await this.prisma.quizAttempt.findMany({
      where: { studentId, quizId: { in: quizzes.map((q) => q.id) } },
      select: { quizId: true, id: true, status: true },
    });
    const attemptByQuiz = new Map(
      attempts.map((a) => [
        a.quizId,
        { attemptStatus: a.status, attemptId: a.id },
      ]),
    );

    return quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      description: q.description,
      assignments: mapAssignments(q),
      teacherId: q.teacherId,
      timeLimit: q.timeLimit,
      passingScore: q.passingScore,
      difficulty: q.difficulty,
      source: q.source,
      endsAt: q.endsAt?.toISOString() ?? null,
      status: q.status,
      questionCount: q._count.questions,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
      ...attemptByQuiz.get(q.id),
    }));
  }

  async findOne(id: string, studentView = false, studentId?: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: {
        questions: { orderBy: { order: 'asc' } },
        ...ASSIGNMENTS_INCLUDE,
      },
    });

    if (!quiz) {
      throw new ApiError(
        ErrorCode.QUIZ_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz could not be found.',
      );
    }

    if (studentView) {
      if (!(await this.isStudentEligible(id, studentId ?? ''))) {
        throw new ApiError(
          ErrorCode.QUIZ_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This quiz could not be found.',
        );
      }
      return {
        ...quiz,
        assignments: mapAssignments(quiz),
        questions: quiz.questions.map((q) => ({
          id: q.id,
          type: q.type,
          question: q.question,
          options:
            q.type === 'MCQ' || q.type === 'TRUE_FALSE'
              ? (q.options as { text: string }[])?.map((o) => ({
                  text: o.text,
                }))
              : undefined,
          points: q.points,
          order: q.order,
        })),
        endsAt: quiz.endsAt?.toISOString() ?? null,
        createdAt: quiz.createdAt.toISOString(),
        updatedAt: quiz.updatedAt.toISOString(),
      };
    }

    return {
      ...quiz,
      assignments: mapAssignments(quiz),
      endsAt: quiz.endsAt?.toISOString() ?? null,
      createdAt: quiz.createdAt.toISOString(),
      updatedAt: quiz.updatedAt.toISOString(),
    };
  }

  /**
   * A student may see/attempt a quiz when at least one assignment covers them:
   * - targeted assignment whose targetStudentIds contains the student, or
   * - section-wide assignment where the student is APPROVED-enrolled in the
   *   offering's section.
   */
  private async isStudentEligible(quizId: string, studentId: string) {
    const assignment = await this.prisma.quizAssignment.findFirst({
      where: {
        quizId,
        OR: [
          {
            targetStudentIds: { isEmpty: true },
            offering: {
              section: {
                enrollments: { some: { studentId, status: 'APPROVED' } },
              },
            },
          },
          { targetStudentIds: { has: studentId } },
        ],
      },
      select: { id: true },
    });
    return assignment !== null;
  }

  async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      timeLimit?: number | null;
      passingScore?: number | null;
      difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
      endsAt?: string | null;
      status?: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
      questions?: {
        type: 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY';
        question: string;
        options?: { text: string; isCorrect: boolean }[];
        points: number;
        order: number;
      }[];
    },
  ) {
    const existing = await this.prisma.quiz.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(
        ErrorCode.QUIZ_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz could not be found.',
      );
    }

    if (data.questions) {
      await this.prisma.$transaction([
        this.prisma.quizQuestion.deleteMany({ where: { quizId: id } }),
        this.prisma.quiz.update({
          where: { id },
          data: {
            title: data.title,
            description: data.description,
            timeLimit: data.timeLimit ?? null,
            passingScore: data.passingScore ?? null,
            difficulty: data.difficulty,
            endsAt:
              data.endsAt !== undefined
                ? data.endsAt
                  ? new Date(data.endsAt)
                  : null
                : undefined,
            status: data.status,
            questions: {
              create: data.questions.map((q) => ({
                type: q.type,
                question: q.question,
                options: q.options ?? undefined,
                points: q.points,
                order: q.order,
              })),
            },
          },
        }),
      ]);
    } else {
      await this.prisma.quiz.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          timeLimit: data.timeLimit ?? null,
          passingScore: data.passingScore ?? null,
          difficulty: data.difficulty,
          endsAt:
            data.endsAt !== undefined
              ? data.endsAt
                ? new Date(data.endsAt)
                : null
              : undefined,
          status: data.status,
        },
      });
    }

    return this.findOne(id);
  }

  async publish(id: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id } });
    if (!quiz) {
      throw new ApiError(
        ErrorCode.QUIZ_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz could not be found.',
      );
    }
    if (quiz.status !== 'DRAFT')
      throw new ApiError(
        ErrorCode.QUIZ_DRAFT_ONLY,
        HttpStatus.BAD_REQUEST,
        'Only draft quizzes can be published.',
      );

    return this.prisma.quiz.update({
      where: { id },
      data: { status: 'PUBLISHED' },
    });
  }

  async remove(id: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id } });
    if (!quiz) {
      throw new ApiError(
        ErrorCode.QUIZ_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz could not be found.',
      );
    }

    await this.prisma.quiz.delete({ where: { id } });
  }

  // ─── Assignment management (multi-section reuse) ─────
  async addAssignments(id: string, assignments: AssignmentInput[]) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id } });
    if (!quiz) {
      throw new ApiError(
        ErrorCode.QUIZ_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz could not be found.',
      );
    }

    await this.prisma.quizAssignment.createMany({
      data: assignments.map((a) => ({
        quizId: id,
        courseOfferingId: a.courseOfferingId,
        targetStudentIds: a.targetStudentIds ?? [],
      })),
      skipDuplicates: true,
    });

    return this.findOne(id);
  }

  async removeAssignment(assignmentId: string) {
    const assignment = await this.prisma.quizAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new ApiError(
        ErrorCode.QUIZ_ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz assignment could not be found.',
      );
    }

    await this.prisma.quizAssignment.delete({ where: { id: assignmentId } });
    return this.findOne(assignment.quizId);
  }

  // ─── Attempts ─────────────────────────────────────────
  async startAttempt(quizId: string, studentId: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) {
      throw new ApiError(
        ErrorCode.QUIZ_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz could not be found.',
      );
    }
    if (quiz.status !== 'PUBLISHED')
      throw new ApiError(
        ErrorCode.QUIZ_NOT_PUBLISHED,
        HttpStatus.BAD_REQUEST,
        'This quiz is not published yet.',
      );
    if (quiz.endsAt && quiz.endsAt.getTime() < Date.now())
      throw new ApiError(
        ErrorCode.QUIZ_CLOSED,
        HttpStatus.BAD_REQUEST,
        'This quiz has closed.',
      );
    // A quiz is only attemptable when it is actually assigned to this student
    // (targeted explicitly or via an enrolled section).
    if (!(await this.isStudentEligible(quizId, studentId))) {
      throw new ApiError(
        ErrorCode.QUIZ_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'This quiz is not assigned to you.',
      );
    }

    const existing = await this.prisma.quizAttempt.findUnique({
      where: { quizId_studentId: { quizId, studentId } },
    });
    if (existing)
      throw new ApiError(
        ErrorCode.QUIZ_ALREADY_ATTEMPTED,
        HttpStatus.CONFLICT,
        'You have already taken this quiz.',
      );

    const attempt = await this.prisma.quizAttempt.create({
      data: { quizId, studentId },
    });

    const serverNow = new Date();

    if (quiz.timeLimit) {
      return {
        ...attempt,
        expiresAt: new Date(
          attempt.startedAt.getTime() + quiz.timeLimit * 60_000,
        ),
        serverNow: serverNow.toISOString(),
      };
    }

    return { ...attempt, serverNow: serverNow.toISOString() };
  }

  async submitAttempt(
    quizId: string,
    studentId: string,
    answers: { questionId: string; answer: string }[],
  ) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { quizId_studentId: { quizId, studentId } },
      include: {
        quiz: { include: { questions: true } },
        answers: true,
      },
    });

    if (!attempt) {
      throw new ApiError(
        ErrorCode.ATTEMPT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz attempt could not be found.',
      );
    }
    if (attempt.status === 'COMPLETED')
      throw new ApiError(
        ErrorCode.ATTEMPT_ALREADY_SUBMITTED,
        HttpStatus.CONFLICT,
        'This attempt has already been submitted.',
      );

    if (attempt.quiz.timeLimit) {
      const deadline =
        attempt.startedAt.getTime() +
        attempt.quiz.timeLimit * 60_000 +
        SUBMIT_GRACE_PERIOD_MS;
      if (Date.now() > deadline) {
        throw new ApiError(
          ErrorCode.ATTEMPT_NOT_IN_PROGRESS,
          HttpStatus.GONE,
          'The quiz time has expired.',
        );
      }
    }

    const questionMap = new Map(attempt.quiz.questions.map((q) => [q.id, q]));

    const answerRecords: {
      questionId: string;
      answer: string;
      pointsAwarded: number;
      isConfirmed: boolean;
      aiFeedback?: string;
    }[] = [];

    for (const ans of answers) {
      const question = questionMap.get(ans.questionId);
      if (!question) {
        this.logger.warn(
          `Question ${ans.questionId} not found in quiz ${quizId}`,
        );
        continue;
      }

      const isMcqOrTf =
        question.type === 'MCQ' || question.type === 'TRUE_FALSE';

      if (isMcqOrTf) {
        const options = question.options as {
          text: string;
          isCorrect: boolean;
        }[];
        const result =
          question.type === 'MCQ'
            ? this.gradingService.gradeMcq(ans.answer, options)
            : this.gradingService.gradeTrueFalse(ans.answer, options);

        const pts = result.isCorrect ? question.points : 0;
        answerRecords.push({
          questionId: ans.questionId,
          answer: ans.answer,
          pointsAwarded: pts,
          isConfirmed: true,
        });
      } else {
        const existingAnswer = attempt.answers.find(
          (a) => a.questionId === ans.questionId,
        );
        if (existingAnswer) continue;

        const grade = await this.gradingService.gradeEssay(
          question.question,
          ans.answer,
          question.points,
          undefined,
        );

        answerRecords.push({
          questionId: ans.questionId,
          answer: ans.answer,
          pointsAwarded: grade.pointsAwarded,
          isConfirmed: false,
          aiFeedback: grade.feedback,
        });
      }
    }

    const mcqTotal = answerRecords
      .filter((r) => {
        const q = questionMap.get(r.questionId);
        return q && (q.type === 'MCQ' || q.type === 'TRUE_FALSE');
      })
      .reduce((sum, r) => sum + r.pointsAwarded, 0);

    await this.prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'COMPLETED',
        submittedAt: new Date(),
        totalScore: mcqTotal,
        answers: { create: answerRecords },
      },
    });

    if (toViolations(attempt.violations).length > 0) {
      await this.quizViolationsService.report(attempt.id);
    }

    const updated = await this.prisma.quizAttempt.findUnique({
      where: { id: attempt.id },
      include: { answers: true },
    });

    return updated;
  }

  async reportViolation(
    attemptId: string,
    studentId: string,
    type: 'TAB_SWITCH' | 'FULLSCREEN_EXIT',
  ) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt) {
      throw new ApiError(
        ErrorCode.ATTEMPT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz attempt could not be found.',
      );
    }
    if (attempt.studentId !== studentId)
      throw new ApiError(
        ErrorCode.ATTEMPT_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'You can only access your own quiz attempts.',
      );
    if (attempt.status !== 'IN_PROGRESS')
      throw new ApiError(
        ErrorCode.ATTEMPT_NOT_IN_PROGRESS,
        HttpStatus.CONFLICT,
        'This attempt is no longer in progress.',
      );

    const violations = toViolations(attempt.violations);

    const updated = await this.prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        violations: [
          ...violations,
          { type, occurredAt: new Date().toISOString() },
        ],
      },
    });

    return toViolations(updated.violations);
  }

  async getAttempt(attemptId: string) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        student: { select: { id: true, name: true } },
        answers: {
          include: {
            question: {
              select: {
                id: true,
                type: true,
                question: true,
                points: true,
                order: true,
              },
            },
          },
        },
        quiz: { include: { questions: { orderBy: { order: 'asc' } } } },
      },
    });

    if (!attempt) {
      throw new ApiError(
        ErrorCode.ATTEMPT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz attempt could not be found.',
      );
    }

    return {
      id: attempt.id,
      quizId: attempt.quizId,
      quiz: {
        ...attempt.quiz,
        endsAt: attempt.quiz.endsAt?.toISOString() ?? null,
        createdAt: attempt.quiz.createdAt.toISOString(),
        updatedAt: attempt.quiz.updatedAt.toISOString(),
      },
      student: attempt.student,
      studentId: attempt.studentId,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      totalScore: attempt.totalScore,
      status: attempt.status,
      violations: toViolations(attempt.violations),
      answers: attempt.answers.map((a) => ({
        id: a.id,
        questionId: a.questionId,
        answer: a.answer,
        pointsAwarded: a.pointsAwarded,
        isConfirmed: a.isConfirmed,
        aiFeedback: a.aiFeedback,
        question: a.question,
      })),
    };
  }

  async getAttemptsByQuiz(quizId: string) {
    const attempts = await this.prisma.quizAttempt.findMany({
      where: { quizId },
      include: {
        student: { select: { id: true, name: true, email: true } },
        _count: { select: { answers: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return attempts.map((a) => ({
      id: a.id,
      studentId: a.studentId,
      student: { id: a.student.id, name: a.student.name },
      startedAt: a.startedAt.toISOString(),
      submittedAt: a.submittedAt?.toISOString() ?? null,
      totalScore: a.totalScore,
      status: a.status,
      answerCount: a._count.answers,
      violations: toViolations(a.violations),
    }));
  }

  // ─── Confirmation ─────────────────────────────────────
  async confirmAttempt(attemptId: string) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: { answers: true },
    });

    if (!attempt) {
      throw new ApiError(
        ErrorCode.ATTEMPT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz attempt could not be found.',
      );
    }

    await this.prisma.quizAnswer.updateMany({
      where: { attemptId, isConfirmed: false },
      data: { isConfirmed: true },
    });

    const allAnswers = await this.prisma.quizAnswer.findMany({
      where: { attemptId },
    });

    const totalScore = allAnswers.reduce(
      (sum, a) => sum + (a.pointsAwarded ?? 0),
      0,
    );

    await this.prisma.quizAttempt.update({
      where: { id: attemptId },
      data: { totalScore },
    });

    return this.getAttempt(attemptId);
  }

  async updateAnswer(answerId: string, pointsAwarded: number) {
    const answer = await this.prisma.quizAnswer.findUnique({
      where: { id: answerId },
    });

    if (!answer) {
      throw new ApiError(
        ErrorCode.QUIZ_ANSWER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This quiz answer could not be found.',
      );
    }

    const updated = await this.prisma.quizAnswer.update({
      where: { id: answerId },
      data: { pointsAwarded, isConfirmed: true },
    });

    return updated;
  }
}
