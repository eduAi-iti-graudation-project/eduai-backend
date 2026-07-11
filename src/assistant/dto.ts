import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const ChatSchema = z.object({
  messages: z.array(MessageSchema),
  newMessage: z.string().min(1),
});

const ChatResponseSchema = z.object({
  reply: z.string(),
});

export class ChatDto extends createZodDto(ChatSchema) {}
export class ChatResponseDto extends createZodDto(ChatResponseSchema) {}
