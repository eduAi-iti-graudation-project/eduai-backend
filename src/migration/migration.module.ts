import { Module } from '@nestjs/common';
import { MigrationService } from './migration.service';
import { MigrationController } from './migration.controller';
import { JoinRequestsModule } from '../join-requests/join-requests.module';

@Module({
  imports: [JoinRequestsModule],
  providers: [MigrationService],
  controllers: [MigrationController],
})
export class MigrationModule {}
