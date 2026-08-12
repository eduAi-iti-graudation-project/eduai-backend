import { Test, TestingModule } from '@nestjs/testing';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { SupabaseService } from '../auth/supabase.service';
import { ApiError } from '../common/errors/api-error';

describe('DocumentsService', () => {
  let service: DocumentsService;

  const organizationId = 'org-1';

  const storage = {
    upload: jest.fn(),
    createSignedUrl: jest.fn(),
    remove: jest.fn(),
  };

  const mockSupabase = {
    getClient: jest.fn(() => ({ storage: { from: jest.fn(() => storage) } })),
  };

  const mockPrisma = {
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    studentDocument: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockLlm = {
    generateStructured: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  const file = (name = 'birth.pdf') =>
    ({
      buffer: Buffer.from('pdf'),
      originalname: name,
      mimetype: 'application/pdf',
      size: 3,
    }) as Express.Multer.File;

  describe('suggestCategory', () => {
    it('should return a category inside the enum', async () => {
      mockLlm.generateStructured.mockResolvedValue({
        category: 'IMMUNIZATION_RECORD',
      });

      const result = await service.suggestCategory('some document text');

      expect(result).toBe('IMMUNIZATION_RECORD');
    });

    it('should return null instead of passing through a value outside the enum', async () => {
      mockLlm.generateStructured.mockImplementation(
        ({ schema }: { schema: { parse: (v: unknown) => unknown } }) => {
          try {
            return schema.parse({ category: 'NOT_A_REAL_CATEGORY' });
          } catch {
            throw new Error('schema validation failed after retry');
          }
        },
      );

      const result = await service.suggestCategory('some document text');

      expect(result).toBeNull();
    });

    it('should return null when the LLM keeps failing after retries', async () => {
      mockLlm.generateStructured.mockRejectedValue(new Error('provider down'));

      const result = await service.suggestCategory('some document text');

      expect(result).toBeNull();
    });
  });

  describe('extractPrintedName', () => {
    it('should return the extracted name', async () => {
      mockLlm.generateStructured.mockResolvedValue({
        studentName: 'Aya Hassan',
      });

      const result = await service.extractPrintedName('report text');

      expect(result).toBe('Aya Hassan');
    });

    it('should return null when no name is found or the call fails', async () => {
      mockLlm.generateStructured.mockRejectedValue(new Error('provider down'));

      const result = await service.extractPrintedName('report text');

      expect(result).toBeNull();
    });
  });

  describe('matchStudent', () => {
    it('should match exactly with confidence 1', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 's1', name: 'Aya Hassan' },
        { id: 's2', name: 'Omar Ali' },
      ]);

      const result = await service.matchStudent('aya hassan', organizationId);

      expect(result).toEqual({ studentId: 's1', confidence: 1 });
    });

    it('should match on token overlap above the threshold', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 's1', name: 'Aya Hassan Ibrahim Mohamed' },
        { id: 's2', name: 'Omar Ali' },
      ]);

      const result = await service.matchStudent(
        'Aya Hassan Ibrahim',
        organizationId,
      );

      expect(result).not.toBeNull();
      expect(result?.studentId).toBe('s1');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('should return null instead of a low-confidence guess', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 's1', name: 'Mahmoud Sayed' },
        { id: 's2', name: 'Omar Ali' },
      ]);

      const result = await service.matchStudent('Aya Hassan', organizationId);

      expect(result).toBeNull();
    });

    it('should not query when the name is empty', async () => {
      const result = await service.matchStudent('', organizationId);

      expect(result).toBeNull();
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('bulkUpload', () => {
    it('should reject when no files are attached', async () => {
      try {
        await service.bulkUpload([], organizationId, 'admin-1');
        throw new Error('expected bulkUpload to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('BULK_UPLOAD_EMPTY');
      }
      expect(mockPrisma.studentDocument.create).not.toHaveBeenCalled();
    });

    it('should create unassigned rows with AI suggestions', async () => {
      storage.upload.mockResolvedValue({ error: null });
      jest.spyOn(service, 'extractText').mockResolvedValue('document text');
      mockLlm.generateStructured
        .mockResolvedValueOnce({ category: 'BIRTH_CERTIFICATE' })
        .mockResolvedValueOnce({ studentName: 'Aya Hassan' });
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 's1', name: 'Aya Hassan' },
      ]);
      mockPrisma.studentDocument.create.mockResolvedValue({
        id: 'd1',
        organizationId,
        studentId: null,
        category: 'OTHER',
        fileName: 'birth.pdf',
        aiSuggestedCategory: 'BIRTH_CERTIFICATE',
        aiSuggestedStudentId: 's1',
        aiMatchConfidence: 1,
      });

      const result = await service.bulkUpload(
        [file()],
        organizationId,
        'admin-1',
      );

      expect(result.created).toHaveLength(1);
      expect(result.created[0]).toMatchObject({
        studentId: null,
        aiSuggestedCategory: 'BIRTH_CERTIFICATE',
        aiSuggestedStudentId: 's1',
        aiMatchConfidence: 1,
      });
      expect(mockPrisma.studentDocument.create).toHaveBeenCalledTimes(1);
      const createCall = mockPrisma.studentDocument.create.mock
        .calls[0] as unknown as [{ data: Record<string, unknown> }];
      expect(createCall[0].data).toMatchObject({
        organizationId,
        studentId: null,
        category: 'OTHER',
        uploadedById: 'admin-1',
      });
      expect(result.failed).toEqual([]);
    });

    it('should keep a failed file in the failed list instead of crashing', async () => {
      storage.upload.mockResolvedValueOnce({ error: null });
      storage.upload.mockRejectedValueOnce(new Error('storage down'));
      mockPrisma.studentDocument.create.mockResolvedValue({
        id: 'd1',
        studentId: null,
        category: 'OTHER',
      });

      const result = await service.bulkUpload(
        [file('ok.pdf'), file('bad.pdf')],
        organizationId,
        'admin-1',
      );

      expect(result.created).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({ fileName: 'bad.pdf' });
    });
  });

  describe('confirmAssignment', () => {
    it('should be the only path that assigns a student to a bulk document', async () => {
      mockPrisma.studentDocument.findFirst.mockResolvedValue({
        id: 'd1',
        organizationId,
      });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.studentDocument.update.mockResolvedValue({
        id: 'd1',
        studentId: 's1',
        category: 'BIRTH_CERTIFICATE',
      });

      const result = await service.confirmAssignment('d1', organizationId, {
        studentId: 's1',
        category: 'BIRTH_CERTIFICATE',
      });

      expect(result).toMatchObject({ studentId: 's1' });
      expect(mockPrisma.studentDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            studentId: 's1',
            category: 'BIRTH_CERTIFICATE',
            aiSuggestedStudentId: null,
            aiMatchConfidence: null,
            aiSuggestedCategory: null,
          },
        }),
      );
    });

    it('should reject documents from another organization', async () => {
      mockPrisma.studentDocument.findFirst.mockResolvedValue(null);

      try {
        await service.confirmAssignment('d1', organizationId, {
          studentId: 's1',
          category: 'OTHER',
        });
        throw new Error('expected confirmAssignment to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('DOCUMENT_NOT_FOUND');
      }
    });

    it('should reject students outside the organization', async () => {
      mockPrisma.studentDocument.findFirst.mockResolvedValue({
        id: 'd1',
        organizationId,
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);

      try {
        await service.confirmAssignment('d1', organizationId, {
          studentId: 'other-org-student',
          category: 'OTHER',
        });
        throw new Error('expected confirmAssignment to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('DOCUMENT_ASSIGNMENT_NOT_FOUND');
      }
      expect(mockPrisma.studentDocument.update).not.toHaveBeenCalled();
    });
  });

  describe('listBulk', () => {
    it('should only list unassigned documents of the organization', async () => {
      mockPrisma.studentDocument.findMany.mockResolvedValue([{ id: 'd1' }]);

      const result = await service.listBulk(organizationId);

      expect(mockPrisma.studentDocument.findMany).toHaveBeenCalledWith({
        where: { organizationId, studentId: null },
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: { select: { id: true, name: true } },
          aiSuggestedStudent: {
            select: { id: true, name: true, email: true },
          },
        },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('extractText', () => {
    it('should return null for unreadable files instead of throwing', async () => {
      const result = await service.extractText(
        Buffer.from('image bytes'),
        'scan.png',
      );
      expect(result).toBeNull();
    });

    it('should return text for plain text files', async () => {
      const result = await service.extractText(
        Buffer.from('hello world'),
        'notes.txt',
      );
      expect(result).toBe('hello world');
    });
  });
});
