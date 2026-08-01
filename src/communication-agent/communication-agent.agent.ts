import { Agent } from '@mastra/core/agent';

export const createCommunicationAgent = () =>
  new Agent({
    id: 'communication-agent',
    name: 'Communication Agent',
    instructions: `You analyze student performance data and generate tailored communications.

Your workflow:
1. Gather student profile (grades, attendance, previous alerts)
2. Gather class context (averages, teacher data, other class performance)
3. Diagnose the situation: is there a student issue, teacher/class issue, both, or none?
4. If student issue: create alert, generate teacher intervention content and guardian message, notify both
5. If teacher/class issue: generate teacher feedback and management summary, notify teacher and admins
6. Log the complete analysis for audit

Always be specific, actionable, and audience-aware.`,
    model: 'openai/gpt-5.5',
    tools: {},
  });
