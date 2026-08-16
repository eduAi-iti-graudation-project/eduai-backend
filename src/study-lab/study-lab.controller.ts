import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { StudyLabService } from './study-lab.service';
import {
  GenerateStudyRequestDto,
  StudyGenerationSubmitDto,
  StudyGenerationDetailDto,
  StudyGenerationListDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { AllowGuardianless } from '../auth/allow-guardianless.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '@prisma/client';
import { RequiresTier } from '../auth/requires-tier.decorator';

@ApiTags('assistant')
@Controller('assistant')
@RequiresTier('PRO', 'ENTERPRISE')
export class StudyLabController {
  constructor(private readonly studyLabService: StudyLabService) {}

  @Post('study-lab/generate')
  @Roles('STUDENT')
  @ApiOperation({
    summary: 'Generate a podcast, slide deck, or study material',
  })
  @ApiOkResponse({ type: StudyGenerationSubmitDto })
  async generate(
    @Body() dto: GenerateStudyRequestDto,
    @CurrentUser() user: User,
  ): Promise<StudyGenerationSubmitDto> {
    return this.studyLabService.submit(user.id, dto);
  }

  @Post('study-lab/:generationId/retry')
  @Roles('STUDENT')
  @ApiOperation({
    summary: 'Retry a failed study generation',
  })
  @ApiOkResponse({ type: StudyGenerationSubmitDto })
  async retry(
    @Param('generationId') generationId: string,
    @CurrentUser() user: User,
  ): Promise<StudyGenerationSubmitDto> {
    return this.studyLabService.retry(user.id, generationId);
  }

  @Get('study-lab/offerings')
  @Roles('STUDENT')
  @AllowGuardianless()
  @ApiOperation({
    summary:
      "List the student's approved course offerings for study-lab generation",
  })
  async offerings(@CurrentUser() user: User): Promise<{
    offerings: {
      id: string;
      courseName: string;
      sectionName: string;
      teacherName: string | null;
    }[];
  }> {
    return this.studyLabService.getStudentOfferings(user.id);
  }

  @Get('study-lab/history')
  @Roles('STUDENT')
  @AllowGuardianless()
  @ApiOperation({ summary: "List the student's study generations" })
  @ApiQuery({ name: 'courseOfferingId', required: false })
  @ApiOkResponse({ type: StudyGenerationListDto })
  async history(
    @CurrentUser() user: User,
    @Query('courseOfferingId') courseOfferingId?: string,
  ): Promise<StudyGenerationListDto> {
    return this.studyLabService.getHistory(user.id, courseOfferingId);
  }

  @Get('study-lab/:generationId')
  @Roles('STUDENT')
  @AllowGuardianless()
  @ApiOperation({ summary: 'Get a study generation with its payload' })
  @ApiOkResponse({ type: StudyGenerationDetailDto })
  async detail(
    @Param('generationId') generationId: string,
    @CurrentUser() user: User,
  ): Promise<StudyGenerationDetailDto> {
    return this.studyLabService.getDetail(user.id, generationId);
  }

  @Get('study-lab/:generationId/download')
  @Roles('STUDENT')
  @AllowGuardianless()
  @ApiOperation({
    summary: 'Download the generated file (slides or podcast audio)',
  })
  async download(
    @Param('generationId') generationId: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType, filename } =
      await this.studyLabService.download(user.id, generationId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Delete('study-lab/:generationId')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Delete a study generation and its files' })
  async remove(
    @Param('generationId') generationId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.studyLabService.remove(user.id, generationId);
  }
}
