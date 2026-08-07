import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuizzesGradingService } from './quizzes-grading.service';
import { QuizGenerationAgent } from './agents/quiz-generation.agent';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

const SUBMIT_GRACE_PERIOD_MS = 30_000;

type ViolationRecord = { type: string; occurredAt: string };

function toViolations(value: Prisma.JsonValue | null): ViolationRecord[] {
  if (!Array.isArray(value)) return [];
  return value as ViolationRecord[];
}

@Injectable()
export class QuizzesService {
  private readonly logger = new Logger(QuizzesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingService: QuizzesGradingService,
    private readonly generationAgent: QuizGenerationAgent,
  ) {}

  // ─── AI Generation ────────────────────────────────────
  async generate(params: {
    courseOfferingId: string;
    teacherId: string;
    topic?: string;
    questionCount?: number;
    types?: ('MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY')[];
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  }) {
    return this.generationAgent.generate(params);
  }

  // ─── CRUD ─────────────────────────────────────────────
  async create(data: {
    title: string;
    description?: string;
    courseOfferingId: string;
    teacherId: string;
    timeLimit?: number;
    passingScore?: number;
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
        courseOfferingId: data.courseOfferingId,
        teacherId: data.teacherId,
        timeLimit: data.timeLimit ?? null,
        passingScore: data.passingScore ?? null,
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
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    return quiz;
  }

  async findAll(courseOfferingId?: string, teacherId?: string) {
    const where: Prisma.QuizWhereInput = {};
    if (courseOfferingId) where.courseOfferingId = courseOfferingId;
    if (teacherId) where.teacherId = teacherId;

    const quizzes = await this.prisma.quiz.findMany({
      where,
      include: { _count: { select: { questions: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      description: q.description,
      courseOfferingId: q.courseOfferingId,
      teacherId: q.teacherId,
      timeLimit: q.timeLimit,
      passingScore: q.passingScore,
      status: q.status,
      questionCount: q._count.questions,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
    }));
  }

  async findOne(id: string, studentView = false) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: {
        questions: { orderBy: { order: 'asc' } },
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
      return {
        ...quiz,
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
        createdAt: quiz.createdAt.toISOString(),
        updatedAt: quiz.updatedAt.toISOString(),
      };
    }

    return {
      ...quiz,
      createdAt: quiz.createdAt.toISOString(),
      updatedAt: quiz.updatedAt.toISOString(),
    };
  }

  async update(
    id: string,
    data: {
      title?: string;
      description?: string;
      timeLimit?: number | null;
      passingScore?: number | null;
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
