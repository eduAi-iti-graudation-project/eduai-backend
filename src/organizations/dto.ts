import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const InviteMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(['TEACHER', 'STUDENT']),
});

export class InviteMemberDto extends createZodDto(InviteMemberSchema) {}
