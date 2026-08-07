import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { StudentProfileSchema } from '../dto';

const InputSchema = z.object({
  studentId: z.string(),
});

export type StudentProfileTool = {
  execute: (
    input: z.infer<typeof InputSchema>,
  ) => Promise<z.infer<typeof StudentProfileSchema>>;
};

export const createGetStudentProfileTool = (
  prisma: PrismaService,
): StudentProfileTool => ({
  execute: async (input) => {
    const student = await prisma.user.findUnique({
      where: { id: input.studentId },
    });

    const grades = await prisma.gradingScore.findMany({
      where: {
        submission: { studentId: input.studentId },
        isConfirmed: true,
      },
      include: {
        criteria: true,
        submission: { select: { id: true, createdAt: true } },
      },
      orderBy: { submission: { createdAt: 'desc' } },
      take: 10,
    });

    const attendance = await prisma.attendance.findMany({
      where: { studentId: input.studentId },
      include: { section: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 20,
    });

    const previousAlerts = await prisma.alert.findMany({
      where: { studentId: input.studentId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      grades: grades.map((g) => ({
        submissionId: g.submissionId,
        criteriaId: g.criteria.id,
        pointsAwarded: g.pointsAwarded,
        maxPoints: g.criteria.maxPoints,
        percentage: Math.round((g.pointsAwarded / g.criteria.maxPoints) * 100),
        criteriaDescription: g.criteria.description,
        createdAt: g.submission.createdAt.toISOString(),
      })),
      attendance: attendance.map((a) => ({
        date: a.date.toISOString(),
        status: a.status,
        className: a.section.name,
      })),
      previousAlerts: previousAlerts.map((a) => ({
        type: a.type,
        reason: a.reason,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
      })),
      studentName: student?.name ?? 'Unknown',
    };
  },
});
