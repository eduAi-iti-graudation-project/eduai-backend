import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from '../grading/grading.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotFoundException } from '@nestjs/common';

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
    it('should create a submission and fire grading in background', async () => {
      const dto = {
        assignmentId: 'assignment-id',
        content: 'Student submission text.',
      };

      const createdSubmission = {
        id: 'submission-id',
        assignmentId: dto.assignmentId,
        studentId: '',
        status: 'SUBMITTED',
      };

      mockPrisma.submission.create.mockResolvedValue(createdSubmission);
      mockPrisma.submissionChunk.createMany.mockResolvedValue({ count: 1 });

      const result = await service.create(dto);

      expect(mockPrisma.submission.create).toHaveBeenCalledWith({
        data: { assignmentId: dto.assignmentId, studentId: '' },
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
        studentId: '',
        status: 'SUBMITTED',
      };

      mockPrisma.submission.create.mockResolvedValue(createdSubmission);
      mockPrisma.submissionChunk.createMany.mockResolvedValue({ count: 1 });

      const result = await service.create(dto);

      expect(mockGradingService.gradeSubmission).toHaveBeenCalled();
      expect(result).not.toHaveProperty('scores');
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
