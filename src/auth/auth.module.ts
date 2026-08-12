import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SupabaseService } from './supabase.service';
import { RolesGuard } from './roles.guard';
import { MailerModule } from '../common/mailer/mailer.module';

@Module({
  imports: [MailerModule],
  providers: [
    AuthService,
    SupabaseService,
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  controllers: [AuthController],
  exports: [SupabaseService],
})
export class AuthModule {}
