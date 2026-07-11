import { Controller, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { GradingService } from './grading.service';
import { ConfirmGradeDto } from './dto';

@ApiTags('grading')
@Controller('grades')
export class GradingController {
  constructor(private readonly gradingService: GradingService) {}

  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Confirm a grade (teacher review)' })
  @ApiBody({ type: ConfirmGradeDto })
  confirm(@Param('id') id: string, @Body() dto: ConfirmGradeDto) {
    return this.gradingService.confirm(id, dto);
  }
}
