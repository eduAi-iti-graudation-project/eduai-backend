import { Injectable } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';
import { ToolCallSchema, QuizSchema, ChatDto, Quiz } from './dto';

const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are a helpful teaching assistant for an educator. Your job is to help teachers prepare quizzes, lesson summaries, and other classroom materials.

CRITICAL: You MUST always respond with ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON object.

Available actions and their exact JSON format:

1. Search curriculum:
{"action": "search_curriculum", "query": "what to search for", "topK": 5}

2. Create quiz (only AFTER search_curriculum returned results):
{"action": "create_quiz", "topic": "quiz topic", "questionCount": 5, "types": ["mcq", "short_answer"]}

3. Respond (general answer or when no tool is needed):
{"action": "respond", "reply": "Your helpful response here"}

Rules:
1. Always call search_curriculum first when you need curriculum information.
2. After receiving search results, call create_quiz if the teacher asked for a quiz.
3. Base all answers and quizzes ONLY on the curriculum search results. Never use your own knowledge or information outside the results.
4. If the search returned no material, tell the teacher the topic is not covered in the uploaded curriculum material. Never fall back to general knowledge.
5. Be thorough and detailed in your responses.`;

const QUIZ_PROMPT = `You are a quiz generator for an educator. Given a topic and context from curriculum materials, create a quiz with a mix of multiple-choice and short-answer questions.

Rules:
1. MCQ questions must have exactly 4 options with one correct answer. Include the options array.
2. Short answer questions must have a clear correct answer.
3. Questions should be grade-level appropriate and test understanding.
4. Include an explanation for the correct answer where helpful.
5. Base every question ONLY on the provided curriculum context. Never use outside knowledge.`;

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AssistantService {
  constructor(
    private readonly llm: LlmService,
    private readonly materials: MaterialsService,
  ) {}

  async chat(dto: ChatDto): Promise<{ reply: string; quiz?: Quiz }> {
    const { classId, messages, newMessage } = dto;
    const history: ConversationMessage[] = [
      ...messages,
      { role: 'user', content: newMessage },
    ];

    let lastSearchContext = '';
    let hasSearchContext = false;

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
        const chunks = await this.materials.searchChunks(
          classId,
          result.query,
          topK,
        );

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

        return { reply: formatted, quiz };
      }
    }

    return {
      reply:
        'I was unable to complete your request within the available steps. Please try rephrasing or providing more specific instructions.',
    };
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
}
