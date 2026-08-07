import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DOCUMENT_CATEGORIES } from './documents.service';

export const ConfirmAssignmentSchema = z.object({
  studentId: z.string().uuid(),
  category: z.enum(DOCUMENT_CATEGORIES),
});

export class ConfirmAssignmentDto extends createZodDto(
  ConfirmAssignmentSchema,
) {}
