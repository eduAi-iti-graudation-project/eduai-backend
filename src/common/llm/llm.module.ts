import { Global, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LlmService } from './llm.service';

@Global()
@Module({
  imports: [AiModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
