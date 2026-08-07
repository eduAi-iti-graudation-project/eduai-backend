import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GradingService } from './grading.service';
import { Roles } from '../auth/roles.decorator';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

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

  @Roles('TEACHER', 'ADMIN')
  @Get('submissions/:submissionId/scores')
  @ApiOperation({ summary: 'Get all scores with criteria for a submission' })
  getScores(@Param('submissionId') submissionId: string) {
    return this.gradingService.getScores(submissionId);
  }

  @Roles('TEACHER')
  @Patch('scores/:scoreId')
  @ApiOperation({ summary: 'Update points awarded for a single score' })
  updateScore(
    @Param('scoreId') scoreId: string,
    @Body() body: { pointsAwarded: number },
  ) {
    if (body.pointsAwarded == null || body.pointsAwarded < 0) {
      throw new ApiError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'The points value must be a non-negative number.',
      );
    }
    return this.gradingService.updateScore(scoreId, body.pointsAwarded);
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch('confirm-all/:submissionId')
  @ApiOperation({ summary: 'Confirm all grades in a submission' })
  confirmAll(@Param('submissionId') submissionId: string) {
    return this.gradingService.confirmAll(submissionId);
  }

  @Roles('TEACHER', 'ADMIN')
  @Post('backfill-feedback')
  @ApiOperation({
    summary:
      'Re-run feedback writer for all confirmed submissions missing AI feedback',
  })
  backfillFeedback() {
    return this.gradingService.backfillFeedback();
  }
}
