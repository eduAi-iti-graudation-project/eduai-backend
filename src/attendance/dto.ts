import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AttendanceStatusEnum = z.enum([
  'PRESENT',
  'ABSENT',
  'LATE',
  'EXCUSED',
]);
const SessionStatusEnum = z.enum(['OPEN', 'CLOSED', 'EXPIRED']);
const FineTypeEnum = z.enum(['ATTENDANCE', 'LATE', 'OTHER']);
const FineStatusEnum = z.enum(['PAID', 'PARTIAL', 'POSTPONED', 'UNPAID']);

const AttendanceRecordSchema = z.object({
  studentId: z.string().uuid(),
  courseOfferingId: z.string().uuid(),
  date: z.string(),
  status: AttendanceStatusEnum,
});

export const ImportAttendanceSchema = z.object({
  records: z.array(AttendanceRecordSchema).min(1),
});

const AttendanceResponseSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  sectionId: z.string().uuid(),
  courseOfferingId: z.string().uuid().nullable(),
  date: z.string(),
  status: AttendanceStatusEnum,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const OpenSessionSchema = z.object({
  courseOfferingId: z.string().uuid(),
});

const SessionResponseSchema = z.object({
  id: z.string().uuid(),
  courseOfferingId: z.string().uuid(),
  teacherId: z.string().uuid(),
  date: z.string(),
  token: z.string(),
  status: SessionStatusEnum,
  openedAt: z.string(),
  expiresAt: z.string(),
  closedAt: z.string().nullable(),
  courseName: z.string().optional(),
  sectionName: z.string().optional(),
});

const CheckInSchema = z.object({
  token: z.string().min(8),
});

const CheckInResponseSchema = z.object({
  alreadyCheckedIn: z.boolean(),
  status: AttendanceStatusEnum,
  date: z.string(),
  courseName: z.string(),
  sectionName: z.string(),
  teacherName: z.string(),
});

const TeacherLedgerQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  status: AttendanceStatusEnum.optional(),
});

const CreateTeacherFineSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(3),
  type: FineTypeEnum.optional(),
  status: FineStatusEnum.optional(),
  amountPaid: z.number().nonnegative().optional(),
  dueDate: z.string().optional(),
});

const UpdateTeacherFineSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.string().min(3).optional(),
  type: FineTypeEnum.optional(),
  status: FineStatusEnum.optional(),
  amountPaid: z.number().nonnegative().optional(),
  dueDate: z.string().nullable().optional(),
});

const TeacherFineResponseSchema = z.object({
  id: z.string().uuid(),
  teacherId: z.string().uuid(),
  amount: z.union([z.number(), z.string()]),
  reason: z.string(),
  type: FineTypeEnum,
  status: FineStatusEnum,
  amountPaid: z.union([z.number(), z.string()]).nullable(),
  dueDate: z.string().nullable(),
  issuedById: z.string().uuid(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class ImportAttendanceDto extends createZodDto(ImportAttendanceSchema) {}
export class AttendanceResponseDto extends createZodDto(
  AttendanceResponseSchema,
) {}
export class OpenSessionDto extends createZodDto(OpenSessionSchema) {}
export class SessionResponseDto extends createZodDto(SessionResponseSchema) {}
export class CheckInDto extends createZodDto(CheckInSchema) {}
export class CheckInResponseDto extends createZodDto(CheckInResponseSchema) {}
export class TeacherLedgerQueryDto extends createZodDto(
  TeacherLedgerQuerySchema,
) {}
export class CreateTeacherFineDto extends createZodDto(
  CreateTeacherFineSchema,
) {}
export class UpdateTeacherFineDto extends createZodDto(
  UpdateTeacherFineSchema,
) {}
export class TeacherFineResponseDto extends createZodDto(
  TeacherFineResponseSchema,
) {}
