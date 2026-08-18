import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const GuardianChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const GuardianChatRequestSchema = z.object({
  studentId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  messages: z.array(GuardianChatMessageSchema),
  newMessage: z.string().min(1),
});

export const GuardianReplySchema = z.object({
  reply: z.string(),
  sources: z.array(z.string()),
});

export type GuardianAgentStep =
  | 'read_grades'
  | 'read_attendance'
  | 'read_classes'
  | 'read_alerts'
  | 'read_insights'
  | 'thinking';

export type GuardianChatEvent =
  | { type: 'step'; step: GuardianAgentStep }
  | {
      type: 'done';
      data: { reply: string; sources: string[]; conversationId: string };
    }
  | { type: 'error'; message: string };

export class GuardianChatRequestDto extends createZodDto(
  GuardianChatRequestSchema,
) {}
export class GuardianReplyDto extends createZodDto(GuardianReplySchema) {}
