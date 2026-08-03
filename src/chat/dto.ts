import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateThreadSchema = z.object({
  classId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
});

export class CreateThreadDto extends createZodDto(CreateThreadSchema) {}

export const SendMessageSchema = z.object({
  text: z.string().min(1).max(4000),
});

export class SendMessageDto extends createZodDto(SendMessageSchema) {}

export const GetMessagesQuerySchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export class GetMessagesQueryDto extends createZodDto(GetMessagesQuerySchema) {}

export const MessageSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  authorId: z.string().uuid(),
  text: z.string(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export class MessageDto extends createZodDto(MessageSchema) {}

export const ThreadSchema = z.object({
  id: z.string().uuid(),
  classId: z.string().uuid(),
  teacherId: z.string().uuid(),
  studentId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ThreadDto extends createZodDto(ThreadSchema) {}

export const MessagesPageSchema = z.object({
  items: z.array(MessageSchema),
  nextCursor: z.string().uuid().nullable(),
});

export class MessagesPageDto extends createZodDto(MessagesPageSchema) {}
