import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES } from '../common/llm/formatting-rules';
import { MaterialsService } from '../materials/materials.service';
import { createSaveQuizTool } from '../quizzes/agents/tools/save-quiz.tool';
import {
  submissionPcts,
  summarizeStudentSeries,
  summarizeClass,
} from '../communication-agent/trends';
import {
  ToolCallSchema,
  QuizSchema,
  RubricDraftSchema,
  LessonSummarySchema,
  LessonPlanSchema,
  AssignmentDraftSchema,
  ClassAnalyticsSchema,
  ChatDto,
  Quiz,
  RubricDraft,
  LessonSummary,
  LessonPlan,
  AssignmentDraft,
  ClassAnalytics,
} from './dto';

const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT =
  `You are a helpful teaching assistant for an educator. Your job is to help teachers prepare quizzes, rubrics, lesson materials, and assignment drafts, and to answer questions about their class.

CRITICAL: You MUST always respond with ONLY valid JSON. No markdown code fences, no explanation outside the JSON object.

Available actions and their exact JSON format:

1. Search curriculum:
{"action": "search_curriculum", "query": "what to search for", "topK": 5}

2. Create quiz (only AFTER search_curriculum returned results):
{"action": "create_quiz", "topic": "quiz topic", "questionCount": 5, "types": ["mcq", "short_answer"]}

3. Draft a grading rubric:
{"action": "draft_rubric", "topic": "what the rubric should assess"}

4. Summarize a lesson (only AFTER search_curriculum returned results; works for a whole-course overview too when the search returned the full material):
{"action": "summarize_lesson", "topic": "lesson topic"}

5. Plan a lesson (only AFTER search_curriculum returned results):
{"action": "plan_lesson", "topic": "lesson topic"}

6. Analyze the class (works without a search; uses real class data):
{"action": "class_analytics", "question": "the teacher's analytics question"}

7. Draft an assignment:
{"action": "draft_assignment", "topic": "assignment topic"}

8. Respond (general answer or when no tool is needed):
{"action": "respond", "reply": "Your helpful response here"}

Rules:
1. Always call search_curriculum first when you need curriculum information.
2. After receiving search results, call create_quiz, summarize_lesson, or plan_lesson if the teacher asked for one.
3. Base all answers and quizzes ONLY on the curriculum search results. Never use your own knowledge or information outside the results.
4. If the search returned no material, tell the teacher the class has no uploaded curriculum material covering the request. Never fall back to general knowledge. IMPORTANT: the search results may contain the class's full uploaded curriculum when the teacher asks a general question (e.g. "summarize the course material", "give me an overview of the course"). In that case summarize_lesson / plan_lesson / create_quiz should still run, using the provided context, and you should never claim there is no material.
5. class_analytics and draft_rubric/draft_assignment do not require a search first.
6. Be thorough and detailed in your responses.` + `${FORMATTING_RULES}`;

const STRUCTURED_OUTPUT_RULE =
  '\n\nCRITICAL: Respond with ONLY a single valid JSON object matching the schema below. No markdown code fences, no prose before or after, no explanation, no keys outside the schema. The response is parsed with JSON.parse and validated against a strict schema, so field names, types and nesting must match exactly.\n\nExpected JSON schema: ';

const QUIZ_PROMPT = `You are a quiz generator for an educator. Given a topic and context from curriculum materials, create a quiz with a mix of multiple-choice and short-answer questions.

Rules:
1. MCQ questions must have exactly 4 options with one correct answer. Include the options array.
2. Short answer questions must have a clear correct answer.
3. Questions should be grade-level appropriate and test understanding.
4. Include an explanation for the correct answer where helpful.
5. Base every question ONLY on the provided curriculum context. Never use outside knowledge.${STRUCTURED_OUTPUT_RULE}
{"title": "string", "questions": [{"type": "mcq" | "short_answer", "question": "string", "options": ["4 strings", "optional"], "correctAnswer": "string", "explanation": "string", "optional"}]}`;

const RUBRIC_PROMPT = `You are a rubric designer for an educator. Given a topic, create a grading rubric.
Rules:
1. Define 3-6 criteria, each with a clear description of what is being evaluated.
2. maxPoints must be a positive integer; use sensible point distributions that sum to a round total (e.g. 100 or 20).
3. Criteria must be specific, observable, and grade-appropriate.
Base the rubric ONLY on the provided topic context. Never use outside knowledge.${STRUCTURED_OUTPUT_RULE}
{"title": "string", "criteria": [{"description": "string", "maxPoints": "number"}]}`;

const LESSON_SUMMARY_PROMPT = `You are a lesson summarizer for an educator. Given a topic and curriculum context, produce a concise summary with key points students must know.
Rules:
1. Base the summary ONLY on the provided curriculum context.
2. keyPoints should be 3-6 scannable, concrete takeaways.${STRUCTURED_OUTPUT_RULE}
{"title": "string", "summary": "string", "keyPoints": ["string"]}`;

const LESSON_PLAN_PROMPT = `You are a lesson planner for an educator. Given a topic and curriculum context, produce a practical lesson plan.
Rules:
1. Base the plan ONLY on the provided curriculum context.
2. Objectives: 2-5 measurable, student-facing goals.
3. Activities: 3-8 concrete, time-box-able classroom activities that build understanding.${STRUCTURED_OUTPUT_RULE}
{"title": "string", "objectives": ["string"], "activities": ["string"], "assessmentHint": "string"}`;

const ASSIGNMENT_DRAFT_PROMPT = `You are an assignment drafter for an educator. Given a topic, draft a ready-to-post assignment.
Rules:
1. title: a clear, short name for the assignment.
2. description: a motivating overview for students.
3. instructions: numbered, unambiguous steps a student can follow.
Base the assignment ONLY on the provided topic context. Never use outside knowledge.${STRUCTURED_OUTPUT_RULE}
{"title": "string", "description": "string", "instructions": "string"}`;

const ANALYTICS_PROMPT =
  `You are a teacher-facing class analyst. You will receive real numbers computed from confirmed grades. Turn them into a precise summary.
Rules:
1. Reference the actual numbers (percentages, counts, trends).
2. strugglingAreas: list the specific weak skills/patterns the numbers reveal.
3. recommendations: 2-4 concrete actions for the teacher.
Never invent numbers that are not in the provided data.` +
  `${STRUCTURED_OUTPUT_RULE}
{"overall": "string", "strugglingAreas": ["string"], "recommendations": ["string"]}` +
  `${FORMATTING_RULES}`;

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly materials: MaterialsService,
    private readonly prisma: PrismaService,
  ) {}

  async chat(dto: ChatDto): Promise<{
    reply: string;
    quiz?: Quiz;
    savedQuiz?: { quizId: string; title: string; questionCount: number };
    rubric?: RubricDraft;
    lesson?: LessonSummary | LessonPlan;
    assignment?: AssignmentDraft;
    analytics?: ClassAnalytics;
  }> {
    const { courseOfferingId, messages, newMessage } = dto;
    const history: ConversationMessage[] = [
      ...messages,
      { role: 'user', content: newMessage },
    ];

    let lastSearchContext = '';
    let hasSearchContext = false;

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const userPrompt = history
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n');

        const result = await this.llm.generateStructured({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          schema: ToolCallSchema,
        });

        if (result.action === 'respond') {
          return { reply: result.reply };
        }

        if (result.action === 'search_curriculum') {
          const topK = result.topK ?? 5;
          let chunks = await this.materials.searchChunks(
            courseOfferingId,
            result.query,
            topK,
          );

          // A weak or generic query (e.g. "summarize the course material")
          // may embed too far from the content to pass the similarity
          // threshold even though the class has uploaded material. Fall back
          // to the class's raw chunks so generation still has real context —
          // the same guard quizzes and labs apply.
          if (chunks.length === 0) {
            chunks = await this.materials.getChunksByOffering(
              courseOfferingId,
              50,
            );
          }

          hasSearchContext = chunks.length > 0;
          lastSearchContext =
            chunks.length > 0
              ? chunks
                  .map(
                    (c, idx) =>
                      `[Result ${idx + 1}] (from: ${c.materialTitle}, relevance: ${c.distance.toFixed(4)})\n${c.content}`,
                  )
                  .join('\n\n')
              : 'No relevant curriculum material found.';

          history.push(
            {
              role: 'assistant',
              content: `I'll search the curriculum for: "${result.query}"`,
            },
            {
              role: 'user',
              content: `Search results for "${result.query}":\n${lastSearchContext}`,
            },
          );
        }

        if (result.action === 'create_quiz') {
          if (!hasSearchContext) {
            return {
              reply: `The topic "${result.topic}" is not covered in this class's uploaded curriculum material, so I can't create a quiz on it. Upload material covering this topic first, then ask me again.`,
            };
          }

          const questionCount = result.questionCount ?? 5;
          const types = result.types ?? ['mcq', 'short_answer'];

          const quiz = await this.llm.generateStructured<Quiz>({
            systemPrompt: QUIZ_PROMPT,
            userPrompt: `Topic: ${result.topic}\nNumber of questions: ${questionCount}\nQuestion types: ${types.join(', ')}\n\nCurriculum context:\n${lastSearchContext}`,
            schema: QuizSchema,
          });

          const formatted = this.formatQuiz(quiz);
          const savedQuiz = await this.persistQuiz(quiz, courseOfferingId);

          return {
            reply: savedQuiz
              ? `${formatted}\n\n(Draft saved to your quiz library — quizId: ${savedQuiz.quizId})`
              : formatted,
            quiz,
            ...(savedQuiz ? { savedQuiz } : {}),
          };
        }

        if (result.action === 'draft_rubric') {
          const rubric = await this.llm.generateStructured<RubricDraft>({
            systemPrompt: RUBRIC_PROMPT,
            userPrompt: [
              `Topic: ${result.topic}`,
              lastSearchContext
                ? `Curriculum context:\n${lastSearchContext}`
                : '',
              `Teacher's request: ${newMessage}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
            schema: RubricDraftSchema,
          });

          return {
            reply: this.formatRubric(rubric),
            rubric,
          };
        }

        if (result.action === 'summarize_lesson') {
          if (!hasSearchContext) {
            return {
              reply: `There's no curriculum material to summarize for "${result.topic}" yet. Upload material covering this topic first, then ask me again.`,
            };
          }

          const lesson = await this.llm.generateStructured<LessonSummary>({
            systemPrompt: LESSON_SUMMARY_PROMPT,
            userPrompt: `Topic: ${result.topic}\n\nCurriculum context:\n${lastSearchContext}`,
            schema: LessonSummarySchema,
          });

          return {
            reply: this.formatLessonSummary(lesson),
            lesson,
          };
        }

        if (result.action === 'plan_lesson') {
          if (!hasSearchContext) {
            return {
              reply: `There's no curriculum material to plan a lesson for "${result.topic}" yet. Upload material covering this topic first, then ask me again.`,
            };
          }

          const lesson = await this.llm.generateStructured<LessonPlan>({
            systemPrompt: LESSON_PLAN_PROMPT,
            userPrompt: `Topic: ${result.topic}\n\nCurriculum context:\n${lastSearchContext}`,
            schema: LessonPlanSchema,
          });

          return {
            reply: this.formatLessonPlan(lesson),
            lesson,
          };
        }

        if (result.action === 'class_analytics') {
          const analytics = await this.runClassAnalytics(
            courseOfferingId,
            newMessage,
          );
          return {
            reply: this.formatAnalytics(analytics),
            analytics,
          };
        }

        if (result.action === 'draft_assignment') {
          const assignment = await this.llm.generateStructured<AssignmentDraft>(
            {
              systemPrompt: ASSIGNMENT_DRAFT_PROMPT,
              userPrompt: [
                `Topic: ${result.topic}`,
                lastSearchContext
                  ? `Curriculum context:\n${lastSearchContext}`
                  : '',
                `Teacher's request: ${newMessage}`,
              ]
                .filter(Boolean)
                .join('\n\n'),
              schema: AssignmentDraftSchema,
            },
          );

          return {
            reply: this.formatAssignment(assignment),
            assignment,
          };
        }
      }
    } catch (error) {
      this.logger.warn(
        `Assistant generation failed; returning graceful reply: ${String(error)}`,
      );
      return {
        reply:
          'I hit a snag generating that response. Please try rephrasing your request or ask again in a moment.',
      };
    }

    return {
      reply:
        'I was unable to complete your request within the available steps. Please try rephrasing or providing more specific instructions.',
    };
  }

  private async persistQuiz(
    quiz: Quiz,
    courseOfferingId: string,
  ): Promise<{ quizId: string; title: string; questionCount: number } | null> {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: courseOfferingId },
      select: { teacherId: true },
    });
    if (!offering) return null;

    const saveQuiz = createSaveQuizTool(this.prisma);
    try {
      return await saveQuiz.execute({
        title: quiz.title,
        assignments: [{ courseOfferingId: courseOfferingId }],
        teacherId: offering.teacherId,
        questions: quiz.questions.map((q, idx) =>
          q.type === 'mcq'
            ? {
                type: 'MCQ' as const,
                question: q.question,
                points: 1,
                order: idx,
                options: q.options?.map((option) => ({
                  text: option,
                  isCorrect: option === q.correctAnswer,
                })),
              }
            : {
                type: 'SHORT_ANSWER' as const,
                question: q.question,
                correctAnswer: q.correctAnswer,
                points: 1,
                order: idx,
              },
        ),
        // Chat-generated quizzes still need a time limit and close date —
        // apply sensible defaults the teacher can adjust in the editor.
        timeLimit: 15,
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch {
      return null;
    }
  }

  private async runClassAnalytics(
    courseOfferingId: string,
    question: string,
  ): Promise<ClassAnalytics> {
    const scores = await this.prisma.gradingScore.findMany({
      where: {
        submission: { assignment: { courseOfferingId }, status: 'CONFIRMED' },
        isConfirmed: true,
      },
      include: {
        criteria: { select: { maxPoints: true, description: true } },
        submission: {
          select: {
            id: true,
            createdAt: true,
            student: { select: { id: true, name: true } },
          },
        },
      },
    });

    const byStudent = new Map<
      string,
      {
        name: string;
        pcts: { submissionId: string; pct: number; createdAt: string }[];
      }
    >();
    for (const score of scores) {
      const student = score.submission.student;
      const stats = byStudent.get(student.id) ?? {
        name: student.name,
        pcts: [],
      };
      stats.pcts.push({
        submissionId: score.submission.id,
        pct:
          score.criteria.maxPoints > 0
            ? Math.round((score.pointsAwarded / score.criteria.maxPoints) * 100)
            : 0,
        createdAt: score.submission.createdAt.toISOString(),
      });
      byStudent.set(student.id, stats);
    }

    const series = Array.from(byStudent.values()).map((s) => ({
      name: s.name,
      stats: summarizeStudentSeries(
        submissionPcts(
          s.pcts.map((p) => ({
            studentId: 'x',
            submissionId: p.submissionId,
            pct: p.pct,
            createdAt: p.createdAt,
          })),
        ),
      ),
    }));

    const classStats = summarizeClass(
      Array.from(byStudent.values()).map((s) =>
        submissionPcts(
          s.pcts.map((p) => ({
            studentId: 'x',
            submissionId: p.submissionId,
            pct: p.pct,
            createdAt: p.createdAt,
          })),
        ),
      ),
    );

    const flagged = series.filter(
      (s) =>
        s.stats.count >= 2 &&
        (s.stats.last3AvgPct < 60 || s.stats.consecutiveDrops >= 3),
    );

    return this.llm.generateStructured<ClassAnalytics>({
      systemPrompt: ANALYTICS_PROMPT,
      userPrompt: JSON.stringify({
        question,
        classStats,
        classAverage: classStats.classAvgPct,
        students: series.map((s) => ({
          name: s.name,
          last3AvgPct: Math.round(s.stats.last3AvgPct),
          consecutiveDrops: s.stats.consecutiveDrops,
        })),
        flaggedStudents: flagged.map((f) => f.name),
      }),
      schema: ClassAnalyticsSchema,
    });
  }

  private formatQuiz(quiz: Quiz): string {
    const lines: string[] = [`Quiz: ${quiz.title}`, ''];
    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const num = i + 1;
      if (q.type === 'mcq') {
        lines.push(`${num}. (MCQ) ${q.question}`);
        if (q.options) {
          const labels = ['a', 'b', 'c', 'd'];
          for (let j = 0; j < q.options.length; j++) {
            lines.push(`   ${labels[j]}) ${q.options[j]}`);
          }
        }
        lines.push(`   Answer: ${q.correctAnswer}`);
      } else {
        lines.push(`${num}. (Short Answer) ${q.question}`);
        lines.push(`   Answer: ${q.correctAnswer}`);
      }
      if (q.explanation) {
        lines.push(`   Explanation: ${q.explanation}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private formatRubric(rubric: RubricDraft): string {
    const total = rubric.criteria.reduce((a, c) => a + c.maxPoints, 0);
    const lines: string[] = [`Rubric: ${rubric.title}`, ''];
    for (const c of rubric.criteria) {
      lines.push(`- ${c.description} (${c.maxPoints} pts)`);
    }
    lines.push('', `Total: ${total} pts`);
    return lines.join('\n');
  }

  private formatLessonSummary(lesson: LessonSummary): string {
    const lines: string[] = [
      `Summary: ${lesson.title}`,
      '',
      lesson.summary,
      '',
    ];
    lines.push('Key points:');
    for (const point of lesson.keyPoints) {
      lines.push(`- ${point}`);
    }
    return lines.join('\n');
  }

  private formatLessonPlan(plan: LessonPlan): string {
    const lines: string[] = [`Lesson plan: ${plan.title}`, ''];
    lines.push('Objectives:');
    for (const o of plan.objectives) lines.push(`- ${o}`);
    lines.push('', 'Activities:');
    for (const a of plan.activities) lines.push(`- ${a}`);
    lines.push('', `Assessment: ${plan.assessmentHint}`);
    return lines.join('\n');
  }

  private formatAssignment(assignment: AssignmentDraft): string {
    return [
      `Assignment: ${assignment.title}`,
      '',
      assignment.description,
      '',
      'Instructions:',
      ...assignment.instructions.split('\n').map((line) => `- ${line}`),
    ].join('\n');
  }

  private formatAnalytics(analytics: ClassAnalytics): string {
    const lines: string[] = ['Class analytics', '', analytics.overall, ''];
    if (analytics.strugglingAreas.length > 0) {
      lines.push('Struggling areas:');
      for (const area of analytics.strugglingAreas) {
        lines.push(`- ${area}`);
      }
    }
    lines.push('', 'Recommendations:');
    for (const rec of analytics.recommendations) {
      lines.push(`- ${rec}`);
    }
    return lines.join('\n');
  }
}
