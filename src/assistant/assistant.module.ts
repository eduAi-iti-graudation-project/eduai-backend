import { Module } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { MaterialsModule } from '../materials/materials.module';

@Module({
  imports: [MaterialsModule],
  providers: [AssistantService],
  controllers: [AssistantController],
})
export class AssistantModule {}
