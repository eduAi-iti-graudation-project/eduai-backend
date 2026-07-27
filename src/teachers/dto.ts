import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AddTeacherGradeSchema = z.object({
  gradeId: z.string().uuid(),
});

export class AddTeacherGradeDto extends createZodDto(AddTeacherGradeSchema) {}
