import { Test, TestingModule } from '@nestjs/testing';
import { MaterialsService } from './materials.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';

describe('MaterialsService', () => {
  let service: MaterialsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    courseOffering: {
      findFirst: jest.fn(),
    },
    material: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    $executeRawUnsafe: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockLlm = {
    embed: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
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
    const courseOfferingId = '00000000-0000-0000-0000-000000000001';

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
  });

  describe('findByClass', () => {
    it('should return materials for a class', async () => {
      mockPrisma.material.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          title: 'M1',
          courseOfferingId: 'of-1',
          _count: { chunks: 3 },
        },
      ]);

      const result = await service.findByClass('of-1', organizationId);

      expect(result).toHaveLength(1);
      expect(mockPrisma.material.findMany).toHaveBeenCalledWith({
        where: { courseOfferingId: 'of-1', offering: { organizationId } },
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

  describe('delete', () => {
    it('should delete material', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({ id: 'mat-1' });
      mockPrisma.material.delete.mockResolvedValue({ id: 'mat-1' });

      const result = await service.delete('mat-1', organizationId);

      expect(result.deleted).toBe(true);
    });

    it('should throw when not found', async () => {
      mockPrisma.material.findFirst.mockResolvedValue(null);

      await expect(
        service.delete('nonexistent', organizationId),
      ).rejects.toMatchObject({ code: 'MATERIAL_NOT_FOUND' });
    });
  });
});
