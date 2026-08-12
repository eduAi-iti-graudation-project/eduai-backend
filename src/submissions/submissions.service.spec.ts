import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from '../grading/grading.service';
import { NotificationsService } from '../notifications/notifications.service';
import pdfParse from 'pdf-parse';

jest.mock('pdf-parse');
const mockPdfParse = pdfParse as jest.Mock;

describe('SubmissionsService', () => {
  let service: SubmissionsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    assignment: {
      findFirst: jest.fn(),
    },
    submission: {
      create: jest.fn(),
      findFirst: jest.fn(),
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

      mockPrisma.assignment.findFirst.mockResolvedValue({
        id: dto.assignmentId,
      });
      mockPrisma.submission.create.mockResolvedValue(createdSubmission);
      mockPrisma.submissionChunk.createMany.mockResolvedValue({ count: 1 });

      const result = await service.create(dto, studentId, organizationId);

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

      mockPrisma.assignment.findFirst.mockResolvedValue({
        id: dto.assignmentId,
      });
      mockPrisma.submission.create.mockResolvedValue(createdSubmission);
      mockPrisma.submissionChunk.createMany.mockResolvedValue({ count: 1 });

      const result = await service.create(dto, studentId, organizationId);

      expect(mockGradingService.gradeSubmission).toHaveBeenCalled();
      expect(result).not.toHaveProperty('scores');
    });

    it('should reject a duplicate submission for the same assignment', async () => {
      const dto = {
        assignmentId: 'assignment-id',
        content: 'A second attempt.',
      };

      mockPrisma.assignment.findFirst.mockResolvedValue({
        id: dto.assignmentId,
      });
      mockPrisma.submission.findFirst.mockResolvedValue({
        id: 'existing-submission',
        assignmentId: dto.assignmentId,
        studentId,
        status: 'SUBMITTED',
      });

      await expect(
        service.create(dto, studentId, organizationId),
      ).rejects.toMatchObject({ code: 'SUBMISSION_ALREADY_EXISTS' });

      expect(mockPrisma.submission.findFirst).toHaveBeenCalledWith({
        where: { assignmentId: dto.assignmentId, studentId },
      });
      expect(mockPrisma.submission.create).not.toHaveBeenCalled();
    });
  });

  describe('createFromPdf', () => {
    beforeEach(() => {
      mockPdfParse.mockReset();
      mockPrisma.submission.findFirst.mockReset();
    });

    it('should parse PDF and create submission with extracted text', async () => {
      const studentId = 'test-student-id';
      const assignmentId = 'assign-1';
      const pdfText = 'Extracted PDF content for grading.';
      mockPdfParse.mockResolvedValue({ text: pdfText });

      mockPrisma.assignment.findFirst.mockResolvedValue({ id: assignmentId });
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
        organizationId,
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
        service.createFromPdf(
          Buffer.from('empty'),
          'assign-1',
          studentId,
          organizationId,
        ),
      ).rejects.toMatchObject({ code: 'PDF_NO_TEXT' });
    });

    it('should throw BadRequestException when pdf-parse fails', async () => {
      const studentId = 'test-student-id';
      mockPdfParse.mockRejectedValue(new Error('Corrupt PDF'));

      await expect(
        service.createFromPdf(
          Buffer.from('bad'),
          'assign-1',
          studentId,
          organizationId,
        ),
      ).rejects.toMatchObject({ code: 'PDF_NO_TEXT' });
    });
  });

  describe('findAll', () => {
    it('should return submissions with student and scores', async () => {
      const mockSubmissions = [
        { id: '1', student: {}, scores: [] },
        { id: '2', student: {}, scores: [] },
      ];
      mockPrisma.submission.findMany.mockResolvedValue(mockSubmissions);

      const result = await service.findAll(
        undefined,
        undefined,
        organizationId,
      );
      expect(result).toEqual(mockSubmissions);
      expect(mockPrisma.submission.findMany).toHaveBeenCalledWith({
        where: { assignment: { offering: { organizationId } } },
        include: {
          student: true,
          assignment: true,
          scores: { include: { criteria: true } },
        },
      });
    });

    it('should filter by status and assignmentId', async () => {
      mockPrisma.submission.findMany.mockResolvedValue([]);
      await service.findAll('SUBMITTED', 'assignment-id', organizationId);

      expect(mockPrisma.submission.findMany).toHaveBeenCalledWith({
        where: {
          status: 'SUBMITTED',
          assignmentId: 'assignment-id',
          assignment: { offering: { organizationId } },
        },
        include: {
          student: true,
          assignment: true,
          scores: { include: { criteria: true } },
        },
      });
    });
  });

  describe('findMine', () => {
    it("returns the student's submissions, optionally filtered by assignment", async () => {
      mockPrisma.submission.findMany.mockResolvedValue([
        { id: 's1', assignmentId: 'a1', status: 'SUBMITTED' },
      ]);

      const result = await service.findMine('student-1');

      expect(result).toEqual([
        { id: 's1', assignmentId: 'a1', status: 'SUBMITTED' },
      ]);
      expect(mockPrisma.submission.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        select: { id: true, assignmentId: true, status: true },
        orderBy: { createdAt: 'desc' },
      });

      await service.findMine('student-1', 'a1');

      expect(mockPrisma.submission.findMany).toHaveBeenLastCalledWith({
        where: { studentId: 'student-1', assignmentId: 'a1' },
        select: { id: true, assignmentId: true, status: true },
        orderBy: { createdAt: 'desc' },
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
      mockPrisma.submission.findFirst.mockResolvedValue(submission);

      const result = await service.findOne('id', organizationId);
      expect(result).toEqual(submission);
    });

    it('should throw when submission not found', async () => {
      mockPrisma.submission.findFirst.mockResolvedValue(null);
      await expect(
        service.findOne('bad-id', organizationId),
      ).rejects.toMatchObject({ code: 'SUBMISSION_NOT_FOUND' });
    });

    it('should throw when the submission belongs to another organization', async () => {
      mockPrisma.submission.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('org-b-submission', organizationId),
      ).rejects.toMatchObject({ code: 'SUBMISSION_NOT_FOUND' });
      expect(mockPrisma.submission.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'org-b-submission',
          assignment: { offering: { organizationId } },
        },
        include: expect.any(Object) as object,
      });
    });
  });
});
