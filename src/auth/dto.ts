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

export const TeacherSignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(120),
  joinCode: z.string().min(4).max(12),
  ssn: z
    .string()
    .regex(
      /^\d{3}[-\s]?\d{2}[-\s]?\d{4}$/,
      'SSN must be 9 digits (e.g. 123-45-6789)',
    ),
  phone: z.string().min(6).max(30),
  street: z.string().min(1).max(120),
  city: z.string().min(1).max(80),
  nationality: z.string().min(1).max(80).optional(),
  personalEmail: z.string().email().optional().or(z.literal('')),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
    .transform((v) => new Date(`${v}T00:00:00.000Z`)),
  emergencyContactName: z.string().min(1).max(120).optional(),
  emergencyContactPhone: z.string().min(6).max(30).optional(),
  emergencyContactRelationship: z.string().min(1).max(60).optional(),
});

export const OauthProviderSchema = z.enum(['google', 'microsoft']);

export const OauthAuthorizeParamsSchema = z.object({
  provider: OauthProviderSchema,
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const ResendCredentialsSchema = z.object({
  personalEmail: z.string().email(),
});

export const OauthOnboardSchema = z
  .object({
    organizationName: z.string().min(1).max(120).optional(),
    joinCode: z.string().min(4).max(12).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.organizationName && !data.joinCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['organizationName'],
        message:
          'Provide an organization name or a join code to finish onboarding.',
      });
    }
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
export class TeacherSignupDto extends createZodDto(TeacherSignupSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class UserDto extends createZodDto(UserSchema) {}
export class AuthResponseDto extends createZodDto(UserSchema) {}
export class OauthAuthorizeParams extends createZodDto(
  OauthAuthorizeParamsSchema,
) {}
export class RefreshDto extends createZodDto(RefreshSchema) {}
export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
export class VerifyEmailDto extends createZodDto(VerifyEmailSchema) {}
export class ResendCredentialsDto extends createZodDto(
  ResendCredentialsSchema,
) {}
export class OauthOnboardDto extends createZodDto(OauthOnboardSchema) {}
export class ProvidersResponseDto extends createZodDto(
  ProvidersResponseSchema,
) {}
export class OauthAuthorizeResponseDto extends createZodDto(
  OauthAuthorizeResponseSchema,
) {}
export class RefreshResponseDto extends createZodDto(RefreshResponseSchema) {}
