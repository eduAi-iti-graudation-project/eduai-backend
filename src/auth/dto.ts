import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SignupSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    organizationName: z.string().min(1).optional(),
    joinCode: z.string().min(4).max(12).optional(),
    role: z.enum(['TEACHER', 'STUDENT']).optional(),
    gradeLevel: z.number().int().min(1).max(12).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.joinCode && !data.role) {
      ctx.addIssue({
        code: 'custom',
        path: ['role'],
        message: 'A role is required when joining an organization.',
      });
    }
    if (data.role === 'STUDENT' && !data.gradeLevel) {
      ctx.addIssue({
        code: 'custom',
        path: ['gradeLevel'],
        message: 'A grade level is required for students.',
      });
    }
  });

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const OauthProviderSchema = z.enum(['google', 'microsoft']);

export const OauthAuthorizeParamsSchema = z.object({
  provider: OauthProviderSchema,
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['TEACHER', 'STUDENT', 'GUARDIAN', 'ADMIN']),
});

const ProviderInfoSchema = z.object({
  provider: OauthProviderSchema,
  enabled: z.boolean(),
});

const ProvidersResponseSchema = z.object({
  providers: z.array(ProviderInfoSchema),
});

const OauthAuthorizeResponseSchema = z.object({
  url: z.string(),
});

const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export class SignupDto extends createZodDto(SignupSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class UserDto extends createZodDto(UserSchema) {}
export class AuthResponseDto extends createZodDto(UserSchema) {}
export class OauthAuthorizeParams extends createZodDto(
  OauthAuthorizeParamsSchema,
) {}
export class RefreshDto extends createZodDto(RefreshSchema) {}
export class ProvidersResponseDto extends createZodDto(
  ProvidersResponseSchema,
) {}
export class OauthAuthorizeResponseDto extends createZodDto(
  OauthAuthorizeResponseSchema,
) {}
export class RefreshResponseDto extends createZodDto(RefreshResponseSchema) {}
