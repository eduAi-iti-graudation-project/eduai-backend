import { Module } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { AssignmentsController } from './assignments.controller';
import { MaterialsModule } from '../materials/materials.module';
import { RubricsModule } from '../rubrics/rubrics.module';

@Module({
  imports: [MaterialsModule, RubricsModule],
  providers: [AssignmentsService],
  controllers: [AssignmentsController],
})
export class AssignmentsModule {}
