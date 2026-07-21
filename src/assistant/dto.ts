import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const ChatSchema = z.object({
  classId: z.string().uuid(),
  messages: z.array(MessageSchema),
  newMessage: z.string().min(1),
});

const QuizQuestionSchema = z.object({
  type: z.enum(['mcq', 'short_answer']),
  question: z.string().min(1),
  options: z.array(z.string()).length(4).optional(),
  correctAnswer: z.string().min(1),
  explanation: z.string().optional(),
});

export const QuizSchema = z.object({
  title: z.string().min(1),
  questions: z.array(QuizQuestionSchema).min(1).max(20),
});

const ChatResponseSchema = z.object({
  reply: z.string(),
  quiz: QuizSchema.optional(),
});

export const ToolCallSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search_curriculum'),
    query: z.string(),
    topK: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    action: z.literal('create_quiz'),
    topic: z.string().min(1),
    questionCount: z.number().int().min(1).max(20).optional(),
    types: z.array(z.enum(['mcq', 'short_answer'])).optional(),
  }),
  z.object({
    action: z.literal('respond'),
    reply: z.string(),
  }),
]);

export type Quiz = z.infer<typeof QuizSchema>;

export class ChatDto extends createZodDto(ChatSchema) {}
export class ChatResponseDto extends createZodDto(ChatResponseSchema) {}
