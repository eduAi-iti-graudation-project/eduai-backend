import { Module } from '@nestjs/common';
import { OfferingsService } from './offerings.service';
import { OfferingsController } from './offerings.controller';
import { RosterModule } from '../roster/roster.module';

@Module({
  imports: [RosterModule],
  providers: [OfferingsService],
  controllers: [OfferingsController],
  exports: [OfferingsService],
})
export class OfferingsModule {}
