import { Global, Module } from '@nestjs/common';
import { PiiService } from './pii.service';

@Global()
@Module({
  providers: [PiiService],
  exports: [PiiService],
})
export class PiiModule {}
