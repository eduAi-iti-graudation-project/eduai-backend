import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';

export const LookupAssignmentInputSchema = z.object({
  classId: z.string().uuid(),
  query: z.string(),
  assignmentId: z.string().uuid().optional(),
});

export const LookupAssignmentOutputSchema = z.object({
  found: z.boolean(),
  assignment: z.string().nullable(),
});

export type LookupAssignmentInput = z.infer<typeof LookupAssignmentInputSchema>;

type AssignmentWithDetails = {
  title: string;
  description: string | null;
  dueDate: Date;
  totalPoints: number;
  rubrics: {
    title: string;
    criteria: { description: string; maxPoints: number }[];
  }[];
};

export function formatAssignmentDetails(
  assignments: AssignmentWithDetails[],
): string {
  return assignments
    .map(
      (a) => `Assignment: ${a.title}
Description: ${a.description ?? 'N/A'}
Due: ${a.dueDate.toISOString().split('T')[0]}
Total Points: ${a.totalPoints}

${a.rubrics.length > 0 ? `Rubric: ${a.rubrics[0].title}` : 'No rubric'}
${
  a.rubrics[0]?.criteria
    ?.map(
      (c, idx) =>
        `  Criterion ${idx + 1}: ${c.description} (${c.maxPoints} pts)`,
    )
    .join('\n') ?? ''
}`,
    )
    .join('\n\n---\n\n');
}

export function createLookupAssignmentTool(prisma: PrismaService) {
  return {
    inputSchema: LookupAssignmentInputSchema,
    outputSchema: LookupAssignmentOutputSchema,
    execute: async (
      input: LookupAssignmentInput,
    ): Promise<z.infer<typeof LookupAssignmentOutputSchema>> => {
      const where: Record<string, unknown> = { classId: input.classId };
      if (input.assignmentId) {
        where.id = input.assignmentId;
      } else {
        where.OR = [
          { title: { contains: input.query, mode: 'insensitive' } },
          { description: { contains: input.query, mode: 'insensitive' } },
        ];
      }

      const assignments = await prisma.assignment.findMany({
        where,
        include: {
          rubrics: {
            include: { criteria: true },
          },
        },
        take: 3,
        orderBy: { dueDate: 'desc' },
      });

      if (assignments.length === 0) {
        return { found: false, assignment: null };
      }

      return { found: true, assignment: formatAssignmentDetails(assignments) };
    },
  };
}
