import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SSN_PATTERN = /^\d{3}[- ]?\d{2}[- ]?\d{4}$/;

export const UpdateGuardianProfileSchema = z.object({
  personalEmail: z.string().email().optional(),
  phone: z.string().min(1).optional(),
  street: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  nationality: z.string().min(1).optional(),
  dateOfBirth: z.string().datetime().optional().nullable(),
  ssn: z.string().regex(SSN_PATTERN).optional(),
  emergencyContactName: z.string().min(1).optional(),
  emergencyContactPhone: z.string().min(1).optional(),
  emergencyContactRelationship: z.string().min(1).optional(),
});

export class UpdateGuardianProfileDto extends createZodDto(
  UpdateGuardianProfileSchema,
) {}
