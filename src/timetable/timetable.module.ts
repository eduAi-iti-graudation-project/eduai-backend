import { Module } from '@nestjs/common';
import { TimetableService } from './timetable.service';
import { TimetableController } from './timetable.controller';

@Module({
  providers: [TimetableService],
  controllers: [TimetableController],
  exports: [TimetableService],
})
export class TimetableModule {}
