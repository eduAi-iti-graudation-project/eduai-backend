import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const InviteMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(['TEACHER', 'STUDENT']),
});

export class InviteMemberDto extends createZodDto(InviteMemberSchema) {}

export const RequestStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

export const ApproveRequestSchema = z.object({
  role: z.enum(['TEACHER', 'STUDENT']).optional(),
});

export class ApproveRequestDto extends createZodDto(ApproveRequestSchema) {}

export const EmailDomainSchema = z.object({
  emailDomain: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i,
      'The domain must look like "school.example.org".',
    ),
});

export class EmailDomainDto extends createZodDto(EmailDomainSchema) {}
