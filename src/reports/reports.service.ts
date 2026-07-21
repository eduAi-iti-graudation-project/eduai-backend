import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { ReportGenerateSchema } from './dto';

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
    if (!alert) throw new NotFoundException('Alert not found');

    const { parentSection, teacherSection, managementSection } =
      await this.llmService.generateStructured({
        systemPrompt:
          'You are an educational report writer. Given an alert about a student, ' +
          'generate three distinct sections explaining the situation for different audiences.',
        userPrompt:
          `Student: ${alert.student.name}\n` +
          `Alert type: ${alert.type}\n` +
          `Reason: ${alert.reason}\n\n` +
          'Generate three sections:\n' +
          '1. parentSection: Explanation for parents (empathetic, constructive)\n' +
          '2. teacherSection: Detailed pedagogical analysis for teachers\n' +
          '3. managementSection: Administrative summary for school management',
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

  async findAll(studentId?: string) {
    const where: Record<string, unknown> = {};
    if (studentId) where.studentId = studentId;
    return this.prisma.studentReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const report = await this.prisma.studentReport.findUnique({
      where: { id },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }
}
