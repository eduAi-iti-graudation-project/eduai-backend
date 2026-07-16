import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ProviderService } from './provider.service';

@Global()
@Module({
  imports: [HttpModule],
  providers: [ProviderService],
  exports: [ProviderService],
})
export class AiModule {}
