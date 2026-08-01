import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassContextSchema } from '../dto';

interface ScoreWithCriteria {
  pointsAwarded: number;
  criteria: { maxPoints: number };
  submission: { studentId: string };
}

interface ClassWithAssignments {
  name: string;
  enrollments: Array<{ length: number }>;
  assignments: Array<{
    submissions: Array<{
      studentId: string;
      scores: Array<{
        pointsAwarded: number;
        criteria: { maxPoints: number };
      }>;
    }>;
  }>;
}

const InputSchema = z.object({
  classId: z.string(),
});

export type ClassContextTool = {
  execute: (
    input: z.infer<typeof InputSchema>,
  ) => Promise<z.infer<typeof ClassContextSchema>>;
};

export const createGetClassContextTool = (
  prisma: PrismaService,
): ClassContextTool => ({
  execute: async (input) => {
    const classEntity = await prisma.class.findUnique({
      where: { id: input.classId },
      include: { teacher: true, enrollments: true },
    });
    if (!classEntity) throw new Error('Class not found');

    const allScores = (await prisma.gradingScore.findMany({
      where: {
        submission: {
          assignment: { classId: input.classId },
          status: 'CONFIRMED',
        },
        isConfirmed: true,
      },
      include: {
        criteria: true,
        submission: { select: { studentId: true } },
      },
    })) as unknown as ScoreWithCriteria[];

    const studentPercentages = new Map<string, number[]>();
    for (const score of allScores) {
      const pct = (score.pointsAwarded / score.criteria.maxPoints) * 100;
      const existing = studentPercentages.get(score.submission.studentId) ?? [];
      existing.push(pct);
      studentPercentages.set(score.submission.studentId, existing);
    }

    const studentAverages = Array.from(studentPercentages.values()).map(
      (scores) => scores.reduce((a, b) => a + b, 0) / scores.length,
    );

    const classAverage =
      studentAverages.length > 0
        ? Math.round(
            studentAverages.reduce((a, b) => a + b, 0) / studentAverages.length,
          )
        : 0;

    const belowAverageCount = studentAverages.filter((a) => a < 60).length;

    const otherClasses = (await prisma.class.findMany({
      where: {
        teacherId: classEntity.teacherId,
        id: { not: input.classId },
      },
      include: {
        enrollments: true,
        assignments: {
          include: {
            submissions: {
              where: { status: 'CONFIRMED' },
              include: {
                scores: {
                  where: { isConfirmed: true },
                  include: { criteria: true },
                },
              },
            },
          },
        },
      },
    })) as unknown as ClassWithAssignments[];

    const teacherOtherClasses = otherClasses.map((c) => {
      const classStudentScores = new Map<string, number[]>();
      for (const assignment of c.assignments) {
        for (const sub of assignment.submissions) {
          for (const score of sub.scores) {
            const pct = (score.pointsAwarded / score.criteria.maxPoints) * 100;
            const existing = classStudentScores.get(sub.studentId) ?? [];
            existing.push(pct);
            classStudentScores.set(sub.studentId, existing);
          }
        }
      }
      const avgs = Array.from(classStudentScores.values()).map(
        (s) => s.reduce((a, b) => a + b, 0) / s.length,
      );
      return {
        className: c.name,
        averageScore:
          avgs.length > 0
            ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length)
            : 0,
        studentCount: c.enrollments.length,
      };
    });

    return {
      className: classEntity.name,
      teacherName: classEntity.teacher.name,
      averageScore: classAverage,
      totalStudents: classEntity.enrollments.length,
      belowAverageCount,
      teacherOtherClasses,
    };
  },
});
