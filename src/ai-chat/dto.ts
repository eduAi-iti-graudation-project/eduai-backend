import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AiChatConversationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['ASSISTANT', 'GUARDIAN', 'ADMIN']),
  courseOfferingId: z.string().uuid().nullable(),
  studentId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  lastMessage: z.string().nullable(),
  lastMessageRole: z.enum(['user', 'assistant']).nullable(),
  messageCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AiChatMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  sources: z.array(z.string()).nullable(),
  createdAt: z.string(),
});

export const AiChatConversationListSchema = z.object({
  items: z.array(AiChatConversationSchema),
});

export class AiChatConversationDto extends createZodDto(
  AiChatConversationSchema,
) {}
export class AiChatMessageDto extends createZodDto(AiChatMessageSchema) {}
export class AiChatConversationListDto extends createZodDto(
  AiChatConversationListSchema,
) {}
