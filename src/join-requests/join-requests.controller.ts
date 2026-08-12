import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JoinRequestsService } from './join-requests.service';
import {
  SignupStudentDto,
  SignupGuardianDto,
  ListJoinRequestsQuery,
  DecideJoinRequestsDto,
} from './dto';

@ApiTags('join-requests')
@Controller('auth')
export class JoinRequestsController {
  constructor(private readonly joinRequests: JoinRequestsService) {}

  @Public()
  @Get('auth/school/:code')
  @ApiOperation({ summary: 'Resolve a school (name + grades) by its code' })
  schoolByCode(@Param('code') code: string) {
    return this.joinRequests.schoolByCode(code);
  }

  @Public()
  @Post('auth/signup/student')
  @ApiOperation({
    summary:
      'Student self-registration — creates a pending join request; roster rows auto-fill the grade',
  })
  signupStudent(@Body() dto: SignupStudentDto) {
    return this.joinRequests.applyAsStudent(dto);
  }

  @Public()
  @Post('auth/signup/guardian')
  @ApiOperation({
    summary:
      'Parent self-registration with a school code — pending guardian request linked to a child by school email on approval',
  })
  signupGuardian(@Body() dto: SignupGuardianDto) {
    return this.joinRequests.applyAsGuardian(dto);
  }
}

@ApiTags('join-requests')
@Controller('students/join-requests')
@Roles('ADMIN')
export class AdminJoinRequestsController {
  constructor(private readonly joinRequests: JoinRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'List join requests with status/source filters' })
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query() query: ListJoinRequestsQuery,
  ) {
    return this.joinRequests.list(organizationId, {
      status: query.status,
      source: query.source,
    });
  }

  @Post('approve')
  @ApiOperation({
    summary: 'Bulk approve join requests (ROSTER rows get a gmail + password)',
  })
  approve(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('id') decidedBy: string,
    @Body() dto: DecideJoinRequestsDto,
  ) {
    return this.joinRequests.approve(organizationId, dto.ids, decidedBy);
  }

  @Post('reject')
  @ApiOperation({ summary: 'Reject a batch of pending join requests' })
  reject(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('id') decidedBy: string,
    @Body() dto: DecideJoinRequestsDto,
  ) {
    return this.joinRequests.reject(organizationId, dto.ids, decidedBy);
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reopen a rejected join request' })
  reopen(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.joinRequests.reopen(organizationId, id);
  }
}
