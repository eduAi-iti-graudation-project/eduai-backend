import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { ApproveRequestDto, InviteMemberDto, RequestStatusSchema } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipSubscriptionCheck } from '../auth/skip-subscription.decorator';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @SkipSubscriptionCheck()
  @Get('me')
  @ApiOperation({
    summary:
      'Current user organization (subscription status, seat usage, join code)',
  })
  getMyOrganization(@CurrentUser('organizationId') organizationId: string) {
    return this.organizationsService.getOrganizationSummary(organizationId);
  }

  @Roles('ADMIN')
  @Post('me/join-code')
  @ApiOperation({ summary: 'Regenerate the organization join code' })
  regenerateJoinCode(@CurrentUser('organizationId') organizationId: string) {
    return this.organizationsService.regenerateJoinCode(organizationId);
  }

  @Roles('ADMIN')
  @Get('me/requests')
  @ApiOperation({ summary: 'List membership requests (defaults to PENDING)' })
  listRequests(
    @CurrentUser('organizationId') organizationId: string,
    @Query('status') status?: string,
  ) {
    const parsed = RequestStatusSchema.safeParse(status ?? 'PENDING');
    const resolved = parsed.success
      ? parsed.data
      : RequestStatusSchema.enum.PENDING;
    return this.organizationsService.listRequests(organizationId, resolved);
  }

  @Roles('ADMIN')
  @Post('me/requests/:id/approve')
  @ApiOperation({
    summary: 'Approve a membership request (optional role override)',
  })
  approveRequest(
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.organizationsService.approveRequest(
      id,
      organizationId,
      dto?.role,
    );
  }

  @Roles('ADMIN')
  @Post('me/requests/:id/reject')
  @ApiOperation({ summary: 'Reject a membership request' })
  rejectRequest(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.organizationsService.rejectRequest(id, organizationId);
  }

  @Roles('ADMIN')
  @Post(':id/invite')
  @ApiOperation({ summary: 'Invite a teacher or student to the organization' })
  invite(
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser('id') inviterId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    if (id !== organizationId) {
      throw new ApiError(
        ErrorCode.ORG_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'You can only invite members to your own organization.',
      );
    }
    return this.organizationsService.inviteMember(
      organizationId,
      dto,
      inviterId,
    );
  }
}
