import { ApiError } from '../common/errors/api-error';
import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';

describe('StudentsService', () => {
  let service: StudentsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    gradingScore: {
      findMany: jest.fn(),
    },
    submission: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    studentDocument: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockDocumentsService = {
    storeFile: jest.fn(),
    extractText: jest.fn(),
    suggestCategory: jest.fn(),
    createSignedUrl: jest.fn(),
    removeFromStorage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DocumentsService, useValue: mockDocumentsService },
      ],
    }).compile();

    service = module.get<StudentsService>(StudentsService);
    jest.clearAllMocks();
  });

  describe('getSubmissionGrades', () => {
    const studentId = 'student-uuid';
    const submissionId = 'sub-1';

    it('should return grades filtered by student and submission', async () => {
      mockPrisma.submission.findFirst.mockResolvedValue({
        id: submissionId,
        studentId,
        assignmentId: 'a-1',
      });
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        {
          id: 's1',
          submissionId,
          criteriaId: 'c1',
          pointsAwarded: 8,
          aiFeedback: null,
          teacherNotes: null,
          isConfirmed: true,
          createdAt: new Date(),
          criteria: { id: 'c1', description: 'Thesis', maxPoints: 10 },
        },
      ]);

      const result = await service.getSubmissionGrades(
        studentId,
        submissionId,
        organizationId,
      );

      expect(mockPrisma.gradingScore.findMany).toHaveBeenCalledWith({
        where: { submissionId, isConfirmed: true },
        include: { criteria: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        assignmentId: 'a-1',
        criterionDescription: 'Thesis',
        criterionMaxPoints: 10,
      });
    });

    it('should throw if submission does not belong to student', async () => {
      mockPrisma.submission.findFirst.mockResolvedValue(null);

      try {
        await service.getSubmissionGrades(
          studentId,
          submissionId,
          organizationId,
        );
        expect('should have thrown').toBe('but did not');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('SUBMISSION_NOT_FOUND');
      }

      expect(mockPrisma.submission.findFirst).toHaveBeenCalledWith({
        where: { id: submissionId, studentId, student: { organizationId } },
      });
    });

    it('should throw if submission does not exist', async () => {
      mockPrisma.submission.findFirst.mockResolvedValue(null);

      try {
        await service.getSubmissionGrades(
          studentId,
          submissionId,
          organizationId,
        );
        expect('should have thrown').toBe('but did not');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('SUBMISSION_NOT_FOUND');
      }
    });
  });

  describe('getGrades', () => {
    const studentId = 'student-uuid';

    it('should only return confirmed grades', async () => {
      const confirmedScore = {
        id: 's1',
        pointsAwarded: 9,
        isConfirmed: true,
        criteria: { id: 'c1' },
        submission: { id: 'sub-1' },
      };
      mockPrisma.gradingScore.findMany.mockResolvedValue([confirmedScore]);

      const result = await service.getGrades(studentId, organizationId);

      expect(mockPrisma.gradingScore.findMany).toHaveBeenCalledWith({
        where: {
          submission: { studentId, student: { organizationId } },
          isConfirmed: true,
        },
        include: { criteria: true, submission: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].isConfirmed).toBe(true);
    });

    it('should exclude unconfirmed grades', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([]);

      const result = await service.getGrades(studentId, organizationId);

      expect(result).toHaveLength(0);
      expect(mockPrisma.gradingScore.findMany).toHaveBeenCalledWith({
        where: {
          submission: { studentId, student: { organizationId } },
          isConfirmed: true,
        },
        include: { criteria: true, submission: true },
      });
    });

    it('should return empty array when student has no grades', async () => {
      mockPrisma.gradingScore.findMany.mockResolvedValue([]);

      const result = await service.getGrades(studentId, organizationId);

      expect(result).toEqual([]);
    });

    it('should flatten criteria and submission into the grade object', async () => {
      const grade = {
        id: 's1',
        submissionId: 'sub-1',
        criteriaId: 'c1',
        pointsAwarded: 8,
        aiFeedback: null,
        teacherNotes: null,
        isConfirmed: true,
        createdAt: new Date(),
        criteria: { id: 'c1', description: 'Thesis', maxPoints: 10 },
        submission: { id: 'sub-1', assignmentId: 'a-1' },
      };
      mockPrisma.gradingScore.findMany.mockResolvedValue([grade]);

      const result = await service.getGrades(studentId, organizationId);

      expect(result[0]).toMatchObject({
        assignmentId: 'a-1',
        criterionDescription: 'Thesis',
        criterionMaxPoints: 10,
        criteriaId: 'c1',
      });
      expect(result[0]).not.toHaveProperty('submission');
      expect(result[0]).not.toHaveProperty('criteria');
    });
  });

  describe('student documents', () => {
    const studentId = 'student-uuid';
    const ownStudent = {
      id: studentId,
      role: 'STUDENT',
      organizationId,
      grade: null,
      guardian: null,
      enrollments: [],
    };

    describe('getDocuments', () => {
      it('should reject documents of a student in another organization', async () => {
        mockPrisma.user.findFirst.mockImplementation(
          ({ where }: { where: { organizationId: string } }) =>
            where.organizationId === 'org-2' ? ownStudent : null,
        );

        try {
          await service.getDocuments(studentId, organizationId);
          throw new Error('expected getDocuments to throw');
        } catch (err) {
          expect(err).toBeInstanceOf(ApiError);
          expect((err as ApiError).code).toBe('STUDENT_NOT_FOUND');
        }
        expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: studentId, role: 'STUDENT', organizationId },
          }),
        );
        expect(mockPrisma.studentDocument.findMany).not.toHaveBeenCalled();
      });

      it('should list documents for a student in the organization', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(ownStudent);
        mockPrisma.studentDocument.findMany.mockResolvedValue([
          { id: 'd1', title: 'Birth certificate' },
        ]);

        const result = await service.getDocuments(studentId, organizationId);

        expect(mockPrisma.studentDocument.findMany).toHaveBeenCalledWith({
          where: { studentId },
          orderBy: { createdAt: 'desc' },
          include: { uploadedBy: { select: { id: true, name: true } } },
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          id: 'd1',
          title: 'Birth certificate',
        });
      });
    });

    describe('createDocument', () => {
      const file = {
        buffer: Buffer.from('pdf-bytes'),
        originalname: 'birth.pdf',
        mimetype: 'application/pdf',
        size: 100,
      };

      it('should store the file and classify when no category is given', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(ownStudent);
        mockDocumentsService.storeFile.mockResolvedValue(
          'documents/org-1/abc-birth.pdf',
        );
        mockDocumentsService.extractText.mockResolvedValue('extracted text');
        mockDocumentsService.suggestCategory.mockResolvedValue(
          'BIRTH_CERTIFICATE',
        );
        mockPrisma.studentDocument.create.mockResolvedValue({
          id: 'd1',
          studentId,
          organizationId,
          category: 'OTHER',
          aiSuggestedCategory: 'BIRTH_CERTIFICATE',
        });

        const result = await service.createDocument(
          studentId,
          organizationId,
          'admin-1',
          file,
          {
            title: 'Birth certificate',
          },
        );

        expect(mockDocumentsService.storeFile).toHaveBeenCalledWith(
          organizationId,
          file.buffer,
          'birth.pdf',
          'application/pdf',
        );
        expect(mockDocumentsService.suggestCategory).toHaveBeenCalledWith(
          'extracted text',
        );
        expect(mockPrisma.studentDocument.create).toHaveBeenCalledWith({
          data: {
            studentId,
            organizationId,
            uploadedById: 'admin-1',
            category: 'OTHER',
            title: 'Birth certificate',
            academicYear: null,
            fileName: 'birth.pdf',
            fileUrl: 'documents/org-1/abc-birth.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 100,
            aiSuggestedCategory: 'BIRTH_CERTIFICATE',
          },
        });
        expect(result).toMatchObject({ id: 'd1' });
      });

      it('should not run classification when a category is given', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(ownStudent);
        mockDocumentsService.storeFile.mockResolvedValue(
          'documents/org-1/abc-birth.pdf',
        );
        mockPrisma.studentDocument.create.mockResolvedValue({ id: 'd1' });

        await service.createDocument(
          studentId,
          organizationId,
          'admin-1',
          file,
          {
            title: 'Report card',
            category: 'OTHER',
          },
        );

        expect(mockDocumentsService.extractText).not.toHaveBeenCalled();
        expect(mockDocumentsService.suggestCategory).not.toHaveBeenCalled();
      });
    });
  });
});
