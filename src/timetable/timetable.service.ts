import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';

export const DAYS_OF_WEEK = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export interface SlotConflict {
  kind: 'teacher' | 'section';
  conflictingSlot: {
    id: string;
    dayOfWeek: DayOfWeek;
    startTime: string;
    endTime: string;
    courseOfferingId: string;
    courseName: string;
    sectionName: string;
  };
}

function toTimeString(time: string | Date): string {
  if (typeof time === 'string') return time;
  const hh = String(time.getUTCHours()).padStart(2, '0');
  const mm = String(time.getUTCMinutes()).padStart(2, '0');
  const ss = String(time.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function normalizeTime(time: string | Date): string {
  const normalized = toTimeString(time);
  return normalized.length === 5 ? `${normalized}:00` : normalized;
}

/**
 * Prisma requires a Date (ISO-8601) for @db.Time columns — a bare
 * "HH:MM:SS" string is rejected. Encode the wall-clock time on a fixed
 * UTC date so the time component round-trips exactly.
 */
function timeToDate(time: string | Date): Date {
  return new Date(`1970-01-01T${normalizeTime(time)}Z`);
}

/** Map a slot's Date-valued time columns back to plain "HH:MM:SS" strings. */
function toApiSlot<
  T extends { startTime: Date | string; endTime: Date | string },
>(slot: T): T & { startTime: string; endTime: string } {
  return {
    ...slot,
    startTime: normalizeTime(slot.startTime),
    endTime: normalizeTime(slot.endTime),
  };
}

function normalizeRange(
  startTime: string | Date,
  endTime: string | Date,
): { startTime: string; endTime: string } {
  return {
    startTime: normalizeTime(startTime),
    endTime: normalizeTime(endTime),
  };
}

function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface TimetableSlotData {
  courseOfferingId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  room?: string | null;
}

@Injectable()
export class TimetableService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shared conflict check used by both create and update paths.
   * Returns the first conflicting slot, or null when the slot is conflict-free.
   */
  async checkTimetableConflict(
    courseOfferingId: string,
    dayOfWeek: DayOfWeek,
    startTime: string | Date,
    endTime: string | Date,
    organizationId: string,
    excludeSlotId?: string,
  ): Promise<SlotConflict | null> {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId },
      select: { id: true, teacherId: true, sectionId: true },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course offering could not be found.',
      );
    }

    const { startTime: start, endTime: end } = normalizeRange(
      startTime,
      endTime,
    );

    const slots = await this.prisma.timetableSlot.findMany({
      where: {
        organizationId,
        dayOfWeek,
        courseOffering: {
          OR: [
            { teacherId: offering.teacherId },
            { sectionId: offering.sectionId },
          ],
        },
        ...(excludeSlotId ? { NOT: { id: excludeSlotId } } : {}),
      },
      select: {
        id: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        courseOfferingId: true,
        courseOffering: {
          select: {
            id: true,
            teacherId: true,
            sectionId: true,
            course: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
      },
    });

    for (const slot of slots) {
      const slotStart = normalizeTime(slot.startTime);
      const slotEnd = normalizeTime(slot.endTime);
      if (!rangesOverlap(start, end, slotStart, slotEnd)) {
        continue;
      }
      const teacherConflict =
        slot.courseOffering.teacherId === offering.teacherId;
      const kind = teacherConflict ? 'teacher' : 'section';
      return {
        kind,
        conflictingSlot: {
          id: slot.id,
          dayOfWeek: slot.dayOfWeek,
          startTime: slotStart,
          endTime: slotEnd,
          courseOfferingId: slot.courseOfferingId,
          courseName: slot.courseOffering.course.name,
          sectionName: slot.courseOffering.section.name,
        },
      };
    }

    return null;
  }

  /**
   * Read-only conflict preview — powers the admin UI's live drag feedback.
   * Runs the exact same check as create/update, never writes anything.
   */
  async checkConflict(
    params: {
      courseOfferingId: string;
      day: DayOfWeek;
      start: string;
      end: string;
      excludeSlotId?: string;
    },
    organizationId: string,
  ): Promise<{ conflict: SlotConflict | null }> {
    const conflict = await this.checkTimetableConflict(
      params.courseOfferingId,
      params.day,
      params.start,
      params.end,
      organizationId,
      params.excludeSlotId,
    );
    return { conflict };
  }

  private validateRange(
    startTime: string | Date,
    endTime: string | Date,
  ): void {
    const { startTime: start, endTime: end } = normalizeRange(
      startTime,
      endTime,
    );
    if (start >= end) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'The slot must end after it starts.',
      );
    }
  }

  private conflictError(conflict: SlotConflict): ApiError {
    const { kind, conflictingSlot } = conflict;
    const who = kind === 'teacher' ? 'teacher' : 'section';
    const courseName = conflictingSlot.courseName;
    const sectionName = conflictingSlot.sectionName;
    const message =
      kind === 'teacher'
        ? `This teacher already teaches ${courseName} on ${conflictingSlot.dayOfWeek} from ${conflictingSlot.startTime} to ${conflictingSlot.endTime}.`
        : `This section already has ${courseName} on ${conflictingSlot.dayOfWeek} from ${conflictingSlot.startTime} to ${conflictingSlot.endTime}.`;
    return new ApiError(
      kind === 'teacher'
        ? ErrorCode.TIMETABLE_TEACHER_CONFLICT
        : ErrorCode.TIMETABLE_SECTION_CONFLICT,
      HttpStatus.CONFLICT,
      message,
      {
        details: {
          kind,
          conflictingSlot,
          who,
          sectionName,
        },
      },
    );
  }

  async create(
    dto: TimetableSlotData,
    organizationId: string,
  ): Promise<unknown> {
    this.validateRange(dto.startTime, dto.endTime);
    const conflict = await this.checkTimetableConflict(
      dto.courseOfferingId,
      dto.dayOfWeek,
      dto.startTime,
      dto.endTime,
      organizationId,
    );
    if (conflict) {
      throw this.conflictError(conflict);
    }
    return toApiSlot(
      await this.prisma.timetableSlot.create({
        data: {
          courseOfferingId: dto.courseOfferingId,
          organizationId,
          dayOfWeek: dto.dayOfWeek,
          startTime: timeToDate(dto.startTime),
          endTime: timeToDate(dto.endTime),
          room: dto.room ?? null,
        },
      }),
    );
  }

  async update(
    id: string,
    dto: Partial<TimetableSlotData>,
    organizationId: string,
  ): Promise<unknown> {
    const existing = await this.prisma.timetableSlot.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new ApiError(
        ErrorCode.TIMETABLE_SLOT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This timetable slot could not be found.',
      );
    }

    const nextDay = dto.dayOfWeek ?? existing.dayOfWeek;
    const nextStart = dto.startTime ?? existing.startTime;
    const nextEnd = dto.endTime ?? existing.endTime;
    this.validateRange(nextStart, nextEnd);

    const conflict = await this.checkTimetableConflict(
      existing.courseOfferingId,
      nextDay,
      nextStart,
      nextEnd,
      organizationId,
      id,
    );
    if (conflict) {
      throw this.conflictError(conflict);
    }

    return toApiSlot(
      await this.prisma.timetableSlot.update({
        where: { id },
        data: {
          dayOfWeek: nextDay,
          startTime: timeToDate(nextStart),
          endTime: timeToDate(nextEnd),
          ...(dto.room !== undefined ? { room: dto.room } : {}),
        },
      }),
    );
  }

  async remove(id: string, organizationId: string): Promise<unknown> {
    const existing = await this.prisma.timetableSlot.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new ApiError(
        ErrorCode.TIMETABLE_SLOT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This timetable slot could not be found.',
      );
    }
    return this.prisma.timetableSlot.delete({ where: { id } });
  }

  async listAll(organizationId: string) {
    const rows = await this.prisma.timetableSlot.findMany({
      where: { organizationId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      include: {
        courseOffering: {
          select: {
            id: true,
            courseId: true,
            sectionId: true,
            teacherId: true,
            course: { select: { id: true, name: true, colorTag: true } },
            section: { select: { id: true, name: true, gradeLevelId: true } },
          },
        },
      },
    });
    return rows.map(toApiSlot);
  }

  async listForSection(sectionId: string, organizationId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, organizationId },
      select: { id: true },
    });
    if (!section) {
      throw new ApiError(
        ErrorCode.SECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This section could not be found.',
      );
    }
    const rows = await this.prisma.timetableSlot.findMany({
      where: {
        organizationId,
        courseOffering: { sectionId },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      include: {
        courseOffering: {
          select: {
            id: true,
            courseId: true,
            sectionId: true,
            teacherId: true,
            course: { select: { id: true, name: true, colorTag: true } },
            section: { select: { id: true, name: true, gradeLevelId: true } },
          },
        },
      },
    });
    return rows.map(toApiSlot);
  }

  async listForTeacher(teacherId: string, organizationId: string) {
    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId, organizationId, role: 'TEACHER' },
      select: { id: true },
    });
    if (!teacher) {
      throw new ApiError(
        ErrorCode.TEACHER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This teacher could not be found.',
      );
    }
    const rows = await this.prisma.timetableSlot.findMany({
      where: {
        organizationId,
        courseOffering: { teacherId },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      include: {
        courseOffering: {
          select: {
            id: true,
            courseId: true,
            sectionId: true,
            teacherId: true,
            course: { select: { id: true, name: true, colorTag: true } },
            section: { select: { id: true, name: true, gradeLevelId: true } },
          },
        },
      },
    });
    return rows.map(toApiSlot);
  }
}
