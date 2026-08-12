import { z } from 'zod';
import { MaterialsService } from '../../../materials/materials.service';

export const SearchCurriculumInputSchema = z.object({
  courseOfferingId: z.string().uuid(),
  query: z.string(),
  topK: z.number().int().min(1).max(20).default(5),
});

export const SearchCurriculumOutputSchema = z.object({
  results: z.string(),
  count: z.number(),
});

export type SearchCurriculumInput = z.infer<typeof SearchCurriculumInputSchema>;

export function createSearchCurriculumTool(materialsService: MaterialsService) {
  return {
    inputSchema: SearchCurriculumInputSchema,
    outputSchema: SearchCurriculumOutputSchema,
    execute: async (
      input: SearchCurriculumInput,
    ): Promise<z.infer<typeof SearchCurriculumOutputSchema>> => {
      const chunks = await materialsService.searchChunks(
        input.courseOfferingId,
        input.query,
        input.topK,
      );

      if (chunks.length === 0) {
        return {
          results: 'No relevant curriculum material found.',
          count: 0,
        };
      }

      const results = chunks
        .map(
          (c, idx) =>
            `[Result ${idx + 1}] (from: ${c.materialTitle}${c.chapterTitle ? `, chapter: ${c.chapterTitle}` : ''}, relevance: ${c.distance.toFixed(4)})\n${c.content}`,
        )
        .join('\n\n');

      return { results, count: chunks.length };
    },
  };
}
