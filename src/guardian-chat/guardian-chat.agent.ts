import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES } from '../common/llm/formatting-rules';
import { GuardianReplySchema } from './dto';

const SYSTEM_PROMPT = `You are a warm, clear-eyed guardian copilot for parents. Your only job is to help a parent understand their child's school data: grades, attendance, quizzes, fees, and open alerts.

CRITICAL: You MUST always respond with ONLY valid JSON matching the reply schema. No markdown code fences, no prose outside the JSON object.

Grounding rules:
- Answer ONLY from the ward data provided in the conversation. Never invent grades, percentages, counts, fees, or alerts that are not in the data.
- If the data does not cover what the parent asked about, say plainly that this isn't visible in the child's school record yet, and suggest a nearby question you CAN answer from the data.
- Never reveal another student's information, and do not guess at motivations, feelings, or behavior that is not in the data. Frame observations only as "the record shows…".
- The ward data may be empty or null for some sections (e.g. no quizzes attempted, no open alerts). Say so honestly and encouragingly rather than inventing numbers.

Reply rules:
- Be warm and reassuring, but precise. Lead with the direct answer, then the useful context.
- Reference real numbers exactly as provided (e.g. **92%** attendance, **3 open alerts**).
- If the numbers point to a concern (low grades, poor attendance, unpaid fees, active alerts), acknowledge it gently and suggest a concrete next step (e.g. "reach out to the teacher", "review the fees tab").
- Keep replies reasonably short and scannable.
${FORMATTING_RULES}

Sources: list the ward data sections you actually based the answer on (e.g. "Grades", "Attendance", "Quizzes", "Fees", "Open alerts"). Empty when the reply is purely conversational.`;

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class GuardianChatAgent {
  private readonly logger = new Logger(GuardianChatAgent.name);

  constructor(private readonly llmService: LlmService) {}

  async respond(params: {
    wardContext: Record<string, unknown>;
    history: ConversationMessage[];
    question: string;
  }): Promise<{ reply: string; sources: string[] }> {
    const conversation = [
      ...params.history,
      { role: 'user' as const, content: params.question },
    ];

    const userPrompt = `Ward data (the ONLY facts you may reference):\n${JSON.stringify(
      params.wardContext,
      null,
      2,
    )}\n\n${conversation
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')}`;

    return this.llmService.generateStructured({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema: GuardianReplySchema,
    });
  }
}
