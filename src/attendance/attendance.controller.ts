import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBody } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { ImportAttendanceDto, AttendanceResponseDto } from './dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('attendance')
@Controller()
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Roles('TEACHER')
  @Post('attendance/import')
  @ApiOperation({ summary: 'Import attendance records in batch' })
  @ApiBody({ type: ImportAttendanceDto })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  importBatch(@Body() dto: ImportAttendanceDto) {
    return this.attendanceService.importBatch(dto.records);
  }

  @Roles('TEACHER', 'STUDENT', 'GUARDIAN')
  @Get('students/:id/attendance')
  @ApiOperation({ summary: 'Get attendance records for a student' })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  getByStudent(@Param('id') id: string) {
    return this.attendanceService.getByStudent(id);
  }

  @Roles('TEACHER')
  @Get('classes/:id/attendance')
  @ApiOperation({ summary: 'Get attendance records for a class' })
  @ApiOkResponse({ type: AttendanceResponseDto, isArray: true })
  getByClass(@Param('id') id: string) {
    return this.attendanceService.getByClass(id);
  }
}
