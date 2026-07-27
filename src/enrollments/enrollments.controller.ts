import { Controller, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClassesService } from '../classes/classes.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('enrollments')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly classesService: ClassesService) {}

  @Roles('TEACHER')
  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a pending enrollment request' })
  approve(@Param('id') id: string) {
    return this.classesService.approveEnrollment(id);
  }

  @Roles('TEACHER')
  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a pending enrollment request' })
  reject(@Param('id') id: string) {
    return this.classesService.rejectEnrollment(id);
  }
}
