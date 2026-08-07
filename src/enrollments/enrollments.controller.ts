import { Controller, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SectionsService } from '../sections/sections.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('enrollments')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Roles('TEACHER', 'ADMIN')
  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a pending enrollment request' })
  approve(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sectionsService.approveEnrollment(id, organizationId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a pending enrollment request' })
  reject(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sectionsService.rejectEnrollment(id, organizationId);
  }
}
