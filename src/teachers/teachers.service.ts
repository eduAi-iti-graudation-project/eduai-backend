import { PrismaService } from '../prisma/prisma.service';
import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import {
  encryptSsn,
  decryptSsn,
  maskSsn,
  ssnTail4,
} from '../common/crypto/ssn';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class TeachersService {
  constructor(private readonly prisma: PrismaService) {}

  private formatPersonal(
    profile: {
      phone: string | null;
      street: string | null;
      city: string | null;
      nationality: string | null;
      personalEmail: string | null;
      dateOfBirth: Date | null;
      ssnEncrypted: string | null;
      ssnTail4: string | null;
      emergencyContactName: string | null;
      emergencyContactPhone: string | null;
      emergencyContactRelationship: string | null;
    } | null,
  ) {
    return {
      phone: profile?.phone ?? null,
      street: profile?.street ?? null,
      city: profile?.city ?? null,
      nationality: profile?.nationality ?? null,
      personalEmail: profile?.personalEmail ?? null,
      dateOfBirth: profile?.dateOfBirth
        ? profile.dateOfBirth.toISOString().slice(0, 10)
        : null,
      ssnMasked: profile
        ? maskSsn(profile.ssnEncrypted, profile.ssnTail4)
        : null,
      emergencyContact: {
        name: profile?.emergencyContactName ?? null,
        phone: profile?.emergencyContactPhone ?? null,
        relationship: profile?.emergencyContactRelationship ?? null,
      },
    };
  }

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
        section: {
          include: {
            gradeLevel: true,
            _count: { select: { enrollments: true } },
          },
        },
      },
    });

    // Grades the teacher actually teaches, with per-grade counts scoped to
    // the teacher's own sections/courses in that grade.
    const byGrade = new Map<
      string,
      {
        grade: {
          id: string;
          level: number;
          name: string | null;
          createdAt: Date;
        };
        sections: Set<string>;
        courses: Set<string>;
        offeringId: string;
      }
    >();
    for (const o of offerings) {
      const gradeLevel = o.section.gradeLevel;
      if (!gradeLevel) continue;
      let entry = byGrade.get(gradeLevel.id);
      if (!entry) {
        entry = {
          grade: gradeLevel,
          sections: new Set(),
          courses: new Set(),
          offeringId: o.id,
        };
        byGrade.set(gradeLevel.id, entry);
      }
      entry.sections.add(o.section.id);
      entry.courses.add(o.course.id);
    }

    const rows: Array<{
      id: string;
      teacherId: string;
      gradeId: string | null;
      grade: object | null;
      _count: { sections: number; courses: number; students: number };
    }> = [];

    for (const [gradeId, entry] of byGrade) {
      const students = await this.prisma.enrollment.count({
        where: {
          sectionId: { in: [...entry.sections] },
          status: 'APPROVED',
        },
      });
      rows.push({
        id: entry.offeringId,
        teacherId,
        gradeId,
        grade: entry.grade,
        _count: {
          sections: entry.sections.size,
          courses: entry.courses.size,
          students,
        },
      });
    }

    return rows;
  }

  async getGrade(teacherId: string, gradeId: string) {
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

    const gradeLevel = await this.prisma.gradeLevel.findUnique({
      where: { id: gradeId },
    });
    if (!gradeLevel) {
      throw new ApiError(
        ErrorCode.GRADE_LEVEL_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This grade could not be found.',
      );
    }

    const offerings = await this.prisma.courseOffering.findMany({
      where: { teacherId, section: { gradeLevelId: gradeId } },
      include: {
        course: true,
        section: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    const sectionMap = new Map<
      string,
      {
        id: string;
        name: string;
        description: string | null;
        courses: Set<string>;
      }
    >();
    const courseMap = new Map<
      string,
      { id: string; name: string; description: string | null }
    >();
    for (const o of offerings) {
      const s = o.section;
      let entry = sectionMap.get(s.id);
      if (!entry) {
        entry = {
          id: s.id,
          name: s.name,
          description: s.description,
          courses: new Set(),
        };
        sectionMap.set(s.id, entry);
      }
      entry.courses.add(o.course.id);
      if (!courseMap.has(o.course.id)) {
        courseMap.set(o.course.id, {
          id: o.course.id,
          name: o.course.name,
          description: o.course.description,
        });
      }
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        sectionId: { in: [...sectionMap.keys()] },
        status: 'APPROVED',
      },
      select: { sectionId: true },
    });
    const perSection = new Map<string, number>();
    for (const e of enrollments) {
      perSection.set(e.sectionId, (perSection.get(e.sectionId) ?? 0) + 1);
    }

    return {
      id: gradeLevel.id,
      level: gradeLevel.level,
      name: gradeLevel.name,
      students: enrollments.length,
      sections: [...sectionMap.values()].map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        enrollments: perSection.get(s.id) ?? 0,
        courses: [...s.courses].map((cid) => courseMap.get(cid)!),
      })),
      courses: [...courseMap.values()],
    };
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

    const [offerings, quizzes, docsCount, salaryCount, profile] =
      await Promise.all([
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
        this.prisma.teacherProfile.findUnique({ where: { teacherId } }),
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
      avatarUrl: teacher.avatarUrl,
      createdAt: teacher.createdAt,
      ...this.formatPersonal(profile),
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

  async getMyProfile(userId: string, organizationId: string) {
    const teacher = await this.ensureTeacher(userId, organizationId);
    const profile = await this.prisma.teacherProfile.findUnique({
      where: { teacherId: userId },
    });
    return {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      gender: teacher.gender,
      avatarUrl: teacher.avatarUrl,
      createdAt: teacher.createdAt,
      ...this.formatPersonal(profile),
    };
  }

  async updateMyProfile(
    userId: string,
    organizationId: string,
    dto: Parameters<TeachersService['updateProfile']>[2],
  ) {
    await this.ensureTeacher(userId, organizationId);
    return this.updateProfile(userId, organizationId, dto);
  }

  async updateProfile(
    teacherId: string,
    organizationId: string,
    dto: {
      gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
      ssn?: string;
      phone?: string | null;
      street?: string | null;
      city?: string | null;
      nationality?: string | null;
      personalEmail?: string | null;
      dateOfBirth?: string | null;
      emergencyContactName?: string | null;
      emergencyContactPhone?: string | null;
      emergencyContactRelationship?: string | null;
    },
  ) {
    await this.ensureTeacher(teacherId, organizationId);
    const data: { gender?: 'MALE' | 'FEMALE' | 'OTHER' | null } = {};
    if (dto.gender !== undefined) data.gender = dto.gender;

    const profileData: {
      phone?: string | null;
      street?: string | null;
      city?: string | null;
      nationality?: string | null;
      personalEmail?: string | null;
      dateOfBirth?: Date | null;
      ssnEncrypted?: string;
      ssnTail4?: string;
      emergencyContactName?: string | null;
      emergencyContactPhone?: string | null;
      emergencyContactRelationship?: string | null;
    } = {};
    if (dto.phone !== undefined) profileData.phone = dto.phone;
    if (dto.street !== undefined) profileData.street = dto.street;
    if (dto.city !== undefined) profileData.city = dto.city;
    if (dto.nationality !== undefined)
      profileData.nationality = dto.nationality;
    if (dto.personalEmail !== undefined)
      profileData.personalEmail = dto.personalEmail?.trim()
        ? dto.personalEmail
        : null;
    if (dto.dateOfBirth !== undefined)
      profileData.dateOfBirth = dto.dateOfBirth
        ? new Date(`${dto.dateOfBirth}T00:00:00.000Z`)
        : null;
    if (dto.emergencyContactName !== undefined)
      profileData.emergencyContactName = dto.emergencyContactName;
    if (dto.emergencyContactPhone !== undefined)
      profileData.emergencyContactPhone = dto.emergencyContactPhone;
    if (dto.emergencyContactRelationship !== undefined)
      profileData.emergencyContactRelationship =
        dto.emergencyContactRelationship;
    if (dto.ssn !== undefined) {
      profileData.ssnEncrypted = encryptSsn(dto.ssn);
      profileData.ssnTail4 = ssnTail4(dto.ssn);
    }

    const [, profile] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: teacherId }, data }),
      this.prisma.teacherProfile.upsert({
        where: { teacherId },
        create: { teacherId, ...profileData },
        update: profileData,
      }),
    ]);

    return this.formatPersonal(profile);
  }

  async getSsn(teacherId: string, organizationId: string) {
    await this.ensureTeacher(teacherId, organizationId);
    const profile = await this.prisma.teacherProfile.findUnique({
      where: { teacherId },
    });
    if (!profile?.ssnEncrypted) {
      throw new ApiError(
        ErrorCode.SSN_INVALID,
        HttpStatus.NOT_FOUND,
        'No SSN is stored for this teacher.',
      );
    }
    return { ssn: decryptSsn(profile.ssnEncrypted) };
  }

  private async saveAvatar(
    teacher: { id: string },
    file: Express.Multer.File | undefined,
    removeOld: boolean,
  ) {
    if (!file || !file.mimetype.startsWith('image/')) {
      throw new ApiError(
        ErrorCode.PHOTO_INVALID,
        HttpStatus.BAD_REQUEST,
        'The photo must be a JPEG or PNG image.',
      );
    }
    const ext =
      file.mimetype === 'image/png'
        ? 'png'
        : file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg'
          ? 'jpg'
          : null;
    if (!ext) {
      throw new ApiError(
        ErrorCode.PHOTO_INVALID,
        HttpStatus.BAD_REQUEST,
        'The photo must be a JPEG or PNG image.',
      );
    }
    const dir = path.resolve(
      process.cwd(),
      process.env.PHOTO_UPLOAD_DIR ?? 'uploads/photos',
    );
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const fileUrl = path.join(dir, fileName);
    try {
      fs.writeFileSync(fileUrl, file.buffer);
    } catch {
      throw new ApiError(
        ErrorCode.PHOTO_UPLOAD_FAILED,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Could not save the photo. Please try again.',
      );
    }
    const existing = await this.prisma.user.findUnique({
      where: { id: teacher.id },
      select: { avatarUrl: true },
    });
    const updated = await this.prisma.user.update({
      where: { id: teacher.id },
      data: { avatarUrl: fileUrl },
      select: { avatarUrl: true },
    });
    if (removeOld && existing?.avatarUrl && existing.avatarUrl !== fileUrl) {
      try {
        fs.unlinkSync(existing.avatarUrl);
      } catch {
        /* best-effort cleanup */
      }
    }
    return updated.avatarUrl;
  }

  async updateAvatar(
    teacherId: string,
    organizationId: string,
    file: Express.Multer.File | undefined,
  ) {
    const teacher = await this.ensureTeacher(teacherId, organizationId);
    return this.saveAvatar({ id: teacher.id }, file, true);
  }

  async updateMyAvatar(
    userId: string,
    organizationId: string,
    file: Express.Multer.File | undefined,
  ) {
    const teacher = await this.ensureTeacher(userId, organizationId);
    return this.saveAvatar({ id: teacher.id }, file, true);
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
