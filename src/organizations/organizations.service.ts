import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import type { InviteMemberDto } from './dto';

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
    if (!organization) throw new NotFoundException('Organization not found');

    if (organization.seatLimit === null) return;

    const memberCount = await this.prisma.user.count({
      where: { organizationId, role: { not: 'ADMIN' } },
    });

    if (memberCount >= organization.seatLimit) {
      throw new HttpException(
        'Organization seat limit reached. Upgrade your plan to add more members.',
        HttpStatus.PAYMENT_REQUIRED,
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
    if (!organization) throw new NotFoundException('Organization not found');

    return {
      id: organization.id,
      name: organization.name,
      subscriptionStatus: organization.subscriptionStatus,
      subscriptionTier: organization.subscriptionTier,
      seatLimit: organization.seatLimit,
      userCount,
    };
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
      throw new ForbiddenException(
        'Only an organization admin can invite members',
      );
    }

    await this.assertSeatAvailable(organizationId);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new BadRequestException('A user with this email already exists');
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.admin.inviteUserByEmail(dto.email, {
        redirectTo: process.env.FRONTEND_URL ?? undefined,
      });
    if (error || !data.user) {
      throw new BadRequestException(
        error?.message ?? 'Failed to send the invitation',
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
