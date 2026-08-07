import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const GradeSchema = z.object({
  id: z.string().uuid(),
  submissionId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  criteriaId: z.string().uuid(),
  pointsAwarded: z.number(),
  aiFeedback: z.string().nullable(),
  teacherNotes: z.string().nullable(),
  isConfirmed: z.boolean(),
  createdAt: z.string(),
  criterionDescription: z.string(),
  criterionMaxPoints: z.number(),
});

export const UpdateStudentSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  gradeLevelId: z.string().uuid().optional(),
  guardianId: z.string().uuid().optional(),
});

export const CreateDocumentSchema = z.object({
  type: z.enum([
    'CERTIFICATE',
    'REPORT_CARD',
    'TRANSCRIPT',
    'IMMUNIZATION',
    'TRANSFER',
    'ENROLLMENT_FORM',
    'ID',
    'MEDICAL',
    'OTHER',
  ]),
  title: z.string().min(1),
  academicYear: z.string().min(2).max(20).optional().nullable(),
});

export const CreateFeeSchema = z.object({
  academicYear: z.string().min(2).max(20),
  feeType: z.enum(['TUITION', 'REGISTRATION', 'EXAM', 'MATERIALS', 'OTHER']),
  amount: z.coerce.number().nonnegative(),
  amountPaid: z.coerce.number().nonnegative().optional().nullable(),
  status: z.enum(['PAID', 'PARTIAL', 'POSTPONED', 'UNPAID']),
  body: z.string().optional().nullable(),
  paidAt: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
});

export class GradeDto extends createZodDto(GradeSchema) {}
export class UpdateStudentDto extends createZodDto(UpdateStudentSchema) {}
export class CreateDocumentDto extends createZodDto(CreateDocumentSchema) {}
export class CreateFeeDto extends createZodDto(CreateFeeSchema) {}
