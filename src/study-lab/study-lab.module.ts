import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StudyLabController } from './study-lab.controller';
import { StudyLabService } from './study-lab.service';
import { StudyLabGenerators } from './study-lab.generators';
import { StudyLabGatewayService } from './study-lab.gateway.service';
import { MaterialsModule } from '../materials/materials.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [MaterialsModule, AuthModule, HttpModule],
  controllers: [StudyLabController],
  providers: [StudyLabService, StudyLabGenerators, StudyLabGatewayService],
  exports: [StudyLabService],
})
export class StudyLabModule {}
