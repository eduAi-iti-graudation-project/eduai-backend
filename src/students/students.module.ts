import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { RosterModule } from '../roster/roster.module';
import { AuthModule } from '../auth/auth.module';
import { JoinRequestsModule } from '../join-requests/join-requests.module';

@Module({
  imports: [RosterModule, AuthModule, JoinRequestsModule],
  providers: [StudentsService],
  controllers: [StudentsController],
})
export class StudentsModule {}
