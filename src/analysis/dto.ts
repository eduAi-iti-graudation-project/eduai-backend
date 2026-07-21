import { z } from 'zod';

export const ExplanationSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export type Explanation = z.infer<typeof ExplanationSchema>;
