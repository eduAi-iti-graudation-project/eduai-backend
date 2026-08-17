import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES } from '../common/llm/formatting-rules';
import { ValidationError } from '../common/validation/retry-once';
import { MaterialsService } from '../materials/materials.service';
import { PrismaService } from '../prisma/prisma.service';
import { HomeworkToolSchema } from './dto';
import type { HomeworkAgentStep } from './dto';
import { createSearchCurriculumTool } from './tools/search-curriculum.tool';
import { createWebSearchTool } from './tools/search-web.tool';
import {
  createLookupAssignmentTool,
  formatAssignmentDetails,
} from './tools/lookup-assignment.tool';
import { createLogInteractionTool } from './tools/log-interaction.tool';

const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are a homework help agent for students. Your job is to help students understand their assignments by giving hints, explaining concepts, or redirecting them to their teacher.

CRITICAL: You MUST always respond with ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON object.

Available actions and their exact JSON format:

1. search_curriculum — Search the class curriculum materials for relevant content.
   Use when the student asks about a topic or concept that might be in the curriculum.
   {"action": "search_curriculum", "query": "search term", "topK": 5}

2. lookup_assignment — Find an assignment by name or description to get details and rubric criteria.
   Use when the student references a specific assignment (e.g. "question 3 on the math assignment").
   If the request included an assignmentId, it is resolved exactly — do not guess or search by other criteria.
   {"action": "lookup_assignment", "query": "assignment name or keywords"}
3. search_web — Search the internet for general knowledge, factual references, or hints on a topic.
   Use when the curriculum material search found nothing relevant AND either:
   - the question is general knowledge or factual (e.g. "what does a thesis statement mean?"), OR
   - the student explicitly asks you to search the internet or wants hints on an assignment topic.
   Never use it to get direct answers to graded assignments or for the student's own work.
   {"action": "search_web", "query": "search term", "maxResults": 5}
4. respond_to_student — Give your final answer to the student.
   {"action": "respond_to_student", "answer": "your response", "responseAction": "HINT|EXPLANATION|REDIRECT_TEACHER", "sources": ["source 1", "source 2"]}

Decision rules:
- HINT: The student can figure it out with a small nudge. Point them in the right direction without giving the full answer.
- EXPLANATION: The student needs a concept explained. Provide a thorough explanation with examples.
- REDIRECT_TEACHER: The question requires teacher judgment (e.g. grade disputes, personal feedback, sensitive topics, or the student's own work). Politely explain they should ask their teacher.

Grounding rules:
- Answer ONLY from the curriculum search results. Never use your own knowledge or information outside the results.
- Relevant course material (if any) is already provided in the conversation — prefer it whenever possible.
- If the curriculum search found no relevant material, call search_web when the question is general knowledge or factual OR the student explicitly asked to search the internet or wants hints on an assignment topic. If the question requires teacher judgment (grade disputes, personal feedback, sensitive topics, or the student's own work), respond with responseAction REDIRECT_TEACHER instead. Never answer from your own knowledge.
- If the web search also finds nothing useful, respond with responseAction REDIRECT_TEACHER. Never answer from your own knowledge.
- Web answers must remain hint-level (give direction, examples, or framing — never a ready-made answer to a graded assignment), must cite the web result titles in the sources array, and must note the information is general reference, not course material.
- If the student references a specific assignment, call lookup_assignment instead of searching the curriculum.
- If assignment details are already provided in the conversation, do NOT call lookup_assignment again — the assignment is resolved. Search the curriculum for the topic of the specific question the student is asking about.
- List the material titles from the search results you based your answer on in the sources array.

Always search the curriculum before responding if the question relates to class material. Look up assignments when the student references one. Be encouraging and supportive. Never give direct answers to graded questions — give hints instead.

${FORMATTING_RULES}`;

@Injectable()
export class HomeworkHelperAgent {
  private readonly logger = new Logger(HomeworkHelperAgent.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly materialsService: MaterialsService,
    private readonly prisma: PrismaService,
  ) {}

  async help(params: {
    courseOfferingId: string;
    studentId: string;
    question: string;
    assignmentId?: string;
    onStep?: (step: HomeworkAgentStep) => void;
  }): Promise<{
    answer: string;
    action: 'HINT' | 'EXPLANATION' | 'REDIRECT_TEACHER';
    sources: string[];
    interactionId: string;
  }> {
    const searchCurriculum = createSearchCurriculumTool(this.materialsService);
    const lookupAssignment = createLookupAssignmentTool(this.prisma);
    const logInteraction = createLogInteractionTool(this.prisma);
    const searchWeb = createWebSearchTool(process.env.TAVILY_API_KEY);

    const history: { role: 'user' | 'assistant'; content: string }[] = [
      {
        role: 'user',
        content: `Student question: ${params.question}\nClass ID: ${params.courseOfferingId}`,
      },
    ];

    let webSources: { title: string; url: string }[] = [];

    let assignmentTitle: string | undefined;

    if (params.assignmentId) {
      const assignment = await this.prisma.assignment.findFirst({
        where: {
          id: params.assignmentId,
          courseOfferingId: params.courseOfferingId,
        },
        include: {
          rubrics: { include: { criteria: true } },
        },
      });

      if (!assignment) {
        const answer =
          "I couldn't find that assignment in this class. Try selecting it again from the assignment dropdown.";
        const logResult = await logInteraction.execute({
          studentId: params.studentId,
          courseOfferingId: params.courseOfferingId,
          question: params.question,
          answer,
          action: 'EXPLANATION',
          sources: [],
        });
        return {
          answer,
          action: 'EXPLANATION',
          sources: [],
          interactionId: logResult.interactionId,
        };
      }

      assignmentTitle = assignment.title;
      history.push({
        role: 'user',
        content: `Assignment details:\n${formatAssignmentDetails([assignment])}`,
      });
    }

    params.onStep?.('search_material');
    const seedQuery = assignmentTitle ?? params.question;
    const preSeed = await searchCurriculum.execute({
      courseOfferingId: params.courseOfferingId,
      query: seedQuery,
      topK: 5,
    });
    history.push(
      {
        role: 'assistant',
        content: `Searching course material for: "${seedQuery}"`,
      },
      {
        role: 'user',
        content: this.formatSearchResults(preSeed),
      },
    );

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const userPrompt = history
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n');

        params.onStep?.('thinking');
        const result = await this.llmService.generateStructured({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          schema: HomeworkToolSchema,
        });

        switch (result.action) {
          case 'respond_to_student': {
            const finalSources =
              webSources.length > 0
                ? webSources.map((s) => `${s.title} — ${s.url}`)
                : result.sources;
            const logResult = await logInteraction.execute({
              studentId: params.studentId,
              courseOfferingId: params.courseOfferingId,
              question: params.question,
              answer: result.answer,
              action: result.responseAction,
              sources: finalSources,
            });

            return {
              answer: result.answer,
              action: result.responseAction,
              sources: finalSources,
              interactionId: logResult.interactionId,
            };
          }

          case 'search_curriculum': {
            params.onStep?.('search_material');
            const toolResult = await searchCurriculum.execute({
              courseOfferingId: params.courseOfferingId,
              query: result.query,
              topK: result.topK ?? 5,
            });
            history.push(
              {
                role: 'assistant',
                content: `Searching curriculum for: "${result.query}"`,
              },
              {
                role: 'user',
                content: this.formatSearchResults(toolResult),
              },
            );
            break;
          }

          case 'search_web': {
            params.onStep?.('search_web');
            const toolResult = await searchWeb.execute({
              query: result.query,
              maxResults: result.maxResults ?? 5,
            });
            if (toolResult.count > 0) {
              webSources = toolResult.items ?? [];
            }
            history.push(
              {
                role: 'assistant',
                content: `Searching the web for: "${result.query}"`,
              },
              {
                role: 'user',
                content:
                  toolResult.count === 0
                    ? `Web search results:\n${toolResult.results}\n\nIf the web search also found nothing useful, respond with responseAction "REDIRECT_TEACHER". Do NOT answer from your own knowledge.`
                    : `Web search results (general reference, NOT course material):\n${toolResult.results}`,
              },
            );
            break;
          }

          case 'lookup_assignment': {
            params.onStep?.('search_assignment');
            const toolResult = await lookupAssignment.execute({
              courseOfferingId: params.courseOfferingId,
              query: result.query,
              assignmentId: params.assignmentId,
            });
            history.push(
              {
                role: 'assistant',
                content: `Looking up assignment: "${result.query}"`,
              },
              {
                role: 'user',
                content: toolResult.found
                  ? `Assignment details:\n${toolResult.assignment}`
                  : 'No matching assignment found.',
              },
            );
            break;
          }
        }
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        this.logger.warn(
          `LLM call failed for student ${params.studentId}: ${error.message}`,
        );
        return this.redirectToTeacher(
          logInteraction,
          params,
          'I could not process your question right now. Please ask your teacher for help.',
        );
      }
      throw error;
    }

    return this.redirectToTeacher(
      logInteraction,
      params,
      'I was unable to find a good answer within the available steps. Please try asking in a different way or ask your teacher for help.',
    );
  }

  private formatSearchResults(toolResult: {
    results: string;
    count: number;
  }): string {
    if (toolResult.count > 0) {
      return `Search results:\n${toolResult.results}`;
    }
    return `Search results:\n${toolResult.results}\n\nIMPORTANT: No curriculum material was found for this search. If the student's question is a general-knowledge or factual question, OR the student explicitly asked to search the internet or wants hints on an assignment topic, call search_web to find a general reference or hints. If the question requires teacher judgment (grade disputes, personal feedback, sensitive topics, or the student's own work), respond with responseAction "REDIRECT_TEACHER", politely explaining the topic is not covered in the uploaded material. Do NOT answer from your own knowledge. If the student referenced a specific assignment, call lookup_assignment instead.`;
  }

  private async redirectToTeacher(
    logInteraction: ReturnType<typeof createLogInteractionTool>,
    params: {
      studentId: string;
      courseOfferingId: string;
      question: string;
    },
    answer: string,
  ): Promise<{
    answer: string;
    action: 'HINT' | 'EXPLANATION' | 'REDIRECT_TEACHER';
    sources: string[];
    interactionId: string;
  }> {
    const logResult = await logInteraction.execute({
      studentId: params.studentId,
      courseOfferingId: params.courseOfferingId,
      question: params.question,
      answer,
      action: 'REDIRECT_TEACHER',
      sources: [],
    });

    return {
      answer,
      action: 'REDIRECT_TEACHER',
      sources: [],
      interactionId: logResult.interactionId,
    };
  }
}
