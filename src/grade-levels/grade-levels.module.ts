import { Module } from '@nestjs/common';
import { GradeLevelsService } from './grade-levels.service';
import { GradeLevelsController } from './grade-levels.controller';

@Module({
  providers: [GradeLevelsService],
  controllers: [GradeLevelsController],
  exports: [GradeLevelsService],
})
export class GradeLevelsModule {}
