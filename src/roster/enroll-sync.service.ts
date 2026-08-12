import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * Roster is grade-derived: each student belongs to exactly ONE section of
 * their grade level. Sections are assigned automatically with a round-robin
 * policy — the student lands in the grade's least-populated section
 * (ties broken alphabetically) unless an explicit section was requested
 * (admin move, CSV import with a SECTION column, join request).
 *
 * A REJECTED enrollment row marks an explicit exclusion — re-adding to that
 * section clears the marker. A student moved to another section leaves the
 * previous section automatically (its APPROVED row is removed).
 */
@Injectable()
export class EnrollSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async syncStudentToGrade(
    studentId: string,
    organizationId: string,
    gradeId?: string,
    preferredSectionId?: string,
    tx?: Tx,
  ) {
    const client = tx ?? this.prisma;
    const student = await client.user.findUnique({
      where: { id: studentId },
      select: {
        organizationId: true,
        gradeId: true,
      },
    });
    if (!student) return { added: 0, removed: 0 };
    if (student.organizationId !== organizationId)
      return { added: 0, removed: 0 };

    const targetGradeId = gradeId ?? student.gradeId;
    if (!targetGradeId) return { added: 0, removed: 0 };

    const gradeSections = await client.section.findMany({
      where: { organizationId, gradeLevelId: targetGradeId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (gradeSections.length === 0) return { added: 0, removed: 0 };

    let targetSectionId = gradeSections.find(
      (s) => s.id === preferredSectionId,
    )?.id;

    if (!targetSectionId) {
      const counts = await client.enrollment.groupBy({
        by: ['sectionId'],
        where: {
          sectionId: { in: gradeSections.map((s) => s.id) },
          status: 'APPROVED',
        },
        _count: { sectionId: true },
      });
      const countBySection = new Map(
        counts.map((c) => [c.sectionId, c._count.sectionId]),
      );
      let best = gradeSections[0];
      for (const s of gradeSections) {
        if (
          (countBySection.get(s.id) ?? 0) < (countBySection.get(best.id) ?? 0)
        ) {
          best = s;
        }
      }
      targetSectionId = best.id;
    }

    const otherSectionIds = gradeSections
      .map((s) => s.id)
      .filter((id) => id !== targetSectionId);

    const stale = await client.enrollment.findMany({
      where: {
        studentId,
        status: 'APPROVED',
        OR: [
          {
            section: {
              organizationId,
              gradeLevelId: { not: targetGradeId },
            },
          },
          { sectionId: { in: otherSectionIds } },
        ],
      },
      select: { id: true },
    });

    let added = 0;
    const upsertResult = await client.enrollment.upsert({
      where: {
        sectionId_studentId: { sectionId: targetSectionId, studentId },
      },
      update: { status: 'APPROVED' },
      create: {
        sectionId: targetSectionId,
        studentId,
        status: 'APPROVED' as const,
      },
    });
    added = upsertResult ? 1 : 0;

    let removed = 0;
    if (stale.length > 0) {
      const result = await client.enrollment.deleteMany({
        where: { id: { in: stale.map((e) => e.id) } },
      });
      removed = result.count;
    }

    return { added, removed };
  }

  /**
   * Section creation does not auto-enroll anyone: with round-robin
   * assignment, a new section fills up as new students are added.
   */
  syncSectionToStudents() {
    return { added: 0 };
  }
}
