import { z } from 'zod';
import { MaterialsService } from '../../../materials/materials.service';

export const SearchCurriculumInputSchema = z.object({
  courseId: z.string().uuid(),
  query: z.string(),
  topK: z.number().int().min(1).max(20).default(5),
});

export const SearchCurriculumOutputSchema = z.object({
  results: z.string(),
  count: z.number(),
});

export type SearchCurriculumInput = z.infer<typeof SearchCurriculumInputSchema>;

export function createSearchCurriculumTool(
  materialsService: MaterialsService,
  chapterId?: string | null,
) {
  return {
    inputSchema: SearchCurriculumInputSchema,
    outputSchema: SearchCurriculumOutputSchema,
    execute: async (
      input: SearchCurriculumInput,
    ): Promise<z.infer<typeof SearchCurriculumOutputSchema>> => {
      let chunks = await materialsService.searchChunksByCourse(
        input.courseId,
        input.query,
        input.topK,
        chapterId ?? undefined,
      );

      // The scope is already chosen — a weak semantic query (e.g. just the
      // unit title) must not cause a false "no material". Fall back to the
      // scope's material directly when the search comes back empty.
      if (chunks.length === 0) {
        chunks = chapterId
          ? await materialsService.getChunksByChapter(
              input.courseId,
              chapterId,
              50,
            )
          : await materialsService.getChunksByCourse(input.courseId, 50);
      }

      if (chunks.length === 0) {
        return {
          results: 'No curriculum material found in this unit.',
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
