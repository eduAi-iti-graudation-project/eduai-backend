import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

jest.mock('pdf-parse', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import pdfParse from 'pdf-parse';
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
    it('should create a submission with chunked content', async () => {
      const dto = {
        assignmentId: 'assignment-id',
        content: 'Student submission text.',
      };

      const createdSubmission = {
        id: 'submission-id',
        assignmentId: dto.assignmentId,
        studentId: '',
      };

      mockPrisma.submission.create.mockResolvedValue(createdSubmission);
      mockPrisma.submissionChunk.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.submission.findUnique.mockResolvedValue({
        ...createdSubmission,
        chunks: [
          {
            id: 'chunk-id',
            submissionId: 'submission-id',
            content: dto.content,
          },
        ],
        scores: [],
      });

      const result: unknown = await service.create(dto);

      expect(mockPrisma.submission.create).toHaveBeenCalledWith({
        data: {
          assignmentId: dto.assignmentId,
          studentId: '00000000-0000-0000-0000-000000000000',
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
      expect(result.chunks).toHaveLength(1);
    });
  });

  describe('createFromPdf', () => {
    beforeEach(() => {
      mockPdfParse.mockReset();
    });

    it('should parse PDF and create submission with extracted text', async () => {
      const assignmentId = 'assign-1';
      const pdfText = 'Extracted PDF content for grading.';
      mockPdfParse.mockResolvedValue({ text: pdfText });

      mockPrisma.submission.create.mockResolvedValue({
        id: 'sub-id',
        assignmentId,
        studentId: '',
      });
      mockPrisma.submissionChunk.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.submission.findUnique.mockResolvedValue({
        id: 'sub-id',
        assignmentId,
        studentId: '',
        chunks: [{ id: 'chunk-id', submissionId: 'sub-id', content: pdfText }],
        scores: [],
      });

      const result = await service.createFromPdf(
        Buffer.from('fake pdf'),
        assignmentId,
      );

      expect(mockPdfParse).toHaveBeenCalledWith(Buffer.from('fake pdf'));
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].content).toBe(pdfText);
    });

    it('should throw BadRequestException when PDF has no text', async () => {
      mockPdfParse.mockResolvedValue({ text: '' });

      await expect(
        service.createFromPdf(Buffer.from('empty'), 'assign-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when pdf-parse fails', async () => {
      mockPdfParse.mockRejectedValue(new Error('Corrupt PDF'));

      await expect(
        service.createFromPdf(Buffer.from('bad'), 'assign-1'),
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
