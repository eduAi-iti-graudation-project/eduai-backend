import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AssignOfferingSchema = z.object({
  offeringId: z.string().uuid(),
});

export class AddTeacherGradeDto extends createZodDto(AssignOfferingSchema) {}

export const UpdateTeacherProfileSchema = z.object({
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
});

export class UpdateTeacherProfileDto extends createZodDto(
  UpdateTeacherProfileSchema,
) {}

export const CreateTeacherDocumentSchema = z.object({
  type: z
    .enum([
      'SOCIAL_SECURITY',
      'NATIONAL_ID',
      'PASSPORT',
      'LICENSE',
      'DEGREE',
      'CONTRACT',
      'OTHER',
    ])
    .default('OTHER'),
  title: z.string().min(1).max(200),
});

export class CreateTeacherDocumentDto extends createZodDto(
  CreateTeacherDocumentSchema,
) {}

export const CreateSalarySchema = z.object({
  period: z.string().min(1).max(30),
  amount: z.coerce.number().nonnegative(),
  amountPaid: z.coerce.number().nonnegative().optional().nullable(),
  status: z.enum(['PAID', 'PARTIAL', 'POSTPONED', 'UNPAID']).default('UNPAID'),
  body: z.string().max(500).optional().nullable(),
  paidAt: z.string().datetime().optional().nullable(),
});

export class CreateSalaryDto extends createZodDto(CreateSalarySchema) {}
