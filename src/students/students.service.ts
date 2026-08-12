import { PrismaService } from '../prisma/prisma.service';
import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { EnrollSyncService } from '../roster/enroll-sync.service';
import { JoinRequestsService } from '../join-requests/join-requests.service';
import { SupabaseService } from '../auth/supabase.service';
import { encryptCredential } from '../common/crypto/credentials';
import { generatePassword } from '../common/mailer/generated-credentials';
import type { User } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';

function academicYearOf(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = m >= 7 ? y : y - 1;
  return `${start}-${start + 1}`;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollSync: EnrollSyncService,
    private readonly supabaseService: SupabaseService,
    private readonly joinRequests: JoinRequestsService,
  ) {}

  /**
   * The post-import follow-up queue: students of THIS organization who are
   * missing a grade level and/or have no APPROVED section enrollment.
   */
  async listUnassignedStudents(organizationId: string) {
    return this.prisma.user.findMany({
      where: {
        organizationId,
        role: 'STUDENT',
        OR: [
          { gradeId: null },
          { enrollments: { none: { status: 'APPROVED' } } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        gradeId: true,
        grade: { select: { id: true, level: true, name: true } },
        enrollments: {
          where: { status: 'APPROVED' },
          select: {
            sectionId: true,
            section: { select: { id: true, name: true } },
          },
        },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Org admin student list. `withoutGuardian = true` narrows to students with
   * no linked guardian (the WP2 "students without guardian" widget).
   */
  async listStudents(organizationId: string, withoutGuardian: boolean) {
    return this.prisma.user.findMany({
      where: {
        organizationId,
        role: 'STUDENT',
        ...(withoutGuardian ? { guardianId: null } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        gradeId: true,
        grade: { select: { id: true, level: true, name: true } },
        guardian: { select: { id: true, name: true, email: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * WP4 ownership audit: students may only read their own data; guardians
   * only their wards' (404 so unrelated students stay invisible). Admin and
   * teacher callers are unaffected.
   */
  private async assertStudentReadAccess(
    studentId: string,
    organizationId: string,
    caller?: { id: string; role: User['role'] },
  ): Promise<void> {
    if (!caller || caller.role === 'ADMIN' || caller.role === 'TEACHER') return;
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, role: 'STUDENT', organizationId },
      select: { guardianId: true },
    });
    if (!student) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }
    if (caller.role === 'GUARDIAN') {
      if (student.guardianId !== caller.id) {
        throw new ApiError(
          ErrorCode.STUDENT_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This student could not be found.',
        );
      }
      return;
    }
    if (caller.role === 'STUDENT' && caller.id !== studentId) {
      throw new ApiError(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        "You don't have permission to do that.",
      );
    }
  }

  async getGrades(
    id: string,
    organizationId: string,
    caller?: { id: string; role: User['role'] },
  ) {
    await this.assertStudentReadAccess(id, organizationId, caller);
    const grades = await this.prisma.gradingScore.findMany({
      where: {
        submission: { studentId: id, student: { organizationId } },
        isConfirmed: true,
      },
      include: { criteria: true, submission: true },
    });

    return grades.map((g) => ({
      id: g.id,
      submissionId: g.submissionId,
      assignmentId: g.submission.assignmentId,
      criteriaId: g.criteriaId,
      pointsAwarded: g.pointsAwarded,
      aiFeedback: g.aiFeedback,
      teacherNotes: g.teacherNotes,
      isConfirmed: g.isConfirmed,
      createdAt: g.createdAt,
      criterionDescription: g.criteria.description,
      criterionMaxPoints: g.criteria.maxPoints,
    }));
  }

  async getSubmissionGrades(
    studentId: string,
    submissionId: string,
    organizationId: string,
    caller?: { id: string; role: User['role'] },
  ) {
    await this.assertStudentReadAccess(studentId, organizationId, caller);
    const submission = await this.prisma.submission.findFirst({
      where: {
        id: submissionId,
        studentId,
        student: { organizationId },
      },
    });
    if (!submission) {
      throw new ApiError(
        ErrorCode.SUBMISSION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This submission could not be found.',
      );
    }

    const grades = await this.prisma.gradingScore.findMany({
      where: { submissionId, isConfirmed: true },
      include: { criteria: true },
    });

    return grades.map((g) => ({
      id: g.id,
      submissionId: g.submissionId,
      assignmentId: submission.assignmentId,
      criteriaId: g.criteriaId,
      pointsAwarded: g.pointsAwarded,
      aiFeedback: g.aiFeedback,
      teacherNotes: g.teacherNotes,
      isConfirmed: g.isConfirmed,
      createdAt: g.createdAt,
      criterionDescription: g.criteria.description,
      criterionMaxPoints: g.criteria.maxPoints,
    }));
  }

  async getClasses(
    studentId: string,
    organizationId: string,
    caller?: { id: string; role: User['role'] },
  ) {
    await this.assertStudentReadAccess(studentId, organizationId, caller);
    const sections = await this.prisma.section.findMany({
      where: {
        organizationId,
        enrollments: {
          some: { studentId, status: 'APPROVED' },
        },
      },
      include: {
        gradeLevel: true,
        offerings: {
          include: {
            course: true,
            teacher: true,
            assignments: {
              include: {
                rubrics: true,
                materials: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
    });

    return sections.map((s) => {
      const teacherNames = [
        ...new Set(
          s.offerings
            .map((o) => o.teacher?.name)
            .filter((n): n is string => Boolean(n)),
        ),
      ];
      return {
        id: s.id,
        name: s.name,
        description: s.description ?? (s.gradeLevel ? s.gradeLevel.name : null),
        teacherName: teacherNames.join(', '),
        assignments: s.offerings.flatMap((o) =>
          o.assignments.map((a) => ({
            id: a.id,
            title: a.title,
            description: a.description,
            dueDate: a.dueDate.toISOString(),
            totalPoints: a.totalPoints,
            materials: a.materials.map((m) => ({ id: m.id, title: m.title })),
          })),
        ),
      };
    });
  }

  async update(
    studentId: string,
    dto: {
      name?: string;
      email?: string;
      gradeLevelId?: string;
      guardianId?: string;
    },
    organizationId: string,
  ) {
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, organizationId },
    });
    if (!student) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }
    if (dto.guardianId) {
      const guardian = await this.prisma.user.findFirst({
        where: { id: dto.guardianId, organizationId },
      });
      if (!guardian) {
        throw new ApiError(
          ErrorCode.GUARDIAN_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'This guardian could not be found.',
        );
      }
    }
    const updated = await this.prisma.user.update({
      where: { id: studentId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.gradeLevelId !== undefined
          ? { gradeId: dto.gradeLevelId }
          : {}),
        ...(dto.guardianId !== undefined ? { guardianId: dto.guardianId } : {}),
      },
    });
    if (
      dto.gradeLevelId !== undefined &&
      dto.gradeLevelId !== student.gradeId
    ) {
      await this.enrollSync.syncStudentToGrade(
        studentId,
        organizationId,
        dto.gradeLevelId,
      );
    }
    return updated;
  }

  async linkGuardian(
    studentId: string,
    dto: { guardianId?: string; email?: string; name?: string },
    organizationId: string,
    decidedBy: string,
  ) {
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, organizationId },
    });
    if (!student) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }

    // WP2: create the guardian from a real email (school identity provisioned,
    // verify invite sent) and link — for rows imported without guardian data.
    if (dto.email) {
      if (!dto.name) {
        throw new ApiError(
          ErrorCode.VALIDATION_FAILED,
          HttpStatus.BAD_REQUEST,
          'A guardian name is required when creating a guardian from an email.',
        );
      }
      return this.joinRequests.provisionGuardian({
        organizationId,
        studentId,
        name: dto.name,
        personalEmail: dto.email,
        decidedBy,
      });
    }

    if (!dto.guardianId) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Provide either a guardianId (existing account) or an email + name to create the guardian.',
      );
    }
    const guardian = await this.prisma.user.findFirst({
      where: { id: dto.guardianId, organizationId },
    });
    if (!guardian) {
      throw new ApiError(
        ErrorCode.GUARDIAN_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This guardian could not be found.',
      );
    }
    return this.prisma.user.update({
      where: { id: studentId },
      data: { guardianId: dto.guardianId },
    });
  }

  /**
   * WP1 admin escape hatch: regenerate a school-provisioned student's login
   * password (Supabase) and re-encrypt the stored copy. The new password is
   * returned ONCE to the admin (e.g. "parent lost access").
   */
  async resetCredentials(id: string, organizationId: string) {
    const student = await this.prisma.user.findFirst({
      where: { id, role: 'STUDENT', organizationId },
      select: { id: true, authId: true, email: true },
    });
    if (!student) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }
    if (!student.authId) {
      throw new ApiError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        HttpStatus.BAD_REQUEST,
        'This student has no auth identity to reset.',
      );
    }
    const password = generatePassword(10);
    await this.supabaseService
      .getClient()
      .auth.admin.updateUserById(student.authId, { password });
    await this.prisma.user.update({
      where: { id: student.id },
      data: { credentialEncrypted: encryptCredential(password) },
    });
    return { email: student.email, password };
  }

  private async ensureStudent(id: string, organizationId: string) {
    const student = await this.prisma.user.findFirst({
      where: { id, role: 'STUDENT', organizationId },
      include: {
        grade: true,
        guardian: { select: { id: true, name: true, email: true } },
        enrollments: {
          where: { status: 'APPROVED' },
          include: {
            section: {
              include: {
                gradeLevel: true,
                offerings: {
                  include: {
                    teacher: { select: { id: true, name: true, email: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!student) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }
    return student;
  }

  async getAdminProfile(studentId: string, organizationId: string) {
    const student = await this.ensureStudent(studentId, organizationId);
    const [activeAlertCount, quizGrades] = await Promise.all([
      this.prisma.alert.count({
        where: { studentId, status: 'ACTIVE' },
      }),
      this.getQuizGrades(studentId, organizationId),
    ]);

    const classes = student.enrollments.map((e) => ({
      id: e.section.id,
      name: e.section.name,
      description: e.section.description,
      teacher: e.section.offerings[0]?.teacher ?? null,
      grade: e.section.gradeLevel ?? null,
    }));

    return {
      id: student.id,
      name: student.name,
      email: student.email,
      grade: student.grade,
      guardian: student.guardian,
      createdAt: student.createdAt,
      classes,
      activeAlertCount,
      quizGradeSummary: {
        count: quizGrades.length,
        averagePct: quizGrades.length
          ? Math.round(
              quizGrades.reduce((sum, g) => sum + g.percent, 0) /
                quizGrades.length,
            )
          : null,
      },
    };
  }

  async getQuizGrades(studentId: string, organizationId: string) {
    await this.ensureStudent(studentId, organizationId);
    const attempts = await this.prisma.quizAttempt.findMany({
      where: {
        studentId,
        status: 'COMPLETED',
        submittedAt: { not: null },
        quiz: { offering: { organizationId } },
      },
      include: {
        quiz: {
          include: {
            offering: {
              include: {
                course: { select: { id: true, name: true } },
                section: { select: { id: true, name: true } },
                teacher: { select: { id: true, name: true } },
              },
            },
            questions: { select: { points: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return attempts.map((a) => {
      const maxPoints = a.quiz.questions.reduce((sum, q) => sum + q.points, 0);
      const totalScore = a.totalScore ?? 0;
      return {
        id: a.id,
        quizId: a.quizId,
        quizTitle: a.quiz.title,
        className: a.quiz.offering.section.name,
        teacherName: a.quiz.offering.teacher?.name ?? null,
        totalScore,
        maxPoints,
        percent: maxPoints ? Math.round((totalScore / maxPoints) * 100) : 0,
        submittedAt: a.submittedAt,
      };
    });
  }

  async getHistory(studentId: string, organizationId: string) {
    const student = await this.ensureStudent(studentId, organizationId);
    const [attempts, alerts] = await Promise.all([
      this.prisma.quizAttempt.findMany({
        where: {
          studentId,
          status: 'COMPLETED',
          submittedAt: { not: null },
          quiz: { offering: { organizationId } },
        },
        include: {
          quiz: {
            include: {
              questions: { select: { points: true } },
            },
          },
        },
      }),
      this.prisma.alert.findMany({
        where: { studentId, student: { organizationId } },
        include: {
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { diagnosis: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const byYear = new Map<
      string,
      {
        year: string;
        quizCount: number;
        quizAveragePct: number | null;
        quizScores: {
          quizTitle: string;
          totalScore: number;
          maxPoints: number;
          percent: number;
          submittedAt: Date;
        }[];
        warnings: {
          id: string;
          type: string;
          reason: string;
          status: string;
          createdAt: Date;
          severity?: string;
        }[];
      }
    >();

    for (const a of attempts) {
      if (!a.submittedAt) continue;
      const key = academicYearOf(a.submittedAt);
      const bucket = byYear.get(key) ?? {
        year: key,
        quizCount: 0,
        quizAveragePct: null,
        quizScores: [],
        warnings: [],
      };
      const maxPoints = a.quiz.questions.reduce((s, q) => s + q.points, 0);
      const totalScore = a.totalScore ?? 0;
      bucket.quizCount += 1;
      bucket.quizScores.push({
        quizTitle: a.quiz.title,
        totalScore,
        maxPoints,
        percent: maxPoints ? Math.round((totalScore / maxPoints) * 100) : 0,
        submittedAt: a.submittedAt,
      });
      byYear.set(key, bucket);
    }

    for (const alert of alerts) {
      const key = academicYearOf(alert.createdAt);
      const bucket = byYear.get(key) ?? {
        year: key,
        quizCount: 0,
        quizAveragePct: null,
        quizScores: [],
        warnings: [],
      };
      const diagnosis = alert.analyses[0]?.diagnosis as
        { severity?: string } | undefined;
      bucket.warnings.push({
        id: alert.id,
        type: alert.type,
        reason: alert.reason,
        status: alert.status,
        createdAt: alert.createdAt,
        severity: diagnosis?.severity,
      });
      byYear.set(key, bucket);
    }

    const years = Array.from(byYear.values());
    for (const bucket of years) {
      if (bucket.quizScores.length > 0) {
        bucket.quizAveragePct = Math.round(
          bucket.quizScores.reduce((s, q) => s + q.percent, 0) /
            bucket.quizScores.length,
        );
      }
      bucket.quizScores.sort(
        (x, y) =>
          new Date(y.submittedAt).getTime() - new Date(x.submittedAt).getTime(),
      );
      bucket.warnings.sort(
        (x, y) =>
          new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime(),
      );
    }
    years.sort((a, b) => b.year.localeCompare(a.year));

    return { studentId: student.id, years };
  }

  async getDocuments(studentId: string, organizationId: string) {
    await this.ensureStudent(studentId, organizationId);
    return this.prisma.studentDocument.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  async createDocument(
    studentId: string,
    organizationId: string,
    adminId: string,
    file: Express.Multer.File,
    dto: { type: string; title: string; academicYear?: string | null },
  ) {
    await this.ensureStudent(studentId, organizationId);
    if (!file) {
      throw new ApiError(
        ErrorCode.FILE_NO_TEXT,
        HttpStatus.BAD_REQUEST,
        'Please attach a file.',
      );
    }

    const dir = path.resolve(
      process.cwd(),
      process.env.DOCUMENT_UPLOAD_DIR ?? 'uploads/documents',
    );
    fs.mkdirSync(dir, { recursive: true });
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    const fileUrl = path.join(dir, fileName);

    try {
      fs.writeFileSync(fileUrl, file.buffer);
    } catch {
      throw new ApiError(
        ErrorCode.DOCUMENT_UPLOAD_FAILED,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Could not save the uploaded document.',
      );
    }

    return this.prisma.studentDocument.create({
      data: {
        studentId,
        uploadedById: adminId,
        type: dto.type as never,
        title: dto.title,
        academicYear: dto.academicYear ?? null,
        fileName: file.originalname,
        fileUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
  }

  async deleteDocument(
    studentId: string,
    documentId: string,
    organizationId: string,
  ) {
    const student = await this.ensureStudent(studentId, organizationId);
    const doc = await this.prisma.studentDocument.findFirst({
      where: { id: documentId, studentId: student.id },
    });
    if (!doc) {
      throw new ApiError(
        ErrorCode.DOCUMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This document could not be found.',
      );
    }
    try {
      fs.unlinkSync(doc.fileUrl);
    } catch {
      // file may already be gone; deletion of the row still succeeds
    }
    return this.prisma.studentDocument.delete({ where: { id: doc.id } });
  }

  async getDocumentFile(
    studentId: string,
    documentId: string,
    organizationId: string,
  ) {
    const student = await this.ensureStudent(studentId, organizationId);
    const doc = await this.prisma.studentDocument.findFirst({
      where: { id: documentId, studentId: student.id },
    });
    if (!doc) {
      throw new ApiError(
        ErrorCode.DOCUMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This document could not be found.',
      );
    }
    return doc;
  }

  async getFees(studentId: string, organizationId: string) {
    await this.ensureStudent(studentId, organizationId);
    const fees = await this.prisma.feePayment.findMany({
      where: { studentId },
      orderBy: [{ academicYear: 'desc' }, { feeType: 'asc' }],
    });
    return fees.map((f) => ({
      ...f,
      amount: f.amount.toString(),
      amountPaid: f.amountPaid ? f.amountPaid.toString() : null,
    }));
  }

  async createFee(
    studentId: string,
    organizationId: string,
    dto: {
      academicYear: string;
      feeType: string;
      amount: number;
      amountPaid?: number | null;
      status: string;
      body?: string | null;
      paidAt?: string | null;
      dueDate?: string | null;
    },
  ) {
    const student = await this.ensureStudent(studentId, organizationId);
    const existing = await this.prisma.feePayment.findFirst({
      where: {
        studentId: student.id,
        academicYear: dto.academicYear,
        feeType: dto.feeType as never,
      },
    });
    if (existing) {
      throw new ApiError(
        ErrorCode.FEE_CONFLICT,
        HttpStatus.CONFLICT,
        `A ${dto.feeType} fee for ${dto.academicYear} already exists for this student.`,
      );
    }
    return this.prisma.feePayment.create({
      data: {
        studentId: student.id,
        academicYear: dto.academicYear,
        feeType: dto.feeType as never,
        amount: dto.amount,
        amountPaid: dto.amountPaid ?? null,
        status: dto.status as never,
        body: dto.body ?? null,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
    });
  }

  async updateFee(
    studentId: string,
    feeId: string,
    organizationId: string,
    dto: {
      amount?: number;
      amountPaid?: number | null;
      status?: string;
      body?: string | null;
      paidAt?: string | null;
      dueDate?: string | null;
    },
  ) {
    const student = await this.ensureStudent(studentId, organizationId);
    const fee = await this.prisma.feePayment.findFirst({
      where: { id: feeId, studentId: student.id },
    });
    if (!fee) {
      throw new ApiError(
        ErrorCode.FEE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This fee record could not be found.',
      );
    }
    return this.prisma.feePayment.update({
      where: { id: feeId },
      data: {
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.amountPaid !== undefined
          ? { amountPaid: dto.amountPaid ?? null }
          : {}),
        ...(dto.status ? { status: dto.status as never } : {}),
        ...(dto.body !== undefined ? { body: dto.body ?? null } : {}),
        ...(dto.paidAt !== undefined
          ? { paidAt: dto.paidAt ? new Date(dto.paidAt) : null }
          : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
          : {}),
      },
    });
  }

  async deleteFee(studentId: string, feeId: string, organizationId: string) {
    const student = await this.ensureStudent(studentId, organizationId);
    const fee = await this.prisma.feePayment.findFirst({
      where: { id: feeId, studentId: student.id },
    });
    if (!fee) {
      throw new ApiError(
        ErrorCode.FEE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This fee record could not be found.',
      );
    }
    return this.prisma.feePayment.delete({ where: { id: feeId } });
  }
}
