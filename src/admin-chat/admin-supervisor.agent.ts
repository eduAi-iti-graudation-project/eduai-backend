import { Injectable, Logger } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import { z } from 'zod';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES } from '../common/llm/formatting-rules';
import { createGatewayLanguageModel } from '../struggle-signals/gateway-language-model';
import {
  AdminDomain,
  AdminPlanSchema,
  AdminReplySchema,
  AdminSpecialistSchema,
  AdminAgentStep,
} from './dto';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const ROUTER_PROMPT = `You are the routing supervisor for a school's admin copilot. Given a question and the conversation so far, decide which specialist data domains are needed to answer it.

Available domains and what each covers:
- overview: roster counts (students/teachers/classes), flagged-student count, submissions awaiting review, pending confirmations, pass rate.
- alerts: active student alerts (who is flagged, type, severity).
- insights: weekly performance trends and agent insight cards.
- requests: pending join requests (guardians/students awaiting approval).
- billing: subscription plan, status, trial state.
- student: a single scoped student's attendance, classes, confirmed grades, and active alerts.
- teacher: a single scoped teacher's classes, class count, and confirmed grading volume.

Rules:
- Include a domain only when the question genuinely needs its data. For a greeting or "hello", return an empty list.
- For a broad school-wide summary ("how is the school doing"), include overview, alerts, insights, requests and billing.
- When a student or teacher is scoped (noted below), prefer that profile domain over broad domains unless the question clearly needs both.
- Do not include a domain just because it sounds related — include it only if its numbers are needed for the answer.

Respond with ONLY valid JSON: {"domains": ["overview", "alerts"]}.`;

const WRITER_PROMPT = `You are the lead writer of a school's admin copilot. Specialist agents gathered the school data and pulled the key facts. Your job is to compose the final answer to the administrator.

Grounding rules:
- Answer ONLY from the specialist facts provided. Never invent counts, alert lists, percentages, trends, requests, or billing facts.
- Reference real numbers exactly as provided (e.g. **5 flagged students**, **12 submissions awaiting review**).
- When a list is long, summarize the top few with a count and offer to go deeper.
- If the facts do not cover what was asked, say plainly that this isn't visible in the school data yet.
- Some sections may be empty or null (no open alerts, no pending requests, no subscription info). Say so honestly rather than inventing numbers.
- Be direct and useful: lead with the direct answer, then the supporting numbers. Keep replies reasonably short and scannable.
${FORMATTING_RULES}

Sources: list the specialist domains you actually based the answer on (e.g. "Overview", "Active alerts", "Insights", "Join requests", "Billing", "Student profile", "Teacher profile"). Empty when the reply is purely conversational.

Respond with ONLY valid JSON matching this exact shape: {"reply": string, "sources": [string, ...]}.
- "reply": the composed answer following the OUTPUT MARKUP rules above.
- "sources": the specialist domains you actually based the answer on, as strings (empty array for purely conversational replies).
No markdown, no prose, no code fences — just the JSON object.`;

const SPECIALIST_PROMPTS: Record<AdminDomain, string> = {
  overview:
    'You are the school-overview specialist. Given the dashboard snapshot, pull only the numbers that answer the question. Return a short summary plus the key facts as exact numbers.',
  alerts:
    'You are the active-alerts specialist. Given the flagged students list, identify who is flagged, with which severity and reason. Only surface facts relevant to the question.',
  insights:
    'You are the insights specialist. Given the weekly performance insights, extract the trend direction, the latest figures, and the agent insight cards relevant to the question.',
  requests:
    'You are the operations specialist. Given the pending join requests, report the exact count and what they are for.',
  billing:
    'You are the billing specialist. Given the organization billing fields, report plan, subscription status, and trial state exactly as shown.',
  student:
    'You are the student-profile specialist. Given a single student profile, pull attendance, classes, confirmed grades, and active alerts that matter for the question. Never invent numbers.',
  teacher:
    'You are the teacher-profile specialist. Given a single teacher profile, pull classes, class count, and grading volume that matter for the question. Never invent numbers.',
};

const SPECIALIST_OUTPUT_INSTRUCTION = `

Respond with ONLY valid JSON matching this exact shape: {"summary": string, "facts": [string, ...]}.
- "summary": the short, direct answer to the question based on the specialist data.
- "facts": the exact numbers, names, and concrete facts from the specialist data — never invented.
No markdown, no prose, no code fences — just the JSON object.`;

const STEP_FOR_DOMAIN: Record<AdminDomain, AdminAgentStep> = {
  overview: 'read_overview',
  alerts: 'read_alerts',
  insights: 'read_insights',
  requests: 'read_requests',
  billing: 'read_billing',
  student: 'read_profile',
  teacher: 'read_profile',
};

interface SpecialistOutput {
  domain: AdminDomain;
  summary: string;
  facts: string[];
}

/**
 * Admin copilot multi-agent system.
 *
 * The ITI gateway model cannot emit tool calls, so Mastra's framework-level
 * `agents:` delegation is unreachable here. This supervisor instead
 * orchestrates Mastra `Agent` primitives in code: a router agent decides
 * which specialist agents to engage, the selected specialists each analyze
 * their own slice of the school data in parallel, and a writer agent composes
 * the final grounded reply with sources. Each delegation is streamed as a
 * real `step` event.
 */
@Injectable()
export class AdminSupervisor {
  private readonly logger = new Logger(AdminSupervisor.name);

  private readonly router: Agent;
  private readonly specialists: Record<AdminDomain, Agent>;
  private readonly writer: Agent;

  constructor(llmService: LlmService) {
    const model = createGatewayLanguageModel((systemPrompt, userPrompt) =>
      llmService.chat(systemPrompt, userPrompt),
    );
    this.router = this.buildAgent('admin-router', ROUTER_PROMPT, model);
    this.writer = this.buildAgent('admin-writer', WRITER_PROMPT, model);
    const specialists = {} as Record<AdminDomain, Agent>;
    for (const domain of Object.keys(SPECIALIST_PROMPTS) as AdminDomain[]) {
      specialists[domain] = this.buildAgent(
        `admin-${domain}`,
        SPECIALIST_PROMPTS[domain] + SPECIALIST_OUTPUT_INSTRUCTION,
        model,
      );
    }
    this.specialists = specialists;
  }

  private buildAgent(
    id: string,
    instructions: string,
    model: LanguageModelV2,
  ): Agent {
    return new Agent({ id, name: id, instructions, model });
  }

  async respond(params: {
    schoolContext: Record<string, unknown>;
    history: ConversationMessage[];
    question: string;
    onStep?: (step: AdminAgentStep) => void;
  }): Promise<{ reply: string; sources: string[] }> {
    const { schoolContext, history, question, onStep } = params;

    onStep?.('routing');
    const domains = await this.selectDomains(question, history);

    const selected = domains.filter((domain) =>
      this.hasData(schoolContext, domain),
    );

    for (const domain of selected) {
      onStep?.(STEP_FOR_DOMAIN[domain]);
    }

    const findings: SpecialistOutput[] = [];
    await Promise.all(
      selected.map(async (domain) => {
        try {
          const result = await this.generateBestEffort(
            this.specialists[domain],
            this.specialistPrompt(domain, schoolContext, question, history),
            AdminSpecialistSchema,
          );
          if ('object' in result) {
            const parsed = AdminSpecialistSchema.parse(result.object);
            findings.push({
              domain,
              summary: parsed.summary,
              facts: parsed.facts,
            });
          } else {
            findings.push({ domain, summary: result.text, facts: [] });
          }
        } catch (error) {
          this.logger.warn(
            `Admin specialist "${domain}" failed; skipping: ${String(error)}`,
          );
        }
      }),
    );

    onStep?.('thinking');
    const written = await this.generateBestEffort(
      this.writer,
      this.writerPrompt(findings, question, history),
      AdminReplySchema,
    );

    if ('object' in written) {
      const parsed = AdminReplySchema.parse(written.object);
      return { reply: parsed.reply, sources: parsed.sources };
    }
    return { reply: written.text, sources: [] };
  }

  /**
   * Run a structured-output generation against a gateway model that only
   * speaks text. The model is told the exact JSON shape in its instructions,
   * but it can still drift into prose; when that happens we retry once with a
   * hardened JSON nudge, and if the model still refuses, fall back to its raw
   * text so a single misbehaving call never kills the whole answer.
   */
  private async generateBestEffort<T extends z.ZodTypeAny>(
    agent: Agent,
    prompt: string,
    schema: T,
  ): Promise<{ object: z.infer<T> } | { text: string }> {
    const attempts = [false, true];
    for (const nudge of attempts) {
      try {
        const result = await agent.generate(
          nudge
            ? `${prompt}\n\nIMPORTANT: Your previous response was not valid JSON. Return ONLY the JSON object matching the required shape. No prose, no markdown, no code fences.`
            : prompt,
          { structuredOutput: { schema } },
        );
        if (result.object !== undefined) {
          return { object: result.object as z.infer<T> };
        }
      } catch {
        // Try the next strategy (nudged retry, then raw-text fallback).
      }
    }
    const plain = await agent.generate(prompt);
    return { text: plain.text ?? '' };
  }

  private async selectDomains(
    question: string,
    history: ConversationMessage[],
  ): Promise<AdminDomain[]> {
    try {
      const result = await this.router.generate(
        this.routerPrompt(question, history),
        { structuredOutput: { schema: AdminPlanSchema } },
      );
      return result.object.domains;
    } catch (error) {
      this.logger.warn(
        `Admin router failed; falling back to all domains: ${String(error)}`,
      );
      return Object.keys(SPECIALIST_PROMPTS) as AdminDomain[];
    }
  }

  private routerPrompt(
    question: string,
    history: ConversationMessage[],
  ): string {
    return `Conversation so far:\n${history
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')}\n\nCurrent question: ${question}`;
  }

  private specialistPrompt(
    domain: AdminDomain,
    schoolContext: Record<string, unknown>,
    question: string,
    history: ConversationMessage[],
  ): string {
    const slice = this.sliceFor(domain, schoolContext);
    return `Specialist data (the ONLY facts you may reference):\n${JSON.stringify(
      slice,
      null,
      2,
    )}\n\nLast exchange:\n${history
      .slice(-2)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')}\n\nQuestion: ${question}`;
  }

  private writerPrompt(
    findings: SpecialistOutput[],
    question: string,
    history: ConversationMessage[],
  ): string {
    return `Specialist findings (the ONLY facts you may reference):\n${JSON.stringify(
      findings,
      null,
      2,
    )}\n\nConversation so far:\n${history
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')}\n\nQuestion: ${question}`;
  }

  private hasData(
    schoolContext: Record<string, unknown>,
    domain: AdminDomain,
  ): boolean {
    const slice = this.sliceFor(domain, schoolContext);
    if (slice === null) return false;
    const value = Object.values(slice)[0];
    if (Array.isArray(value)) return value.length > 0;
    if (value === null || value === undefined) return false;
    return typeof value === 'object' ? Object.keys(value as object).length > 0 : true;
  }

  private sliceFor(
    domain: AdminDomain,
    schoolContext: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const scope = schoolContext.scope as
      | { kind?: 'student' | 'teacher' }
      | null
      | undefined;
    switch (domain) {
      case 'overview':
        return schoolContext.overview
          ? { overview: schoolContext.overview }
          : null;
      case 'alerts': {
        const alerts = schoolContext.activeAlerts;
        return Array.isArray(alerts) && alerts.length > 0
          ? { activeAlerts: alerts }
          : null;
      }
      case 'insights':
        return schoolContext.insights
          ? { insights: schoolContext.insights }
          : null;
      case 'requests':
        return typeof schoolContext.pendingJoinRequests === 'number'
          ? { pendingJoinRequests: schoolContext.pendingJoinRequests }
          : null;
      case 'billing':
        return schoolContext.billing
          ? { billing: schoolContext.billing }
          : null;
      case 'student':
        return scope?.kind === 'student'
          ? { student: scope }
          : null;
      case 'teacher':
        return scope?.kind === 'teacher'
          ? { teacher: scope }
          : null;
    }
  }
}