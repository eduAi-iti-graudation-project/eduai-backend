import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const StudyGenerationKindSchema = z.enum([
  'PODCAST',
  'SLIDES',
  'STUDY_MATERIAL',
]);

export const MaterialKindSchema = z.enum([
  'STUDY_GUIDE',
  'FLASHCARDS',
  'PRACTICE_QUESTIONS',
  'CHEAT_SHEET',
]);

export const PodcastPresetSchema = z.enum([
  'OVERVIEW',
  'DEEP_DIVE',
  'EXAM_CRAM',
  'CASUAL',
  'BREAKDOWN',
]);

export const GenerateStudySchema = z.object({
  courseOfferingId: z.string().uuid(),
  kind: StudyGenerationKindSchema,
  materialKind: MaterialKindSchema.optional(),
  preset: PodcastPresetSchema.optional(),
  topic: z.string().min(3).max(500),
});

const StudyGenerationSummarySchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  materialKind: z.string().nullable(),
  preset: z.string().nullable(),
  topic: z.string(),
  status: z.string(),
  stage: z.string(),
  error: z.string().nullable(),
  recommendedForAnalysisId: z.string().uuid().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  payload: z.unknown().nullable(),
  audioUrl: z.string().nullable(),
  fileUrl: z.string().nullable(),
});

export const StudyGenerationSubmitSchema = z.object({
  generationId: z.string().uuid(),
  status: z.string(),
});

export const StudyGenerationDetailSchema = z.object({
  generation: StudyGenerationSummarySchema,
});

export const StudyGenerationListSchema = z.object({
  generations: z.array(StudyGenerationSummarySchema),
});

export type GenerateStudyDto = z.infer<typeof GenerateStudySchema>;

export class GenerateStudyRequestDto extends createZodDto(
  GenerateStudySchema,
) {}
export class StudyGenerationSubmitDto extends createZodDto(
  StudyGenerationSubmitSchema,
) {}
export class StudyGenerationDetailDto extends createZodDto(
  StudyGenerationDetailSchema,
) {}
export class StudyGenerationListDto extends createZodDto(
  StudyGenerationListSchema,
) {}
