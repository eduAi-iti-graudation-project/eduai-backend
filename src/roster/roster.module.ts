import { Module } from '@nestjs/common';
import { EnrollSyncService } from './enroll-sync.service';

@Module({
  providers: [EnrollSyncService],
  exports: [EnrollSyncService],
})
export class RosterModule {}
