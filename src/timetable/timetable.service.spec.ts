import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TimetableService } from './timetable.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

function callArgs<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as T[][];
  return calls[0][0];
}

describe('TimetableService', () => {
  let service: TimetableService;

  const organizationId = 'org-1';

  const mockPrisma = {
    courseOffering: {
      findFirst: jest.fn(),
    },
    timetableSlot: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    section: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimetableService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TimetableService>(TimetableService);
  });

  const offering = {
    id: 'offering-1',
    teacherId: 'teacher-1',
    sectionId: 'section-1',
  };

  const conflictingTeacherSlot = {
    id: 'slot-teacher',
    dayOfWeek: 'MONDAY',
    startTime: '08:00:00',
    endTime: '09:00:00',
    courseOfferingId: 'offering-2',
    courseOffering: {
      id: 'offering-2',
      teacherId: 'teacher-1',
      sectionId: 'section-9',
      course: { name: 'Math' },
      section: { name: 'A' },
    },
  };

  const conflictingSectionSlot = {
    id: 'slot-section',
    dayOfWeek: 'MONDAY',
    startTime: '08:00:00',
    endTime: '09:00:00',
    courseOfferingId: 'offering-3',
    courseOffering: {
      id: 'offering-3',
      teacherId: 'teacher-9',
      sectionId: 'section-1',
      course: { name: 'Science' },
      section: { name: '5-A' },
    },
  };

  describe('checkTimetableConflict', () => {
    beforeEach(() => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
    });

    it('throws OFFERING_NOT_FOUND when the offering is not in the organization', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(null);

      await expect(
        service.checkTimetableConflict(
          'offering-x',
          'MONDAY',
          '08:00',
          '09:00',
          organizationId,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.OFFERING_NOT_FOUND });
    });

    it('scopes the conflict query to the organization and day, same teacher', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([]);

      await service.checkTimetableConflict(
        'offering-1',
        'MONDAY',
        '08:00',
        '09:00',
        organizationId,
      );

      const arg = callArgs<{
        where: Record<string, unknown>;
      }>(mockPrisma.timetableSlot.findMany);
      expect(arg.where).toEqual({
        organizationId,
        dayOfWeek: 'MONDAY',
        courseOffering: {
          OR: [{ teacherId: 'teacher-1' }, { sectionId: 'section-1' }],
        },
      });
    });

    it('excludes the edited slot when excludeSlotId is given', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([]);

      await service.checkTimetableConflict(
        'offering-1',
        'MONDAY',
        '08:00',
        '09:00',
        organizationId,
        'slot-1',
      );

      const arg = callArgs<{
        where: Record<string, unknown>;
      }>(mockPrisma.timetableSlot.findMany);
      expect(arg.where.NOT).toEqual({ id: 'slot-1' });
    });

    it('returns a teacher conflict when the same teacher overlaps on the same day', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        conflictingTeacherSlot,
      ]);

      const conflict = await service.checkTimetableConflict(
        'offering-1',
        'MONDAY',
        '08:30',
        '09:30',
        organizationId,
      );

      expect(conflict).toEqual({
        kind: 'teacher',
        conflictingSlot: {
          id: 'slot-teacher',
          dayOfWeek: 'MONDAY',
          startTime: '08:00:00',
          endTime: '09:00:00',
          courseOfferingId: 'offering-2',
          courseName: 'Math',
          sectionName: 'A',
        },
      });
    });

    it('returns a section conflict when the same section overlaps on the same day', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        conflictingSectionSlot,
      ]);

      const conflict = await service.checkTimetableConflict(
        'offering-1',
        'MONDAY',
        '08:30',
        '09:30',
        organizationId,
      );

      expect(conflict).toEqual({
        kind: 'section',
        conflictingSlot: {
          id: 'slot-section',
          dayOfWeek: 'MONDAY',
          startTime: '08:00:00',
          endTime: '09:00:00',
          courseOfferingId: 'offering-3',
          courseName: 'Science',
          sectionName: '5-A',
        },
      });
    });

    it('allows adjacent slots where one ends exactly when the other starts', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        conflictingTeacherSlot,
      ]);

      const conflict = await service.checkTimetableConflict(
        'offering-1',
        'MONDAY',
        '09:00',
        '10:00',
        organizationId,
      );

      expect(conflict).toBeNull();
    });

    it('returns null when no overlapping slots exist on that day', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([]);

      const conflict = await service.checkTimetableConflict(
        'offering-1',
        'MONDAY',
        '08:30',
        '09:30',
        organizationId,
      );

      expect(conflict).toBeNull();
    });
  });

  describe('create', () => {
    const dto = {
      courseOfferingId: 'offering-1',
      dayOfWeek: 'MONDAY',
      startTime: '08:00',
      endTime: '09:00',
    } as const;

    beforeEach(() => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
      mockPrisma.timetableSlot.create.mockResolvedValue({
        id: 'new-slot',
        startTime: new Date('1970-01-01T08:00:00Z'),
        endTime: new Date('1970-01-01T09:00:00Z'),
      });
    });

    it('rejects a teacher double-booking with a 409 teacher conflict', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        conflictingTeacherSlot,
      ]);

      const err = await service
        .create(dto, organizationId)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe(ErrorCode.TIMETABLE_TEACHER_CONFLICT);
      expect((err as ApiError).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((err as ApiError).message).toContain('Math');
      expect((err as ApiError).message).toContain('MONDAY');
      expect(mockPrisma.timetableSlot.create).not.toHaveBeenCalled();
    });

    it('rejects a section double-booking with a 409 section conflict', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        conflictingSectionSlot,
      ]);

      const err = await service
        .create(dto, organizationId)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe(ErrorCode.TIMETABLE_SECTION_CONFLICT);
      expect((err as ApiError).getStatus()).toBe(HttpStatus.CONFLICT);
      expect(mockPrisma.timetableSlot.create).not.toHaveBeenCalled();
    });

    it('allows creating an adjacent slot that starts exactly when another ends', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        conflictingTeacherSlot,
      ]);

      const result = await service.create(
        { ...dto, startTime: '09:00', endTime: '10:00' },
        organizationId,
      );

      expect(result).toMatchObject({ id: 'new-slot', startTime: '08:00:00' });
      expect(mockPrisma.timetableSlot.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a slot whose offering belongs to another organization', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(null);

      const err = await service.create(dto, 'org-2').catch((e: unknown) => e);

      expect((err as ApiError).code).toBe(ErrorCode.OFFERING_NOT_FOUND);
      expect(mockPrisma.timetableSlot.create).not.toHaveBeenCalled();
    });

    it('rejects a slot that ends after it starts being invalid (end <= start)', async () => {
      const err = await service
        .create(
          { ...dto, startTime: '10:00', endTime: '09:00' },
          organizationId,
        )
        .catch((e: unknown) => e);

      expect((err as ApiError).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(mockPrisma.timetableSlot.findMany).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const existingSlot = {
      id: 'slot-1',
      courseOfferingId: 'offering-1',
      organizationId,
      dayOfWeek: 'MONDAY',
      startTime: '08:00:00',
      endTime: '09:00:00',
      room: null,
    };

    beforeEach(() => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
      mockPrisma.timetableSlot.findFirst.mockResolvedValue(existingSlot);
      mockPrisma.timetableSlot.update.mockResolvedValue({
        ...existingSlot,
        startTime: new Date('1970-01-01T09:30:00Z'),
        endTime: new Date('1970-01-01T10:00:00Z'),
      });
    });

    it('throws TIMETABLE_SLOT_NOT_FOUND when the slot is not in the organization', async () => {
      mockPrisma.timetableSlot.findFirst.mockResolvedValue(null);

      const err = await service
        .update('slot-x', { startTime: '09:00' }, organizationId)
        .catch((e: unknown) => e);

      expect((err as ApiError).code).toBe(ErrorCode.TIMETABLE_SLOT_NOT_FOUND);
      expect(mockPrisma.timetableSlot.update).not.toHaveBeenCalled();
    });

    it('rejects moving a slot onto an overlapping slot, excluding itself', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        conflictingTeacherSlot,
      ]);

      const err = await service
        .update(
          'slot-1',
          { startTime: '08:30', endTime: '09:30' },
          organizationId,
        )
        .catch((e: unknown) => e);

      expect((err as ApiError).code).toBe(ErrorCode.TIMETABLE_TEACHER_CONFLICT);
      expect((err as ApiError).getStatus()).toBe(HttpStatus.CONFLICT);
      const arg = callArgs<{
        where: Record<string, unknown>;
      }>(mockPrisma.timetableSlot.findMany);
      expect(arg.where.NOT).toEqual({ id: 'slot-1' });
      expect(mockPrisma.timetableSlot.update).not.toHaveBeenCalled();
    });

    it('allows updating its own slot to a non-conflicting time', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([]);

      const result = await service.update(
        'slot-1',
        { startTime: '11:00', endTime: '12:00' },
        organizationId,
      );

      const arg = callArgs<{
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }>(mockPrisma.timetableSlot.update);
      expect(arg.where).toEqual({ id: 'slot-1' });
      expect(arg.data).toMatchObject({
        startTime: new Date('1970-01-01T11:00:00Z'),
        endTime: new Date('1970-01-01T12:00:00Z'),
      });
      expect(result).toMatchObject({ startTime: '09:30:00' });
    });
  });

  describe('remove', () => {
    it('deletes the slot when it belongs to the organization', async () => {
      mockPrisma.timetableSlot.findFirst.mockResolvedValue({ id: 'slot-1' });
      mockPrisma.timetableSlot.delete.mockResolvedValue({ id: 'slot-1' });

      await service.remove('slot-1', organizationId);

      expect(mockPrisma.timetableSlot.delete).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
      });
    });

    it('throws TIMETABLE_SLOT_NOT_FOUND for a slot in another organization', async () => {
      mockPrisma.timetableSlot.findFirst.mockResolvedValue(null);

      const err = await service
        .remove('slot-other', 'org-2')
        .catch((e: unknown) => e);

      expect((err as ApiError).code).toBe(ErrorCode.TIMETABLE_SLOT_NOT_FOUND);
      expect(mockPrisma.timetableSlot.delete).not.toHaveBeenCalled();
    });
  });

  describe('checkConflict (read-only preview)', () => {
    const params = {
      courseOfferingId: 'offering-1',
      day: 'MONDAY' as const,
      start: '08:30',
      end: '09:30',
    };

    it('shares the exact same conflict logic as create: one test, both code paths', async () => {
      // Same inputs for both paths — a single input, a single expectation.
      mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        conflictingTeacherSlot,
      ]);

      // Path 1: the real create path — rejects with a conflict.
      const createErr = await service
        .create(
          {
            courseOfferingId: params.courseOfferingId,
            dayOfWeek: params.day,
            startTime: params.start,
            endTime: params.end,
          },
          organizationId,
        )
        .catch((e: unknown) => e);

      expect((createErr as ApiError).code).toBe(
        ErrorCode.TIMETABLE_TEACHER_CONFLICT,
      );
      const errorDetails = (
        createErr as ApiError & { details: { conflictingSlot: unknown } }
      ).details.conflictingSlot;

      // Path 2: the check-conflict endpoint path — must agree exactly.
      const result = await service.checkConflict(params, organizationId);

      expect(result.conflict).not.toBeNull();
      expect(result.conflict!.kind).toBe('teacher');
      expect(result.conflict!.conflictingSlot).toEqual(errorDetails);
      expect(result.conflict!.conflictingSlot.courseName).toBe('Math');
    });

    it('returns { conflict: null } when the proposed slot is free', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
      mockPrisma.timetableSlot.findMany.mockResolvedValue([]);

      const result = await service.checkConflict(params, organizationId);

      expect(result).toEqual({ conflict: null });
    });

    it('passes excludeSlotId through to the shared check (self-edit preview)', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        conflictingTeacherSlot,
      ]);

      await service.checkConflict(
        { ...params, excludeSlotId: 'slot-1' },
        organizationId,
      );

      const arg = callArgs<{
        where: Record<string, unknown>;
      }>(mockPrisma.timetableSlot.findMany);
      expect(arg.where.NOT).toEqual({ id: 'slot-1' });
    });

    it('scopes the preview to the caller organization', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(null);

      const err = await service
        .checkConflict(params, 'org-2')
        .catch((e: unknown) => e);

      expect((err as ApiError).code).toBe(ErrorCode.OFFERING_NOT_FOUND);
    });
  });

  describe('listAll', () => {
    it('lists every slot scoped to the organization', async () => {
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        {
          id: 's1',
          startTime: new Date('1970-01-01T08:00:00Z'),
          endTime: new Date('1970-01-01T09:00:00Z'),
        },
      ]);

      const result = await service.listAll(organizationId);

      expect(mockPrisma.timetableSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId } }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].startTime).toBe('08:00:00');
    });
  });

  describe('listForSection', () => {
    it('throws SECTION_NOT_FOUND when the section belongs to another organization', async () => {
      mockPrisma.section.findFirst.mockResolvedValue(null);

      const err = await service
        .listForSection('section-1', 'org-2')
        .catch((e: unknown) => e);

      expect((err as ApiError).code).toBe(ErrorCode.SECTION_NOT_FOUND);
      expect(mockPrisma.timetableSlot.findMany).not.toHaveBeenCalled();
    });

    it('lists only slots under the section, scoped to the organization', async () => {
      mockPrisma.section.findFirst.mockResolvedValue({ id: 'section-1' });
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        {
          id: 's1',
          startTime: new Date('1970-01-01T08:00:00Z'),
          endTime: new Date('1970-01-01T09:00:00Z'),
        },
      ]);

      const result = await service.listForSection('section-1', organizationId);

      expect(mockPrisma.timetableSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId, courseOffering: { sectionId: 'section-1' } },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('listForTeacher', () => {
    it('throws TEACHER_NOT_FOUND when the teacher belongs to another organization', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const err = await service
        .listForTeacher('teacher-1', 'org-2')
        .catch((e: unknown) => e);

      expect((err as ApiError).code).toBe(ErrorCode.TEACHER_NOT_FOUND);
      expect(mockPrisma.timetableSlot.findMany).not.toHaveBeenCalled();
    });

    it('lists only slots for offerings taught by the teacher', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'teacher-1' });
      mockPrisma.timetableSlot.findMany.mockResolvedValue([
        {
          id: 's1',
          startTime: new Date('1970-01-01T08:00:00Z'),
          endTime: new Date('1970-01-01T09:00:00Z'),
        },
      ]);

      const result = await service.listForTeacher('teacher-1', organizationId);

      expect(mockPrisma.timetableSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId, courseOffering: { teacherId: 'teacher-1' } },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });
});
