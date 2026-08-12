import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AssignOfferingSchema = z.object({
  offeringId: z.string().uuid(),
});

export class AddTeacherGradeDto extends createZodDto(AssignOfferingSchema) {}

export const UpdateTeacherProfileSchema = z.object({
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
  ssn: z
    .string()
    .regex(
      /^\d{3}[-\s]?\d{2}[-\s]?\d{4}$/,
      'SSN must be 9 digits (e.g. 123-45-6789)',
    )
    .optional(),
  phone: z.string().min(6).max(30).nullable().optional(),
  street: z.string().min(1).max(120).nullable().optional(),
  city: z.string().min(1).max(80).nullable().optional(),
  nationality: z.string().min(1).max(80).nullable().optional(),
  personalEmail: z.string().email().nullable().optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
    .nullable()
    .optional(),
  emergencyContactName: z.string().min(1).max(120).nullable().optional(),
  emergencyContactPhone: z.string().min(6).max(30).nullable().optional(),
  emergencyContactRelationship: z.string().min(1).max(60).nullable().optional(),
});

export class UpdateTeacherProfileDto extends createZodDto(
  UpdateTeacherProfileSchema,
) {}

export const UpdateTeacherMeSchema = UpdateTeacherProfileSchema.omit({
  gender: true,
  ssn: true,
});

export class UpdateTeacherMeDto extends createZodDto(UpdateTeacherMeSchema) {}

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
