import { Module } from '@nestjs/common';
import { RubricsService } from './rubrics.service';
import { RubricsController } from './rubrics.controller';

@Module({
  providers: [RubricsService],
  controllers: [RubricsController],
})
export class RubricsModule {}
