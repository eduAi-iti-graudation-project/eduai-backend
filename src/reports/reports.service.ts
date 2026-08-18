import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { FORMATTING_RULES as MD_FORMATTING_RULES } from '../common/llm/formatting-rules';
import { ReportGenerateSchema } from './dto';
import { buildReportHtml, initials } from './report-html';
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
          'Every free-text field must reference the actual numbers and reason from the alert — never generic filler. ' +
          'Each free-text section must be structured markdown, never one dense paragraph: open with ONE bolded takeaway sentence, then short labelled sections (### headings) with bullet lists.' +
          MD_FORMATTING_RULES,
        userPrompt:
          `Student: ${alert.student.name}\n` +
          `Alert type: ${alert.type}\n` +
          `Reason: ${alert.reason}\n\n` +
          'Generate three sections, each with the exact shape below:\n' +
          '1. parentSection: plain-language explanation for parents.\n' +
          '   { message: string — structured markdown, 2-3 short sections of short bullets, empathetic and constructive; homeSupport: string[] — 3-4 concrete actions the family can take }\n' +
          '2. teacherSection: pedagogical analysis for teachers.\n' +
          '   { analysis: string — structured markdown citing the actual numbers and likely causes, with labelled sections and bullets; skillGaps: string[] — specific skills falling behind; interventions: string[] — classroom strategies; resourceSuggestions: string[] — materials or resources }\n' +
          '3. managementSection: administrative summary for school management.\n' +
          '   { summary: string — structured markdown: overall status with a bolded takeaway; classTrend: string — one line comparing this student to class patterns; recommendation: string — next step for leadership }',
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
   * Build a standalone, self-contained HTML document for a report: school
   * logo + name in the header, student/alert meta, and the three sections
   * rendered as styled cards. The logo is embedded as a base64 data URI so the
   * document works offline and prints cleanly.
   */
  async getHtmlDocument(id: string, user: User) {
    const report = await this.findOne(id, user);
    const [student, alert] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: report.studentId },
        select: { name: true, organizationId: true },
      }),
      this.prisma.alert.findUnique({
        where: { id: report.alertId },
        select: { type: true, reason: true },
      }),
    ]);
    const organization = student?.organizationId
      ? await this.prisma.organization.findUnique({
          where: { id: student.organizationId },
          select: { name: true, logoUrl: true },
        })
      : null;

    let logoDataUri: string | null = null;
    if (organization?.logoUrl) {
      const logoPath = path.resolve(process.cwd(), organization.logoUrl);
      if (fs.existsSync(logoPath)) {
        try {
          const ext = path.extname(logoPath).toLowerCase();
          const mime =
            ext === '.png'
              ? 'image/png'
              : ext === '.jpg' || ext === '.jpeg'
                ? 'image/jpeg'
                : 'image/png';
          logoDataUri = `data:${mime};base64,${fs
            .readFileSync(logoPath)
            .toString('base64')}`;
        } catch (err) {
          this.logger.warn(`Could not read organization logo: ${err}`);
        }
      }
    }

    const parentSection = report.parentSection as {
      message: string;
      homeSupport: string[];
    };
    const teacherSection = report.teacherSection as {
      analysis: string;
      skillGaps: string[];
      interventions: string[];
      resourceSuggestions: string[];
    };
    const managementSection = report.managementSection as {
      summary: string;
      classTrend: string;
      recommendation: string;
    };

    return {
      html: buildReportHtml({
        orgName: organization?.name ?? 'School',
        orgInitials: initials(organization?.name ?? 'School'),
        logoDataUri,
        studentName: student?.name ?? 'Student',
        alertType: alert?.type ?? 'ALERT',
        alertReason: alert?.reason ?? '',
        generatedAt: report.createdAt,
        parentSection,
        teacherSection,
        managementSection,
      }),
      filename: `${(student?.name ?? 'student').replace(/\s+/g, '-').toLowerCase()}-progress-report.html`,
    };
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
