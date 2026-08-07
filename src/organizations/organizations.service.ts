import { Injectable, HttpStatus } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import type { InviteMemberDto } from './dto';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { ErrorHint } from '../common/errors/hints';

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateJoinCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async assertSeatAvailable(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.ORG_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your organization could not be found.',
      );
    }

    if (organization.seatLimit === null) return;

    const memberCount = await this.prisma.user.count({
      where: { organizationId, role: { not: 'ADMIN' } },
    });

    if (memberCount >= organization.seatLimit) {
      throw new ApiError(
        ErrorCode.INVITE_SEATS_FULL,
        HttpStatus.PAYMENT_REQUIRED,
        'Your organization has reached its seat limit. Upgrade to invite more members.',
        { hint: ErrorHint.UPGRADE },
      );
    }
  }

  async getOrganizationSummary(organizationId: string) {
    const [organization, userCount] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.user.count({
        where: { organizationId, role: { not: 'ADMIN' } },
      }),
    ]);
    if (!organization) {
      throw new ApiError(
        ErrorCode.ORG_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your organization could not be found.',
      );
    }

    return {
      id: organization.id,
      name: organization.name,
      joinCode: organization.joinCode,
      subscriptionStatus: organization.subscriptionStatus,
      subscriptionTier: organization.subscriptionTier,
      seatLimit: organization.seatLimit,
      userCount,
    };
  }

  async regenerateJoinCode(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new ApiError(
        ErrorCode.ORG_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Your organization could not be found.',
      );
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateJoinCode();
      try {
        return await this.prisma.organization.update({
          where: { id: organizationId },
          data: { joinCode: code },
        });
      } catch (err) {
        const last = attempt === 2;
        if (last) throw err;
      }
    }
    throw new Error('Could not allocate a unique join code');
  }

  async listRequests(
    organizationId: string,
    status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING',
  ) {
    return this.prisma.membershipRequest.findMany({
      where: { organizationId, status },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        gradeLevel: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async approveRequest(
    requestId: string,
    organizationId: string,
    roleOverride?: 'TEACHER' | 'STUDENT',
  ) {
    const request = await this.prisma.membershipRequest.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) {
      throw new ApiError(
        ErrorCode.REQUEST_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This membership request could not be found.',
      );
    }
    if (request.status !== 'PENDING') {
      throw new ApiError(
        ErrorCode.REQUEST_ALREADY_RESOLVED,
        HttpStatus.CONFLICT,
        'This membership request has already been reviewed.',
      );
    }

    await this.assertSeatAvailable(organizationId);

    const existingMember = await this.prisma.user.findFirst({
      where: { email: request.email, organizationId },
    });
    if (existingMember) {
      throw new ApiError(
        ErrorCode.INVITE_EMAIL_TAKEN,
        HttpStatus.CONFLICT,
        'A user with this email already exists in the organization.',
      );
    }

    let gradeId: string | null = null;
    if (request.gradeLevel) {
      const grade = await this.prisma.gradeLevel.findFirst({
        where: { organizationId, level: request.gradeLevel },
      });
      gradeId = grade?.id ?? null;
    }

    const [user] = await this.prisma.$transaction([
      this.prisma.user.create({
        data: {
          authId: request.authId,
          email: request.email,
          name: request.name,
          role: roleOverride ?? request.role,
          organizationId,
          ...(gradeId ? { gradeId } : {}),
        },
      }),
      this.prisma.membershipRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', resolvedAt: new Date() },
      }),
    ]);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      gradeId: user.gradeId,
    };
  }

  async rejectRequest(requestId: string, organizationId: string) {
    const request = await this.prisma.membershipRequest.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) {
      throw new ApiError(
        ErrorCode.REQUEST_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This membership request could not be found.',
      );
    }
    if (request.status !== 'PENDING') {
      throw new ApiError(
        ErrorCode.REQUEST_ALREADY_RESOLVED,
        HttpStatus.CONFLICT,
        'This membership request has already been reviewed.',
      );
    }

    return this.prisma.membershipRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });
  }

  async inviteMember(
    organizationId: string,
    dto: InviteMemberDto,
    inviterId: string,
  ) {
    const inviter = await this.prisma.user.findFirst({
      where: { id: inviterId, organizationId, role: 'ADMIN' },
    });
    if (!inviter) {
      throw new ApiError(
        ErrorCode.ORG_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'Only an organization admin can invite members.',
      );
    }

    await this.assertSeatAvailable(organizationId);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ApiError(
        ErrorCode.INVITE_EMAIL_TAKEN,
        HttpStatus.CONFLICT,
        'A user with this email already exists.',
      );
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.inviteUserByEmail(dto.email, {
        redirectTo: process.env.FRONTEND_URL ?? undefined,
      });
    if (error || !data.user) {
      throw new ApiError(
        ErrorCode.INVITE_EMAIL_INVALID,
        HttpStatus.BAD_REQUEST,
        'That email address is not valid.',
        { hint: ErrorHint.RETRY, cause: error },
      );
    }

    const user = await this.prisma.user.create({
      data: {
        authId: data.user.id,
        email: dto.email.toLowerCase(),
        name: dto.name ?? dto.email.split('@')[0],
        role: dto.role,
        organizationId,
      },
    });

    return { id: user.id, email: user.email, role: user.role };
  }
}
