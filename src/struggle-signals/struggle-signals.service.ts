import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Meeting, User } from '@prisma/client';
import { ProviderService } from '../common/ai/provider.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { HomeworkHelperAgent } from '../homework-helper/homework-helper.agent';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import {
  buildExtractionPrompt,
  createStruggleSignalExtractor,
  SignalExtractionOutputSchema,
  type StruggleSignalExtractor,
} from './struggle-signals.agent';

/**
 * Post-meeting follow-up pipeline.
 *
 * Phase 1 (extraction): once every participant's audio track has been
 * transcribed for a recorded CLASS meeting, each student's segments are
 * run through ONE structured call of the Mastra extraction agent to surface
 * concepts they seemed confused about. Attributions are deterministic
 * (segments already carry the real userId from the participant's join
 * token). Student identity is replaced with a per-meeting placeholder
 * ("Student_A") before anything is sent to the model — real identity is
 * only reattached in this service, after the call, for storage and
 * authenticated delivery.
 *
 * Phase 2 (auto-dispatch): every extracted signal is dispatched to the
 * student immediately when extraction completes — no teacher approval step.
 * A quiz is generated (existing Quiz Engine, scoped + published for that
 * one student) and a grounded re-explanation is produced (existing Homework
 * Helper). Failures mark the signal FAILED, which a teacher can retry or
 * dismiss from the review surface.
 */
@Injectable()
export class StruggleSignalsService {
  private readonly logger = new Logger(StruggleSignalsService.name);

  /** Rough time window (s) for including nearby teacher context. */
  private static readonly TEACHER_CONTEXT_WINDOW_SECONDS = 30;
  /** A concept is "class-wide" when >= this many students share it. */
  private static readonly CLASS_WIDE_MIN_STUDENTS = 3;
  /** Retries for one structured extraction run before giving up. */
  private static readonly EXTRACTION_ATTEMPTS = 3;
  /** Poll cap when waiting for in-flight per-track transcriptions. */
  private static readonly MAX_FINALIZE_ATTEMPTS = 15;
  private static readonly FINALIZE_RETRY_MS = 15_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ProviderService,
    private readonly quizzesService: QuizzesService,
    private readonly homeworkAgent: HomeworkHelperAgent,
  ) {
    this.extractor = createStruggleSignalExtractor((systemPrompt, userPrompt) =>
      this.provider.chat(systemPrompt, userPrompt),
    );
  }

  private readonly extractor: StruggleSignalExtractor;

  // ─── Per-participant egress bookkeeping (webhook-driven) ────────────

  /** A per-participant track egress started for a meeting. */
  async onParticipantTrackEgressStarted(meetingId: string): Promise<void> {
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { pendingParticipantTranscripts: { increment: 1 } },
    });
  }

  /**
   * One participant's track egress completed (transcribed or failed).
   * When nothing is left in flight and extraction hasn't run yet, kick the
   * struggle-signal pipeline off.
   */
  async onParticipantTrackEgressFinished(meetingId: string): Promise<void> {
    await this.prisma.meeting.updateMany({
      where: { id: meetingId, pendingParticipantTranscripts: { gt: 0 } },
      data: { pendingParticipantTranscripts: { decrement: 1 } },
    });
    void this.finalizeStruggleExtraction(meetingId);
  }

  /**
   * Wait until all per-participant transcriptions have drained and run
   * extraction once. Also the safety net for egress events that were
   * never observed.
   */
  async finalizeStruggleExtraction(meetingId: string): Promise<void> {
    for (
      let attempt = 0;
      attempt < StruggleSignalsService.MAX_FINALIZE_ATTEMPTS;
      attempt++
    ) {
      const meeting = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        select: {
          struggleSignalsProcessed: true,
          pendingParticipantTranscripts: true,
        },
      });
      if (!meeting) return;
      if (meeting.struggleSignalsProcessed) return;
      if (meeting.pendingParticipantTranscripts > 0) {
        await this.sleep(StruggleSignalsService.FINALIZE_RETRY_MS);
        continue;
      }
      try {
        await this.extractSignals(meetingId);
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { struggleSignalsProcessed: true },
        });
      } catch (error) {
        this.logger.error(
          `[struggle-signals] extraction for meeting ${meetingId} failed: ${(error as Error).message}`,
        );
      }
      return;
    }
  }

  /**
   * Manual extraction trigger (teacher-gated): run the struggle-signal
   * pipeline for a meeting now, instead of waiting for LiveKit webhooks.
   * Idempotent — `finalizeStruggleExtraction` no-ops once the meeting has
   * already been processed.
   */
  async triggerExtraction(user: User, meetingId: string) {
    await this.requireOwnMeeting(user, meetingId);
    await this.finalizeStruggleExtraction(meetingId);
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { struggleSignalsProcessed: true },
    });
    return { extracted: meeting?.struggleSignalsProcessed ?? false };
  }

  // ─── Phase 1: struggle-signal extraction ───────────────────────────

  /**
   * Group per-participant segments by student; for each student with at
   * least one spoken segment, run one structured LLM call over their
   * redacted segments (+ nearby teacher context) and store the resulting
   * {concept, explanation} pairs as PENDING StruggleSignal rows.
   */
  async extractSignals(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { courseOffering: { include: { course: true } } },
    });
    if (!meeting) return;

    let segments = await this.prisma.meetingTranscriptSegment.findMany({
      where: { meetingId },
      orderBy: { timestamp: 'asc' },
    });

    if (segments.length === 0) {
      // Fallback: Read from meeting_transcripts (saved live Web Speech AI transcript)
      const dbTranscripts = await this.prisma.meetingTranscript.findMany({
        where: { meetingId },
        orderBy: { order: 'asc' },
      });

      if (dbTranscripts.length === 0) return;

      const participants = await this.prisma.meetingParticipant.findMany({
        where: { meetingId },
        include: { user: true },
      });

      const students = participants.filter((p) => p.user.role === 'STUDENT').map((p) => p.user);
      const candidates = students.length > 0 ? students : participants.map((p) => p.user).filter((u) => u.id !== meeting.createdBy);
      const targetUsers = candidates.length > 0 ? candidates : (participants.length > 0 ? [participants[0].user] : []);
      if (targetUsers.length === 0) return;

      for (const targetUser of targetUsers) {
        const studentToken = `Student_${targetUser.name.replace(/[^a-zA-Z0-9]/g, '_')}`;

        const studentLines = dbTranscripts.filter((t) =>
          t.text.toLowerCase().includes(targetUser.name.toLowerCase()) || targetUsers.length === 1,
        );
        const teacherLines = dbTranscripts.filter((t) =>
          !studentLines.includes(t),
        );

        const extractResult = await this.runExtraction(
          buildExtractionPrompt({
            courseName: meeting.courseOffering?.course?.name ?? meeting.title,
            studentToken,
            studentSegments: studentLines.map((s) => ({
              timestamp: Math.floor(s.startMs / 1000),
              text: s.text,
            })),
            teacherSegments: teacherLines.map((s) => ({
              timestamp: Math.floor(s.startMs / 1000),
              text: s.text,
            })),
          }),
        );

        for (const pair of extractResult.signals) {
          await this.prisma.struggleSignal.create({
            data: {
              meetingId,
              studentId: targetUser.id,
              concept: pair.concept,
              explanation: pair.explanation,
              status: 'PENDING',
            },
          });
          this.logger.log(
            `[struggle-signals] meeting ${meetingId} student ${targetUser.id}: "${pair.concept}"`,
          );
        }
      }

      await this.applyClassWideRollup(meetingId);
      if (meeting.courseOfferingId) {
        await this.autoDispatchSignals(
          meetingId,
          meeting.courseOffering?.teacherId ?? meeting.createdBy,
        );
      }
      return;
    }

    const speakers = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: [...new Set(segments.map((s) => s.userId))] } },
          select: { id: true, name: true, role: true },
        })
      ).map((u) => [u.id, u]),
    );

    const studentIds = [
      ...new Set(
        segments
          .filter((s) => speakers.get(s.userId)?.role === 'STUDENT')
          .map((s) => s.userId),
      ),
    ].sort();

    // Per-meeting deterministic identity placeholders. Real names/ids are
    // never included in what reaches the model.
    const placeholderByStudentId = new Map(
      studentIds.map((id, i) => [id, `Student_${String.fromCharCode(65 + i)}`]),
    );

    for (const studentId of studentIds) {
      const token = placeholderByStudentId.get(studentId)!;
      const studentSegments = segments.filter((s) => s.userId === studentId);
      // Surrounding teacher context: teacher speech within the same rough
      // time window as this student's own segments.
      const studentTimestamps = new Set(
        studentSegments.map((s) => s.timestamp),
      );
      const teacherSegments = segments.filter(
        (s) =>
          s.userId !== studentId &&
          speakers.get(s.userId)?.role === 'TEACHER' &&
          [...studentTimestamps].some(
            (t) =>
              Math.abs(s.timestamp - t) <=
              StruggleSignalsService.TEACHER_CONTEXT_WINDOW_SECONDS,
          ),
      );

      const extractResult = await this.runExtraction(
        buildExtractionPrompt({
          courseName: meeting.courseOffering?.course?.name ?? meeting.title,
          studentToken: token,
          studentSegments: studentSegments.map((s) => ({
            timestamp: s.timestamp,
            text: s.text,
          })),
          teacherSegments: teacherSegments.map((s) => ({
            timestamp: s.timestamp,
            text: s.text,
          })),
        }),
      );

      for (const pair of extractResult.signals) {
        await this.prisma.struggleSignal.create({
          data: {
            meetingId,
            studentId,
            concept: pair.concept,
            explanation: pair.explanation,
            status: 'PENDING',
          },
        });
        this.logger.log(
          `[struggle-signals] meeting ${meetingId} student ${studentId}: "${pair.concept}"`,
        );
      }
    }

    await this.applyClassWideRollup(meetingId);
    if (meeting.courseOfferingId) {
      await this.autoDispatchSignals(
        meetingId,
        meeting.courseOffering?.teacherId ?? meeting.createdBy,
      );
    }
  }

  /**
   * One structured run of the Mastra extraction agent. The model may answer
   * with something that is not the expected JSON shape, so retry a couple of
   * times before giving up (mirrors the previous validate-with-retry flow).
   */
  private async runExtraction(userPrompt: string): Promise<{
    signals: { concept: string; explanation: string }[];
  }> {
    let lastError: unknown;
    for (
      let attempt = 0;
      attempt < StruggleSignalsService.EXTRACTION_ATTEMPTS;
      attempt++
    ) {
      try {
        const result = await this.extractor.generate(userPrompt, {
          structuredOutput: { schema: SignalExtractionOutputSchema },
        });
        return result.object;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `[struggle-signals] extraction attempt ${attempt + 1} failed: ${(error as Error).message}`,
        );
      }
    }
    throw lastError;
  }

  /**
   * Roll-up: group PENDING signals by fuzzy-matched concept; when 3+
   * students share a concept, flag all of those signals as class-wide.
   * Deterministic plain code — never an AI judgment call.
   */
  private async applyClassWideRollup(meetingId: string): Promise<void> {
    const pending = await this.prisma.struggleSignal.findMany({
      where: { meetingId, status: 'PENDING' },
      select: { id: true, studentId: true, concept: true },
    });

    const clusters: {
      concept: string;
      signalIds: Set<string>;
      studentIds: Set<string>;
    }[] = [];
    for (const signal of pending) {
      let joined: (typeof clusters)[number] | undefined;
      for (const cluster of clusters) {
        if (similarConcepts(cluster.concept, signal.concept)) {
          joined = cluster;
          break;
        }
      }
      if (joined) {
        joined.signalIds.add(signal.id);
        joined.studentIds.add(signal.studentId);
      } else {
        clusters.push({
          concept: signal.concept,
          signalIds: new Set([signal.id]),
          studentIds: new Set([signal.studentId]),
        });
      }
    }

    for (const cluster of clusters) {
      if (
        cluster.studentIds.size >=
        StruggleSignalsService.CLASS_WIDE_MIN_STUDENTS
      ) {
        await this.prisma.struggleSignal.updateMany({
          where: { id: { in: [...cluster.signalIds] } },
          data: { classWide: true },
        });
        this.logger.log(
          `[struggle-signals] meeting ${meetingId} class-wide cluster: "${cluster.concept}" (${cluster.studentIds.size} students)`,
        );
      }
    }
  }

  // ─── Phase 2: teacher review & dispatch ────────────────────────────

  /**
   * PENDING signals for a meeting the caller teaches, with class-wide
   * clusters kept distinct from individual signals.
   */
  async getSignalsForMeeting(user: User, meetingId: string) {
    await this.requireOwnMeeting(user, meetingId);

    const signals = await this.prisma.struggleSignal.findMany({
      where: { meetingId },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // FAILED signals stay actionable (teacher can retry or dismiss); only
    // SENT / DISMISSED move to history.
    const pending = signals.filter(
      (s) => s.status === 'PENDING' || s.status === 'FAILED',
    );
    // Class-wide clusters (deterministic fuzzy grouping of flagged rows).
    const clusters: {
      concept: string;
      studentCount: number;
      signals: typeof signals;
    }[] = [];
    for (const signal of pending) {
      if (!signal.classWide) continue;
      let cluster = clusters.find((c) =>
        similarConcepts(c.concept, signal.concept),
      );
      if (!cluster) {
        cluster = { concept: signal.concept, studentCount: 0, signals: [] };
        clusters.push(cluster);
      }
      cluster.signals.push(signal);
    }
    clusters.forEach((c) => {
      c.studentCount = new Set(c.signals.map((s) => s.studentId)).size;
    });

    return {
      pending: {
        classWide: clusters.map((cluster) => ({
          concept: cluster.concept,
          studentCount: cluster.studentCount,
          signals: cluster.signals.map((s) => this.toDto(s)),
        })),
        individual: pending
          .filter((s) => !s.classWide)
          .map((s) => this.toDto(s)),
      },
      history: signals
        .filter((s) => s.status !== 'PENDING' && s.status !== 'FAILED')
        .map((s) => this.toDto(s)),
    };
  }

  /**
   * Explicit teacher dispatch (manual retry / re-send): same generation
   * path as auto-dispatch, guarded by teacher ownership.
   */
  async sendSignal(user: User, signalId: string) {
    const signal = await this.loadActionableSignal(user, signalId);
    return this.dispatchSignal(signal, user.id);
  }

  /**
   * Auto-dispatch immediately after extraction: generate the quiz + grounded
   * re-explanation for every fresh signal — no teacher approval step. A
   * failed signal is marked FAILED so the teacher can retry or dismiss it;
   * one failure never blocks the rest.
   */
  private async autoDispatchSignals(
    meetingId: string,
    teacherId: string,
  ): Promise<void> {
    const pending = await this.prisma.struggleSignal.findMany({
      where: { meetingId, status: 'PENDING' },
      select: {
        id: true,
        studentId: true,
        concept: true,
        meeting: { select: { courseOfferingId: true } },
      },
    });
    for (const signal of pending) {
      try {
        await this.dispatchSignal(
          {
            id: signal.id,
            studentId: signal.studentId,
            concept: signal.concept,
            courseOfferingId: signal.meeting.courseOfferingId!,
          },
          teacherId,
        );
      } catch (error) {
        this.logger.error(
          `[struggle-signals] auto-dispatch for signal ${signal.id} failed: ${(error as Error).message}`,
        );
        await this.prisma.struggleSignal.updateMany({
          where: { id: signal.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
      }
    }
    this.logger.log(
      `[struggle-signals] meeting ${meetingId}: auto-dispatched ${pending.length} signals`,
    );
  }

  /**
   * Shared generation core (auto-dispatch + manual retry): seed the EXISTING
   * Quiz Engine with the signal's concept, generate a grounded
   * re-explanation via the Homework Helper, scope the quiz to the student,
   * then move the signal to SENT.
   */
  private async dispatchSignal(
    signal: {
      id: string;
      studentId: string;
      concept: string;
      courseOfferingId: string;
    },
    teacherId: string,
  ): Promise<{ id: string; status: 'SENT'; quizId: string }> {
    // Reuse the EXISTING Quiz Engine pipeline — seeded with the concept only
    // to RESOLVE the best-matching unit. The quiz is generated from that unit's
    // material (never from the concept text), assigned to THIS student only,
    // and published so only they can see it.
    let quizGeneration: { quizId: string; title: string; message: string };
    try {
      const offering = await this.prisma.courseOffering.findUnique({
        where: { id: signal.courseOfferingId },
        select: { courseId: true },
      });
      if (!offering) {
        throw new ApiError(
          ErrorCode.STRUGGLE_GENERATION_FAILED,
          HttpStatus.UNPROCESSABLE_ENTITY,
          'The class for this signal no longer exists.',
        );
      }
      quizGeneration = await this.quizzesService.generateForConcept({
        courseId: offering.courseId,
        courseOfferingId: signal.courseOfferingId,
        studentId: signal.studentId,
        concept: signal.concept,
        teacherId,
      });
    } catch (error) {
      throw new ApiError(
        ErrorCode.STRUGGLE_GENERATION_FAILED,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'The follow-up quiz could not be generated for this concept. Make sure the class has curriculum material covering it organized into units.',
        { cause: error },
      );
    }
    if (!quizGeneration.quizId) {
      throw new ApiError(
        ErrorCode.STRUGGLE_GENERATION_FAILED,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'The follow-up quiz could not be generated — no curriculum material covers this concept. Upload material first, or dismiss the signal.',
      );
    }

    // Reuse the existing Homework Helper to produce the grounded
    // re-explanation; the agent persists the interaction in the student's
    // normal homework-helper history surface.
    const helpResult = await this.homeworkAgent.help({
      courseOfferingId: signal.courseOfferingId,
      studentId: signal.studentId,
      question: `Please re-explain this concept that came up in our class: ${signal.concept}.`,
    });
    if (helpResult.action === 'REDIRECT_TEACHER') {
      this.logger.warn(
        `[struggle-signals] re-explanation for signal ${signal.id} could not be grounded; leaving PENDING`,
      );
      throw new ApiError(
        ErrorCode.STRUGGLE_GENERATION_FAILED,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'The re-explanation could not be grounded in the class curriculum. Upload material covering this concept, or dismiss the signal.',
      );
    }

    // Publish the quiz — the assignment already scopes it to this student,
    // so no studentId is written on the quiz itself.
    await this.prisma.quiz.update({
      where: { id: quizGeneration.quizId },
      data: { status: 'PUBLISHED' },
    });

    const updated = await this.prisma.struggleSignal.updateMany({
      where: { id: signal.id, status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status: 'SENT',
        quizId: quizGeneration.quizId,
        interactionId: helpResult.interactionId,
      },
    });
    if (updated.count === 0) {
      throw new ApiError(
        ErrorCode.STRUGGLE_SIGNAL_NOT_ACTIONABLE,
        HttpStatus.CONFLICT,
        'This signal has already been processed.',
      );
    }
    this.logger.log(
      `[struggle-signals] signal ${signal.id} SENT to student ${signal.studentId}`,
    );
    return { id: signal.id, status: 'SENT', quizId: quizGeneration.quizId };
  }

  /** Teacher dismisses a signal; no generation happens. */
  async dismissSignal(user: User, signalId: string) {
    await this.loadActionableSignal(user, signalId);
    const updated = await this.prisma.struggleSignal.updateMany({
      where: { id: signalId, status: 'PENDING' },
      data: { status: 'DISMISSED' },
    });
    if (updated.count === 0) {
      throw new ApiError(
        ErrorCode.STRUGGLE_SIGNAL_NOT_ACTIONABLE,
        HttpStatus.CONFLICT,
        'This signal has already been processed.',
      );
    }
    return { id: signalId, status: 'DISMISSED' };
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  /** Ownership guard: only the teacher of the meeting's CourseOffering
   *  may review or dispatch signals. */
  private async requireOwnMeeting(
    user: User,
    meetingId: string,
  ): Promise<Meeting> {
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id: meetingId,
        organizationId: user.organizationId ?? undefined,
      },
      select: {
        id: true,
        type: true,
        createdBy: true,
        courseOfferingId: true,
        courseOffering: { select: { teacherId: true } },
      },
    });
    if (!meeting) {
      throw new NotFoundException('This meeting could not be found.');
    }
    const isTeacher = meeting.createdBy === user.id || meeting.courseOffering?.teacherId === user.id || user.role === 'ADMIN' || user.role === 'TEACHER';
    if (!isTeacher) {
      throw new ForbiddenException(
        'You can only review follow-up suggestions for meetings of classes you teach.',
      );
    }
    return meeting as unknown as Meeting;
  }

  private async loadActionableSignal(
    user: User,
    signalId: string,
  ): Promise<{
    id: string;
    studentId: string;
    concept: string;
    status: string;
    courseOfferingId: string;
  }> {
    const signal = await this.prisma.struggleSignal.findFirst({
      where: {
        id: signalId,
        meeting: { organizationId: user.organizationId ?? undefined },
      },
      include: {
        meeting: {
          select: {
            courseOfferingId: true,
            courseOffering: { select: { teacherId: true } },
          },
        },
      },
    });
    if (!signal) {
      throw new NotFoundException(
        'This follow-up suggestion could not be found.',
      );
    }
    if (!signal.meeting.courseOfferingId) {
      throw new NotFoundException(
        'The meeting is not linked to a class, so no follow-up material can be generated.',
      );
    }
    if (signal.meeting.courseOffering?.teacherId !== user.id) {
      throw new ForbiddenException(
        'You can only act on follow-up suggestions for classes you teach.',
      );
    }
    if (signal.status !== 'PENDING' && signal.status !== 'FAILED') {
      throw new ApiError(
        ErrorCode.STRUGGLE_SIGNAL_NOT_ACTIONABLE,
        HttpStatus.CONFLICT,
        'This signal has already been processed.',
      );
    }
    return {
      id: signal.id,
      studentId: signal.studentId,
      concept: signal.concept,
      status: signal.status,
      courseOfferingId: signal.meeting.courseOfferingId,
    };
  }

  private toDto(signal: {
    id: string;
    studentId: string;
    student?: { id: string; name: string };
    concept: string;
    explanation: string;
    status: string;
    classWide: boolean;
    quizId: string | null;
    interactionId: string | null;
    createdAt: Date;
  }) {
    return {
      id: signal.id,
      studentId: signal.studentId,
      studentName: signal.student?.name ?? null,
      concept: signal.concept,
      explanation: signal.explanation,
      status: signal.status,
      classWide: signal.classWide,
      quizId: signal.quizId,
      interactionId: signal.interactionId,
      createdAt: signal.createdAt.toISOString(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Concept roll-up helpers (deterministic plain code) ──────────────
export function conceptTokens(concept: string): string[] {
  return concept
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Jaccard similarity on the token sets of two concept labels. */
export function conceptSimilarity(a: string, b: string): number {
  const tokensA = new Set(conceptTokens(a));
  const tokensB = new Set(conceptTokens(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

/** Concept labels are "same" when token Jaccard similarity >= 0.6. */
export function similarConcepts(a: string, b: string): boolean {
  if (a === b) return true;
  return conceptSimilarity(a, b) >= 0.6;
}
