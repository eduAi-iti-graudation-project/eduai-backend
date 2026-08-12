import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  JOIN_REQUEST_KINDS,
  JOIN_REQUEST_SOURCES,
  JOIN_REQUEST_STATUSES,
} from './join-requests.types';

export const SignupStudentSchema = z.object({
  schoolCode: z.string().min(4).max(12),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  guardianName: z.string().min(1).max(120).optional(),
  guardianEmail: z.string().email().optional(),
  guardianSsn: z.string().min(6).max(20).optional(),
  guardianPhone: z.string().min(6).max(20).optional(),
  guardianNationality: z.string().min(2).max(60).optional(),
});

export const SignupGuardianSchema = z.object({
  schoolCode: z.string().min(4).max(12),
  name: z.string().min(1).max(120),
  personalEmail: z.string().email(),
  password: z.string().min(8).max(72),
  childSchoolEmail: z.string().email(),
  phone: z.string().min(6).max(20).optional(),
  nationality: z.string().min(2).max(60).optional(),
});

export const ListJoinRequestsQuerySchema = z.object({
  status: z.enum(JOIN_REQUEST_STATUSES).optional(),
  source: z.enum(JOIN_REQUEST_SOURCES).optional(),
});

export const DecideJoinRequestsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

const JoinRequestItemSchema = z.object({
  id: z.string().uuid(),
  source: z.enum(JOIN_REQUEST_SOURCES),
  kind: z.enum(JOIN_REQUEST_KINDS),
  status: z.enum(JOIN_REQUEST_STATUSES),
  email: z.string(),
  name: z.string(),
  gradeId: z.string().uuid().nullable(),
  gradeLevelName: z.string().nullable(),
  sectionId: z.string().uuid().nullable(),
  sectionName: z.string().nullable(),
  targetStudentEmail: z.string().nullable(),
  guardianName: z.string().nullable(),
  guardianEmail: z.string().nullable(),
  guardianPhone: z.string().nullable(),
  guardianNationality: z.string().nullable(),
  appliedAt: z.date(),
  decidedAt: z.date().nullable(),
});

const JoinRequestListResponseSchema = z.object({
  items: z.array(JoinRequestItemSchema),
  counts: z.object({
    pending: z.number(),
    approved: z.number(),
    rejected: z.number(),
  }),
});

const SchoolByCodeResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  gradeLevels: z.array(
    z.object({
      id: z.string().uuid(),
      level: z.number(),
      name: z.string().nullable(),
    }),
  ),
});

const SignupStudentResponseSchema = z.object({
  requestId: z.string().uuid(),
  matchedFromRoster: z.boolean(),
  gradeLevelName: z.string().nullable(),
  status: z.enum(JOIN_REQUEST_STATUSES),
});

export class SignupStudentDto extends createZodDto(SignupStudentSchema) {}
export class SignupGuardianDto extends createZodDto(SignupGuardianSchema) {}
export class ListJoinRequestsQuery extends createZodDto(
  ListJoinRequestsQuerySchema,
) {}
export class DecideJoinRequestsDto extends createZodDto(
  DecideJoinRequestsSchema,
) {}
export class SchoolByCodeResponseDto extends createZodDto(
  SchoolByCodeResponseSchema,
) {}
export class SignupStudentResponseDto extends createZodDto(
  SignupStudentResponseSchema,
) {}
export class JoinRequestListResponseDto extends createZodDto(
  JoinRequestListResponseSchema,
) {}
