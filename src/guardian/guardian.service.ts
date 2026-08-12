import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../common/mailer/mailer.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';
import { encryptSsn, ssnTail4 } from '../common/crypto/ssn';
import { decryptCredential } from '../common/crypto/credentials';
import type { User } from '@prisma/client';

const PERCENT = (value?: number | null, max?: number | null): number | null =>
  value == null || !max || max <= 0
    ? null
    : Math.round((value / max) * 10000) / 100;

@Injectable()
export class GuardianService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  /** WP4 first-login gate: reveal/wards/profile all require the verify click. */
  private assertVerified(user: User): void {
    if (!user.emailVerifiedAt) {
      throw new ApiError(
        ErrorCode.GUARDIAN_VERIFY_REQUIRED,
        HttpStatus.FORBIDDEN,
        'Verify your email first — open the verify link your school sent you to unlock the parent dashboard.',
        { hint: ErrorHint.VERIFY_EMAIL },
      );
    }
  }

  /**
   * Ownership gate for every per-child guardian endpoint: the student must
   * be one of THIS guardian's wards. 404 (not 403) so student ids do not
   * leak to unrelated parents.
   */
  private async assertWard(
    guardianId: string,
    studentId: string,
  ): Promise<{ id: string; name: string }> {
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, role: 'STUDENT' },
      select: { id: true, name: true, guardianId: true },
    });
    if (!student || student.guardianId !== guardianId) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This child could not be found.',
      );
    }
    return { id: student.id, name: student.name };
  }

  /** Public for the students.controller ownership audit (WP4.2). */
  assertWardAccess(guardianId: string, studentId: string) {
    return this.assertWard(guardianId, studentId);
  }

  async wards(guardian: User) {
    this.assertVerified(guardian);
    const guardianRow = await this.prisma.user.findUnique({
      where: { id: guardian.id },
      include: {
        wards: {
          include: {
            grade: { select: { id: true, name: true, level: true } },
            alerts: {
              where: { status: 'ACTIVE' },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!guardianRow) return { wards: [] };

    const wards = await Promise.all(
      guardianRow.wards.map(async (ward) => {
        const [confirmedScores, unpaidFees, unreadNotifications] =
          await Promise.all([
            this.prisma.gradingScore.findMany({
              where: { isConfirmed: true, submission: { studentId: ward.id } },
              include: { criteria: true },
              orderBy: { createdAt: 'desc' },
            }),
            this.prisma.feePayment.count({
              where: {
                studentId: ward.id,
                status: { in: ['UNPAID', 'PARTIAL'] },
              },
            }),
            this.prisma.notification.count({
              where: { userId: ward.id, readAt: null },
            }),
          ]);

        const percentages = confirmedScores.map((g) =>
          PERCENT(g.pointsAwarded, g.criteria.maxPoints),
        );
        const known = percentages.filter((p): p is number => p !== null);
        const averagePct =
          known.length > 0
            ? Math.round(
                (known.reduce((s, p) => s + p, 0) / known.length) * 100,
              ) / 100
            : null;
        const latest = confirmedScores[0];

        return {
          id: ward.id,
          name: ward.name,
          gradeLevelName: ward.grade?.name ?? null,
          avatarUrl: ward.avatarUrl,
          averagePct,
          latestGrade:
            latest && latest.criteria
              ? {
                  name: latest.criteria.description,
                  percentage: PERCENT(
                    latest.pointsAwarded,
                    latest.criteria.maxPoints,
                  ),
                }
              : null,
          openAlerts: ward.alerts.length,
          unpaidFees: unpaidFees > 0,
          unreadNotifications,
        };
      }),
    );

    return { wards };
  }

  async wardInsights(guardian: User, studentId: string) {
    this.assertVerified(guardian);
    const ward = await this.assertWard(guardian.id, studentId);

    const [confirmedScores, attendanceRecords, quizAttempts, fees, openAlerts] =
      await Promise.all([
        this.prisma.gradingScore.findMany({
          where: { isConfirmed: true, submission: { studentId: ward.id } },
          include: { criteria: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.attendance.findMany({
          where: { studentId: ward.id },
          orderBy: { date: 'asc' },
        }),
        this.prisma.quizAttempt.findMany({
          where: { studentId: ward.id, status: 'COMPLETED' },
          include: {
            quiz: {
              include: {
                questions: { select: { points: true } },
              },
            },
          },
          orderBy: { submittedAt: 'desc' },
        }),
        this.prisma.feePayment.findMany({
          where: { studentId: ward.id },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.alert.findMany({
          where: { studentId: ward.id, status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            reason: true,
            createdAt: true,
          },
        }),
      ]);

    const percentages = confirmedScores.map((g) =>
      PERCENT(g.pointsAwarded, g.criteria.maxPoints),
    );
    const known = percentages.filter((p): p is number => p !== null);

    const totalAttendance = attendanceRecords.length;
    const statusCount = (status: string) =>
      attendanceRecords.filter((r) => r.status === status).length;

    const completed = quizAttempts.length;
    const quizPercents = quizAttempts
      .map((a) => {
        const totalPoints = a.quiz.questions.reduce((s, q) => s + q.points, 0);
        return PERCENT(a.totalScore, totalPoints);
      })
      .filter((p): p is number => p !== null);

    const unpaidFees = fees.filter(
      (f) => f.status === 'UNPAID' || f.status === 'PARTIAL',
    );

    return {
      ward: { id: ward.id, name: ward.name },
      grades: {
        averagePct:
          known.length > 0
            ? Math.round(
                (known.reduce((s, p) => s + p, 0) / known.length) * 100,
              ) / 100
            : null,
        latestGrade:
          confirmedScores[0] && confirmedScores[0].criteria
            ? {
                name: confirmedScores[0].criteria.description,
                percentage: PERCENT(
                  confirmedScores[0].pointsAwarded,
                  confirmedScores[0].criteria.maxPoints,
                ),
              }
            : null,
      },
      attendance: {
        records: totalAttendance,
        present: statusCount('PRESENT'),
        absent: statusCount('ABSENT'),
        late: statusCount('LATE'),
        excused: statusCount('EXCUSED'),
        rate:
          totalAttendance > 0
            ? Math.round(
                ((statusCount('PRESENT') + statusCount('LATE')) /
                  totalAttendance) *
                  10000,
              ) / 100
            : null,
      },
      quizzes: {
        completed,
        averageScorePct:
          quizPercents.length > 0
            ? Math.round(
                (quizPercents.reduce((s, p) => s + p, 0) /
                  quizPercents.length) *
                  100,
              ) / 100
            : null,
        attempts: quizAttempts.map((a) => {
          const totalPoints = a.quiz.questions.reduce(
            (s, q) => s + q.points,
            0,
          );
          return {
            id: a.id,
            quizId: a.quizId,
            quizTitle: a.quiz.title,
            totalScore: a.totalScore,
            totalPoints,
            percentage: PERCENT(a.totalScore, totalPoints),
            submittedAt: a.submittedAt?.toISOString() ?? null,
          };
        }),
      },
      fees: {
        unpaidCount: unpaidFees.length,
        unpaidTotal: unpaidFees.reduce((s, f) => {
          const due = Number(f.amount) - Number(f.amountPaid ?? 0);
          return s + (due > 0 ? due : 0);
        }, 0),
        items: fees.map((f) => ({
          id: f.id,
          feeType: f.feeType,
          amount: Number(f.amount),
          amountPaid: f.amountPaid == null ? null : Number(f.amountPaid),
          status: f.status,
          dueDate: f.dueDate?.toISOString() ?? null,
          academicYear: f.academicYear,
        })),
      },
      openAlerts: openAlerts.map((a) => ({
        id: a.id,
        type: a.type,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  async profile(guardian: User) {
    this.assertVerified(guardian);
    const row = await this.prisma.user.findUnique({
      where: { id: guardian.id },
      include: { guardianProfile: true },
    });
    const p = row?.guardianProfile;
    if (!p) {
      throw new ApiError(
        ErrorCode.GUARDIAN_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your guardian profile could not be found. Contact your school.',
      );
    }
    return {
      requiresCompletion: !p.profileComplete,
      profile: {
        personalEmail: p.personalEmail,
        phone: p.phone,
        street: p.street,
        city: p.city,
        nationality: p.nationality,
        ssnTail4: p.ssnTail4,
        dateOfBirth: p.dateOfBirth?.toISOString() ?? null,
        emergencyContactName: p.emergencyContactName,
        emergencyContactPhone: p.emergencyContactPhone,
        emergencyContactRelationship: p.emergencyContactRelationship,
        profileComplete: p.profileComplete,
      },
    };
  }

  async updateProfile(
    guardian: User,
    dto: {
      personalEmail?: string;
      phone?: string;
      street?: string;
      city?: string;
      nationality?: string;
      dateOfBirth?: string | null;
      ssn?: string;
      emergencyContactName?: string;
      emergencyContactPhone?: string;
      emergencyContactRelationship?: string;
    },
  ) {
    this.assertVerified(guardian);
    const existing = await this.prisma.guardianProfile.findUnique({
      where: { guardianId: guardian.id },
    });
    if (!existing) {
      throw new ApiError(
        ErrorCode.GUARDIAN_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your guardian profile could not be found. Contact your school.',
      );
    }

    const merged = {
      personalEmail:
        dto.personalEmail?.trim().toLowerCase() ?? existing.personalEmail,
      phone: dto.phone ?? existing.phone,
      street: dto.street ?? existing.street,
      city: dto.city ?? existing.city,
      nationality: dto.nationality ?? existing.nationality,
      ssnEncrypted: existing.ssnEncrypted,
      ssnTail4: existing.ssnTail4,
      dateOfBirth:
        dto.dateOfBirth !== undefined && dto.dateOfBirth !== null
          ? new Date(dto.dateOfBirth)
          : dto.dateOfBirth === null
            ? null
            : existing.dateOfBirth,
    };
    if (dto.ssn !== undefined) {
      merged.ssnEncrypted = encryptSsn(dto.ssn);
      merged.ssnTail4 = ssnTail4(dto.ssn);
    }
    // Mirrors the approval-time rule: SSN + phone + nationality + street +
    // city unlock the full guardian experience.
    const profileComplete = Boolean(
      merged.ssnEncrypted &&
      merged.phone &&
      merged.nationality &&
      merged.street &&
      merged.city,
    );

    await this.prisma.guardianProfile.update({
      where: { guardianId: guardian.id },
      data: {
        personalEmail: merged.personalEmail,
        phone: merged.phone,
        street: merged.street,
        city: merged.city,
        nationality: merged.nationality,
        ssnEncrypted: merged.ssnEncrypted,
        ssnTail4: merged.ssnTail4,
        dateOfBirth: merged.dateOfBirth,
        ...(dto.emergencyContactName !== undefined
          ? { emergencyContactName: dto.emergencyContactName }
          : {}),
        ...(dto.emergencyContactPhone !== undefined
          ? { emergencyContactPhone: dto.emergencyContactPhone }
          : {}),
        ...(dto.emergencyContactRelationship !== undefined
          ? { emergencyContactRelationship: dto.emergencyContactRelationship }
          : {}),
        profileComplete,
      },
    });

    return this.profile(guardian);
  }

  /** Guardian-scoped resend: re-delivers the reveal to the personal email. */
  async resendReveal(guardian: User) {
    if (!guardian.credentialEncrypted || !guardian.email) {
      throw new ApiError(
        ErrorCode.CREDENTIALS_ENCRYPTION_NOT_CONFIGURED,
        HttpStatus.BAD_REQUEST,
        'No stored credentials to resend. Contact your school.',
      );
    }
    this.assertVerified(guardian);
    const profile = await this.prisma.guardianProfile.findUnique({
      where: { guardianId: guardian.id },
      select: { personalEmail: true },
    });
    const to = profile?.personalEmail ?? null;
    if (!to) {
      throw new ApiError(
        ErrorCode.GUARDIAN_NOT_FOUND,
        HttpStatus.BAD_REQUEST,
        'No personal email on file to deliver the login to. Contact your school.',
      );
    }
    const organization = await this.prisma.organization.findUnique({
      where: { id: guardian.organizationId },
      select: { joinCode: true },
    });
    const password = decryptCredential(guardian.credentialEncrypted);
    await this.mailer.send({
      to,
      subject: 'Your EduAI login details',
      html: `<p>Hi ${guardian.name},</p><p>Here are your EduAI login details again:</p><p><b>Email:</b> ${guardian.email}<br/><b>Password:</b> ${password}</p><p>School code: <b>${organization?.joinCode ?? '—'}</b></p><p>If you didn't ask for this, you can ignore this email.</p>`,
    });
    return { message: 'Your login details have been sent to your email.' };
  }
}
