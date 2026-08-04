import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { InviteMemberDto } from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipSubscriptionCheck } from '../auth/skip-subscription.decorator';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @SkipSubscriptionCheck()
  @Get('me')
  @ApiOperation({
    summary: 'Current user organization (subscription status, seat usage)',
  })
  getMyOrganization(@CurrentUser('organizationId') organizationId: string) {
    return this.organizationsService.getOrganizationSummary(organizationId);
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
      throw new ForbiddenException(
        'You can only invite members to your own organization',
      );
    }
    return this.organizationsService.inviteMember(
      organizationId,
      dto,
      inviterId,
    );
  }
}
