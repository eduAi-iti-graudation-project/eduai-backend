import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { MaterialsService } from '../materials/materials.service';
import { PrismaService } from '../prisma/prisma.service';
import { HomeworkToolSchema } from './dto';
import { createSearchCurriculumTool } from './tools/search-curriculum.tool';
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
3. respond_to_student — Give your final answer to the student.
   {"action": "respond_to_student", "answer": "your response", "responseAction": "HINT|EXPLANATION|REDIRECT_TEACHER", "sources": ["source 1", "source 2"]}

Decision rules:
- HINT: The student can figure it out with a small nudge. Point them in the right direction without giving the full answer.
- EXPLANATION: The student needs a concept explained. Provide a thorough explanation with examples.
- REDIRECT_TEACHER: The question requires teacher judgment (e.g. grade disputes, personal feedback, sensitive topics). Politely explain they should ask their teacher.

Grounding rules:
- Answer ONLY from the curriculum search results. Never use your own knowledge or information outside the results.
- If the search results say no relevant material was found, respond with responseAction REDIRECT_TEACHER and politely explain the topic is not covered in the uploaded material. Never answer from your own knowledge.
- If the student references a specific assignment, call lookup_assignment instead of searching the curriculum.
- If assignment details are already provided in the conversation, do NOT call lookup_assignment again — the assignment is resolved. Search the curriculum for the topic of the specific question the student is asking about.
- List the material titles from the search results you based your answer on in the sources array.

Always search the curriculum before responding if the question relates to class material. Look up assignments when the student references one. Be encouraging and supportive. Never give direct answers to graded questions — give hints instead.`;

@Injectable()
export class HomeworkHelperAgent {
  private readonly logger = new Logger(HomeworkHelperAgent.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly materialsService: MaterialsService,
    private readonly prisma: PrismaService,
  ) {}

  async help(params: {
    classId: string;
    studentId: string;
    question: string;
    assignmentId?: string;
  }): Promise<{
    answer: string;
    action: 'HINT' | 'EXPLANATION' | 'REDIRECT_TEACHER';
    sources: string[];
    interactionId: string;
  }> {
    const searchCurriculum = createSearchCurriculumTool(this.materialsService);
    const lookupAssignment = createLookupAssignmentTool(this.prisma);
    const logInteraction = createLogInteractionTool(this.prisma);

    const history: { role: 'user' | 'assistant'; content: string }[] = [
      {
        role: 'user',
        content: `Student question: ${params.question}\nClass ID: ${params.classId}`,
      },
    ];

    if (params.assignmentId) {
      const assignment = await this.prisma.assignment.findFirst({
        where: { id: params.assignmentId, classId: params.classId },
        include: {
          rubrics: { include: { criteria: true } },
        },
      });

      if (!assignment) {
        const answer =
          "I couldn't find that assignment in this class. Try selecting it again from the assignment dropdown.";
        const logResult = await logInteraction.execute({
          studentId: params.studentId,
          classId: params.classId,
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

      history.push({
        role: 'user',
        content: `Assignment details:\n${formatAssignmentDetails([assignment])}`,
      });
    }

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const userPrompt = history
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n');

      const result = await this.llmService.generateStructured({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        schema: HomeworkToolSchema,
      });

      switch (result.action) {
        case 'respond_to_student': {
          const logResult = await logInteraction.execute({
            studentId: params.studentId,
            classId: params.classId,
            question: params.question,
            answer: result.answer,
            action: result.responseAction,
            sources: result.sources,
          });

          return {
            answer: result.answer,
            action: result.responseAction,
            sources: result.sources,
            interactionId: logResult.interactionId,
          };
        }

        case 'search_curriculum': {
          const toolResult = await searchCurriculum.execute({
            classId: params.classId,
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
              content:
                toolResult.count === 0
                  ? `Search results:\n${toolResult.results}\n\nIMPORTANT: No curriculum material was found for this search. If the student's question relates to class material, you MUST respond with responseAction "REDIRECT_TEACHER", politely explaining the topic is not covered in the uploaded material. Do NOT answer from your own knowledge. If the student referenced a specific assignment, call lookup_assignment instead.`
                  : `Search results:\n${toolResult.results}`,
            },
          );
          break;
        }

        case 'lookup_assignment': {
          const toolResult = await lookupAssignment.execute({
            classId: params.classId,
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

    return {
      answer:
        'I was unable to find a good answer within the available steps. Please try asking in a different way or ask your teacher for help.',
      action: 'REDIRECT_TEACHER',
      sources: [],
      interactionId: '',
    };
  }
}
