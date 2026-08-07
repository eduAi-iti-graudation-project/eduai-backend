import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const AttendanceStatusEnum = z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);

const AttendanceRecordSchema = z.object({
  studentId: z.string().uuid(),
  sectionId: z.string().uuid(),
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
  date: z.string(),
  status: AttendanceStatusEnum,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class ImportAttendanceDto extends createZodDto(ImportAttendanceSchema) {}
export class AttendanceResponseDto extends createZodDto(
  AttendanceResponseSchema,
) {}
