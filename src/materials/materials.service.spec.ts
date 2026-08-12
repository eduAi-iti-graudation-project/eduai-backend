import { Test, TestingModule } from '@nestjs/testing';
import { MaterialsService } from './materials.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { SupabaseService } from '../auth/supabase.service';
import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

jest.mock('pdf-parse', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ text: 'PDF extracted text' }),
}));

describe('MaterialsService', () => {
  let service: MaterialsService;

  const organizationId = 'org-1';
  const courseOfferingId = '00000000-0000-0000-0000-000000000001';

  const mockPrisma = {
    courseOffering: {
      findFirst: jest.fn(),
    },
    material: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    materialChapter: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    $executeRawUnsafe: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockLlm = {
    embed: jest.fn(),
  };

  const mockStorageBucket = {
    upload: jest.fn(),
    createSignedUrl: jest.fn(),
    remove: jest.fn(),
  };

  const mockSupabase = {
    getClient: jest.fn(() => ({
      storage: {
        from: jest.fn(() => mockStorageBucket),
      },
    })),
    getStorageClient: jest.fn(() => ({
      storage: {
        from: jest.fn(() => mockStorageBucket),
      },
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get<MaterialsService>(MaterialsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upload', () => {
    const title = 'Test Material';

    it('should chunk and embed a text file', async () => {
      const text = 'Hello world. '.repeat(500);
      const buffer = Buffer.from(text);
      const filename = 'test.txt';

      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId,
        chunks: [{ id: 'chunk-1', content: text.slice(0, 1900) }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(
        title,
        courseOfferingId,
        buffer,
        filename,
        organizationId,
      );

      expect(result.id).toBe('mat-1');
      expect(result.chunkCount).toBe(1);
      expect(mockLlm.embed).toHaveBeenCalled();
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalled();
      expect(mockPrisma.material.create).toHaveBeenCalledWith({
        data: {
          title,
          courseOfferingId,
          assignmentId: null,
          chapterId: null,
          fileUrl: filename,
          chunks: {
            create: expect.any(Array) as Array<{ content: string }>,
          },
        },
        include: { chunks: true },
      });
      expect(mockStorageBucket.upload).not.toHaveBeenCalled();
    });

    it('should scope the offering lookup to the organization', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(null);
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        chunks: [],
      });

      await expect(
        service.upload(
          title,
          courseOfferingId,
          Buffer.from('x'),
          'x.txt',
          organizationId,
        ),
      ).rejects.toMatchObject({ code: 'OFFERING_NOT_FOUND' });

      expect(mockPrisma.courseOffering.findFirst).toHaveBeenCalledWith({
        where: { id: courseOfferingId, organizationId },
      });
    });

    it('should throw for empty text', async () => {
      const buffer = Buffer.from('   \n\n  ');
      const filename = 'empty.txt';

      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      await expect(
        service.upload(
          title,
          courseOfferingId,
          buffer,
          filename,
          organizationId,
        ),
      ).rejects.toMatchObject({ code: 'FILE_NO_TEXT' });
    });

    it('should upload a PDF to the bucket and persist the object path', async () => {
      const filename = 'lesson.pdf';
      const buffer = Buffer.from('%PDF-1.4 fake');

      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId,
        fileUrl: null,
        chunks: [{ id: 'chunk-1', content: 'text' }],
      });
      mockStorageBucket.upload.mockResolvedValue({ error: null });
      mockPrisma.material.update.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId,
        fileUrl: `materials/${courseOfferingId}/mat-1.pdf`,
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(
        title,
        courseOfferingId,
        buffer,
        filename,
        organizationId,
      );

      const expectedPath = `materials/${courseOfferingId}/mat-1.pdf`;
      expect(mockStorageBucket.upload).toHaveBeenCalledWith(
        expectedPath,
        buffer,
        { contentType: 'application/pdf' },
      );
      expect(mockPrisma.material.update).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
        data: { fileUrl: expectedPath },
      });
      expect(mockPrisma.material.create).toHaveBeenCalledWith({
        data: {
          title,
          courseOfferingId,
          assignmentId: null,
          chapterId: null,
          fileUrl: filename,
          chunks: {
            create: expect.any(Array) as Array<{ content: string }>,
          },
        },
        include: { chunks: true },
      });
      expect(result.chunkCount).toBe(1);
    });

    it('should roll back the created row and fail when storage upload rejects', async () => {
      const filename = 'lesson.pdf';
      const buffer = Buffer.from('%PDF-1.4 fake');

      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId,
        fileUrl: null,
        chunks: [{ id: 'chunk-1', content: 'text' }],
      });
      mockStorageBucket.upload.mockRejectedValue(new Error('bucket down'));
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      await expect(
        service.upload(
          title,
          courseOfferingId,
          buffer,
          filename,
          organizationId,
        ),
      ).rejects.toThrow(BadGatewayException);

      expect(mockPrisma.material.delete).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
      });
      expect(mockPrisma.material.update).not.toHaveBeenCalled();
    });

    it('should roll back the created row and fail when storage returns an error', async () => {
      const filename = 'lesson.pdf';
      const buffer = Buffer.from('%PDF-1.4 fake');

      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId,
        fileUrl: null,
        chunks: [{ id: 'chunk-1', content: 'text' }],
      });
      mockStorageBucket.upload.mockResolvedValue({
        error: new Error('403 bucket not found'),
      });
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      await expect(
        service.upload(
          title,
          courseOfferingId,
          buffer,
          filename,
          organizationId,
        ),
      ).rejects.toThrow(BadGatewayException);

      expect(mockPrisma.material.delete).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
      });
    });
  });

  describe('findByOffering', () => {
    it('should return materials for a course offering', async () => {
      mockPrisma.material.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          title: 'M1',
          courseOfferingId: 'of-1',
          _count: { chunks: 3 },
        },
      ]);

      const result = await service.findByOffering('of-1', organizationId);

      expect(result).toHaveLength(1);
      expect(mockPrisma.material.findMany).toHaveBeenCalledWith({
        where: { courseOfferingId: 'of-1', offering: { organizationId } },
        include: { _count: { select: { chunks: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should not leak materials from another organization', async () => {
      mockPrisma.material.findMany.mockResolvedValue([]);

      await service.findByOffering('of-other-org', organizationId);

      expect(mockPrisma.material.findMany).toHaveBeenCalledWith({
        where: {
          courseOfferingId: 'of-other-org',
          offering: { organizationId },
        },
        include: { _count: { select: { chunks: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return material with chunks', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        id: 'mat-1',
        title: 'M1',
        chunks: [{ id: 'chunk-1', content: '...' }],
      });

      const result = await service.findOne('mat-1', organizationId);

      expect(result.id).toBe('mat-1');
    });

    it('should throw when not found', async () => {
      mockPrisma.material.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent', organizationId),
      ).rejects.toMatchObject({ code: 'MATERIAL_NOT_FOUND' });
    });

    it('should throw when the material belongs to another organization', async () => {
      mockPrisma.material.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('org-b-material', organizationId),
      ).rejects.toMatchObject({ code: 'MATERIAL_NOT_FOUND' });
      expect(mockPrisma.material.findFirst).toHaveBeenCalledWith({
        where: { id: 'org-b-material', offering: { organizationId } },
        include: { chunks: true },
      });
    });
  });

  describe('searchChunks', () => {
    it('should search by embedding similarity', async () => {
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'c1',
          content: 'relevant text',
          distance: 0.15,
          materialId: 'm1',
          materialTitle: 'M1',
        },
      ]);

      const result = await service.searchChunks('of-1', 'query', 3);

      expect(result).toHaveLength(1);
      expect(mockLlm.embed).toHaveBeenCalledWith('query');
    });

    it('should use cosine distance with the default threshold', async () => {
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await service.searchChunks('of-1', 'query', 3);

      const call = mockPrisma.$queryRaw.mock.calls[0] as unknown as [
        string[],
        unknown,
      ];
      expect(call[0].join('')).toContain('mc.embedding <=>');
      expect(call).toContain(0.45);
    });

    it('should use the configured threshold from env', async () => {
      process.env.SEARCH_MAX_COSINE_DISTANCE = '0.6';
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const service = new MaterialsService(
        mockPrisma as never,
        mockLlm as never,
        mockSupabase as never,
      );

      await service.searchChunks('of-1', 'query', 3);

      const call = mockPrisma.$queryRaw.mock.calls[0] as unknown as [
        string[],
        unknown,
      ];
      expect(call[0].join('')).toContain('mc.embedding <=>');
      expect(call).toContain(0.6);
      delete process.env.SEARCH_MAX_COSINE_DISTANCE;
    });
  });

  describe('upload with chapters', () => {
    it('should link the material to an explicit chapter', async () => {
      const buffer = Buffer.from('Just some flat text here.'.repeat(40));

      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.materialChapter.findFirst.mockResolvedValue({
        id: 'ch-1',
        courseOfferingId,
      });
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title: 'T',
        courseOfferingId,
        chapterId: 'ch-1',
        chunks: [{ id: 'c1', content: 'x' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(
        'T',
        courseOfferingId,
        buffer,
        'x.txt',
        organizationId,
        undefined,
        'ch-1',
      );

      expect(result.chapterId).toBe('ch-1');
      const createCalls = mockPrisma.material.create.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(createCalls[0][0].data).toEqual(
        expect.objectContaining({ chapterId: 'ch-1' }),
      );
    });

    it('should reject a chapter that belongs to another class', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.materialChapter.findFirst.mockResolvedValue(null);

      await expect(
        service.upload(
          'T',
          courseOfferingId,
          Buffer.from('x'),
          'x.txt',
          organizationId,
          undefined,
          'ch-other',
        ),
      ).rejects.toMatchObject({ code: 'CHAPTER_NOT_FOUND' });
    });

    it('should auto-create chapters when the document has headings', async () => {
      const text = [
        'Chapter 1 Introduction',
        'Biology is the science of life.',
        'It studies living organisms from bacteria to whales.',
        'Organisms grow, reproduce, and respond to their environment.',
        'All living things are made of cells, the smallest units of life.',
        'The study of biology is divided into many branches of knowledge.',
        '',
        'Chapter 2 Cells',
        'The cell is the basic structural unit of all living organisms.',
        'Cells contain a cell membrane which controls what enters them.',
        'The nucleus stores genetic material inside every living cell.',
        'Mitochondria produce the energy that cells need to survive.',
        'Plant cells also contain chloroplasts used for photosynthesis.',
      ].join('\n');

      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.materialChapter.aggregate.mockResolvedValue({
        _max: { order: null },
      });
      mockPrisma.materialChapter.create
        .mockResolvedValueOnce({ id: 'auto-1', order: 0 })
        .mockResolvedValueOnce({ id: 'auto-2', order: 1 });
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title: 'T',
        courseOfferingId,
        chapterId: 'auto-1',
        chunks: [{ id: 'c1', content: 'x' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(
        'T',
        courseOfferingId,
        Buffer.from(text),
        'book.txt',
        organizationId,
      );

      expect(mockPrisma.materialChapter.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.materialChapter.create).toHaveBeenNthCalledWith(1, {
        data: {
          courseOfferingId,
          title: 'Chapter 1 Introduction',
          order: 0,
        },
      });
      expect(mockPrisma.materialChapter.create).toHaveBeenNthCalledWith(2, {
        data: {
          courseOfferingId,
          title: 'Chapter 2 Cells',
          order: 1,
        },
      });
      expect(result.chapterId).toBe('auto-1');
      expect(result.detectedChapterCount).toBe(2);
    });

    it('should not auto-create chapters for flat text', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title: 'T',
        courseOfferingId,
        chapterId: null,
        chunks: [{ id: 'c1', content: 'x' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(
        'T',
        courseOfferingId,
        Buffer.from('No headings here at all. '.repeat(60)),
        'x.txt',
        organizationId,
      );

      expect(result.chapterId).toBeNull();
      expect(result.detectedChapterCount).toBe(0);
      expect(mockPrisma.materialChapter.create).not.toHaveBeenCalled();
      expect(mockPrisma.materialChapter.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('chapters', () => {
    it('should create a chapter at the next order position', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.materialChapter.aggregate.mockResolvedValue({
        _max: { order: 4 },
      });
      mockPrisma.materialChapter.create.mockResolvedValue({
        id: 'ch-9',
        courseOfferingId,
        title: 'Chapter 9',
        order: 5,
      });

      const result = await service.createChapter(
        courseOfferingId,
        'Chapter 9',
        organizationId,
      );

      expect(mockPrisma.materialChapter.create).toHaveBeenCalledWith({
        data: { courseOfferingId, title: 'Chapter 9', order: 5 },
      });
      expect(result.order).toBe(5);
    });

    it('should rename and reorder a chapter in the same organization', async () => {
      mockPrisma.materialChapter.findFirst.mockResolvedValue({
        id: 'ch-1',
      });
      mockPrisma.materialChapter.update.mockResolvedValue({
        id: 'ch-1',
        title: 'Renamed',
        order: 0,
      });

      const result = await service.updateChapter('ch-1', organizationId, {
        title: 'Renamed',
        order: 0,
      });

      expect(mockPrisma.materialChapter.update).toHaveBeenCalledWith({
        where: { id: 'ch-1' },
        data: { title: 'Renamed', order: 0 },
      });
      expect(result.title).toBe('Renamed');
    });

    it('should not rename a chapter from another organization', async () => {
      mockPrisma.materialChapter.findFirst.mockResolvedValue(null);

      await expect(
        service.updateChapter('ch-x', organizationId, { title: 'X' }),
      ).rejects.toMatchObject({ code: 'CHAPTER_NOT_FOUND' });
    });

    it('should delete a chapter', async () => {
      mockPrisma.materialChapter.findFirst.mockResolvedValue({ id: 'ch-1' });
      mockPrisma.materialChapter.delete.mockResolvedValue({ id: 'ch-1' });

      const result = await service.deleteChapter('ch-1', organizationId);

      expect(result).toEqual({ deleted: true });
      expect(mockPrisma.materialChapter.delete).toHaveBeenCalledWith({
        where: { id: 'ch-1' },
      });
    });

    it('should move a material into a chapter', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        id: 'mat-1',
        courseOfferingId,
      });
      mockPrisma.materialChapter.findFirst.mockResolvedValue({ id: 'ch-2' });
      mockPrisma.material.update.mockResolvedValue({
        id: 'mat-1',
        chapterId: 'ch-2',
      });

      const result = await service.moveMaterialToChapter(
        'mat-1',
        'ch-2',
        organizationId,
      );

      expect(mockPrisma.material.update).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
        data: { chapterId: 'ch-2' },
        select: { id: true, chapterId: true },
      });
      expect(result.chapterId).toBe('ch-2');
    });

    it('should ungroup a material when moved to null', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        id: 'mat-1',
        courseOfferingId,
      });
      mockPrisma.material.update.mockResolvedValue({
        id: 'mat-1',
        chapterId: null,
      });

      await service.moveMaterialToChapter('mat-1', null, organizationId);

      expect(mockPrisma.materialChapter.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.material.update).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
        data: { chapterId: null },
        select: { id: true, chapterId: true },
      });
    });

    it('should not link a material to a chapter from another class', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        id: 'mat-1',
        courseOfferingId,
      });
      mockPrisma.materialChapter.findFirst.mockResolvedValue(null);

      await expect(
        service.moveMaterialToChapter('mat-1', 'ch-x', organizationId),
      ).rejects.toMatchObject({ code: 'CHAPTER_NOT_FOUND' });
    });

    it('should return chapters with materials plus ungrouped materials', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.materialChapter.findMany.mockResolvedValue([
        { id: 'ch-1', title: 'C1', order: 0, materials: [] },
      ]);
      mockPrisma.material.findMany.mockResolvedValue([
        { id: 'm-x', title: 'Loose' },
      ]);

      const result = await service.findByOfferingGrouped(
        courseOfferingId,
        organizationId,
      );

      expect(result.chapters).toHaveLength(1);
      expect(result.unassigned).toHaveLength(1);
      expect(mockPrisma.materialChapter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { order: 'asc' },
        }),
      );
    });

    it('should throw when grouping materials for an unknown class', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(null);

      await expect(
        service.findByOfferingGrouped(courseOfferingId, organizationId),
      ).rejects.toMatchObject({ code: 'OFFERING_NOT_FOUND' });
    });
  });

  describe('getMaterialFileUrl', () => {
    const materialBase = {
      id: 'mat-1',
      title: 'M1',
      courseOfferingId,
      fileUrl: `materials/${courseOfferingId}/mat-1.pdf`,
      offering: {
        teacherId: 'teacher-1',
        section: {
          enrollments: [
            {
              student: { id: 'student-1', guardianId: 'guardian-1' },
            },
          ],
        },
      },
    };

    it('should return a signed URL for the teacher of the offering', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(materialBase);
      mockStorageBucket.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://signed/url' },
        error: null,
      });

      const result = await service.getMaterialFileUrl('mat-1', {
        id: 'teacher-1',
        role: 'TEACHER',
      } as never);

      expect(result).toEqual({ url: 'https://signed/url' });
      expect(mockStorageBucket.createSignedUrl).toHaveBeenCalledWith(
        `materials/${courseOfferingId}/mat-1.pdf`,
        3600,
      );
    });

    it('should return a signed URL for an enrolled student', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(materialBase);
      mockStorageBucket.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://signed/url' },
        error: null,
      });

      const result = await service.getMaterialFileUrl('mat-1', {
        id: 'student-1',
        role: 'STUDENT',
      } as never);

      expect(result.url).toBe('https://signed/url');
    });

    it('should return a signed URL for a guardian of an enrolled student', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(materialBase);
      mockStorageBucket.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://signed/url' },
        error: null,
      });

      const result = await service.getMaterialFileUrl('mat-1', {
        id: 'guardian-1',
        role: 'GUARDIAN',
      } as never);

      expect(result.url).toBe('https://signed/url');
    });

    it('should return a signed URL for an admin', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(materialBase);
      mockStorageBucket.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://signed/url' },
        error: null,
      });

      const result = await service.getMaterialFileUrl('mat-1', {
        id: 'admin-1',
        role: 'ADMIN',
      } as never);

      expect(result.url).toBe('https://signed/url');
    });

    it('should forbid a teacher who does not teach the offering', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(materialBase);

      await expect(
        service.getMaterialFileUrl('mat-1', {
          id: 'teacher-2',
          role: 'TEACHER',
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should forbid a student who is not enrolled', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(materialBase);

      await expect(
        service.getMaterialFileUrl('mat-1', {
          id: 'student-9',
          role: 'STUDENT',
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should forbid a guardian with no enrolled ward', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(materialBase);

      await expect(
        service.getMaterialFileUrl('mat-1', {
          id: 'guardian-9',
          role: 'GUARDIAN',
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw 404 for a missing material', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(null);

      await expect(
        service.getMaterialFileUrl('nonexistent', {
          id: 'teacher-1',
          role: 'TEACHER',
        } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 when the material has no stored file', async () => {
      mockPrisma.material.findUnique.mockResolvedValue({
        ...materialBase,
        fileUrl: null,
      });

      await expect(
        service.getMaterialFileUrl('mat-1', {
          id: 'teacher-1',
          role: 'TEACHER',
        } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw 502 when signed URL creation fails', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(materialBase);
      mockStorageBucket.createSignedUrl.mockResolvedValue({
        data: null,
        error: new Error('storage down'),
      });

      await expect(
        service.getMaterialFileUrl('mat-1', {
          id: 'teacher-1',
          role: 'TEACHER',
        } as never),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  describe('delete', () => {
    it('should remove the storage object and delete the material', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        id: 'mat-1',
        fileUrl: 'materials/c1/mat-1.pdf',
      });
      mockStorageBucket.remove.mockResolvedValue({ error: null });
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      const result = await service.delete('mat-1', organizationId);

      expect(result.deleted).toBe(true);
      expect(mockStorageBucket.remove).toHaveBeenCalledWith([
        'materials/c1/mat-1.pdf',
      ]);
      expect(mockPrisma.material.delete).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
      });
    });

    it('should skip storage gracefully when the material has no stored path', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        id: 'mat-1',
        fileUrl: 'notes.txt',
      });
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      const result = await service.delete('mat-1', organizationId);

      expect(result.deleted).toBe(true);
      expect(mockStorageBucket.remove).not.toHaveBeenCalled();
    });

    it('should still delete the row when storage remove fails', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        id: 'mat-1',
        fileUrl: 'materials/c1/mat-1.pdf',
      });
      mockStorageBucket.remove.mockRejectedValue(new Error('storage down'));
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      const result = await service.delete('mat-1', organizationId);

      expect(result.deleted).toBe(true);
      expect(mockPrisma.material.delete).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
      });
    });

    it('should scope deletion to the organization', async () => {
      mockPrisma.material.findFirst.mockResolvedValue(null);

      await expect(
        service.delete('org-b-material', organizationId),
      ).rejects.toMatchObject({ code: 'MATERIAL_NOT_FOUND' });
      expect(mockPrisma.material.findFirst).toHaveBeenCalledWith({
        where: { id: 'org-b-material', offering: { organizationId } },
      });
    });
  });
});
