import { Module } from '@nestjs/common';
import { GuardianService } from './guardian.service';
import { GuardianController } from './guardian.controller';
import { MailerModule } from '../common/mailer/mailer.module';

@Module({
  imports: [MailerModule],
  providers: [GuardianService],
  controllers: [GuardianController],
})
export class GuardianModule {}
