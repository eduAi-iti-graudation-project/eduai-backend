import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';

describe('ReportsService', () => {
  let service: ReportsService;

  const mockPrisma = {
    alert: {
      findUnique: jest.fn(),
    },
    studentReport: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
  };

  const mockLlmService = {
    generateStructured: jest.fn(),
  };

  const userRow = (id: string, role: User['role']): User => ({
    id,
    authId: `${id}-auth`,
    email: `${id}@eduai.test`,
    name: id,
    role,
    gradeId: null,
    guardianId: null,
    organizationId: 'org-1',
    gender: null,
    avatarUrl: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    credentialEncrypted: null,
    verifyToken: null,
    verifyTokenExpiresAt: null,
    emailVerifiedAt: null,
    resetToken: null,
    resetTokenExpiresAt: null,
  });
  const teacher = userRow('teacher-1', 'TEACHER');
  const student = userRow('student-1', 'STUDENT');
  const guardian = userRow('guardian-1', 'GUARDIAN');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlmService },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    jest.clearAllMocks();
  });

  describe('generate', () => {
    it('should call LlmService with correct prompt shape and save report', async () => {
      const alert = {
        id: 'alert-id',
        type: 'FAILING',
        reason: 'Average score is 45%',
        status: 'ACTIVE',
        studentId: 'student-id',
        student: { id: 'student-id', name: 'John Doe' },
      };

      const llmResponse = {
        parentSection: {
          message: 'Parent-friendly explanation',
          homeSupport: ['Set a study routine', 'Review class notes weekly'],
        },
        teacherSection: {
          analysis: 'Detailed pedagogical analysis',
          skillGaps: ['Fractions'],
          interventions: ['Small group tutoring'],
          resourceSuggestions: ['Practice exercises'],
        },
        managementSection: {
          summary: 'Administrative summary',
          classTrend: 'Below class average',
          recommendation: 'Schedule a parent conference',
        },
      };

      mockPrisma.alert.findUnique.mockResolvedValue(alert);
      mockLlmService.generateStructured.mockResolvedValue(llmResponse);
      mockPrisma.studentReport.create.mockResolvedValue({
        id: 'report-id',
        studentId: 'student-id',
        alertId: 'alert-id',
        ...llmResponse,
      });

      const result = await service.generate('student-id', 'alert-id');

      expect(mockPrisma.alert.findUnique).toHaveBeenCalledWith({
        where: { id: 'alert-id' },
        include: { student: true },
      });

      expect(mockLlmService.generateStructured).toHaveBeenCalled();
      const calls = mockLlmService.generateStructured.mock.calls as Array<
        [{ systemPrompt: string; userPrompt: string }]
      >;
      const firstCall = calls[0][0];
      expect(firstCall.systemPrompt).toContain('educational report writer');
      expect(firstCall.userPrompt).toContain('John Doe');
      expect(mockPrisma.studentReport.create).toHaveBeenCalledWith({
        data: {
          studentId: 'student-id',
          alertId: 'alert-id',
          parentSection: llmResponse.parentSection,
          teacherSection: llmResponse.teacherSection,
          managementSection: llmResponse.managementSection,
        },
      });
      expect(result.id).toBe('report-id');
    });

    it('should throw when alert does not exist', async () => {
      mockPrisma.alert.findUnique.mockResolvedValue(null);

      await expect(
        service.generate('student-id', 'bad-alert-id'),
      ).rejects.toMatchObject({ code: 'ALERT_NOT_FOUND' });
    });
  });

  describe('findAll', () => {
    it('scopes a student to their own reports', async () => {
      mockPrisma.studentReport.findMany.mockResolvedValue([]);

      await service.findAll(student);

      expect(mockPrisma.studentReport.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('scopes a guardian to their linked children', async () => {
      mockPrisma.studentReport.findMany.mockResolvedValue([]);

      await service.findAll(guardian);

      expect(mockPrisma.studentReport.findMany).toHaveBeenCalledWith({
        where: { student: { guardianId: 'guardian-1' } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('scopes a guardian to a specific child', async () => {
      mockPrisma.studentReport.findMany.mockResolvedValue([]);

      await service.findAll(guardian, 'child-1');

      expect(mockPrisma.studentReport.findMany).toHaveBeenCalledWith({
        where: { student: { id: 'child-1', guardianId: 'guardian-1' } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('scopes a teacher to their organization', async () => {
      mockPrisma.studentReport.findMany.mockResolvedValue([]);

      await service.findAll(teacher, 'some-student');

      expect(mockPrisma.studentReport.findMany).toHaveBeenCalledWith({
        where: {
          student: { id: 'some-student', organizationId: 'org-1' },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns the report when accessible', async () => {
      const report = { id: 'r1', studentId: 'student-1' };
      mockPrisma.studentReport.findFirst.mockResolvedValue(report);

      const result = await service.findOne('r1', student);

      expect(result).toEqual(report);
      expect(mockPrisma.studentReport.findFirst).toHaveBeenCalledWith({
        where: { id: 'r1', studentId: 'student-1' },
      });
    });

    it('throws REPORT_NOT_FOUND for inaccessible reports', async () => {
      mockPrisma.studentReport.findFirst.mockResolvedValue(null);

      await expect(service.findOne('r1', student)).rejects.toMatchObject({
        code: 'REPORT_NOT_FOUND',
      });
    });
  });

  describe('getHtmlDocument', () => {
    const report = {
      id: 'r1',
      studentId: 'student-1',
      alertId: 'alert-1',
      createdAt: new Date('2026-08-18'),
      parentSection: {
        message: 'Parent update **45%**',
        homeSupport: ['Routine'],
      },
      teacherSection: {
        analysis: 'Detailed analysis',
        skillGaps: ['Fractions'],
        interventions: ['Tutoring'],
        resourceSuggestions: ['Exercises'],
      },
      managementSection: {
        summary: 'Summary',
        classTrend: 'Trend',
        recommendation: 'Recommendation',
      },
    };

    beforeEach(() => {
      mockPrisma.studentReport.findFirst.mockResolvedValue(report);
      mockPrisma.user.findUnique.mockResolvedValue({
        name: 'John Doe',
        organizationId: 'org-1',
      });
      mockPrisma.alert.findUnique.mockResolvedValue({
        type: 'FAILING',
        reason: 'Average dropped to **45%**',
      });
    });

    it('builds an HTML document with school and student names', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        name: 'Green Hills Academy',
        logoUrl: null,
      });

      const doc = await service.getHtmlDocument('r1', teacher);

      expect(doc.html).toContain('<!DOCTYPE html>');
      expect(doc.html).toContain('Green Hills Academy');
      expect(doc.html).toContain('John Doe');
      expect(doc.filename).toBe('john-doe-progress-report.html');
      expect(mockPrisma.studentReport.findFirst).toHaveBeenCalledWith({
        where: { id: 'r1', student: { organizationId: 'org-1' } },
      });
    });

    it('uses the monogram fallback when the organization has no logo', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        name: 'Green Hills Academy',
        logoUrl: null,
      });

      const doc = await service.getHtmlDocument('r1', teacher);

      expect(doc.html).toContain('logo-fallback');
      expect(doc.html).toContain('GH');
      expect(doc.html).not.toContain('data:image');
    });

    it('rejects when the report is inaccessible', async () => {
      mockPrisma.studentReport.findFirst.mockResolvedValue(null);

      await expect(
        service.getHtmlDocument('r1', student),
      ).rejects.toMatchObject({ code: 'REPORT_NOT_FOUND' });
    });
  });
});
