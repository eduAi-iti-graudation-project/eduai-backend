import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DAYS_OF_WEEK } from './timetable.service';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeSchema = z
  .string()
  .regex(timePattern, 'Time must be in 24-hour HH:MM format.');

export const CreateTimetableSlotSchema = z.object({
  courseOfferingId: z.string().uuid(),
  dayOfWeek: z.enum(DAYS_OF_WEEK),
  startTime: TimeSchema,
  endTime: TimeSchema,
  room: z.string().trim().max(100).optional().nullable(),
});

export const UpdateTimetableSlotSchema = z
  .object({
    dayOfWeek: z.enum(DAYS_OF_WEEK).optional(),
    startTime: TimeSchema.optional(),
    endTime: TimeSchema.optional(),
    room: z.string().trim().max(100).optional().nullable(),
  })
  .refine(
    (data) =>
      !(data.startTime && !data.endTime) && !(!data.startTime && data.endTime),
    { message: 'startTime and endTime must be provided together.' },
  );

export const CheckConflictQuerySchema = z.object({
  courseOfferingId: z.string().uuid(),
  day: z.enum(DAYS_OF_WEEK),
  start: TimeSchema,
  end: TimeSchema,
  excludeSlotId: z.string().uuid().optional(),
});

export const SlotConflictSchema = z.object({
  kind: z.enum(['teacher', 'section']),
  conflictingSlot: z.object({
    id: z.string().uuid(),
    dayOfWeek: z.enum(DAYS_OF_WEEK),
    startTime: z.string(),
    endTime: z.string(),
    courseOfferingId: z.string().uuid(),
    courseName: z.string(),
    sectionName: z.string(),
  }),
});

export const CheckConflictResultSchema = z.object({
  conflict: SlotConflictSchema.nullable(),
});

const TimetableSlotSchema = z.object({
  id: z.string().uuid(),
  courseOfferingId: z.string().uuid(),
  organizationId: z.string().uuid(),
  dayOfWeek: z.enum(DAYS_OF_WEEK),
  startTime: z.string(),
  endTime: z.string(),
  room: z.string().nullable(),
  createdAt: z.string(),
});

const TimetableSlotWithOfferingSchema = TimetableSlotSchema.extend({
  courseOffering: z.object({
    id: z.string().uuid(),
    courseId: z.string().uuid(),
    sectionId: z.string().uuid(),
    teacherId: z.string().uuid(),
    course: z.object({
      id: z.string().uuid(),
      name: z.string(),
      colorTag: z.string().nullable(),
    }),
    section: z.object({
      id: z.string().uuid(),
      name: z.string(),
      gradeLevelId: z.string().uuid(),
    }),
  }),
});

export class CreateTimetableSlotDto extends createZodDto(
  CreateTimetableSlotSchema,
) {}
export class UpdateTimetableSlotDto extends createZodDto(
  UpdateTimetableSlotSchema,
) {}
export class CheckConflictQueryDto extends createZodDto(
  CheckConflictQuerySchema,
) {}
export class CheckConflictResultDto extends createZodDto(
  CheckConflictResultSchema,
) {}
export class TimetableSlotDto extends createZodDto(TimetableSlotSchema) {}
export class TimetableSlotWithOfferingDto extends createZodDto(
  TimetableSlotWithOfferingSchema,
) {}
