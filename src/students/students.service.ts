import { PrismaService } from '../prisma/prisma.service';
import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { DocumentsService } from '../documents/documents.service';

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
    private readonly documentsService: DocumentsService,
  ) {}

  async getGrades(id: string, organizationId: string) {
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
  ) {
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

  async getClasses(studentId: string, organizationId: string) {
    return this.prisma.section.findMany({
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
            assignments: { include: { rubrics: true } },
          },
        },
      },
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
    return this.prisma.user.update({
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
  }

  async linkGuardian(
    studentId: string,
    guardianId: string,
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
    const guardian = await this.prisma.user.findFirst({
      where: { id: guardianId, organizationId },
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
      data: { guardianId },
    });
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
    dto: {
      category?: string | null;
      title: string;
      academicYear?: string | null;
    },
  ) {
    await this.ensureStudent(studentId, organizationId);
    if (!file) {
      throw new ApiError(
        ErrorCode.FILE_NO_TEXT,
        HttpStatus.BAD_REQUEST,
        'Please attach a file.',
      );
    }

    const fileUrl = await this.documentsService.storeFile(
      organizationId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    let aiSuggestedCategory: string | null = null;
    if (!dto.category) {
      const rawText = await this.documentsService.extractText(
        file.buffer,
        file.originalname,
      );
      if (rawText) {
        aiSuggestedCategory =
          await this.documentsService.suggestCategory(rawText);
      }
    }

    return this.prisma.studentDocument.create({
      data: {
        studentId,
        organizationId,
        uploadedById: adminId,
        category: (dto.category ?? 'OTHER') as never,
        title: dto.title,
        academicYear: dto.academicYear ?? null,
        fileName: file.originalname,
        fileUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        aiSuggestedCategory,
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
    await this.documentsService.removeFromStorage(doc.fileUrl);
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
    const url = await this.documentsService.createSignedUrl(doc.fileUrl);
    return { url, fileName: doc.fileName, mimeType: doc.mimeType };
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
