import { Module } from '@nestjs/common';
import { SectionsModule } from '../sections/sections.module';
import { EnrollmentsController } from './enrollments.controller';

@Module({
  imports: [SectionsModule],
  controllers: [EnrollmentsController],
})
export class EnrollmentsModule {}
