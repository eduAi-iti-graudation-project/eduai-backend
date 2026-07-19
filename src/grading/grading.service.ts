import { Injectable, NotFoundException } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { RubricsService } from '../rubrics/rubrics.service';
import { AnalysisService } from '../analysis/analysis.service';
import { GradingOutput, GradingOutputSchema } from './dto';
import { transitionStatus } from '../submissions/status-machine';

@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly rubrics: RubricsService,
    private readonly analysis: AnalysisService,
  ) {}

  async gradeSubmission(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { chunks: true, assignment: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    transitionStatus(submission.status, SubmissionStatus.GRADING_IN_PROGRESS);
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: SubmissionStatus.GRADING_IN_PROGRESS },
    });

    for (const chunk of submission.chunks) {
      let embedding: number[] | undefined;

      try {
        embedding = await this.embedAndStoreChunk(chunk.id, chunk.content);
      } catch (err) {
        console.error(
          `[GradingService] Failed to embed chunk ${chunk.id}:`,
          err,
        );
      }

      try {
        const criteria = embedding
          ? await this.rubrics.findSimilarCriteria(
              embedding,
              submission.assignmentId,
            )
          : (await this.rubrics.findConfirmedRubric(submission.assignmentId))
              .criteria;

        const result = await this.callGradingLlm(chunk.content, criteria);
        await this.upsertGradingScores(submission.id, result.scores);
      } catch (err) {
        console.error(
          `[GradingService] Failed to grade chunk ${chunk.id}:`,
          err,
        );
      }
    }

    transitionStatus(
      SubmissionStatus.GRADING_IN_PROGRESS,
      SubmissionStatus.REVIEW_READY,
    );
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: SubmissionStatus.REVIEW_READY },
    });

    return this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { chunks: true, scores: { include: { criteria: true } } },
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
