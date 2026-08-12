import { Module } from '@nestjs/common';
import { GradeConsoleService } from './grade-console.service';
import { GradeConsoleController } from './grade-console.controller';
import { GradeLevelsModule } from '../grade-levels/grade-levels.module';
import { ClassesModule } from '../classes/classes.module';

@Module({
  imports: [GradeLevelsModule, ClassesModule],
  providers: [GradeConsoleService],
  controllers: [GradeConsoleController],
})
export class GradeConsoleModule {}
