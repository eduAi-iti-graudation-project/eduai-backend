import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AddClassToGradeSchema = z.object({
  classId: z.string().uuid(),
});

export class AddClassToGradeDto extends createZodDto(AddClassToGradeSchema) {}
export class CreateClassToGradeDto extends createZodDto(
  AddClassToGradeSchema,
) {}
