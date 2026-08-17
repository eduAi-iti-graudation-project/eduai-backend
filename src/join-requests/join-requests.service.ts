import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import { MailerService } from '../common/mailer/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EnrollSyncService } from '../roster/enroll-sync.service';
import {
  gmailLocal,
  schoolEmailCandidate,
  uniqueEmail,
  generatePassword,
} from '../common/mailer/generated-credentials';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';
import { encryptSsn, ssnTail4 } from '../common/crypto/ssn';
import {
  encryptCredential,
  decryptCredential,
} from '../common/crypto/credentials';
import type {
  JoinRequestSource,
  JoinRequestStatus,
} from './join-requests.types';

/** Invite links must be clicked within 72h; after that a resend is needed. */
const VERIFY_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

export interface RosterRowInput {
  email: string;
  firstName: string;
  lastName?: string;
  gradeId?: string;
  gradeLevelName?: string;
  sectionId?: string;
  sectionName?: string;
  guardianName?: string;
  guardianEmail?: string;
  guardianSsnEncrypted?: string;
  guardianSsnTail4?: string;
  guardianPhone?: string;
  guardianNationality?: string;
}

@Injectable()
export class JoinRequestsService {
  private readonly logger = new Logger(JoinRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly mailer: MailerService,
    private readonly enrollSync: EnrollSyncService,
    private readonly notifications: NotificationsService,
  ) {}

  private issueVerifyToken(): { token: string; expiresAt: Date } {
    return {
      token: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    };
  }

  private verifyLink(token: string): string {
    const base = process.env.FRONTEND_URL ?? process.env.API_URL ?? '';
    return `${base}/verify?token=${encodeURIComponent(token)}`;
  }

  /**
   * Invite email for a provisioned login (delivered to the real inbox only).
   * - mode 'set': account was provisioned without a password — the link opens
   *   the "set your password" page where the user creates their own.
   * - mode 'confirm': the user already chose their password at signup — the
   *   link just reveals their school email.
   */
  private async sendVerifyInvite(input: {
    to: string;
    name: string;
    token: string;
    relationship: string;
    mode: 'set' | 'confirm';
  }) {
    const isSet = input.mode === 'set';
    await this.mailer.send({
      to: input.to,
      subject: isSet
        ? 'Your EduAI account is ready — set your password'
        : 'Your EduAI school email is ready — confirm it',
      html: isSet
        ? `<p>Hi ${input.name},</p><p>Your school added you to their EduAI workspace as ${input.relationship}. To finish setting up your account, open this link (valid for 72 hours) and choose a password:</p><p><a href="${this.verifyLink(input.token)}">Set my password</a></p><p>If the link does not work, copy this into your browser:<br/>${this.verifyLink(input.token)}</p>`
        : `<p>Hi ${input.name},</p><p>Your school email is ready. Open this link (valid for 72 hours) to confirm it and see your login details:</p><p><a href="${this.verifyLink(input.token)}">Confirm my school email</a></p><p>If the link does not work, copy this into your browser:<br/>${this.verifyLink(input.token)}</p>`,
    });
  }

  private async schoolByJoinCode(code: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { joinCode: code.trim().toUpperCase() },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.SCHOOL_CODE_INVALID,
        HttpStatus.NOT_FOUND,
        'This school code is not valid. Please check it with your school administrator.',
      );
    }
    return organization;
  }

  /**
   * Admin reset path: issue a fresh verify token and email a set-password
   * invite to the user's real inbox (guardian personal email, or the
   * join-request email for students). No credential is generated or stored.
   */
  async sendSetPasswordInvite(
    userId: string,
    organizationId: string,
  ): Promise<{ email: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
    });
    if (!user) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student could not be found.',
      );
    }
    if (!user.authId) {
      throw new ApiError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        HttpStatus.BAD_REQUEST,
        'This student has no auth identity to reset.',
      );
    }

    let inbox: string | null = null;
    if (user.role === 'GUARDIAN') {
      const guardianProfile = await this.prisma.guardianProfile.findFirst({
        where: { guardianId: user.id },
        select: { personalEmail: true },
      });
      inbox = guardianProfile?.personalEmail ?? null;
    } else {
      const requests = await this.prisma.joinRequest.findMany({
        where: { userId: user.id },
        select: { email: true, status: true },
      });
      const approved = requests.find((r) => r.status === 'APPROVED');
      inbox = (approved ?? requests[0])?.email ?? null;
    }
    if (!inbox) {
      throw new ApiError(
        ErrorCode.AUTH_USER_NOT_FOUND,
        HttpStatus.BAD_REQUEST,
        'No deliverable inbox is on file for this account.',
      );
    }

    const issued = this.issueVerifyToken();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verifyToken: issued.token,
        verifyTokenExpiresAt: issued.expiresAt,
      },
    });
    await this.sendVerifyInvite({
      to: inbox,
      name: user.name,
      token: issued.token,
      relationship: user.role === 'GUARDIAN' ? 'a parent' : 'a student',
      mode: 'set',
    });
    return { email: user.email };
  }

  /** Public: resolve a school by its code for the self-registration screen. */
  async schoolByCode(code: string) {
    const organization = await this.schoolByJoinCode(code);
    const gradeLevels = await this.prisma.gradeLevel.findMany({
      where: { organizationId: organization.id },
      select: { id: true, level: true, name: true },
      orderBy: { level: 'asc' },
    });
    return {
      id: organization.id,
      name: organization.name,
      gradeLevels,
    };
  }

  /**
   * Self-registration (student without a roster row yet, or whose row had no
   * email). A roster row matched by email auto-fills the grade; the student
   * still supplies first/last name and their own credentials.
   */
  async applyAsStudent(dto: {
    schoolCode: string;
    firstName: string;
    lastName?: string;
    email: string;
    password: string;
    guardianName?: string;
    guardianEmail?: string;
    guardianSsn?: string;
    guardianPhone?: string;
    guardianNationality?: string;
  }) {
    const organization = await this.schoolByJoinCode(dto.schoolCode);
    const email = dto.email.toLowerCase();

    const existingMember = await this.prisma.user.findFirst({
      where: { email, organizationId: organization.id },
    });
    if (existingMember) {
      throw new ApiError(
        ErrorCode.EMAIL_IN_USE,
        HttpStatus.CONFLICT,
        'An account with this email already belongs to this school.',
      );
    }

    const existingRequest = await this.prisma.joinRequest.findFirst({
      where: { email, organizationId: organization.id, status: 'PENDING' },
    });
    if (existingRequest) {
      throw new ApiError(
        ErrorCode.ALREADY_APPLIED,
        HttpStatus.CONFLICT,
        'A request for this email is already awaiting review.',
      );
    }

    // Grade autofill from a staged roster row that could not apply itself
    // (e.g. it had an email-less CSV row and the student must self-apply).
    const rosterMatch = await this.prisma.joinRequest.findFirst({
      where: {
        email,
        organizationId: organization.id,
        source: 'ROSTER',
        status: { in: ['PENDING', 'APPROVED', 'REJECTED'] },
      },
      select: { gradeId: true, gradeLevelName: true, source: true },
    });
    const matchedFromRoster = rosterMatch?.source === 'ROSTER';

    // The student owns these credentials — create the auth identity now so
    // they can sign in the moment an admin approves the request.
    const authId = await this.createStudentAuthIdentity(email, dto.password);

    const request = await this.prisma.joinRequest.create({
      data: {
        organizationId: organization.id,
        source: 'SELF',
        kind: 'STUDENT',
        email,
        name: [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim(),
        authId,
        chosenPasswordEncrypted: encryptCredential(dto.password),
        gradeId: rosterMatch?.gradeId ?? null,
        gradeLevelName: rosterMatch
          ? (rosterMatch.gradeLevelName ?? null)
          : null,
        guardianName: dto.guardianName ?? null,
        guardianEmail: dto.guardianEmail?.toLowerCase() ?? null,
        guardianSsnEncrypted: dto.guardianSsn
          ? encryptSsn(dto.guardianSsn)
          : null,
        guardianSsnTail4: dto.guardianSsn ? ssnTail4(dto.guardianSsn) : null,
        guardianPhone: dto.guardianPhone ?? null,
        guardianNationality: dto.guardianNationality ?? null,
      },
    });

    return {
      requestId: request.id,
      matchedFromRoster,
      gradeLevelName: rosterMatch ? (rosterMatch.gradeLevelName ?? null) : null,
      status: 'PENDING' as const,
    };
  }

  /**
   * Self-registration for parents NOT in the CSV: sign up with the school
   * code + the child's school email. The request sits PENDING until an admin
   * approves the link (creator of the guardian account + link to the child).
   */
  async applyAsGuardian(dto: {
    schoolCode: string;
    name: string;
    personalEmail: string;
    password: string;
    childSchoolEmail: string;
    phone?: string;
    nationality?: string;
  }) {
    const organization = await this.schoolByJoinCode(dto.schoolCode);
    const email = dto.personalEmail.toLowerCase();
    const childEmail = dto.childSchoolEmail.trim().toLowerCase();

    const existingGuardian = await this.prisma.guardianProfile.findFirst({
      where: {
        personalEmail: email,
        guardian: { organizationId: organization.id },
      },
      select: { guardianId: true },
    });
    if (existingGuardian) {
      throw new ApiError(
        ErrorCode.EMAIL_IN_USE,
        HttpStatus.CONFLICT,
        'An account with this email already belongs to this school.',
      );
    }

    const existingRequest = await this.prisma.joinRequest.findFirst({
      where: {
        email,
        organizationId: organization.id,
        status: 'PENDING',
        kind: 'GUARDIAN',
      },
    });
    if (existingRequest) {
      throw new ApiError(
        ErrorCode.ALREADY_APPLIED,
        HttpStatus.CONFLICT,
        'A request for this email is already awaiting review.',
      );
    }

    // The child must be a provisioned student or an already-staged roster
    // row for this school — otherwise the approval can never link them.
    const childKnown = await this.prisma.user.findFirst({
      where: {
        email: childEmail,
        organizationId: organization.id,
        role: 'STUDENT',
      },
      select: { id: true },
    });
    const childPending = childKnown
      ? null
      : await this.prisma.joinRequest.findFirst({
          where: {
            email: childEmail,
            organizationId: organization.id,
            source: 'ROSTER',
            status: { in: ['PENDING', 'REJECTED'] },
          },
          select: { id: true },
        });
    if (!childKnown && !childPending) {
      throw new ApiError(
        ErrorCode.STUDENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        "We couldn't find a student with this school email at this school.",
      );
    }

    const request = await this.prisma.joinRequest.create({
      data: {
        organizationId: organization.id,
        source: 'SELF',
        kind: 'GUARDIAN',
        email,
        name: dto.name,
        chosenPasswordEncrypted: encryptCredential(dto.password),
        targetStudentEmail: childEmail,
        guardianEmail: email,
        guardianPhone: dto.phone ?? null,
        guardianNationality: dto.nationality ?? null,
      },
    });

    return {
      requestId: request.id,
      status: 'PENDING' as const,
    };
  }

  /** Import path: stage ready-to-review rows (email present, member-checked). */
  async stageRoster(
    organizationId: string,
    rows: Array<RosterRowInput & { row: number }>,
    options?: { autoApprove?: boolean; decidedBy?: string },
  ): Promise<{
    staged: number;
    queued: number;
    notStaged: { row: number; reason: string }[];
  }> {
    const result: {
      staged: number;
      queued: number;
      notStaged: { row: number; reason: string }[];
    } = { staged: 0, queued: 0, notStaged: [] };
    if (rows.length === 0) return result;

    const existingEmails = new Set(
      (
        await this.prisma.user.findMany({
          where: { organizationId },
          select: { email: true },
        })
      ).map((u) => u.email.toLowerCase()),
    );
    const pendingByEmail = new Map(
      (
        await this.prisma.joinRequest.findMany({
          where: { organizationId, status: 'PENDING' },
          select: { email: true },
        })
      ).map((r) => [r.email.toLowerCase(), true] as const),
    );

    const seen = new Set<string>();
    const batch: Array<RosterRowInput & { email: string; row: number }> = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = row.row;
      const email = row.email.toLowerCase();
      if (seen.has(email)) {
        result.notStaged.push({
          row: rowNumber,
          reason: 'duplicate row in file',
        });
        continue;
      }
      seen.add(email);
      if (existingEmails.has(email)) {
        result.notStaged.push({
          row: rowNumber,
          reason: 'already a member of this school',
        });
        continue;
      }
      if (pendingByEmail.has(email)) {
        result.notStaged.push({
          row: rowNumber,
          reason: 'already pending review',
        });
        continue;
      }
      batch.push({ ...row, email });
    }

    if (batch.length > 0) {
      await this.prisma.joinRequest.createMany({
        data: batch.map((row) => ({
          organizationId,
          source: 'ROSTER',
          email: row.email,
          name: [row.firstName, row.lastName].filter(Boolean).join(' ').trim(),
          gradeId: row.gradeId ?? null,
          gradeLevelName: row.gradeLevelName ?? null,
          sectionId: row.sectionId ?? null,
          sectionName: row.sectionName ?? null,
          guardianName: row.guardianName ?? null,
          guardianEmail: row.guardianEmail ?? null,
          guardianSsnEncrypted: row.guardianSsnEncrypted ?? null,
          guardianSsnTail4: row.guardianSsnTail4 ?? null,
          guardianPhone: row.guardianPhone ?? null,
          guardianNationality: row.guardianNationality ?? null,
        })),
      });
      result.staged = batch.length;

      // WP2 auto-approval: bypass the admin click for complete rows. The
      // created requests are approved immediately (student + guardian +
      // verify invite). Failures keep PENDING so the admin can act on them
      // from the review queue — reported via `queued`.
      if (options?.autoApprove && options.decidedBy) {
        const created = await this.prisma.joinRequest.findMany({
          where: {
            organizationId,
            source: 'ROSTER',
            status: 'PENDING',
            email: { in: batch.map((row) => row.email) },
          },
          select: { id: true, email: true },
        });
        const rowByEmail = new Map(
          batch.map((row) => [row.email, row.row] as const),
        );
        if (created.length > 0) {
          const outcome = await this.approve(
            organizationId,
            created.map((r) => r.id),
            options.decidedBy,
          );
          result.staged = outcome.approved.length;
          result.queued = outcome.failed.length;
          for (const failed of outcome.failed) {
            const row = failed.email
              ? (rowByEmail.get(failed.email.toLowerCase()) ?? null)
              : null;
            result.notStaged.push({
              row: row ?? 0,
              reason: `Auto-approval failed (queued for review): ${failed.reason}`,
            });
          }
        }
      }
    }
    return result;
  }

  /**
   * Admin path for guardian-less students (WP2 split-import follow-up):
   * provision a guardian from a real email + name, then link them to the
   * student. Dedupes by the personal email within the organization (siblings
   * share one guardian account, same as roster approval).
   */
  async provisionGuardian(input: {
    organizationId: string;
    studentId: string;
    name: string;
    personalEmail: string;
    decidedBy: string;
    phone?: string | null;
    nationality?: string | null;
    ssn?: string | null;
  }): Promise<{
    id: string;
    email: string;
    name: string;
    created: boolean;
    studentId: string;
  }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { emailDomain: true },
    });
    const personal = input.personalEmail.trim().toLowerCase();

    const existing = await this.prisma.guardianProfile.findFirst({
      where: {
        personalEmail: personal,
        guardian: { organizationId: input.organizationId },
      },
      select: { guardianId: true },
    });
    if (existing) {
      await this.prisma.user.update({
        where: { id: input.studentId },
        data: { guardianId: existing.guardianId },
      });
      return {
        id: existing.guardianId,
        email: personal,
        name: input.name,
        created: false,
        studentId: input.studentId,
      };
    }

    const usedGmails = new Set(
      (
        await this.prisma.user.findMany({
          where: { organizationId: input.organizationId, role: 'GUARDIAN' },
          select: { email: true },
        })
      ).map((u) => u.email.toLowerCase().split('@')[0]),
    );
    const gLocal = uniqueEmail(usedGmails, gmailLocal(input.name));
    if (!gLocal) {
      throw new ApiError(
        ErrorCode.AUTH_SIGNUP_FAILED,
        HttpStatus.BAD_REQUEST,
        'Could not allocate a unique guardian login email.',
      );
    }
    const gEmail = schoolEmailCandidate(
      gLocal,
      organization?.emailDomain ?? null,
    );
    const gPassword = generatePassword(10);
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.createUser({
        email: gEmail,
        password: gPassword,
        email_confirm: true,
      });
    if (error || !data.user) {
      throw new ApiError(
        ErrorCode.AUTH_SIGNUP_FAILED,
        HttpStatus.BAD_REQUEST,
        'Guardian auth account creation failed — please try again.',
        { hint: ErrorHint.RETRY, cause: error },
      );
    }
    const issued = this.issueVerifyToken();
    const guardian = await this.prisma.user.create({
      data: {
        authId: data.user.id,
        email: gEmail,
        name: input.name,
        role: 'GUARDIAN',
        organizationId: input.organizationId,
        verifyToken: issued.token,
        verifyTokenExpiresAt: issued.expiresAt,
      },
    });
    await this.prisma.guardianProfile.create({
      data: {
        guardianId: guardian.id,
        personalEmail: personal,
        ...(input.ssn
          ? {
              ssnEncrypted: encryptSsn(input.ssn),
              ssnTail4: ssnTail4(input.ssn),
            }
          : {}),
        phone: input.phone ?? null,
        nationality: input.nationality ?? null,
        profileComplete: Boolean(input.ssn && input.phone && input.nationality),
      },
    });
    await this.prisma.user.update({
      where: { id: input.studentId },
      data: { guardianId: guardian.id },
    });
    await this.sendVerifyInvite({
      to: personal,
      name: input.name,
      token: issued.token,
      relationship: 'a parent',
      mode: 'set',
    });
    return {
      id: guardian.id,
      email: gEmail,
      name: input.name,
      created: true,
      studentId: input.studentId,
    };
  }

  private async createStudentAuthIdentity(
    email: string,
    password: string,
  ): Promise<string> {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    if (data?.user?.id) return data.user.id;

    if (error?.message?.toLowerCase().includes('already registered')) {
      // A prior supabase account exists with this email — only usable if the
      // password matches it (e.g. student filled in for a roster member).
      const { data: signIn } = await this.supabaseService
        .getClient()
        .auth.signInWithPassword({ email, password });
      if (signIn?.user?.id) return signIn.user.id;
    }

    throw new ApiError(
      ErrorCode.AUTH_SIGNUP_FAILED,
      HttpStatus.BAD_REQUEST,
      'We could not create your account. Please try again.',
      { hint: ErrorHint.RETRY, cause: error },
    );
  }

  private async assertSeatAvailable(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.seatLimit === null) return;
    const memberCount = await this.prisma.user.count({
      where: { organizationId, role: { not: 'ADMIN' } },
    });
    if (memberCount >= organization.seatLimit) {
      throw new ApiError(
        ErrorCode.INVITE_SEATS_FULL,
        HttpStatus.PAYMENT_REQUIRED,
        'Your organization has reached its seat limit. Upgrade to add more students.',
        { hint: ErrorHint.UPGRADE },
      );
    }
  }

  async list(
    organizationId: string,
    query: { status?: JoinRequestStatus; source?: JoinRequestSource },
  ) {
    const [pending, approved, rejected] = await Promise.all([
      this.prisma.joinRequest.count({
        where: { organizationId, status: 'PENDING' },
      }),
      this.prisma.joinRequest.count({
        where: { organizationId, status: 'APPROVED' },
      }),
      this.prisma.joinRequest.count({
        where: { organizationId, status: 'REJECTED' },
      }),
    ]);

    const items = await this.prisma.joinRequest.findMany({
      where: {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.source ? { source: query.source } : {}),
      },
      orderBy: { appliedAt: 'desc' },
      select: {
        id: true,
        source: true,
        kind: true,
        status: true,
        email: true,
        name: true,
        gradeId: true,
        gradeLevelName: true,
        sectionId: true,
        sectionName: true,
        targetStudentEmail: true,
        guardianName: true,
        guardianEmail: true,
        guardianPhone: true,
        guardianNationality: true,
        appliedAt: true,
        decidedAt: true,
      },
    });

    return { items, counts: { pending, approved, rejected } };
  }

  /**
   * Bulk approval. ROSTER rows get a generated gmail.mailbox + password
   * (emailed with the credentials); SELF rows keep their own email and are
   * only emailed a confirmation. Any irrecoverable row keeps PENDING status
   * and is reported back so the admin can act on it.
   */
  async approve(
    organizationId: string,
    ids: string[],
    decidedBy: string,
  ): Promise<{
    approved: Array<{
      id: string;
      email: string;
      name: string;
      kind: string;
      generatedPassword?: boolean;
      guardian?: { email: string; name: string; created: boolean };
    }>;
    failed: Array<{ id: string; email: string; reason: string }>;
  }> {
    await this.assertSeatAvailable(organizationId);

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { joinCode: true, emailDomain: true },
    });

    const requests = await this.prisma.joinRequest.findMany({
      where: { id: { in: ids }, organizationId, status: 'PENDING' },
    });
    if (requests.length === 0) {
      throw new ApiError(
        ErrorCode.JOIN_REQUEST_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'No pending join requests matched those ids.',
      );
    }

    const existingEmails = new Map(
      (
        await this.prisma.user.findMany({
          select: { id: true, email: true },
        })
      ).map((u) => [u.email.toLowerCase(), u.id]),
    );
    const usedGmails = new Set(
      (
        await this.prisma.joinRequest.findMany({
          where: { source: 'ROSTER', status: 'APPROVED' },
          select: { email: true },
        })
      ).map((r) => r.email.toLowerCase().split('@')[0]),
    );

    const approved: Array<{
      id: string;
      email: string;
      name: string;
      kind: string;
      generatedPassword?: boolean;
      guardian?: { email: string; name: string; created: boolean };
    }> = [];
    const failed: Array<{ id: string; email: string; reason: string }> = [];
    for (const request of requests) {
      try {
        const outcome = await this.approveOne({
          request,
          existingEmails,
          usedGmails,
          organizationId,
          organizationJoinCode: organization?.joinCode ?? '—',
          emailDomain: organization?.emailDomain ?? null,
          decidedBy,
        });
        approved.push(outcome);
      } catch (err) {
        failed.push({
          id: request.id,
          email: request.email,
          reason: err instanceof Error ? err.message : 'Unexpected failure',
        });
      }
    }

    return { approved, failed };
  }

  private async approveOne(input: {
    request: {
      id: string;
      source: string;
      kind: string;
      email: string;
      name: string;
      authId: string | null;
      gradeId: string | null;
      gradeLevelName: string | null;
      sectionId: string | null;
      sectionName: string | null;
      targetStudentEmail: string | null;
      chosenPasswordEncrypted: string | null;
      guardianName: string | null;
      guardianEmail: string | null;
      guardianSsnEncrypted: string | null;
      guardianSsnTail4: string | null;
      guardianPhone: string | null;
      guardianNationality: string | null;
      guardianStreet: string | null;
      guardianCity: string | null;
      guardianDateOfBirth: Date | null;
    };
    existingEmails: Map<string, string>;
    usedGmails: Set<string>;
    organizationId: string;
    organizationJoinCode: string;
    emailDomain?: string | null;
    decidedBy: string;
  }): Promise<{
    id: string;
    email: string;
    name: string;
    kind: string;
    generatedPassword?: boolean;
    guardian?: { email: string; name: string; created: boolean };
  }> {
    const { request } = input;
    const email = request.email.toLowerCase();

    // Parent self-join: provision the guardian account and link it to the
    // child — no student row is created here.
    if (request.kind === 'GUARDIAN') {
      return this.approveGuardian(input);
    }

    let emailToUse = email;
    let authId = request.authId ?? null;
    let generatedPassword = false;
    // School-provisioned rows still generate a placeholder password for the
    // auth account; the verify link then lets the user set their own. SELF
    // rows own their credentials.
    let verifyToken: string | null = null;
    let verifyTokenExpiresAt: Date | null = null;
    const emailVerifiedAt: Date | null = null;

    // Supabase auth accounts created during this approval that do not yet have
    // a matching local user row. If provisioning fails part-way (DB down,
    // guardian step, invite SMTP), these are rolled back so a retry doesn't
    // trip on "already registered".
    const pendingAuthCreations: string[] = [];
    const rollbackPendingAuth = async (): Promise<void> => {
      for (const id of pendingAuthCreations.splice(0)) {
        await this.deleteAuthAccount(id);
      }
    };
    const commitAuth = (id: string): void => {
      const index = pendingAuthCreations.indexOf(id);
      if (index >= 0) pendingAuthCreations.splice(index, 1);
    };

    if (request.source === 'ROSTER') {
      if (input.existingEmails.has(email)) {
        throw new Error(
          'Email already exists — add the student to the school instead.',
        );
      }
      const base = gmailLocal(request.name);
      const local = uniqueEmail(input.usedGmails, base);
      if (!local) {
        throw new Error('Could not allocate a unique email address.');
      }
      emailToUse = schoolEmailCandidate(local, input.emailDomain);
      const schoolEmailTaken = await this.prisma.user.findFirst({
        where: { email: emailToUse },
        select: { id: true },
      });
      if (schoolEmailTaken) {
        throw new Error(
          `School account ${emailToUse} already exists in the directory.`,
        );
      }
      const password = generatePassword(10);
      const account = await this.upsertAuthAccount({
        email: emailToUse,
        password,
        name: request.name,
      });
      authId = account.id;
      if (account.created) {
        pendingAuthCreations.push(account.id);
      }
      input.usedGmails.add(local);
      const issued = this.issueVerifyToken();
      verifyToken = issued.token;
      verifyTokenExpiresAt = issued.expiresAt;
      // The CSV EMAIL is the real mailbox — the school identity is not a
      // deliverable address, so the invite (and only the invite) goes there.
      try {
        await this.sendVerifyInvite({
          to: email,
          name: request.name,
          token: issued.token,
          relationship: 'a student',
          mode: 'set',
        });
      } catch (err) {
        await rollbackPendingAuth();
        throw err;
      }
      generatedPassword = true;
    } else {
      // SELF — the student chose their password at signup; approval moves
      // their identity onto a school email that REUSES that password (per
      // product decision: "keep the password, give them a school email").
      // The real email stays a comms channel — the verify invite reveals the
      // school login once.
      if (input.existingEmails.has(email)) {
        throw new Error('Email account already exists.');
      }
      if (!authId) {
        throw new Error('This request has no auth identity.');
      }
      const taken = this.takenLocals(input);
      const base = gmailLocal(request.name);
      const local = uniqueEmail(taken, base);
      if (!local) {
        throw new Error('Could not allocate a unique email address.');
      }
      emailToUse = schoolEmailCandidate(local, input.emailDomain);
      const chosen = request.chosenPasswordEncrypted
        ? decryptCredential(request.chosenPasswordEncrypted)
        : null;
      const password = chosen ?? generatePassword(10);
      const { error } = await this.supabaseService
        .getClient()
        .auth.admin.updateUserById(authId, {
          email: emailToUse,
          email_confirm: true,
          ...(chosen ? {} : { password }),
        });
      if (error) {
        throw new Error(
          `Auth account update failed for ${emailToUse}: ${error.message}`,
        );
      }
      input.usedGmails.add(local);
      const issued = this.issueVerifyToken();
      verifyToken = issued.token;
      verifyTokenExpiresAt = issued.expiresAt;
      await this.sendVerifyInvite({
        to: email,
        name: request.name,
        token: issued.token,
        relationship: 'a student',
        mode: chosen ? 'confirm' : 'set',
      });
    }

    // Guardian provisioning — data supplied (roster columns or self-join form).
    // Dedupe by the guardian's personal email within the organization: a second
    // student sharing the same parent links to the existing guardian instead
    // of creating a duplicate account.
    let guardianUserId: string | null = null;
    let guardianLink:
      { email: string; name: string; created: boolean } | undefined;
    const hasGuardian = Boolean(request.guardianName && request.guardianEmail);

    if (hasGuardian) {
      const personal = request.guardianEmail!.toLowerCase();
      const existingGuardian = await this.prisma.guardianProfile.findFirst({
        where: {
          personalEmail: personal,
          guardian: { organizationId: input.organizationId },
        },
        select: { guardianId: true },
      });
      if (existingGuardian) {
        guardianUserId = existingGuardian.guardianId;
        guardianLink = {
          email: personal,
          name: request.guardianName!,
          created: false,
        };
      } else {
        const gBase = gmailLocal(request.guardianName!);
        const gLocal = uniqueEmail(input.usedGmails, gBase);
        if (!gLocal) {
          throw new Error(
            'Could not allocate a unique guardian email address.',
          );
        }
        const gEmail = schoolEmailCandidate(gLocal, input.emailDomain);
        const gPassword = generatePassword(10);
        const gAccount = await this.upsertAuthAccount({
          email: gEmail,
          password: gPassword,
          name: request.guardianName!,
        });
        input.usedGmails.add(gLocal);
        if (gAccount.created) {
          pendingAuthCreations.push(gAccount.id);
        }
        const gVerify = this.issueVerifyToken();
        let gUser: { id: string };
        try {
          gUser = await this.prisma.user.create({
            data: {
              authId: gAccount.id,
              email: gEmail,
              name: request.guardianName!,
              role: 'GUARDIAN',
              organizationId: input.organizationId,
              verifyToken: gVerify.token,
              verifyTokenExpiresAt: gVerify.expiresAt,
            },
          });
          await this.prisma.guardianProfile.create({
            data: {
              guardianId: gUser.id,
              personalEmail: personal,
              ssnEncrypted: request.guardianSsnEncrypted,
              ssnTail4: request.guardianSsnTail4,
              phone: request.guardianPhone,
              street: request.guardianStreet,
              city: request.guardianCity,
              nationality: request.guardianNationality,
              dateOfBirth: request.guardianDateOfBirth,
              profileComplete: Boolean(
                request.guardianSsnEncrypted &&
                request.guardianPhone &&
                request.guardianNationality,
              ),
            },
          });
          // Guardian row committed — keep this auth account if later steps
          // fail; only still-pending accounts are rolled back.
          commitAuth(gAccount.id);
        } catch (err) {
          await rollbackPendingAuth();
          throw err;
        }
        guardianUserId = gUser.id;
        guardianLink = {
          email: gEmail,
          name: request.guardianName!,
          created: true,
        };
        try {
          await this.sendVerifyInvite({
            to: personal,
            name: request.guardianName!,
            token: gVerify.token,
            relationship: 'a parent',
            mode: 'set',
          });
        } catch (err) {
          await rollbackPendingAuth();
          throw err;
        }
      }
    }

    let provisionedUserId: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            authId,
            email: emailToUse,
            name: request.name,
            role: 'STUDENT',
            organizationId: input.organizationId,
            ...(request.gradeId ? { gradeId: request.gradeId } : {}),
            ...(guardianUserId ? { guardianId: guardianUserId } : {}),
            verifyToken,
            verifyTokenExpiresAt,
            emailVerifiedAt,
          },
        });
        provisionedUserId = user.id;
        if (request.gradeId) {
          await this.enrollSync.syncStudentToGrade(
            user.id,
            input.organizationId,
            request.gradeId,
            request.sectionId ?? undefined,
            tx,
          );
        }
        await tx.joinRequest.update({
          where: { id: request.id },
          data: {
            status: 'APPROVED',
            decidedById: input.decidedBy,
            decidedAt: new Date(),
            userId: user.id,
          },
        });
      });
    } catch (err) {
      await rollbackPendingAuth();
      throw err;
    }
    // Student row committed — no pending auth accounts remain.
    pendingAuthCreations.length = 0;

    // Always alert: the student is told the moment a guardian is missing, and
    // org admins get a work item so no guardian-less student goes unnoticed.
    if (!guardianUserId && provisionedUserId) {
      await this.notifications.notifyUser(
        provisionedUserId,
        'GUARDIAN_REQUIRED',
        'Link a parent to your account',
        'Ask your school to link a parent, or share your school code so they can sign up. Some features stay locked until then.',
      );
      const admins = await this.prisma.user.findMany({
        where: { organizationId: input.organizationId, role: 'ADMIN' },
        select: { id: true },
      });
      await Promise.all(
        admins.map((admin) =>
          this.notifications.notifyUser(
            admin.id,
            'STUDENT_WITHOUT_GUARDIAN',
            `${request.name} has no linked guardian`,
            'This student was provisioned without a parent account. Attach a guardian to unlock their full experience.',
          ),
        ),
      );
    }

    return {
      id: request.id,
      email: emailToUse,
      name: request.name,
      kind: 'STUDENT',
      generatedPassword,
      guardian: guardianLink,
    };
  }

  /**
   * Idempotent Supabase provisioning. Tries to create the school auth account
   * for `email`; if it already exists (left over from a previous partial run,
   * or the user already has a school login), it is adopted and given a fresh
   * password instead of erroring. Returns the auth user id plus whether this
   * call created the account, so callers can roll it back on a later failure.
   */
  private async upsertAuthAccount(params: {
    email: string;
    password: string;
    name: string;
  }): Promise<{ id: string; created: boolean }> {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.createUser({
        email: params.email,
        password: params.password,
        email_confirm: true,
      });
    if (!error && data.user) {
      return { id: data.user.id, created: true };
    }
    const message = error?.message ?? '';
    if (
      error &&
      /already registered|already exists|already been registered/i.test(message)
    ) {
      const existing = await this.supabaseService.findAuthUserByEmail(
        params.email,
      );
      if (existing) {
        const { error: updateError } = await this.supabaseService
          .getClient()
          .auth.admin.updateUserById(existing.id, {
            password: params.password,
            email_confirm: true,
          });
        if (updateError) {
          throw new Error(
            `Auth account update failed for ${params.email}: ${updateError.message}`,
          );
        }
        return { id: existing.id, created: false };
      }
    }
    throw new Error(
      `Auth account creation failed for ${params.email}: ${message || 'unknown error'}`,
    );
  }

  /**
   * Deletes a Supabase auth account. Best-effort: used during rollback of a
   * partially-provisioned approval, so failures are logged, not thrown.
   */
  private async deleteAuthAccount(authId: string): Promise<void> {
    try {
      const { error } = await this.supabaseService
        .getClient()
        .auth.admin.deleteUser(authId);
      if (error) {
        this.logger.warn(
          `[join-requests] failed to roll back auth account ${authId}: ${error.message}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[join-requests] failed to roll back auth account ${authId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * GUARDIAN-kind approval: provision the parent's school login (password
   * kept if chosen at self-signup, else generated), email the verify invite
   * to their real inbox, and link them to the child resolved by school email.
   */
  private async approveGuardian(input: {
    request: {
      id: string;
      email: string;
      name: string;
      targetStudentEmail: string | null;
      chosenPasswordEncrypted: string | null;
      guardianPhone: string | null;
      guardianNationality: string | null;
    };
    existingEmails: Map<string, string>;
    usedGmails: Set<string>;
    organizationId: string;
    emailDomain?: string | null;
    decidedBy: string;
  }): Promise<{
    id: string;
    email: string;
    name: string;
    kind: string;
    generatedPassword?: boolean;
    guardian?: { email: string; name: string; created: boolean };
  }> {
    const { request } = input;
    const personal = request.email.toLowerCase();
    const childEmail = request.targetStudentEmail?.trim().toLowerCase() ?? '';

    const student = await this.prisma.user.findFirst({
      where: {
        email: childEmail,
        organizationId: input.organizationId,
        role: 'STUDENT',
      },
      select: { id: true, guardianId: true, name: true },
    });
    if (!student) {
      throw new Error(
        'No student with this school email — the child may not be provisioned yet.',
      );
    }
    if (student.guardianId) {
      throw new Error(`${student.name} already has a linked parent.`);
    }

    const taken = this.takenLocals(input);
    const base = gmailLocal(request.name);
    const local = uniqueEmail(taken, base);
    if (!local) {
      throw new Error('Could not allocate a unique guardian email address.');
    }
    const emailToUse = schoolEmailCandidate(local, input.emailDomain);
    const chosen = request.chosenPasswordEncrypted
      ? decryptCredential(request.chosenPasswordEncrypted)
      : null;
    const password = chosen ?? generatePassword(10);

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.createUser({
        email: emailToUse,
        password,
        email_confirm: true,
      });
    if (error || !data.user) {
      throw new Error(
        'Guardian auth account creation failed — please try again.',
      );
    }
    input.usedGmails.add(local);
    const issued = this.issueVerifyToken();

    const guardian = await this.prisma.user.create({
      data: {
        authId: data.user.id,
        email: emailToUse,
        name: request.name,
        role: 'GUARDIAN',
        organizationId: input.organizationId,
        verifyToken: issued.token,
        verifyTokenExpiresAt: issued.expiresAt,
      },
    });
    await this.prisma.guardianProfile.create({
      data: {
        guardianId: guardian.id,
        personalEmail: personal,
        phone: request.guardianPhone,
        nationality: request.guardianNationality,
        profileComplete: false,
      },
    });
    await this.prisma.user.update({
      where: { id: student.id },
      data: { guardianId: guardian.id },
    });
    await this.sendVerifyInvite({
      to: personal,
      name: request.name,
      token: issued.token,
      relationship: 'a parent',
      mode: chosen ? 'confirm' : 'set',
    });
    await this.prisma.joinRequest.update({
      where: { id: request.id },
      data: {
        status: 'APPROVED',
        decidedById: input.decidedBy,
        decidedAt: new Date(),
        userId: guardian.id,
      },
    });

    return {
      id: request.id,
      email: emailToUse,
      name: request.name,
      kind: 'GUARDIAN',
      generatedPassword: !chosen,
    };
  }

  private takenLocals(input: {
    existingEmails: Map<string, string>;
    usedGmails: Set<string>;
  }): Set<string> {
    const locals = new Set<string>(input.usedGmails);
    for (const email of input.existingEmails.keys()) {
      const local = email.toLowerCase().split('@')[0];
      if (local) locals.add(local);
    }
    return locals;
  }

  async reject(organizationId: string, ids: string[], decidedBy: string) {
    const requests = await this.prisma.joinRequest.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, status: true },
    });
    if (requests.length === 0) {
      throw new ApiError(
        ErrorCode.JOIN_REQUEST_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'No join requests matched those ids.',
      );
    }
    const nonPending = requests.filter((r) => r.status !== 'PENDING');
    if (nonPending.length > 0) {
      throw new ApiError(
        ErrorCode.JOIN_REQUEST_NOT_PENDING,
        HttpStatus.CONFLICT,
        'Only pending requests can be rejected.',
      );
    }
    await this.prisma.joinRequest.updateMany({
      where: { id: { in: ids }, organizationId },
      data: {
        status: 'REJECTED',
        decidedById: decidedBy,
        decidedAt: new Date(),
      },
    });
    return { rejected: requests.length };
  }

  /** Reversal: an admin re-opens a rejected request for another attempt. */
  async reopen(organizationId: string, id: string) {
    const request = await this.prisma.joinRequest.findFirst({
      where: { id, organizationId },
    });
    if (!request) {
      throw new ApiError(
        ErrorCode.JOIN_REQUEST_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This join request could not be found.',
      );
    }
    if (request.status !== 'REJECTED') {
      throw new ApiError(
        ErrorCode.JOIN_REQUEST_NOT_PENDING,
        HttpStatus.CONFLICT,
        'Only rejected requests can be reopened.',
      );
    }
    return this.prisma.joinRequest.update({
      where: { id },
      data: { status: 'PENDING', decidedById: null, decidedAt: null },
    });
  }
}
