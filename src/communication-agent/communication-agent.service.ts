import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DiagnosisSchema,
  TeacherStudentContentSchema,
  GuardianStudentContentSchema,
  TeacherFeedbackSchema,
  ManagementSummarySchema,
  type Diagnosis,
  type ClassContext,
  type TeacherStudentContent,
  type GuardianStudentContent,
  type TeacherFeedback,
  type ManagementSummary,
} from './dto';
import {
  createGetStudentProfileTool,
  createGetClassContextTool,
  createCreateAlertTool,
  type StudentProfileTool,
  type ClassContextTool,
  type CreateAlertTool,
} from './tools';

@Injectable()
export class CommunicationAgentService {
  private readonly logger = new Logger(CommunicationAgentService.name);
  private readonly getStudentProfileTool: StudentProfileTool;
  private readonly getClassContextTool: ClassContextTool;
  private readonly createAlertTool: CreateAlertTool;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly reportsService: ReportsService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.getStudentProfileTool = createGetStudentProfileTool(this.prisma);
    this.getClassContextTool = createGetClassContextTool(this.prisma);
    this.createAlertTool = createCreateAlertTool(this.prisma);
  }

  async analyze(submissionId: string): Promise<void> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: true, student: true },
    });
    if (!submission) {
      this.logger.warn(`Submission ${submissionId} not found`);
      return;
    }

    const studentId = submission.studentId;
    const classId = submission.assignment.classId;

    const confirmedCount = await this.prisma.gradingScore.count({
      where: {
        submission: { studentId },
        isConfirmed: true,
      },
    });

    if (confirmedCount < 2) {
      this.logger.debug(
        `Skipping analysis for ${studentId}: only ${confirmedCount} confirmed scores`,
      );
      return;
    }

    const profile = await this.getStudentProfileTool.execute({ studentId });

    let classContext: ClassContext | null = null;
    try {
      classContext = await this.getClassContextTool.execute({
        classId,
      });
    } catch (err) {
      this.logger.warn(`Could not fetch class context for ${classId}`, err);
    }

    const diagnosis = await this.llmService.generateStructured<Diagnosis>({
      systemPrompt:
        'You are an educational analyst. Analyze the student data and class context to determine if there is a ' +
        'performance issue and who it is attributed to. ' +
        'Return valid JSON with EXACTLY these fields:\n' +
        '{\n' +
        '  "hasIssue": true | false,\n' +
        '  "issueType": "STUDENT_ISSUE" | "CLASS_ISSUE" | "BOTH" | null,\n' +
        '  "severity": "LOW" | "MEDIUM" | "HIGH" | null,\n' +
        '  "summary": "string explaining the diagnosis" | null,\n' +
        '  "classContext": "string describing class context" | null\n' +
        '}\n' +
        'Do not omit any fields.',
      userPrompt: JSON.stringify({
        studentName: profile.studentName,
        recentGrades: profile.grades.slice(0, 5),
        attendance: profile.attendance.slice(0, 10),
        previousAlerts: profile.previousAlerts,
        classContext,
      }),
      schema: DiagnosisSchema,
    });

    this.logger.debug(
      `Diagnosis for ${studentId}: ${JSON.stringify(diagnosis)}`,
    );

    if (!diagnosis.hasIssue) {
      await this.prisma.studentAnalysis.create({
        data: {
          submissionId,
          studentId,
          classId,
          diagnosis: diagnosis,
        },
      });
      this.logger.log(`No issue detected for student ${studentId}`);
      return;
    }

    const hasStudentIssue =
      diagnosis.issueType === 'STUDENT_ISSUE' || diagnosis.issueType === 'BOTH';
    const hasTeacherIssue =
      diagnosis.issueType === 'CLASS_ISSUE' || diagnosis.issueType === 'BOTH';

    const [studentResult, teacherResult] = await Promise.all([
      hasStudentIssue
        ? this.handleStudentIssue(
            submissionId,
            studentId,
            classId,
            profile,
            diagnosis,
          )
        : null,
      hasTeacherIssue
        ? this.handleTeacherIssue(studentId, classId, diagnosis, classContext)
        : null,
    ]);

    await this.prisma.studentAnalysis.create({
      data: {
        submissionId,
        studentId,
        classId,
        alertId: studentResult?.alertId ?? null,
        diagnosis: diagnosis,
        teacherContent: studentResult?.teacherContent ?? undefined,
        guardianContent: studentResult?.guardianContent ?? undefined,
        teacherFeedback: teacherResult?.teacherFeedback ?? undefined,
        managementSummary: teacherResult?.managementSummary ?? undefined,
      },
    });
  }

  private async handleStudentIssue(
    submissionId: string,
    studentId: string,
    classId: string,
    profile: { studentName: string },
    diagnosis: Diagnosis,
  ): Promise<{
    alertId: string;
    teacherContent: TeacherStudentContent;
    guardianContent: GuardianStudentContent;
  }> {
    const [teacherContent, guardianContent] = await Promise.all([
      this.llmService.generateStructured<TeacherStudentContent>({
        systemPrompt:
          'You are a teacher advisor. Given a student diagnosis, provide detailed analysis, ' +
          'skill gaps, interventions, and resource suggestions. ' +
          'Return valid JSON with EXACTLY these fields:\n' +
          '{\n' +
          '  "analysis": "string with detailed analysis",\n' +
          '  "skillGaps": ["string array of identified skill gaps"],\n' +
          '  "interventions": ["string array of suggested interventions"],\n' +
          '  "resourceSuggestions": ["string array of recommended resources"]\n' +
          '}\n' +
          'Do not omit any fields.',
        userPrompt: JSON.stringify({
          studentName: profile.studentName,
          summary: diagnosis.summary,
          severity: diagnosis.severity,
          recentGrades: [],
        }),
        schema: TeacherStudentContentSchema,
      }),
      this.llmService.generateStructured<GuardianStudentContent>({
        systemPrompt:
          'You are a parent liaison. Given a student diagnosis, write an empathetic message ' +
          'and suggest home support strategies. ' +
          'Return valid JSON with EXACTLY these fields:\n' +
          '{\n' +
          '  "message": "string with empathetic message for the parent",\n' +
          '  "homeSupport": ["string array of home support strategies"]\n' +
          '}\n' +
          'Do not omit any fields.',
        userPrompt: JSON.stringify({
          studentName: profile.studentName,
          summary: diagnosis.summary,
        }),
        schema: GuardianStudentContentSchema,
      }),
    ]);

    const alert = await this.createAlertTool.execute({
      studentId,
      type: diagnosis.severity === 'HIGH' ? 'FAILING' : 'DOWNWARD_TREND',
      reason: diagnosis.summary ?? 'Performance issue detected by AI analysis',
    });

    const classEntity = classId
      ? await this.prisma.class.findUnique({ where: { id: classId } })
      : null;
    const teacherId = classEntity?.teacherId;

    if (teacherId) {
      const teacherBody = [
        `Analysis: ${teacherContent.analysis}`,
        `Skill gaps: ${teacherContent.skillGaps.join(', ')}`,
        `Interventions: ${teacherContent.interventions.join(', ')}`,
        `Resources: ${teacherContent.resourceSuggestions.join(', ')}`,
      ].join('\n');
      await this.notificationsService.notifyUser(
        teacherId,
        'AGENT_ALERT',
        `Student flagged: ${profile.studentName}`,
        teacherBody,
      );
    }

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
    });

    if (student?.guardianId) {
      await this.notificationsService.notifyUser(
        student.guardianId,
        'AGENT_ALERT',
        `Academic alert for ${profile.studentName}`,
        guardianContent.message,
      );
    }

    this.reportsService
      .generate(studentId, alert.alertId)
      .catch((err) =>
        this.logger.error(
          `Failed to generate report for alert ${alert.alertId}`,
          err,
        ),
      );

    return { alertId: alert.alertId, teacherContent, guardianContent };
  }

  private async handleTeacherIssue(
    studentId: string,
    classId: string,
    diagnosis: Diagnosis,
    classContext: ClassContext | null,
  ): Promise<{
    teacherFeedback: TeacherFeedback;
    managementSummary: ManagementSummary;
  } | null> {
    if (!classId) return null;
    const classEntity = await this.prisma.class.findUnique({
      where: { id: classId },
      include: { teacher: true },
    });
    if (!classEntity) return null;

    const [teacherFeedback, managementSummary] = await Promise.all([
      this.llmService.generateStructured<TeacherFeedback>({
        systemPrompt:
          'You are a peer coach for teachers. Given a class context showing potential teaching issues, ' +
          'provide constructive feedback, pattern analysis, and actionable strategies. ' +
          'Return valid JSON with EXACTLY these fields:\n' +
          '{\n' +
          '  "feedback": "string with constructive feedback",\n' +
          '  "patternAnalysis": "string describing observed patterns",\n' +
          '  "strategies": ["string array of actionable strategies"]\n' +
          '}\n' +
          'Do not omit any fields.',
        userPrompt: JSON.stringify({
          className: classContext?.className,
          averageScore: classContext?.averageScore,
          belowAverageCount: classContext?.belowAverageCount,
          totalStudents: classContext?.totalStudents,
        }),
        schema: TeacherFeedbackSchema,
      }),
      this.llmService.generateStructured<ManagementSummary>({
        systemPrompt:
          'You are a school management advisor. Given a class-level issue, provide a concise summary, ' +
          'class trend, and recommendation for administration. ' +
          'Return valid JSON with EXACTLY these fields:\n' +
          '{\n' +
          '  "summary": "string with concise summary",\n' +
          '  "classTrend": "string describing class trend over time",\n' +
          '  "recommendation": "string with recommendation for administration"\n' +
          '}\n' +
          'Do not omit any fields.',
        userPrompt: JSON.stringify({
          className: classContext?.className,
          averageScore: classContext?.averageScore,
          belowAverageCount: classContext?.belowAverageCount,
          totalStudents: classContext?.totalStudents,
        }),
        schema: ManagementSummarySchema,
      }),
    ]);

    await this.notificationsService.notifyUser(
      classEntity.teacherId,
      'AGENT_ALERT',
      `Class performance insight: ${classEntity.name}`,
      teacherFeedback.feedback,
    );

    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
    });

    for (const admin of admins) {
      await this.notificationsService.notifyUser(
        admin.id,
        'AGENT_ALERT',
        `Management summary: ${classEntity.name}`,
        managementSummary.summary,
      );
    }

    return { teacherFeedback, managementSummary };
  }
}
