import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
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
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SubmissionsService>(SubmissionsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a submission with a chunk', async () => {
      const dto = {
        assignmentId: 'assignment-id',
        content: 'Student submission text',
      };

      const createdSubmission = {
        id: 'submission-id',
        assignmentId: dto.assignmentId,
        studentId: '',
      };
      const createdChunk = {
        id: 'chunk-id',
        submissionId: 'submission-id',
        content: dto.content,
      };

      mockPrisma.submission.create.mockResolvedValue(createdSubmission);
      mockPrisma.submissionChunk.create.mockResolvedValue(createdChunk);
      mockPrisma.submission.findUnique.mockResolvedValue({
        ...createdSubmission,
        chunks: [createdChunk],
        scores: [],
      });

      const result = await service.create(dto);

      expect(mockPrisma.submission.create).toHaveBeenCalledWith({
        data: { assignmentId: dto.assignmentId, studentId: '' },
      });
      expect(mockPrisma.submissionChunk.create).toHaveBeenCalledWith({
        data: { submissionId: 'submission-id', content: dto.content },
      });
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].content).toBe(dto.content);
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
