import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisService } from '../analysis/analysis.service';

@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisService: AnalysisService,
  ) {}

  async gradeSubmission(submissionId: string): Promise<void> {
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'GRADING_IN_PROGRESS' },
    });

    const criteria = await this.prisma.rubricCriteria.findMany({
      where: {
        rubric: { assignment: { submissions: { some: { id: submissionId } } } },
      },
    });

    for (const criterion of criteria) {
      await this.prisma.gradingScore.upsert({
        where: {
          submissionId_criteriaId: { submissionId, criteriaId: criterion.id },
        },
        create: {
          submissionId,
          criteriaId: criterion.id,
          pointsAwarded: Math.floor(criterion.maxPoints * 0.7),
          aiFeedback: 'Auto-graded placeholder. AI grading pipeline pending.',
        },
        update: {},
      });
    }

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'REVIEWED' },
    });
  }

  async confirmAll(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { scores: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.gradingScore.updateMany({
        where: { submissionId, isConfirmed: false },
        data: { isConfirmed: true },
      });
      await tx.submission.update({
        where: { id: submissionId },
        data: { status: 'CONFIRMED' },
      });
    });

    this.analysisService
      .evaluateStudent(submission.studentId)
      .then(() =>
        this.logger.log(
          `Analysis evaluated for student ${submission.studentId}`,
        ),
      )
      .catch((err) =>
        this.logger.error(
          `Analysis evaluation failed for student ${submission.studentId}`,
          err,
        ),
      );

    return this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { scores: true },
    });
  }

  async confirm(
    id: string,
    dto: { pointsAwarded: number; teacherNotes?: string },
  ) {
    const score = await this.prisma.gradingScore.findUnique({
      where: { id },
      include: { submission: true },
    });
    if (!score) throw new NotFoundException('GradingScore not found');

    const updated = await this.prisma.gradingScore.update({
      where: { id },
      data: {
        pointsAwarded: dto.pointsAwarded,
        teacherNotes: dto.teacherNotes,
        isConfirmed: true,
      },
    });

    const allScores = await this.prisma.gradingScore.findMany({
      where: { submissionId: score.submissionId },
    });
    const allConfirmed = allScores.every((s) => s.isConfirmed);

    if (allConfirmed) {
      transitionStatus(score.submission.status, SubmissionStatus.CONFIRMED);
      await this.prisma.submission.update({
        where: { id: score.submissionId },
        data: { status: SubmissionStatus.CONFIRMED },
      });

      await this.analysis
        .evaluateStudent(score.submission.studentId)
        .catch((err) =>
          console.error(
            `[GradingService] Analysis failed for student ${score.submission.studentId}:`,
            err,
          ),
        );
    }

    return updated;
  }

  private async embedAndStoreChunk(
    chunkId: string,
    content: string,
  ): Promise<number[]> {
    const embedding = await this.llm.embed(content);
    const vectorStr = `[${embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `UPDATE submission_chunks SET embedding = $1::vector WHERE id = $2`,
      vectorStr,
      chunkId,
    );
    return embedding;
  }

  private async callGradingLlm(
    chunkContent: string,
    criteria: { id: string; description: string; maxPoints: number }[],
  ): Promise<GradingOutput> {
    return this.llm.generateStructured({
      systemPrompt: `You are a grading assistant evaluating student work against a rubric.
Grade each criterion independently. Assign a score based solely on the
provided rubric criteria — do not invent new criteria. Output valid JSON
matching this exact schema:

{
  "scores": [
    {
      "criterionId": "uuid-from-the-rubric-criteria-list",
      "pointsAwarded": 0,
      "feedback": "explanation of why points were awarded or deducted"
    }
  ],
  "overallFeedback": "optional summary comment"
}`,
      userPrompt: `Rubric criteria:\n${JSON.stringify(criteria.map((c) => ({ id: c.id, description: c.description, maxPoints: c.maxPoints })))}\n\nStudent submission chunk:\n${chunkContent}`,
      schema: GradingOutputSchema,
    });
  }

  private async upsertGradingScores(
    submissionId: string,
    scores: GradingOutput['scores'],
  ) {
    for (const score of scores) {
      await this.prisma.gradingScore.upsert({
        where: {
          submissionId_criteriaId: {
            submissionId,
            criteriaId: score.criterionId,
          },
        },
        create: {
          submissionId,
          criteriaId: score.criterionId,
          pointsAwarded: score.pointsAwarded,
          aiFeedback: score.feedback,
        },
        update: {
          pointsAwarded: score.pointsAwarded,
          aiFeedback: score.feedback,
        },
      });
    }
  }
}
