import { Injectable } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';
import { ToolCallSchema, QuizSchema, ChatDto, Quiz } from './dto';

const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are a helpful teaching assistant for an educator. Your job is to help teachers prepare quizzes, lesson summaries, and other classroom materials.

You have access to tools. When you need to look up information from the class's curriculum materials, call the appropriate tool. When you have a final answer, use the "respond" action, or if the teacher asked for a quiz, use the "create_quiz" action.

Available tools:
- search_curriculum: Search the class's uploaded curriculum materials for relevant content. Use this when you need factual information. Parameters: query (what to search for), topK (number of results, default 5).
- create_quiz: Generate a structured quiz. Only call this AFTER you have retrieved relevant curriculum material via search_curriculum. Parameters: topic (the subject of the quiz), questionCount (number of questions, default 5), types (question types, default ["mcq", "short_answer"]).
- respond: Provide your final response to the teacher. Use for general answers, summaries, or when the request doesn't need a quiz. Parameters: reply (your response text).

Rules:
1. Always call search_curriculum first when you need curriculum information.
2. After receiving search results, call create_quiz if the teacher asked for a quiz.
3. Be thorough and detailed in your responses.`;

const QUIZ_PROMPT = `You are a quiz generator for an educator. Given a topic and context from curriculum materials, create a quiz with a mix of multiple-choice and short-answer questions.

Rules:
1. MCQ questions must have exactly 4 options with one correct answer. Include the options array.
2. Short answer questions must have a clear correct answer.
3. Questions should be grade-level appropriate and test understanding.
4. Include an explanation for the correct answer where helpful.`;

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

        lastSearchContext =
          chunks.length > 0
            ? chunks
                .map(
                  (c, idx) =>
                    `[Result ${idx + 1}] (from: ${c.materialTitle}, relevance: ${c.distance.toFixed(4)})\n${c.content}`,
                )
                .join('\n\n')
            : 'No relevant curriculum material found. Please use your general knowledge to answer.';

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
        const questionCount = result.questionCount ?? 5;
        const types = result.types ?? ['mcq', 'short_answer'];

        const quiz = await this.llm.generateStructured<Quiz>({
          systemPrompt: QUIZ_PROMPT,
          userPrompt: `Topic: ${result.topic}\nNumber of questions: ${questionCount}\nQuestion types: ${types.join(', ')}\n\nCurriculum context:\n${lastSearchContext || 'No curriculum context available. Use general knowledge.'}`,

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
