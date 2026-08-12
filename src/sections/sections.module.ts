import { Module } from '@nestjs/common';
import { SectionsService } from './sections.service';
import { SectionsController } from './sections.controller';
import { RosterModule } from '../roster/roster.module';

@Module({
  imports: [RosterModule],
  providers: [SectionsService],
  controllers: [SectionsController],
  exports: [SectionsService],
})
export class SectionsModule {}
