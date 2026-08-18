import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AdminChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const AdminChatRequestSchema = z.object({
  scopeStudentId: z.string().uuid().optional(),
  scopeTeacherId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  messages: z.array(AdminChatMessageSchema),
  newMessage: z.string().min(1),
});

export const AdminReplySchema = z.object({
  reply: z.string(),
  sources: z.array(z.string()),
});

export const AdminDomainSchema = z.enum([
  'overview',
  'alerts',
  'insights',
  'requests',
  'billing',
  'student',
  'teacher',
]);
export type AdminDomain = z.infer<typeof AdminDomainSchema>;

export const AdminPlanSchema = z.object({
  domains: z.array(AdminDomainSchema),
});

export const AdminSpecialistSchema = z.object({
  summary: z.string(),
  facts: z.array(z.string()),
});

export type AdminAgentStep =
  | 'routing'
  | 'read_overview'
  | 'read_alerts'
  | 'read_insights'
  | 'read_requests'
  | 'read_billing'
  | 'read_profile'
  | 'thinking';

export type AdminChatEvent =
  | { type: 'step'; step: AdminAgentStep }
  | {
      type: 'done';
      data: { reply: string; sources: string[]; conversationId: string };
    }
  | { type: 'error'; message: string };

export class AdminChatRequestDto extends createZodDto(AdminChatRequestSchema) {}
export class AdminReplyDto extends createZodDto(AdminReplySchema) {}