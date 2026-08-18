import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Response } from 'express';
import { OrganizationsService } from './organizations.service';
import {
  ApproveRequestDto,
  EmailDomainDto,
  InviteMemberDto,
  RequestStatusSchema,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipSubscriptionCheck } from '../auth/skip-subscription.decorator';
import { Public } from '../auth/public.decorator';
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

  @Public()
  @Get(':id/logo')
  @ApiOperation({ summary: 'Stream a school logo' })
  async getLogo(@Param('id') id: string, @Res() res: Response) {
    const organization = await this.organizationsService.getLogoById(id);
    if (!organization?.logoUrl) {
      throw new ApiError(
        ErrorCode.AVATAR_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Logo not found.',
      );
    }
    const expected = path.resolve(process.cwd(), organization.logoUrl);
    if (!fs.existsSync(expected)) {
      throw new ApiError(
        ErrorCode.AVATAR_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Logo not found.',
      );
    }
    const ext = path.extname(expected).toLowerCase();
    res.setHeader('Content-Type', ext === '.png' ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(expected, (err) => {
      if (err) {
        res
          .status(HttpStatus.NOT_FOUND)
          .send({ error: 'AVATAR_NOT_FOUND', message: 'Logo not found.' });
      }
    });
  }

  @Roles('ADMIN')
  @Post('me/logo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload the school logo shown on reports' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { photo: { type: 'string', format: 'binary' } },
      required: ['photo'],
    },
  })
  uploadLogo(
    @CurrentUser('organizationId') organizationId: string,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ) {
    return this.organizationsService.uploadLogo(organizationId, photo);
  }

  @Roles('ADMIN')
  @Post('me/join-code')
  @ApiOperation({ summary: 'Regenerate the organization join code' })
  regenerateJoinCode(@CurrentUser('organizationId') organizationId: string) {
    return this.organizationsService.regenerateJoinCode(organizationId);
  }

  @Roles('ADMIN')
  @Patch('me/email-domain')
  @ApiOperation({
    summary:
      'Set the school login-identity domain used for provisioned accounts',
  })
  setEmailDomain(
    @Body() dto: EmailDomainDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.organizationsService.setEmailDomain(
      organizationId,
      dto.emailDomain,
    );
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
