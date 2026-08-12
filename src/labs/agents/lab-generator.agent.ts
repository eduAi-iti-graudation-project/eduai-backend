import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import {
  createGatewayLanguageModel,
  type GatewayChat,
} from '../../struggle-signals/gateway-language-model';

/** The generator's structured output: the raw simulation code as a string. */
export const LabGeneratorOutputSchema = z.object({
  code: z.string().min(1),
});

export type LabGeneratorOutput = z.infer<typeof LabGeneratorOutputSchema>;

export const GENERATOR_SYSTEM_PROMPT = `You are a science lab simulator generator for a teacher. Given curriculum context retrieved from the class's uploaded material, you write a single, self-contained Matter.js physics/canvas simulation that lets students explore the topic hands-on.

HARD CONSTRAINTS — violating any of these is an automatic rejection:
- Write ONLY plain Matter.js + HTML5 canvas JavaScript code that runs in a sandboxed iframe. The global \`Matter\` object is already available — never import, require, or load any library, including Matter.js itself.
- NEVER use fetch, XMLHttpRequest, WebSocket, EventSource, eval, the Function constructor, setTimeout/setInterval with a string argument, import, require, importScripts, or navigator.sendBeacon.
- NEVER reference window.parent, window.top, parent, document.cookie, localStorage, or sessionStorage.
- NO network calls, navigation, external URLs, or CDN references of any kind.
- Do not use anything that is not provided in the user prompt.

The sandbox provides:
- a global \`Matter\` (the Matter.js engine), and
- a plain function \`reportLabObjectiveComplete()\` you MAY call when the simulation's objective is achieved.
- a full-size container div with id "sim". Render the simulation into it, e.g. Matter.Render.create({ element: document.getElementById('sim'), engine: engine }).
- The simulation must start running immediately when your script executes. Use Matter.Runner and Matter.Engine.create as you normally would.

WIN CONDITION (mandatory):
- Include a simple win/objective condition as REAL code logic inside the simulation, e.g. "keep the pendulum swinging above 40 degrees for 10 consecutive seconds", "get the ball into the goal", "stand the stack upright for 5 seconds".
- When the condition becomes true, call reportLabObjectiveComplete().
- The objective must be achievable, must be communicated to the student with on-canvas text, and must be checked against the simulation's physics state — not a bare timer hack.

GROUNDING:
- Base the simulation's setup, parameters, labels, and on-canvas explanations ONLY on the curriculum context provided in the user prompt. Never invent facts, formulas, or values not present in the context.
- If the context says no material was found, output an empty code string.

OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown fences, no commentary outside the JSON.
{"code": "the complete simulation JavaScript as a string"}`;

export function buildLabGenerationPrompt(input: {
  topic: string;
  curriculum: string;
}): string {
  return `Topic: ${input.topic}

Curriculum context:
${input.curriculum}`;
}

/**
 * The lab generator as a REAL executed Mastra agent. The sandbox contract is
 * described in the instructions: generated code is limited to Matter.js +
 * canvas, may call reportLabObjectiveComplete(), and must never touch network,
 * storage, parent frames, or any import.
 */
export const createLabGenerator = (chat: GatewayChat) =>
  new Agent({
    id: 'lab-generator',
    name: 'Science Lab Generator',
    instructions: GENERATOR_SYSTEM_PROMPT,
    model: createGatewayLanguageModel(chat),
    tools: {},
  });

export type LabGenerator = ReturnType<typeof createLabGenerator>;
