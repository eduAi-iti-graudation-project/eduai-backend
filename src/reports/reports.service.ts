import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES as MD_FORMATTING_RULES } from '../common/llm/formatting-rules';
import { ReportGenerateSchema } from './dto';
import type { User } from '@prisma/client';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  async generate(studentId: string, alertId: string) {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      include: { student: true },
    });
    if (!alert) {
      throw new ApiError(
        ErrorCode.ALERT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This alert could not be found.',
      );
    }

    const { parentSection, teacherSection, managementSection } =
      await this.llmService.generateStructured({
        systemPrompt:
          'You are an educational report writer. Given an alert about a student, ' +
          'generate three structured report sections for different audiences. ' +
          'Every free-text field must reference the actual numbers and reason from the alert — never generic filler.' +
          MD_FORMATTING_RULES,
        userPrompt:
          `Student: ${alert.student.name}\n` +
          `Alert type: ${alert.type}\n` +
          `Reason: ${alert.reason}\n\n` +
          'Generate three sections, each with the exact shape below:\n' +
          '1. parentSection: plain-language explanation for parents.\n' +
          '   { message: string — 2-3 sentences explaining what the numbers show, empathetic and constructive; homeSupport: string[] — 3-4 concrete actions the family can take }\n' +
          '2. teacherSection: pedagogical analysis for teachers.\n' +
          '   { analysis: string — paragraph citing the actual numbers and likely causes; skillGaps: string[] — specific skills falling behind; interventions: string[] — classroom strategies; resourceSuggestions: string[] — materials or resources }\n' +
          '3. managementSection: administrative summary for school management.\n' +
          '   { summary: string — overall status; classTrend: string — one line comparing this student to class patterns; recommendation: string — next step for leadership }',
        schema: ReportGenerateSchema,
      });

    return this.prisma.studentReport.create({
      data: {
        studentId,
        alertId,
        parentSection,
        teacherSection,
        managementSection,
      },
    });
  }

  async findAll(user: User, studentId?: string) {
    const where = this.accessWhere(user, studentId);
    return this.prisma.studentReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: User) {
    const report = await this.prisma.studentReport.findFirst({
      where: { id, ...this.accessWhere(user) },
    });
    if (!report) {
      throw new ApiError(
        ErrorCode.REPORT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This report could not be found.',
      );
    }
    return report;
  }

  /**
   * Role-scoped where clause: students only see their own reports, guardians
   * only their linked children's, teachers/admins everything in their org.
   */
  private accessWhere(user: User, studentId?: string) {
    switch (user.role) {
      case 'STUDENT':
        return { studentId: user.id };
      case 'GUARDIAN':
        return {
          student: {
            ...(studentId ? { id: studentId } : {}),
            guardianId: user.id,
          },
        };
      default:
        return {
          student: {
            ...(studentId ? { id: studentId } : {}),
            organizationId: user.organizationId,
          },
        };
    }
  }
}
