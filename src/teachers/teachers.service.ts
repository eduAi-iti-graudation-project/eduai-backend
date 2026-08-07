import { PrismaService } from '../prisma/prisma.service';
import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class TeachersService {
  constructor(private readonly prisma: PrismaService) {}

  async getGrades(teacherId: string) {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
    });
    if (!teacher) {
      throw new ApiError(
        ErrorCode.TEACHER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This teacher could not be found.',
      );
    }

    const offerings = await this.prisma.courseOffering.findMany({
      where: { teacherId },
      include: {
        course: true,
        section: { include: { gradeLevel: true } },
      },
    });

    const rows: Array<{
      id: string;
      teacherId: string;
      gradeId: string | null;
      grade: object | null;
    }> = [];
    const seen = new Set<string>();

    for (const o of offerings) {
      if (!o.section.gradeLevel) continue;
      if (seen.has(o.section.gradeLevel.id)) continue;
      seen.add(o.section.gradeLevel.id);
      rows.push({
        id: o.id,
        teacherId,
        gradeId: o.section.gradeLevel.id,
        grade: o.section.gradeLevel,
      });
    }

    return rows;
  }

  async addGrade(teacherId: string, offeringId: string) {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
    });
    if (!teacher) {
      throw new ApiError(
        ErrorCode.TEACHER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This teacher could not be found.',
      );
    }

    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: offeringId },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This offering could not be found.',
      );
    }

    return this.prisma.courseOffering.update({
      where: { id: offeringId },
      data: { teacherId },
      include: { course: true, section: true },
    });
  }

  async removeGrade(teacherId: string, offeringId: string) {
    const offering = await this.prisma.courseOffering.findFirst({
      where: { id: offeringId, teacherId },
    });
    if (!offering) {
      throw new ApiError(
        ErrorCode.OFFERING_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This offering could not be found.',
      );
    }

    return this.prisma.courseOffering.update({
      where: { id: offeringId },
      data: { teacherId },
      include: { course: true, section: true },
    });
  }

  // ── Admin teacher detail ─────────────────────────────────────────

  private async ensureTeacher(teacherId: string, organizationId: string) {
    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId, organizationId, role: 'TEACHER' },
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

  async getAdminProfile(teacherId: string, organizationId: string) {
    const teacher = await this.ensureTeacher(teacherId, organizationId);

    const [offerings, quizzes, docsCount, salaryCount] = await Promise.all([
      this.prisma.courseOffering.findMany({
        where: { teacherId, organizationId },
        include: {
          course: true,
          section: {
            include: {
              gradeLevel: true,
              enrollments: { select: { id: true } },
            },
          },
          quizzes: { select: { id: true } },
          assignments: { select: { id: true } },
        },
      }),
      this.prisma.quiz.count({
        where: { teacherId, offering: { organizationId } },
      }),
      this.prisma.teacherDocument.count({ where: { teacherId } }),
      this.prisma.salaryRecord.count({ where: { teacherId } }),
    ]);

    const grades = Array.from(
      new Map(
        offerings
          .map((o) => o.section.gradeLevel)
          .filter((g): g is NonNullable<typeof g> => g !== null)
          .map((g) => [g.id, g]),
      ).values(),
    );

    return {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      gender: teacher.gender,
      createdAt: teacher.createdAt,
      grades,
      classes: offerings.map((o) => ({
        id: o.id,
        name: o.course.name,
        description: o.course.description ?? o.section.description,
        grades: o.section.gradeLevel ? [o.section.gradeLevel] : [],
        studentCount: o.section.enrollments.length,
        quizCount: o.quizzes.length,
        assignmentCount: o.assignments.length,
      })),
      classCount: offerings.length,
      studentCount: offerings.reduce(
        (sum, o) => sum + o.section.enrollments.length,
        0,
      ),
      quizCount: quizzes,
      documentsCount: docsCount,
      salaryRecordsCount: salaryCount,
    };
  }

  async getClasses(teacherId: string, organizationId: string) {
    await this.ensureTeacher(teacherId, organizationId);
    const offerings = await this.prisma.courseOffering.findMany({
      where: { teacherId, organizationId },
      include: {
        course: true,
        section: {
          include: {
            gradeLevel: true,
            enrollments: { include: { student: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return offerings.map((o) => ({
      id: o.id,
      name: o.course.name,
      description: o.course.description ?? o.section.description,
      createdAt: o.createdAt,
      grades: o.section.gradeLevel ? [o.section.gradeLevel] : [],
      students: o.section.enrollments.map((e) => ({
        id: e.student.id,
        name: e.student.name,
        email: e.student.email,
      })),
    }));
  }

  async getHistory(teacherId: string, organizationId: string) {
    await this.ensureTeacher(teacherId, organizationId);
    const logs = await this.prisma.classTeacherLog.findMany({
      where: { teacherId, offering: { organizationId } },
      include: {
        offering: {
          include: {
            course: true,
            section: {
              include: {
                gradeLevel: true,
                enrollments: { select: { id: true } },
              },
            },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    });
    return logs.map((l) => ({
      id: l.id,
      courseOfferingId: l.courseOfferingId,
      className: l.offering.course.name,
      grades: l.offering.section.gradeLevel
        ? [l.offering.section.gradeLevel]
        : [],
      startedAt: l.startedAt,
      endedAt: l.endedAt,
      active: l.endedAt === null,
      studentCount: l.offering.section.enrollments.length,
    }));
  }

  async updateProfile(
    teacherId: string,
    organizationId: string,
    dto: { gender?: 'MALE' | 'FEMALE' | 'OTHER' | null },
  ) {
    await this.ensureTeacher(teacherId, organizationId);
    const data: { gender?: 'MALE' | 'FEMALE' | 'OTHER' | null } = {};
    if (dto.gender !== undefined) data.gender = dto.gender;
    return this.prisma.user.update({
      where: { id: teacherId },
      data,
      select: { id: true, name: true, gender: true },
    });
  }

  async getDocuments(teacherId: string, organizationId: string) {
    await this.ensureTeacher(teacherId, organizationId);
    return this.prisma.teacherDocument.findMany({
      where: { teacherId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  async createDocument(
    teacherId: string,
    organizationId: string,
    adminId: string,
    file: Express.Multer.File,
    dto: { type: string; title: string },
  ) {
    await this.ensureTeacher(teacherId, organizationId);
    if (!file) {
      throw new ApiError(
        ErrorCode.FILE_NO_TEXT,
        HttpStatus.BAD_REQUEST,
        'Please attach a file.',
      );
    }

    const dir = path.resolve(
      process.cwd(),
      process.env.TEACHER_DOCUMENT_UPLOAD_DIR ??
        process.env.DOCUMENT_UPLOAD_DIR ??
        'uploads/teacher-documents',
    );
    fs.mkdirSync(dir, { recursive: true });
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    const fileUrl = path.join(dir, fileName);

    try {
      fs.writeFileSync(fileUrl, file.buffer);
    } catch {
      throw new ApiError(
        ErrorCode.TEACHER_DOCUMENT_UPLOAD_FAILED,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Could not save the uploaded document.',
      );
    }

    return this.prisma.teacherDocument.create({
      data: {
        teacherId,
        uploadedById: adminId,
        type: dto.type as never,
        title: dto.title,
        fileName: file.originalname,
        fileUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
  }

  async deleteDocument(
    teacherId: string,
    documentId: string,
    organizationId: string,
  ) {
    const teacher = await this.ensureTeacher(teacherId, organizationId);
    const doc = await this.prisma.teacherDocument.findFirst({
      where: { id: documentId, teacherId: teacher.id },
    });
    if (!doc) {
      throw new ApiError(
        ErrorCode.TEACHER_DOCUMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This document could not be found.',
      );
    }
    try {
      fs.unlinkSync(doc.fileUrl);
    } catch {
      // file may already be gone; deletion of the row still succeeds
    }
    return this.prisma.teacherDocument.delete({ where: { id: doc.id } });
  }

  async getDocumentFile(
    teacherId: string,
    documentId: string,
    organizationId: string,
  ) {
    const teacher = await this.ensureTeacher(teacherId, organizationId);
    const doc = await this.prisma.teacherDocument.findFirst({
      where: { id: documentId, teacherId: teacher.id },
    });
    if (!doc) {
      throw new ApiError(
        ErrorCode.TEACHER_DOCUMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This document could not be found.',
      );
    }
    return doc;
  }

  async getSalaries(teacherId: string, organizationId: string) {
    await this.ensureTeacher(teacherId, organizationId);
    const records = await this.prisma.salaryRecord.findMany({
      where: { teacherId },
      orderBy: [{ period: 'desc' }],
    });
    return records.map((r) => ({
      ...r,
      amount: r.amount.toString(),
      amountPaid: r.amountPaid ? r.amountPaid.toString() : null,
    }));
  }

  async createSalary(
    teacherId: string,
    organizationId: string,
    dto: {
      period: string;
      amount: number;
      amountPaid?: number | null;
      status?: 'PAID' | 'PARTIAL' | 'POSTPONED' | 'UNPAID';
      body?: string | null;
      paidAt?: string | null;
    },
  ) {
    await this.ensureTeacher(teacherId, organizationId);
    const existing = await this.prisma.salaryRecord.findFirst({
      where: { teacherId, period: dto.period },
    });
    if (existing) {
      throw new ApiError(
        ErrorCode.SALARY_CONFLICT,
        HttpStatus.CONFLICT,
        'A salary record for this period already exists.',
      );
    }
    return this.prisma.salaryRecord.create({
      data: {
        teacherId,
        period: dto.period,
        amount: dto.amount,
        amountPaid: dto.amountPaid ?? null,
        status: dto.status ?? 'UNPAID',
        body: dto.body ?? null,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : null,
      },
    });
  }

  async updateSalary(
    teacherId: string,
    salaryId: string,
    organizationId: string,
    dto: {
      period?: string;
      amount?: number;
      amountPaid?: number | null;
      status?: 'PAID' | 'PARTIAL' | 'POSTPONED' | 'UNPAID';
      body?: string | null;
      paidAt?: string | null;
    },
  ) {
    await this.ensureTeacher(teacherId, organizationId);
    const record = await this.prisma.salaryRecord.findFirst({
      where: { id: salaryId, teacherId },
    });
    if (!record) {
      throw new ApiError(
        ErrorCode.SALARY_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This salary record could not be found.',
      );
    }
    const data: Record<string, unknown> = {};
    if (dto.period !== undefined) data.period = dto.period;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.amountPaid !== undefined) data.amountPaid = dto.amountPaid ?? null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.body !== undefined) data.body = dto.body ?? null;
    if (dto.paidAt !== undefined)
      data.paidAt = dto.paidAt ? new Date(dto.paidAt) : null;
    return this.prisma.salaryRecord.update({
      where: { id: salaryId },
      data,
    });
  }

  async deleteSalary(
    teacherId: string,
    salaryId: string,
    organizationId: string,
  ) {
    await this.ensureTeacher(teacherId, organizationId);
    const record = await this.prisma.salaryRecord.findFirst({
      where: { id: salaryId, teacherId },
    });
    if (!record) {
      throw new ApiError(
        ErrorCode.SALARY_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This salary record could not be found.',
      );
    }
    return this.prisma.salaryRecord.delete({ where: { id: salaryId } });
  }
}
