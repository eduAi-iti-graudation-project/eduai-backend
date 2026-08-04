import { Test, TestingModule } from '@nestjs/testing';
import { MaterialsService } from './materials.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { SupabaseService } from '../auth/supabase.service';
import {
  BadRequestException,
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

  const mockPrisma = {
    material: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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
    const classId = '00000000-0000-0000-0000-000000000001';

    it('should chunk and embed a text file', async () => {
      const text = 'Hello world. '.repeat(500);
      const buffer = Buffer.from(text);
      const filename = 'test.txt';

      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        classId,
        fileUrl: filename,
        chunks: [{ id: 'chunk-1', content: text.slice(0, 1900) }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(title, classId, buffer, filename);

      expect(result.id).toBe('mat-1');
      expect(result.chunkCount).toBe(1);
      expect(mockLlm.embed).toHaveBeenCalled();
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalled();
      expect(mockPrisma.material.create).toHaveBeenCalledWith({
        data: {
          title,
          classId,
          fileUrl: filename,
          chunks: {
            create: expect.any(Array) as Array<{ content: string }>,
          },
        },
        include: { chunks: true },
      });
      expect(mockStorageBucket.upload).not.toHaveBeenCalled();
    });

    it('should throw for empty text', async () => {
      const buffer = Buffer.from('   \n\n  ');
      const filename = 'empty.txt';

      await expect(
        service.upload(title, classId, buffer, filename),
      ).rejects.toThrow(BadRequestException);
    });

    it('should upload a PDF to the bucket and persist the object path', async () => {
      const filename = 'lesson.pdf';
      const buffer = Buffer.from('%PDF-1.4 fake');

      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        classId,
        fileUrl: null,
        chunks: [{ id: 'chunk-1', content: 'text' }],
      });
      mockStorageBucket.upload.mockResolvedValue({ error: null });
      mockPrisma.material.update.mockResolvedValue({
        id: 'mat-1',
        title,
        classId,
        fileUrl: `materials/${classId}/mat-1.pdf`,
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(title, classId, buffer, filename);

      const expectedPath = `materials/${classId}/mat-1.pdf`;
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
          classId,
          fileUrl: null,
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

      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        classId,
        fileUrl: null,
        chunks: [{ id: 'chunk-1', content: 'text' }],
      });
      mockStorageBucket.upload.mockRejectedValue(new Error('bucket down'));
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      await expect(
        service.upload(title, classId, buffer, filename),
      ).rejects.toThrow(BadGatewayException);

      expect(mockPrisma.material.delete).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
      });
      expect(mockPrisma.material.update).not.toHaveBeenCalled();
    });

    it('should roll back the created row and fail when storage returns an error', async () => {
      const filename = 'lesson.pdf';
      const buffer = Buffer.from('%PDF-1.4 fake');

      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        classId,
        fileUrl: null,
        chunks: [{ id: 'chunk-1', content: 'text' }],
      });
      mockStorageBucket.upload.mockResolvedValue({
        error: new Error('403 bucket not found'),
      });
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      await expect(
        service.upload(title, classId, buffer, filename),
      ).rejects.toThrow(BadGatewayException);

      expect(mockPrisma.material.delete).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
      });
    });
  });

  describe('findByClass', () => {
    it('should return materials for a class', async () => {
      mockPrisma.material.findMany.mockResolvedValue([
        { id: 'mat-1', title: 'M1', classId: 'c1', _count: { chunks: 3 } },
      ]);

      const result = await service.findByClass('c1');

      expect(result).toHaveLength(1);
      expect(mockPrisma.material.findMany).toHaveBeenCalledWith({
        where: { classId: 'c1' },
        include: { _count: { select: { chunks: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return material with chunks', async () => {
      mockPrisma.material.findUnique.mockResolvedValue({
        id: 'mat-1',
        title: 'M1',
        chunks: [{ id: 'chunk-1', content: '...' }],
      });

      const result = await service.findOne('mat-1');

      expect(result.id).toBe('mat-1');
    });

    it('should throw when not found', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        'Material not found',
      );
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

      const result = await service.searchChunks('c1', 'query', 3);

      expect(result).toHaveLength(1);
      expect(mockLlm.embed).toHaveBeenCalledWith('query');
    });

    it('should use cosine distance with the default threshold', async () => {
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await service.searchChunks('c1', 'query', 3);

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

      await service.searchChunks('c1', 'query', 3);

      const call = mockPrisma.$queryRaw.mock.calls[0] as unknown as [
        string[],
        unknown,
      ];
      expect(call[0].join('')).toContain('mc.embedding <=>');
      expect(call).toContain(0.6);
      delete process.env.SEARCH_MAX_COSINE_DISTANCE;
    });
  });

  describe('getMaterialFileUrl', () => {
    const classId = '00000000-0000-0000-0000-000000000001';
    const materialBase = {
      id: 'mat-1',
      title: 'M1',
      classId,
      fileUrl: `materials/${classId}/mat-1.pdf`,
      class: {
        id: classId,
        teacherId: 'teacher-1',
        enrollments: [
          {
            status: 'APPROVED',
            studentId: 'student-1',
            student: { id: 'student-1', guardianId: 'guardian-1' },
          },
        ],
      },
    };

    it('should return a signed URL for the teacher of the class', async () => {
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
        `materials/${classId}/mat-1.pdf`,
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

    it('should forbid a teacher from another class', async () => {
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
      mockPrisma.material.findUnique.mockResolvedValue({
        id: 'mat-1',
        fileUrl: 'materials/c1/mat-1.pdf',
      });
      mockStorageBucket.remove.mockResolvedValue({ error: null });
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      const result = await service.delete('mat-1');

      expect(result.deleted).toBe(true);
      expect(mockStorageBucket.remove).toHaveBeenCalledWith([
        'materials/c1/mat-1.pdf',
      ]);
      expect(mockPrisma.material.delete).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
      });
    });

    it('should skip storage gracefully when the material has no stored path', async () => {
      mockPrisma.material.findUnique.mockResolvedValue({
        id: 'mat-1',
        fileUrl: 'notes.txt',
      });
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      const result = await service.delete('mat-1');

      expect(result.deleted).toBe(true);
      expect(mockStorageBucket.remove).not.toHaveBeenCalled();
    });

    it('should still delete the row when storage remove fails', async () => {
      mockPrisma.material.findUnique.mockResolvedValue({
        id: 'mat-1',
        fileUrl: 'materials/c1/mat-1.pdf',
      });
      mockStorageBucket.remove.mockRejectedValue(new Error('storage down'));
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      const result = await service.delete('mat-1');

      expect(result.deleted).toBe(true);
      expect(mockPrisma.material.delete).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
      });
    });

    it('should throw when not found', async () => {
      mockPrisma.material.findUnique.mockResolvedValue(null);

      await expect(service.delete('nonexistent')).rejects.toThrow(
        'Material not found',
      );
    });
  });
});
