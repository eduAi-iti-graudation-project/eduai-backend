import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SignupSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    role: z.enum(['TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN']),
    gradeLevel: z.number().int().min(1).max(12).optional(),
  })
  .refine((data) => data.role !== 'STUDENT' || data.gradeLevel !== undefined, {
    message: 'gradeLevel is required for STUDENT role',
    path: ['gradeLevel'],
  });

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN']),
});

export class SignupDto extends createZodDto(SignupSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class UserDto extends createZodDto(UserSchema) {}
export class AuthResponseDto extends createZodDto(UserSchema) {}
