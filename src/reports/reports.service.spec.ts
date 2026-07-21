import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { NotFoundException } from '@nestjs/common';

describe('ReportsService', () => {
  let service: ReportsService;

  const mockPrisma = {
    alert: {
      findUnique: jest.fn(),
    },
    studentReport: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const mockLlmService = {
    generateStructured: jest.fn(),
  };

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
        parentSection: 'Parent-friendly explanation',
        teacherSection: 'Detailed pedagogical analysis',
        managementSection: 'Administrative summary',
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
          parentSection: 'Parent-friendly explanation',
          teacherSection: 'Detailed pedagogical analysis',
          managementSection: 'Administrative summary',
        },
      });
      expect(result.id).toBe('report-id');
    });

    it('should throw NotFoundException when alert does not exist', async () => {
      mockPrisma.alert.findUnique.mockResolvedValue(null);

      await expect(
        service.generate('student-id', 'bad-alert-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
