import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AttendanceStatus, Attendance } from '@prisma/client';

interface ImportRecord {
  studentId: string;
  classId: string;
  date: string;
  status: AttendanceStatus;
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async importBatch(records: ImportRecord[]) {
    const results: Attendance[] = [];

    for (const record of records) {
      const result = await this.prisma.attendance.upsert({
        where: {
          studentId_classId_date: {
            studentId: record.studentId,
            classId: record.classId,
            date: new Date(record.date),
          },
        },
        create: {
          studentId: record.studentId,
          classId: record.classId,
          date: new Date(record.date),
          status: record.status,
        },
        update: {
          status: record.status,
        },
      });
      results.push(result);
    }

    return results;
  }

  getByStudent(studentId: string) {
    return this.prisma.attendance.findMany({
      where: { studentId },
      include: { class: true },
      orderBy: { date: 'desc' },
    });
  }

  getByClass(classId: string) {
    return this.prisma.attendance.findMany({
      where: { classId },
      include: { student: true },
      orderBy: { date: 'desc' },
    });
  }
}
