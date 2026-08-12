import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateGroupSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export class CreateGroupDto extends createZodDto(CreateGroupSchema) {}
