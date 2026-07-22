import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { ReportsModule } from '../reports/reports.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ReportsModule, NotificationsModule],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
