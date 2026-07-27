import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

type Database = Record<string, never>;

@Injectable()
export class SupabaseService {
  private client: SupabaseClient<Database>;

  constructor() {
    this.client = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
      {
        auth: { persistSession: false },
      },
    );
  }

  getClient(): SupabaseClient<Database> {
    return this.client;
  }

  async verifyToken(token: string) {
    const { data, error } = await this.client.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return data.user;
  }

  async signOut(authId: string): Promise<void> {
    const { error } = await this.client.auth.admin.signOut(authId);
    if (error) {
      throw new UnauthorizedException('Logout failed');
    }
  }
}
