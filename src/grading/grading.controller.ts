import { Controller, Post, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GradingService } from './grading.service';
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

  @Patch('confirm-all/:submissionId')
  @Roles('TEACHER', 'ADMIN')
  @ApiOperation({ summary: 'Confirm all grades in a submission' })
  confirmAll(@Param('submissionId') submissionId: string) {
    return this.gradingService.confirmAll(submissionId);
  }
}
