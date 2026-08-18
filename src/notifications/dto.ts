import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string(),
  channel: z.enum(['EMAIL', 'PUSH']),
  title: z.string(),
  body: z.string().nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  data: z.record(z.string(), z.unknown()).nullable(),
});

export class NotificationDto extends createZodDto(NotificationSchema) {}
