import { Module } from '@nestjs/common';
import { OfferingsService } from './offerings.service';
import { OfferingsController } from './offerings.controller';

@Module({
  providers: [OfferingsService],
  controllers: [OfferingsController],
  exports: [OfferingsService],
})
export class OfferingsModule {}
