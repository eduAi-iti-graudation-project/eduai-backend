import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AttendanceStatus, Attendance } from '@prisma/client';

interface ImportRecord {
  studentId: string;
  sectionId: string;
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
          studentId_sectionId_date: {
            studentId: record.studentId,
            sectionId: record.sectionId,
            date: new Date(record.date),
          },
        },
        create: {
          studentId: record.studentId,
          sectionId: record.sectionId,
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
      include: { section: { include: { gradeLevel: true } } },
      orderBy: { date: 'desc' },
    });
  }

  getByClass(sectionId: string) {
    return this.prisma.attendance.findMany({
      where: { sectionId },
      include: { student: true },
      orderBy: { date: 'desc' },
    });
  }
}
