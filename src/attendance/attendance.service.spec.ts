import { Test } from '@nestjs/testing';
import { AttendanceService, computeCheckInStatus } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ErrorCode } from '../common/errors/codes';

describe('computeCheckInStatus', () => {
  const slot = {
    startTime: new Date('1970-01-01T10:00:00.000Z'),
    endTime: new Date('1970-01-01T11:00:00.000Z'),
  };

  it('marks PRESENT when checking in before the slot', () => {
    const now = new Date('2026-09-01T09:30:00.000+03:00');
    expect(computeCheckInStatus(now, slot)).toBe('PRESENT');
  });

  it('marks PRESENT within the 15-minute grace window', () => {
    const now = new Date('2026-09-01T10:12:00.000+03:00');
    expect(computeCheckInStatus(now, slot)).toBe('PRESENT');
  });

  it('marks LATE after the grace window', () => {
    const now = new Date('2026-09-01T10:20:00.000+03:00');
    expect(computeCheckInStatus(now, slot)).toBe('LATE');
  });

  it('defaults to PRESENT when there is no timetable slot', () => {
    expect(computeCheckInStatus(new Date(), undefined)).toBe('PRESENT');
  });
});

describe('AttendanceService', () => {
  let service: AttendanceService;

  const mockNotifications = { notifyUser: jest.fn() };

  const mockPrisma = {
    courseOffering: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    attendance: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    attendanceSession: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    teacherAttendance: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    enrollment: {
      findUnique: jest.fn(),
    },
    timetableSlot: {
      findFirst: jest.fn(),
    },
    teacherFine: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = moduleRef.get(AttendanceService);
  });

  describe('importBatch', () => {
    it('resolves the offering section and upserts per offering', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue({
        id: 'offering-1',
        sectionId: 'section-1',
      });
      mockPrisma.attendance.upsert.mockResolvedValue({ id: 'att-1' });

      await service.importBatch([
        {
          studentId: 'student-1',
          courseOfferingId: 'offering-1',
          date: '2026-09-01',
          status: 'PRESENT',
        },
      ]);

      expect(mockPrisma.attendance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentId_courseOfferingId_date: {
              studentId: 'student-1',
              courseOfferingId: 'offering-1',
              date: new Date('2026-09-01T00:00:00.000Z'),
            },
          },
          create: {
            studentId: 'student-1',
            courseOfferingId: 'offering-1',
            sectionId: 'section-1',
            date: new Date('2026-09-01T00:00:00.000Z'),
            status: 'PRESENT',
          },
        }),
      );
    });

    it('throws when the offering does not exist', async () => {
      mockPrisma.courseOffering.findUnique.mockResolvedValue(null);
      await expect(
        service.importBatch([
          {
            studentId: 'student-1',
            courseOfferingId: 'offering-x',
            date: '2026-09-01',
            status: 'PRESENT',
          },
        ]),
      ).rejects.toMatchObject({
        code: ErrorCode.OFFERING_NOT_FOUND,
      });
    });
  });

  describe('openSession', () => {
    const offering = {
      id: 'offering-1',
      sectionId: 'section-1',
      teacherId: 'teacher-1',
      course: { name: 'Math' },
      section: { name: '3A' },
    };

    it('rejects a teacher who does not teach the offering', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        ...offering,
        teacherId: 'someone-else',
      });
      await expect(
        service.openSession('offering-1', 'teacher-1', 'org-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('closes a stale open session, creates a new one, and records teacher attendance', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(offering);
      mockPrisma.attendanceSession.findFirst.mockResolvedValue({ id: 'old' });
      mockPrisma.attendanceSession.create.mockResolvedValue({
        id: 'session-1',
        token: 'abc123',
        status: 'OPEN',
      });
      mockPrisma.teacherAttendance.upsert.mockResolvedValue({ id: 'ta-1' });

      const result = await service.openSession(
        'offering-1',
        'teacher-1',
        'org-1',
      );

      expect(mockPrisma.attendanceSession.update).toHaveBeenCalledWith({
        where: { id: 'old' },
        data: { status: 'CLOSED', closedAt: expect.any(Date) as Date },
      });
      expect(mockPrisma.attendanceSession.create).toHaveBeenCalled();
      expect(mockPrisma.teacherAttendance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            teacherId_courseOfferingId_date: {
              teacherId: 'teacher-1',
              courseOfferingId: 'offering-1',
              date: expect.any(Date) as Date,
            },
          },
          create: {
            teacherId: 'teacher-1',
            courseOfferingId: 'offering-1',
            date: expect.any(Date) as Date,
            status: 'PRESENT',
            source: 'SELF',
            sessionId: 'session-1',
          },
          update: {},
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: 'session-1',
          courseName: 'Math',
          sectionName: '3A',
        }),
      );
    });
  });

  describe('checkIn', () => {
    const session = {
      id: 'session-1',
      organizationId: 'org-1',
      courseOfferingId: 'offering-1',
      teacherId: 'teacher-1',
      token: 'abc123',
      status: 'OPEN',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    };
    const offering = {
      id: 'offering-1',
      sectionId: 'section-1',
      course: { name: 'Math' },
      section: { name: '3A' },
      teacher: { name: 'Ms. A' },
    };
    const student = { id: 'student-1', organizationId: 'org-1' };

    it('throws for an unknown token', async () => {
      mockPrisma.attendanceSession.findUnique.mockResolvedValue(null);
      await expect(service.checkIn('bad', student)).rejects.toMatchObject({
        code: ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
      });
    });

    it('throws when the session has expired', async () => {
      mockPrisma.attendanceSession.findUnique.mockResolvedValue({
        ...session,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      await expect(service.checkIn('abc123', student)).rejects.toMatchObject({
        code: ErrorCode.ATTENDANCE_SESSION_EXPIRED,
      });
      expect(mockPrisma.attendanceSession.update).toHaveBeenCalled();
    });

    it('throws when the session is closed', async () => {
      mockPrisma.attendanceSession.findUnique.mockResolvedValue({
        ...session,
        status: 'CLOSED',
      });
      await expect(service.checkIn('abc123', student)).rejects.toMatchObject({
        code: ErrorCode.ATTENDANCE_SESSION_CLOSED,
      });
    });

    it('rejects a student from another organization', async () => {
      mockPrisma.attendanceSession.findUnique.mockResolvedValue(session);
      await expect(
        service.checkIn('abc123', { ...student, organizationId: 'org-2' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('rejects a student who is not enrolled', async () => {
      mockPrisma.attendanceSession.findUnique.mockResolvedValue(session);
      mockPrisma.courseOffering.findUnique.mockResolvedValue(offering);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      await expect(service.checkIn('abc123', student)).rejects.toMatchObject({
        code: ErrorCode.ATTENDANCE_NOT_ENROLLED,
      });
    });

    it('creates a PRESENT record and returns alreadyCheckedIn=false', async () => {
      mockPrisma.attendanceSession.findUnique.mockResolvedValue(session);
      mockPrisma.courseOffering.findUnique.mockResolvedValue(offering);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        status: 'APPROVED',
      });
      mockPrisma.timetableSlot.findFirst.mockResolvedValue(null);
      mockPrisma.attendance.findUnique.mockResolvedValue(null);
      mockPrisma.attendance.create.mockResolvedValue({
        id: 'att-1',
        status: 'PRESENT',
      });

      const result = await service.checkIn('abc123', student);

      expect(mockPrisma.attendance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            studentId: 'student-1',
            sectionId: 'section-1',
            courseOfferingId: 'offering-1',
            date: expect.any(Date) as Date,
            status: 'PRESENT',
          },
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          alreadyCheckedIn: false,
          status: 'PRESENT',
          courseName: 'Math',
          teacherName: 'Ms. A',
        }),
      );
    });

    it('returns alreadyCheckedIn=true when a record exists (idempotent)', async () => {
      mockPrisma.attendanceSession.findUnique.mockResolvedValue(session);
      mockPrisma.courseOffering.findUnique.mockResolvedValue(offering);
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        status: 'APPROVED',
      });
      mockPrisma.timetableSlot.findFirst.mockResolvedValue(null);
      mockPrisma.attendance.findUnique.mockResolvedValue({
        id: 'att-1',
        status: 'PRESENT',
      });

      const result = await service.checkIn('abc123', student);

      expect(result.alreadyCheckedIn).toBe(true);
      expect(mockPrisma.attendance.create).not.toHaveBeenCalled();
    });
  });

  describe('getTeacherLedger', () => {
    it('scopes to the organization and applies filters', async () => {
      mockPrisma.teacherAttendance.findMany.mockResolvedValue([]);
      await service.getTeacherLedger('org-1', {
        teacherId: 'teacher-1',
        status: 'LATE',
      });
      expect(mockPrisma.teacherAttendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            courseOffering: { organizationId: 'org-1' },
            teacherId: 'teacher-1',
            status: 'LATE',
          },
        }),
      );
    });
  });

  describe('createFine', () => {
    it('creates the fine and notifies the teacher', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'teacher-1',
        name: 'T',
      });
      mockPrisma.teacherFine.create.mockResolvedValue({
        id: 'fine-1',
        teacherId: 'teacher-1',
      });

      const result = await service.createFine(
        'teacher-1',
        { amount: 250, reason: 'Missed 3 classes', type: 'ATTENDANCE' },
        'org-1',
        'admin-1',
      );

      expect(mockPrisma.teacherFine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            teacherId: 'teacher-1',
            organizationId: 'org-1',
            amount: 250,
            reason: 'Missed 3 classes',
            type: 'ATTENDANCE',
            status: 'UNPAID',
            amountPaid: undefined,
            dueDate: null,
            issuedById: 'admin-1',
            paidAt: null,
          },
        }),
      );
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'teacher-1',
        'FINE_ISSUED',
        expect.any(String),
        expect.stringContaining('250'),
      );
      expect(result).toEqual(expect.objectContaining({ id: 'fine-1' }));
    });
  });

  describe('updateFine', () => {
    it('throws when the fine does not exist', async () => {
      mockPrisma.teacherFine.findFirst.mockResolvedValue(null);
      await expect(
        service.updateFine('fine-x', { status: 'PAID' }, 'org-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.FINE_NOT_FOUND,
      });
    });

    it('sets paidAt when marking PAID', async () => {
      mockPrisma.teacherFine.findFirst.mockResolvedValue({
        id: 'fine-1',
        paidAt: null,
      });
      mockPrisma.teacherFine.update.mockResolvedValue({ id: 'fine-1' });
      await service.updateFine('fine-1', { status: 'PAID' }, 'org-1');
      expect(mockPrisma.teacherFine.update).toHaveBeenCalledWith({
        where: { id: 'fine-1' },
        data: { status: 'PAID', paidAt: expect.any(Date) as Date },
      });
    });
  });

  describe('deleteFine', () => {
    it('deletes an existing fine', async () => {
      mockPrisma.teacherFine.findFirst.mockResolvedValue({ id: 'fine-1' });
      mockPrisma.teacherFine.delete.mockResolvedValue({ id: 'fine-1' });
      await service.deleteFine('fine-1', 'org-1');
      expect(mockPrisma.teacherFine.delete).toHaveBeenCalledWith({
        where: { id: 'fine-1' },
      });
    });

    it('throws for a missing fine', async () => {
      mockPrisma.teacherFine.findFirst.mockResolvedValue(null);
      await expect(service.deleteFine('fine-x', 'org-1')).rejects.toMatchObject(
        {
          code: ErrorCode.FINE_NOT_FOUND,
        },
      );
    });
  });
});
