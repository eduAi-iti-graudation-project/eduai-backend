import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { InsightsService } from './insights.service';
import { DashboardController } from './dashboard.controller';

@Module({
  providers: [DashboardService, InsightsService],
  controllers: [DashboardController],
  exports: [DashboardService, InsightsService],
})
export class DashboardModule {}
