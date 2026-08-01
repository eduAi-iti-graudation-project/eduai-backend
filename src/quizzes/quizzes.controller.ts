import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { QuizzesService } from './quizzes.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateQuizDto,
  UpdateQuizDto,
  GenerateQuizDto,
  SubmitAttemptDto,
  UpdateAnswerDto,
  ReportViolationDto,
} from './dto';

@ApiTags('quizzes')
@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  // ─── AI Generation ────────────────────────────────────
  @Roles('TEACHER')
  @Post('generate')
  @ApiOperation({ summary: 'AI-generate a quiz from class materials' })
  generate(@Body() dto: GenerateQuizDto, @CurrentUser('id') teacherId: string) {
    return this.quizzesService.generate({ ...dto, teacherId });
  }

  // ─── CRUD ─────────────────────────────────────────────
  @Roles('TEACHER')
  @Post()
  @ApiOperation({ summary: 'Create a quiz manually' })
  create(@Body() dto: CreateQuizDto, @CurrentUser('id') teacherId: string) {
    return this.quizzesService.create({ ...dto, teacherId });
  }

  @Roles('TEACHER', 'STUDENT')
  @Get()
  @ApiOperation({ summary: 'List quizzes' })
  findAll(@Query('classId') classId?: string) {
    return this.quizzesService.findAll(classId);
  }

  @Roles('TEACHER', 'STUDENT')
  @Get(':id')
  @ApiOperation({ summary: 'Get quiz with questions' })
  findOne(@Param('id') id: string, @CurrentUser('role') role: string) {
    return this.quizzesService.findOne(id, role === 'STUDENT');
  }

  @Roles('TEACHER')
  @Patch(':id')
  @ApiOperation({ summary: 'Update quiz' })
  update(@Param('id') id: string, @Body() dto: UpdateQuizDto) {
    return this.quizzesService.update(id, dto);
  }

  @Roles('TEACHER')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete quiz' })
  remove(@Param('id') id: string) {
    return this.quizzesService.remove(id);
  }

  @Roles('TEACHER')
  @Patch(':id/publish')
  @ApiOperation({ summary: 'Publish a draft quiz' })
  publish(@Param('id') id: string) {
    return this.quizzesService.publish(id);
  }

  // ─── Attempts ─────────────────────────────────────────
  @Roles('STUDENT')
  @Post(':id/start')
  @ApiOperation({ summary: 'Start a quiz attempt' })
  startAttempt(@Param('id') id: string, @CurrentUser('id') studentId: string) {
    return this.quizzesService.startAttempt(id, studentId);
  }

  @Roles('STUDENT')
  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit quiz answers' })
  submitAttempt(
    @Param('id') id: string,
    @Body() dto: SubmitAttemptDto,
    @CurrentUser('id') studentId: string,
  ) {
    return this.quizzesService.submitAttempt(id, studentId, dto.answers);
  }

  @Roles('STUDENT')
  @Post('attempts/:id/violations')
  @ApiOperation({ summary: 'Report a violation (tab switch, fullscreen exit)' })
  reportViolation(
    @Param('id') id: string,
    @Body() dto: ReportViolationDto,
    @CurrentUser('id') studentId: string,
  ) {
    return this.quizzesService.reportViolation(id, studentId, dto.type);
  }

  @Roles('TEACHER', 'STUDENT')
  @Get('attempts/:id')
  @ApiOperation({ summary: 'Get attempt with answers' })
  getAttempt(@Param('id') id: string) {
    return this.quizzesService.getAttempt(id);
  }

  @Roles('TEACHER')
  @Get(':id/attempts')
  @ApiOperation({ summary: 'List all attempts for a quiz' })
  getAttemptsByQuiz(@Param('id') id: string) {
    return this.quizzesService.getAttemptsByQuiz(id);
  }

  @Roles('TEACHER')
  @Patch('attempts/:id/confirm')
  @ApiOperation({ summary: 'Confirm all AI-graded scores' })
  confirmAttempt(@Param('id') id: string) {
    return this.quizzesService.confirmAttempt(id);
  }

  @Roles('TEACHER')
  @Patch('answers/:id')
  @ApiOperation({ summary: 'Update a single answer score' })
  updateAnswer(@Param('id') id: string, @Body() dto: UpdateAnswerDto) {
    return this.quizzesService.updateAnswer(id, dto.pointsAwarded);
  }
}
