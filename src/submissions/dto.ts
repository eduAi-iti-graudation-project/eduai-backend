import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSubmissionSchema = z.object({
  assignmentId: z.string().uuid(),
  content: z.string().min(1),
});

const SubmissionSchema = z.object({
  id: z.string().uuid(),
  assignmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  status: z.enum([
    'SUBMITTED',
    'GRADING_IN_PROGRESS',
    'REVIEW_READY',
    'CONFIRMED',
  ]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class CreateSubmissionDto extends createZodDto(CreateSubmissionSchema) {}
export class SubmissionDto extends createZodDto(SubmissionSchema) {}
