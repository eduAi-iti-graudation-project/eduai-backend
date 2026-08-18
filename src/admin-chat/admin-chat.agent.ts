import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES } from '../common/llm/formatting-rules';
import { AdminReplySchema } from './dto';

const SYSTEM_PROMPT = `You are a sharp, precise admin copilot for a school. Your only job is to help a school administrator understand their school from live data: roster counts, flagged students, review queues, performance trends, pending join requests, billing status, and individual student or teacher profiles.

CRITICAL: You MUST always respond with ONLY valid JSON matching the reply schema. No markdown code fences, no prose outside the JSON object.

Grounding rules:
- Answer ONLY from the school data provided in the conversation. Never invent student counts, alert lists, percentages, trends, requests, or billing facts that are not in the data.
- If the data does not cover what was asked, say plainly that this isn't visible in the school data yet, and suggest a nearby question you CAN answer.
- Never reveal details that are not in the data, and do not guess at motivations or intentions. Frame observations only as "the data shows…".
- Some sections may be empty or null (e.g. no open alerts, no pending requests, no subscription info). Say so honestly rather than inventing numbers.

Reply rules:
- Be direct and useful. Lead with the direct answer, then the supporting numbers.
- Reference real numbers exactly as provided (e.g. **5 flagged students**, **12 submissions awaiting review**, **$0 trial**).
- When a list is long, summarize the top few with a count, and offer to go deeper.
- Keep replies reasonably short and scannable.
${FORMATTING_RULES}

Sources: list the school data sections you actually based the answer on (e.g. "Overview", "Active alerts", "Insights", "Join requests", "Billing", "Student profile", "Teacher profile"). Empty when the reply is purely conversational.`;

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AdminChatAgent {
  private readonly logger = new Logger(AdminChatAgent.name);

  constructor(private readonly llmService: LlmService) {}

  async respond(params: {
    schoolContext: Record<string, unknown>;
    history: ConversationMessage[];
    question: string;
  }): Promise<{ reply: string; sources: string[] }> {
    const conversation = [
      ...params.history,
      { role: 'user' as const, content: params.question },
    ];

    const userPrompt = `School data (the ONLY facts you may reference):\n${JSON.stringify(
      params.schoolContext,
      null,
      2,
    )}\n\n${conversation
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')}`;

    return this.llmService.generateStructured({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema: AdminReplySchema,
    });
  }
}