import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../common/llm/llm.service';
import { MaterialsService } from '../../materials/materials.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizGenerationToolSchema } from '../dto';
import { createSearchCurriculumTool } from './tools/search-curriculum.tool';
import { createGenerateQuestionsTool } from './tools/generate-questions.tool';
import { createReviewQuestionsTool } from './tools/review-questions.tool';
import { createSaveQuizTool } from './tools/save-quiz.tool';

const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are a quiz generation agent for an educator. Your job is to create a well-balanced quiz from curriculum materials.

CRITICAL: You MUST always respond with ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON object.

Available actions and their exact JSON format:

1. search_curriculum — Search the class curriculum materials for context on a topic.
   Always call this first.
   {"action": "search_curriculum", "query": "search term", "topK": 5}

2. generate_questions — Generate a batch of questions based on curriculum context.
   {"action": "generate_questions", "context": "...", "types": ["MCQ","SHORT_ANSWER"], "count": 5, "topic": "...", "avoidTopics": [...], "difficulty": "MEDIUM"}

3. review_questions — Review the generated questions for coverage gaps.
   {"action": "review_questions", "questions": [...], "context": "..."}

4. save_quiz — Save the final quiz to the database.
   {"action": "save_quiz", "title": "...", "description": "...", "courseOfferingId": "...", "teacherId": "...", "questions": [...]}

5. respond — Reply to the teacher with the result.
   {"action": "respond", "reply": "..."}

Rules:
1. Always call search_curriculum first.
2. After getting results, call generate_questions to create questions.
3. After generating, call review_questions to check for gaps.
4. If gaps exist, call generate_questions again with avoidTopics to fill gaps.
5. When satisfied, call save_quiz then respond with the result.
6. Generate questions ONLY from the search results. Never use your own knowledge or information outside the results.
7. If the search returned no material, do NOT generate questions — respond with a message explaining no curriculum material covers this topic.`;

@Injectable()
export class QuizGenerationAgent {
  private readonly logger = new Logger(QuizGenerationAgent.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly materialsService: MaterialsService,
    private readonly prisma: PrismaService,
  ) {}

  async generate(params: {
    courseOfferingId: string;
    teacherId: string;
    topic?: string;
    questionCount?: number;
    types?: ('MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY')[];
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  }): Promise<{ quizId: string; title: string; message: string }> {
    const searchCurriculum = createSearchCurriculumTool(this.materialsService);
    const generateQuestions = createGenerateQuestionsTool(this.llmService);
    const reviewQuestions = createReviewQuestionsTool(this.llmService);
    const saveQuiz = createSaveQuizTool(this.prisma);

    const history: { role: 'user' | 'assistant'; content: string }[] = [];
    let saved = false;

    const initialPrompt = [
      `Generate quiz for class ${params.courseOfferingId}`,
      params.topic ? `Topic: ${params.topic}` : null,
      `Target question count: ${params.questionCount ?? 5}`,
      params.types ? `Question types: ${params.types.join(', ')}` : null,
      `Difficulty: ${params.difficulty ?? 'MEDIUM'}`,
    ]
      .filter(Boolean)
      .join('\n');

    history.push({ role: 'user', content: initialPrompt });

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const userPrompt = history
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n');

      const result = await this.llmService.generateStructured({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        schema: QuizGenerationToolSchema,
      });

      switch (result.action) {
        case 'respond': {
          if (!saved) {
            history.push({
              role: 'user',
              content:
                'You must call save_quiz with the full question list before you can respond. Reply with a save_quiz action.',
            });
            break;
          }
          return {
            quizId: '',
            title: '',
            message: result.reply,
          };
        }

        case 'search_curriculum': {
          const toolResult = await searchCurriculum.execute({
            courseOfferingId: params.courseOfferingId,
            query: result.query,
            topK: result.topK ?? 5,
          });
          if (toolResult.count === 0) {
            return {
              quizId: '',
              title: '',
              message: `No curriculum material was found for "${result.query}" in this class, so a quiz can't be generated on this topic. Upload material covering it first, then try again.`,
            };
          }
          history.push(
            {
              role: 'assistant',
              content: `Searching curriculum for: "${result.query}"`,
            },
            {
              role: 'user',
              content: `Search results:\n${toolResult.results}`,
            },
          );
          break;
        }

        case 'generate_questions': {
          const toolResult = await generateQuestions.execute({
            context: result.context,
            types: result.types,
            count: result.count,
            topic: result.topic,
            avoidTopics: result.avoidTopics,
            difficulty: result.difficulty ?? params.difficulty ?? 'MEDIUM',
          });
          history.push(
            {
              role: 'assistant',
              content: `Generated ${toolResult.questions.length} questions`,
            },
            {
              role: 'user',
              content: `Questions:\n${JSON.stringify(toolResult.questions)}`,
            },
          );
          break;
        }

        case 'review_questions': {
          const toolResult = await reviewQuestions.execute({
            questions: result.questions,
            context: result.context,
          });
          if (toolResult.gaps.length > 0 && toolResult.balanced === false) {
            history.push(
              {
                role: 'assistant',
                content: `Review complete. Gaps found: ${toolResult.gaps.join(', ')}`,
              },
              {
                role: 'user',
                content: `Gaps to fill: ${toolResult.gaps.join(', ')}\n${toolResult.suggestion ?? ''}\nPlease generate more questions to cover these gaps.`,
              },
            );
          } else {
            history.push({
              role: 'assistant',
              content: `Review complete. Coverage looks good: ${toolResult.coverage}`,
            });
          }
          break;
        }

        case 'save_quiz': {
          const toolResult = await saveQuiz.execute({
            title: result.title,
            description: result.description ?? undefined,
            courseOfferingId: params.courseOfferingId,
            teacherId: params.teacherId,
            questions: result.questions.map((q, idx) => ({
              ...q,
              points: q.points ?? 1,
              order: q.order ?? idx,
            })),
          });
          history.push({
            role: 'assistant',
            content: `Quiz saved: ${toolResult.title} (${toolResult.questionCount} questions)`,
          });
          saved = true;
          return {
            quizId: toolResult.quizId,
            title: toolResult.title,
            message: `Quiz "${toolResult.title}" created with ${toolResult.questionCount} questions.`,
          };
        }
      }
    }

    return {
      quizId: '',
      title: '',
      message:
        'Quiz generation did not complete within the maximum steps. Please try again.',
    };
  }
}
