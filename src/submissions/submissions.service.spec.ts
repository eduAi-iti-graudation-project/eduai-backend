import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from '../grading/grading.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import pdfParse from 'pdf-parse';

jest.mock('pdf-parse');
const mockPdfParse = pdfParse as jest.Mock;

describe('SubmissionsService', () => {
  let service: SubmissionsService;

  const mockPrisma = {
    submission: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    submissionChunk: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
  };

  const mockGradingService = {
    gradeSubmission: jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined),
  };

  const mockNotificationService = {
    notifyTeacher: jest
      .fn<Promise<void>, [unknown, string]>()
      .mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GradingService, useValue: mockGradingService },
        { provide: NotificationsService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<SubmissionsService>(SubmissionsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    const studentId = 'test-student-id';

    it('should create a submission and fire grading in background', async () => {
      const dto = {
        assignmentId: 'assignment-id',
        content: 'Student submission text.',
      };

      const createdSubmission = {
        id: 'submission-id',
        assignmentId: dto.assignmentId,
        studentId,
        status: 'SUBMITTED',
      };

      mockPrisma.submission.create.mockResolvedValue(createdSubmission);
      mockPrisma.submissionChunk.createMany.mockResolvedValue({ count: 1 });

      const result = await service.create(dto, studentId);

      expect(mockPrisma.submission.create).toHaveBeenCalledWith({
        data: {
          assignmentId: dto.assignmentId,
          studentId,
        },
      });
      expect(mockPrisma.submissionChunk.createMany).toHaveBeenCalledWith({
        data: [
          {
            submissionId: 'submission-id',
            content: expect.any(String) as string,
          },
        ],
      });

      expect(mockGradingService.gradeSubmission).toHaveBeenCalledWith(
        'submission-id',
      );
      expect(result).toEqual({
        id: 'submission-id',
        status: 'SUBMITTED',
        assignmentId: 'assignment-id',
      });
    });

    it('should not await grading result - returns immediately', async () => {
      const dto = {
        assignmentId: 'assignment-id',
        content: 'Student submission text.',
      };

      const createdSubmission = {
        id: 'submission-id',
        assignmentId: dto.assignmentId,
        studentId,
        status: 'SUBMITTED',
      };

      mockPrisma.submission.create.mockResolvedValue(createdSubmission);
      mockPrisma.submissionChunk.createMany.mockResolvedValue({ count: 1 });

      const result = await service.create(dto, studentId);

      expect(mockGradingService.gradeSubmission).toHaveBeenCalled();
      expect(result).not.toHaveProperty('scores');
    });
  });

  describe('createFromPdf', () => {
    beforeEach(() => {
      mockPdfParse.mockReset();
    });

    it('should parse PDF and create submission with extracted text', async () => {
      const studentId = 'test-student-id';
      const assignmentId = 'assign-1';
      const pdfText = 'Extracted PDF content for grading.';
      mockPdfParse.mockResolvedValue({ text: pdfText });

      mockPrisma.submission.create.mockResolvedValue({
        id: 'sub-id',
        assignmentId,
        studentId: '',
        status: 'SUBMITTED',
      });
      mockPrisma.submissionChunk.createMany.mockResolvedValue({ count: 1 });

      const result = await service.createFromPdf(
        Buffer.from('fake pdf'),
        assignmentId,
        studentId,
      );

      expect(mockPdfParse).toHaveBeenCalledWith(Buffer.from('fake pdf'));
      expect(result).toEqual({
        id: 'sub-id',
        status: 'SUBMITTED',
        assignmentId,
      });
    });

    it('should throw BadRequestException when PDF has no text', async () => {
      const studentId = 'test-student-id';
      mockPdfParse.mockResolvedValue({ text: '' });

      await expect(
        service.createFromPdf(Buffer.from('empty'), 'assign-1', studentId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when pdf-parse fails', async () => {
      const studentId = 'test-student-id';
      mockPdfParse.mockRejectedValue(new Error('Corrupt PDF'));

      await expect(
        service.createFromPdf(Buffer.from('bad'), 'assign-1', studentId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('should return submissions with student and scores', async () => {
      const mockSubmissions = [
        { id: '1', student: {}, scores: [] },
        { id: '2', student: {}, scores: [] },
      ];
      mockPrisma.submission.findMany.mockResolvedValue(mockSubmissions);

      const result = await service.findAll();
      expect(result).toEqual(mockSubmissions);
      expect(mockPrisma.submission.findMany).toHaveBeenCalledWith({
        where: {},
        include: { student: true, scores: { include: { criteria: true } } },
      });
    });

    it('should filter by status and assignmentId', async () => {
      mockPrisma.submission.findMany.mockResolvedValue([]);
      await service.findAll('SUBMITTED', 'assignment-id');

      expect(mockPrisma.submission.findMany).toHaveBeenCalledWith({
        where: { status: 'SUBMITTED', assignmentId: 'assignment-id' },
        include: { student: true, scores: { include: { criteria: true } } },
      });
    });
  });

  describe('findOne', () => {
    it('should return submission by id', async () => {
      const submission = {
        id: 'id',
        student: {},
        assignment: {},
        scores: [],
        chunks: [],
      };
      mockPrisma.submission.findUnique.mockResolvedValue(submission);

      const result = await service.findOne('id');
      expect(result).toEqual(submission);
    });

    it('should throw when submission not found', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
