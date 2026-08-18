import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import {
  ImportAttendanceDto,
  AttendanceResponseDto,
  OpenSessionDto,
  SessionResponseDto,
  CheckInDto,
  CheckInResponseDto,
  TeacherLedgerQueryDto,
  CreateTeacherFineDto,
  UpdateTeacherFineDto,
  TeacherFineResponseDto,
} from './dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AllowGuardianless } from '../auth/allow-guardianless.decorator';

@ApiTags('attendance')
@Controller()
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Roles('TEACHER')
  @Post('attendance/import')
  @ApiOperation({
    summary: 'Import attendance records in batch (per offering)',
  })
  @ApiBody({ type: ImportAttendanceDto })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  importBatch(@Body() dto: ImportAttendanceDto) {
    return this.attendanceService.importBatch(dto.records);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN')
  @AllowGuardianless()
  @Get('students/:id/attendance')
  @ApiOperation({ summary: 'Get attendance records for a student' })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  getByStudent(@Param('id') id: string) {
    return this.attendanceService.getByStudent(id);
  }

  @Roles('TEACHER')
  @Get('classes/:id/attendance')
  @ApiOperation({ summary: 'Get attendance records for a class (section)' })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  getByClass(@Param('id') id: string) {
    return this.attendanceService.getByClass(id);
  }

  @Roles('TEACHER')
  @Get('offerings/:id/attendance')
  @ApiOperation({ summary: 'Get attendance records for a course offering' })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  getByOffering(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.getByOffering(id, organizationId);
  }

  @Roles('TEACHER')
  @Post('attendance/sessions')
  @ApiOperation({
    summary:
      'Open a QR check-in session for a class (also records teacher attendance)',
  })
  @ApiBody({ type: OpenSessionDto })
  @ApiOkResponse({ type: SessionResponseDto })
  openSession(
    @Body() dto: OpenSessionDto,
    @CurrentUser('id') teacherId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.openSession(
      dto.courseOfferingId,
      teacherId,
      organizationId,
    );
  }

  @Roles('TEACHER')
  @Get('attendance/sessions/:id')
  @ApiOperation({ summary: 'Get a check-in session (own, re-renders the QR)' })
  @ApiOkResponse({ type: SessionResponseDto })
  getSession(@Param('id') id: string, @CurrentUser('id') teacherId: string) {
    return this.attendanceService.getSession(id, teacherId);
  }

  @Roles('TEACHER')
  @Post('attendance/sessions/:id/close')
  @ApiOperation({ summary: 'Close an open check-in session' })
  @ApiOkResponse({ type: SessionResponseDto })
  closeSession(@Param('id') id: string, @CurrentUser('id') teacherId: string) {
    return this.attendanceService.closeSession(id, teacherId);
  }

  @Roles('STUDENT')
  @AllowGuardianless()
  @Post('attendance/check-in')
  @ApiOperation({
    summary: 'Register attendance by scanning the teacher QR check-in link',
  })
  @ApiBody({ type: CheckInDto })
  @ApiOkResponse({ type: CheckInResponseDto })
  checkIn(
    @Body() dto: CheckInDto,
    @CurrentUser() user: { id: string; organizationId: string | null },
  ) {
    return this.attendanceService.checkIn(dto.token, user);
  }

  @Roles('TEACHER')
  @Get('attendance/teacher/my')
  @ApiOperation({ summary: "Get the current teacher's own attendance records" })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  myTeacherAttendance(@CurrentUser('id') teacherId: string) {
    return this.attendanceService.getMyTeacherAttendance(teacherId);
  }

  @Roles('TEACHER')
  @Get('attendance/teacher/my-fines')
  @ApiOperation({ summary: "Get the current teacher's fines" })
  @ApiOkResponse({ type: TeacherFineResponseDto, isArray: true })
  myFines(@CurrentUser('id') teacherId: string) {
    return this.attendanceService.getMyFines(teacherId);
  }

  @Roles('ADMIN')
  @Get('attendance/teachers')
  @ApiOperation({
    summary: 'Teacher attendance ledger across the organization',
  })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  teacherLedger(
    @Query() query: TeacherLedgerQueryDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.getTeacherLedger(organizationId, query);
  }

  @Roles('ADMIN')
  @Get('teachers/:id/attendance')
  @ApiOperation({ summary: 'Attendance records for one teacher' })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  teacherAttendance(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.getTeacherAttendanceByTeacherId(
      id,
      organizationId,
    );
  }

  @Roles('ADMIN')
  @Get('teachers/:id/fines')
  @ApiOperation({ summary: 'Fines issued against one teacher' })
  @ApiOkResponse({ type: TeacherFineResponseDto, isArray: true })
  listFines(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.listFinesForTeacher(id, organizationId);
  }

  @Roles('ADMIN')
  @Post('teachers/:id/fines')
  @ApiOperation({ summary: 'Issue a fine against a teacher' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiBody({ type: CreateTeacherFineDto })
  @ApiOkResponse({ type: TeacherFineResponseDto })
  createFine(
    @Param('id') id: string,
    @Body() dto: CreateTeacherFineDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.createFine(id, dto, organizationId, adminId);
  }

  @Roles('ADMIN')
  @Patch('fines/:id')
  @ApiOperation({ summary: 'Update a fine (status, amount, reason, due date)' })
  @ApiBody({ type: UpdateTeacherFineDto })
  @ApiOkResponse({ type: TeacherFineResponseDto })
  updateFine(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherFineDto,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.updateFine(id, dto, organizationId);
  }

  @Roles('ADMIN')
  @Delete('fines/:id')
  @ApiOperation({ summary: 'Delete a fine' })
  deleteFine(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.deleteFine(id, organizationId);
  }
}
