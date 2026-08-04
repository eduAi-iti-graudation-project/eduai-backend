import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getGrades(id: string, organizationId: string) {
    const grades = await this.prisma.gradingScore.findMany({
      where: {
        submission: { studentId: id, student: { organizationId } },
        isConfirmed: true,
      },
      include: { criteria: true, submission: true },
    });

    return grades.map((g) => ({
      id: g.id,
      submissionId: g.submissionId,
      assignmentId: g.submission.assignmentId,
      criteriaId: g.criteriaId,
      pointsAwarded: g.pointsAwarded,
      aiFeedback: g.aiFeedback,
      teacherNotes: g.teacherNotes,
      isConfirmed: g.isConfirmed,
      createdAt: g.createdAt,
      criterionDescription: g.criteria.description,
      criterionMaxPoints: g.criteria.maxPoints,
    }));
  }

  async getSubmissionGrades(
    studentId: string,
    submissionId: string,
    organizationId: string,
  ) {
    const submission = await this.prisma.submission.findFirst({
      where: {
        id: submissionId,
        studentId,
        student: { organizationId },
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    const grades = await this.prisma.gradingScore.findMany({
      where: { submissionId, isConfirmed: true },
      include: { criteria: true },
    });

    return grades.map((g) => ({
      id: g.id,
      submissionId: g.submissionId,
      assignmentId: submission.assignmentId,
      criteriaId: g.criteriaId,
      pointsAwarded: g.pointsAwarded,
      aiFeedback: g.aiFeedback,
      teacherNotes: g.teacherNotes,
      isConfirmed: g.isConfirmed,
      createdAt: g.createdAt,
      criterionDescription: g.criteria.description,
      criterionMaxPoints: g.criteria.maxPoints,
    }));
  }

  async getClasses(studentId: string, organizationId: string) {
    return this.prisma.class.findMany({
      where: {
        organizationId,
        enrollments: {
          some: { studentId, status: 'APPROVED' },
        },
      },
      include: {
        teacher: true,
        assignments: { include: { rubrics: true } },
      },
    });
  }

  async update(
    studentId: string,
    dto: {
      name?: string;
      email?: string;
      gradeId?: string;
      guardianId?: string;
    },
    organizationId: string,
  ) {
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, organizationId },
    });
    if (!student) throw new NotFoundException('Student not found');
    if (dto.guardianId) {
      const guardian = await this.prisma.user.findFirst({
        where: { id: dto.guardianId, organizationId },
      });
      if (!guardian) throw new NotFoundException('Guardian not found');
    }
    return this.prisma.user.update({ where: { id: studentId }, data: dto });
  }

  async linkGuardian(
    studentId: string,
    guardianId: string,
    organizationId: string,
  ) {
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, organizationId },
    });
    if (!student) throw new NotFoundException('Student not found');
    const guardian = await this.prisma.user.findFirst({
      where: { id: guardianId, organizationId },
    });
    if (!guardian) throw new NotFoundException('Guardian not found');
    return this.prisma.user.update({
      where: { id: studentId },
      data: { guardianId },
    });
  }
}
