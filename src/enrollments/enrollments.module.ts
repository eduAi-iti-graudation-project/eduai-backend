import { Module } from '@nestjs/common';
import { ClassesModule } from '../classes/classes.module';
import { EnrollmentsController } from './enrollments.controller';

@Module({
  imports: [ClassesModule],
  controllers: [EnrollmentsController],
})
export class EnrollmentsModule {}
