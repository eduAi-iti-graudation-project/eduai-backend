import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const AlertSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  reason: z.string(),
  status: z.string(),
  studentId: z.string().uuid(),
  createdAt: z.string(),
});

export class AlertDto extends createZodDto(AlertSchema) {}
