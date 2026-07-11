import 'dotenv/config';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleDestroy
{
  constructor() {
    const url = new URL(process.env.DATABASE_URL!);
    const schema = url.searchParams.get('schema') ?? undefined;
    url.searchParams.delete('schema');
    const adapter = new PrismaPg(url.toString(), { schema });
    super({ adapter });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
