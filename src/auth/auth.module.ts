import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SupabaseService } from './supabase.service';

@Module({
  providers: [AuthService, SupabaseService],
  controllers: [AuthController],
  exports: [SupabaseService],
})
export class AuthModule {}
