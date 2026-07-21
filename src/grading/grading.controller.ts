import { Controller, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { GradingService } from './grading.service';
import { ConfirmGradeDto } from './dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('grading')
@Controller('grades')
export class GradingController {
  constructor(private readonly gradingService: GradingService) {}

  @Roles('TEACHER')
  @Post('submissions/:submissionId/grade')
  @ApiOperation({ summary: 'Grade a submission (triggers AI grading agent)' })
  grade(@Param('submissionId') submissionId: string) {
    return this.gradingService.gradeSubmission(submissionId);
  }

  @Roles('TEACHER')
  @Patch(':id/confirm')
  @Roles('TEACHER', 'ADMIN')
  @ApiOperation({ summary: 'Confirm a grade (teacher review)' })
  @ApiBody({ type: ConfirmGradeDto })
  confirm(@Param('id') id: string, @Body() dto: ConfirmGradeDto) {
    return this.gradingService.confirm(id, dto);
  }

  @Patch('confirm-all/:submissionId')
  @Roles('TEACHER', 'ADMIN')
  @ApiOperation({ summary: 'Confirm all grades in a submission' })
  confirmAll(@Param('submissionId') submissionId: string) {
    return this.gradingService.confirmAll(submissionId);
  }
}
