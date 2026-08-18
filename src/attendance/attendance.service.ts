import { Injectable, HttpStatus } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import type { Attendance, AttendanceStatus, TeacherFine } from '@prisma/client';
import { Prisma } from '@prisma/client';

const SESSION_TTL_MS = 15 * 60 * 1000;
const LATE_GRACE_MINUTES = 15;

const DAYS_OF_WEEK = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

interface ImportRecord {
  studentId: string;
  courseOfferingId: string;
  date: string;
  status: AttendanceStatus;
}

/** Normalize a moment to a UTC-midnight Date for @db.Date columns. */
function toDateOnly(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function dayOfWeekOf(d: Date): DayOfWeek {
  return DAYS_OF_WEEK[d.getDay()];
}

/** Wall-clock minutes of a @db.Time value (encoded as 1970-01-01T HH:MM Z). */
function minutesOfDay(t: Date): number {
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/**
 * Deterministic check-in status: PRESENT when checking in before the class
 * starts (plus a 15-minute grace window), otherwise LATE. Without a timetable
 * slot for the offering we default to PRESENT.
 */
export function computeCheckInStatus(
  now: Date,
  slot?: { startTime: Date; endTime: Date },
): AttendanceStatus {
  if (!slot) return 'PRESENT';
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = minutesOfDay(slot.startTime);
  if (nowMin <= startMin + LATE_GRACE_MINUTES) return 'PRESENT';
  return 'LATE';
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async importBatch(records: ImportRecord[]): Promise<Attendance[]> {
    const results: Attendance[] = [];

    for (const record of records) {
      const offering = await this.prisma.courseOffering.findUnique({
        where: { id: record.courseOfferingId },
        select: { id: true, sectionId: true },
      });
      if (!offering) {
        throw new ApiError(
          ErrorCode.OFFERING_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This course offering could not be found.',
        );
      }

      const date = toDateOnly(new Date(record.date));
      const result = await this.prisma.attendance.upsert({
        where: {
          studentId_courseOfferingId_date: {
            studentId: record.studentId,
            courseOfferingId: record.courseOfferingId,
            date,
          },
        },
        create: {
          studentId: record.studentId,
          sectionId: offering.sectionId,
          courseOfferingId: record.courseOfferingId,
          date,
          status: record.status,
        },
        update: {
          status: record.status,
          sectionId: offering.sectionId,
        },
      });
      results.push(result);
    }

    return results;
  }

  getByStudent(studentId: string) {
    return this.prisma.attendance.findMany({
      where: { studentId },
      include: {
        section: { include: { gradeLevel: true } },
        courseOffering: {
          select: { id: true, course: { select: { id: true, name: true } } },
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  getByClass(sectionId: string) {
    return this.prisma.attendance.findMany({
      where: { sectionId },
      include: {
        student: true,
        courseOffering: {
          select: { id: true, course: { select: { id: true, name: true } } },
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  async getByOffering(courseOfferingId: string, organizationId: string) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId },
      select: { id: true },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course offering could not be found.',
      );
    }
    return this.prisma.attendance.findMany({
      where: { courseOfferingId },
      include: {
        student: true,
        section: { include: { gradeLevel: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async openSession(
    courseOfferingId: string,
    teacherId: string,
    organizationId: string,
  ) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId },
      select: {
        id: true,
        sectionId: true,
        teacherId: true,
        course: { select: { name: true } },
        section: { select: { name: true } },
      },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This course offering could not be found.',
      );
    }
    if (offering.teacherId !== teacherId) {
      throw new ApiError(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'You can only open attendance for classes you teach.',
      );
    }

    const now = new Date();
    const date = toDateOnly(now);

    const existing = await this.prisma.attendanceSession.findFirst({
      where: { courseOfferingId, date, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.attendanceSession.update({
        where: { id: existing.id },
        data: { status: 'CLOSED', closedAt: now },
      });
    }

    const token = randomBytes(16).toString('base64url');
    const session = await this.prisma.attendanceSession.create({
      data: {
        organizationId,
        courseOfferingId,
        teacherId,
        date,
        token,
        status: 'OPEN',
        openedAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    });

    // Opening the QR is the teacher's self check-in for that period.
    await this.prisma.teacherAttendance.upsert({
      where: {
        teacherId_courseOfferingId_date: {
          teacherId,
          courseOfferingId,
          date,
        },
      },
      create: {
        teacherId,
        courseOfferingId,
        date,
        status: 'PRESENT',
        source: 'SELF',
        sessionId: session.id,
      },
      update: {},
    });

    return {
      ...session,
      courseName: offering.course.name,
      sectionName: offering.section.name,
    };
  }

  async getSession(id: string, teacherId: string) {
    const session = await this.prisma.attendanceSession.findFirst({
      where: { id, teacherId },
      include: {
        courseOffering: {
          select: {
            course: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
      },
    });
    if (!session) {
      throw new ApiError(
        ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This attendance session could not be found.',
      );
    }
    return {
      ...session,
      courseName: session.courseOffering.course.name,
      sectionName: session.courseOffering.section.name,
    };
  }

  async closeSession(id: string, teacherId: string) {
    const session = await this.prisma.attendanceSession.findFirst({
      where: { id, teacherId },
      select: { id: true },
    });
    if (!session) {
      throw new ApiError(
        ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This attendance session could not be found.',
      );
    }
    return this.prisma.attendanceSession.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }

  async checkIn(
    token: string,
    student: { id: string; organizationId: string | null },
  ) {
    const now = new Date();
    const date = toDateOnly(now);

    const session = await this.prisma.attendanceSession.findUnique({
      where: { token },
    });
    if (!session) {
      throw new ApiError(
        ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This check-in link is invalid or has already been replaced.',
      );
    }
    if (session.expiresAt < now) {
      await this.prisma.attendanceSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      throw new ApiError(
        ErrorCode.ATTENDANCE_SESSION_EXPIRED,
        HttpStatus.GONE,
        'This check-in window has expired. Ask your teacher to open a new one.',
      );
    }
    if (session.status !== 'OPEN') {
      throw new ApiError(
        ErrorCode.ATTENDANCE_SESSION_CLOSED,
        HttpStatus.CONFLICT,
        'This attendance session is no longer accepting check-ins.',
      );
    }
    if (session.organizationId !== student.organizationId) {
      throw new ApiError(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'You cannot check in to a class from another school.',
      );
    }

    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: session.courseOfferingId },
      select: {
        id: true,
        sectionId: true,
        course: { select: { name: true } },
        section: { select: { name: true } },
        teacher: { select: { name: true } },
      },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This class could not be found.',
      );
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: {
        sectionId_studentId: {
          sectionId: offering.sectionId,
          studentId: student.id,
        },
      },
      select: { status: true },
    });
    if (!enrollment || enrollment.status !== 'APPROVED') {
      throw new ApiError(
        ErrorCode.ATTENDANCE_NOT_ENROLLED,
        HttpStatus.FORBIDDEN,
        'You are not enrolled in this class.',
      );
    }

    const slot = await this.prisma.timetableSlot.findFirst({
      where: { courseOfferingId: offering.id, dayOfWeek: dayOfWeekOf(now) },
      select: { startTime: true, endTime: true },
    });
    const status = computeCheckInStatus(now, slot ?? undefined);

    const existing = await this.prisma.attendance.findUnique({
      where: {
        studentId_courseOfferingId_date: {
          studentId: student.id,
          courseOfferingId: offering.id,
          date,
        },
      },
    });

    let attendance: Attendance;
    let alreadyCheckedIn = false;
    if (existing) {
      attendance = existing;
      alreadyCheckedIn = true;
    } else {
      attendance = await this.prisma.attendance.create({
        data: {
          studentId: student.id,
          sectionId: offering.sectionId,
          courseOfferingId: offering.id,
          date,
          status,
        },
      });
    }

    return {
      alreadyCheckedIn,
      status: attendance.status,
      date: date.toISOString(),
      courseName: offering.course.name,
      sectionName: offering.section.name,
      teacherName: offering.teacher.name,
    };
  }

  getMyTeacherAttendance(teacherId: string) {
    return this.prisma.teacherAttendance.findMany({
      where: { teacherId },
      include: {
        courseOffering: {
          select: {
            id: true,
            course: { select: { id: true, name: true } },
            section: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  async getTeacherLedger(
    organizationId: string,
    filters: {
      teacherId?: string;
      from?: string;
      to?: string;
      status?: AttendanceStatus;
    },
  ) {
    const where: Prisma.TeacherAttendanceWhereInput = {
      courseOffering: { organizationId },
    };
    if (filters.teacherId) where.teacherId = filters.teacherId;
    if (filters.from || filters.to) {
      where.date = {
        ...(filters.from ? { gte: toDateOnly(new Date(filters.from)) } : {}),
        ...(filters.to ? { lte: toDateOnly(new Date(filters.to)) } : {}),
      };
    }
    if (filters.status) where.status = filters.status;

    return this.prisma.teacherAttendance.findMany({
      where,
      include: {
        teacher: { select: { id: true, name: true } },
        courseOffering: {
          select: {
            course: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  async getTeacherAttendanceByTeacherId(
    teacherId: string,
    organizationId: string,
  ) {
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
    return this.getMyTeacherAttendance(teacherId);
  }

  private async requireTeacherInOrg(teacherId: string, organizationId: string) {
    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId, organizationId, role: 'TEACHER' },
      select: { id: true, name: true },
    });
    if (!teacher) {
      throw new ApiError(
        ErrorCode.TEACHER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This teacher could not be found.',
      );
    }
    return teacher;
  }

  async createFine(
    teacherId: string,
    dto: {
      amount: number;
      reason: string;
      type?: 'ATTENDANCE' | 'LATE' | 'OTHER';
      status?: 'PAID' | 'PARTIAL' | 'POSTPONED' | 'UNPAID';
      amountPaid?: number;
      dueDate?: string;
    },
    organizationId: string,
    issuedById: string,
  ): Promise<TeacherFine> {
    const teacher = await this.requireTeacherInOrg(teacherId, organizationId);

    const fine = await this.prisma.teacherFine.create({
      data: {
        organizationId,
        teacherId,
        amount: dto.amount,
        reason: dto.reason,
        type: dto.type ?? 'ATTENDANCE',
        status: dto.status ?? 'UNPAID',
        amountPaid: dto.amountPaid,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        issuedById,
        paidAt: dto.status === 'PAID' ? new Date() : null,
      },
    });

    await this.notifications.notifyUser(
      teacher.id,
      'FINE_ISSUED',
      'A fine was issued against you',
      `You have been fined ${dto.amount} for: ${dto.reason}`,
    );

    return fine;
  }

  listFinesForTeacher(teacherId: string, organizationId: string) {
    return this.prisma.teacherFine.findMany({
      where: { teacherId, organizationId },
      include: { issuedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  getMyFines(teacherId: string) {
    return this.prisma.teacherFine.findMany({
      where: { teacherId },
      include: { issuedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateFine(
    fineId: string,
    dto: {
      amount?: number;
      reason?: string;
      type?: 'ATTENDANCE' | 'LATE' | 'OTHER';
      status?: 'PAID' | 'PARTIAL' | 'POSTPONED' | 'UNPAID';
      amountPaid?: number;
      dueDate?: string | null;
    },
    organizationId: string,
  ) {
    const fine = await this.prisma.teacherFine.findFirst({
      where: { id: fineId, organizationId },
    });
    if (!fine) {
      throw new ApiError(
        ErrorCode.FINE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This fine could not be found.',
      );
    }

    const data: Prisma.TeacherFineUpdateInput = {};
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.reason !== undefined) data.reason = dto.reason;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.amountPaid !== undefined) data.amountPaid = dto.amountPaid;
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.status === 'PAID' && !fine.paidAt) data.paidAt = new Date();
    if (dto.status === 'UNPAID') data.paidAt = null;

    return this.prisma.teacherFine.update({ where: { id: fineId }, data });
  }

  async deleteFine(fineId: string, organizationId: string) {
    const fine = await this.prisma.teacherFine.findFirst({
      where: { id: fineId, organizationId },
      select: { id: true },
    });
    if (!fine) {
      throw new ApiError(
        ErrorCode.FINE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This fine could not be found.',
      );
    }
    return this.prisma.teacherFine.delete({ where: { id: fineId } });
  }
}
