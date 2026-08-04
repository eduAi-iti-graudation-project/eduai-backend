import { Test, TestingModule } from '@nestjs/testing';
import { RubricsService } from './rubrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { NotFoundException } from '@nestjs/common';

describe('RubricsService', () => {
  let service: RubricsService;

  const organizationId = 'org-1';

  const mockPrisma = {
    assignment: {
      findFirst: jest.fn(),
    },
    rubric: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $executeRawUnsafe: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockLlm = {
    generateStructured: jest.fn(),
    embed: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RubricsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
      ],
    }).compile();

    service = module.get<RubricsService>(RubricsService);
    jest.clearAllMocks();
  });

  describe('confirm', () => {
    const fakeEmbedding = Array.from({ length: 1024 }, () => Math.random());

    beforeEach(() => {
      mockLlm.embed.mockResolvedValue(fakeEmbedding);
    });

    it('should confirm a rubric with no criteria (no embed calls)', async () => {
      const rubricId = 'empty-id';
      const rubric = {
        id: rubricId,
        title: 'Empty Rubric',
        isConfirmed: true,
        criteria: [],
      };
      mockPrisma.rubric.findFirst.mockResolvedValue(rubric);
      mockPrisma.rubric.update.mockResolvedValue(rubric);

      const result = await service.confirm(rubricId, organizationId);

      expect(mockPrisma.rubric.update).toHaveBeenCalledWith({
        where: { id: rubricId },
        data: { isConfirmed: true },
        include: { criteria: true },
      });
      expect(mockLlm.embed).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(result.isConfirmed).toBe(true);
    });

    it('should embed each criterion and store via raw SQL', async () => {
      const rubricId = 'embed-id';
      const criteria = [
        { id: 'c1', description: 'Thesis clarity', maxPoints: 10 },
        { id: 'c2', description: 'Evidence quality', maxPoints: 15 },
      ];
      const rubric = {
        id: rubricId,
        title: 'Essay',
        isConfirmed: true,
        criteria,
      };
      mockPrisma.rubric.findFirst.mockResolvedValue(rubric);
      mockPrisma.rubric.update.mockResolvedValue(rubric);

      await service.confirm(rubricId, organizationId);

      expect(mockLlm.embed).toHaveBeenCalledTimes(2);
      expect(mockLlm.embed).toHaveBeenCalledWith('Thesis clarity');
      expect(mockLlm.embed).toHaveBeenCalledWith('Evidence quality');

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(
          'UPDATE rubric_criteria SET embedding = $1::vector WHERE id = $2',
        ),
        expect.stringMatching(/^\[[\d.,\s-]+\]$/),
        'c1',
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(
          'UPDATE rubric_criteria SET embedding = $1::vector WHERE id = $2',
        ),
        expect.stringMatching(/^\[[\d.,\s-]+\]$/),
        'c2',
      );
    });

    it('should still confirm when one embed fails', async () => {
      const rubricId = 'partial-fail';
      const criteria = [
        { id: 'c1', description: 'Thesis', maxPoints: 10 },
        { id: 'c2', description: 'Evidence', maxPoints: 15 },
      ];
      const rubric = {
        id: rubricId,
        title: 'Essay',
        isConfirmed: true,
        criteria,
      };
      mockPrisma.rubric.findFirst.mockResolvedValue(rubric);
      mockPrisma.rubric.update.mockResolvedValue(rubric);
      mockLlm.embed
        .mockResolvedValueOnce(fakeEmbedding)
        .mockRejectedValueOnce(new Error('API error'));

      const result = await service.confirm(rubricId, organizationId);

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE rubric_criteria'),
        expect.any(String),
        'c1',
      );
      expect(result.isConfirmed).toBe(true);
    });

    it('should throw NotFoundException for missing rubric', async () => {
      mockPrisma.rubric.findFirst.mockResolvedValue(null);

      await expect(
        service.confirm('non-existent-id', organizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a rubric with criteria', async () => {
      const dto = {
        title: 'Test Rubric',
        assignmentId: 'assignment-id',
        criteria: [{ description: 'Criterion 1', maxPoints: 10 }],
      };

      mockPrisma.assignment.findFirst.mockResolvedValue({
        id: 'assignment-id',
      });
      mockPrisma.rubric.create.mockResolvedValue({
        id: 'new-rubric-id',
        ...dto,
        criteria: dto.criteria,
      });

      const result = await service.create(dto, organizationId);

      expect(mockPrisma.rubric.create).toHaveBeenCalled();
      expect(result.title).toBe(dto.title);
    });
  });

  describe('findAll', () => {
    it('should return rubrics without filter', async () => {
      mockPrisma.rubric.findMany.mockResolvedValue([]);
      const result = await service.findAll(undefined, organizationId);
      expect(result).toEqual([]);
      expect(mockPrisma.rubric.findMany).toHaveBeenCalledWith({
        where: { assignment: { class: { organizationId } } },
        include: { criteria: true },
      });
    });

    it('should filter by assignmentId', async () => {
      mockPrisma.rubric.findMany.mockResolvedValue([]);
      await service.findAll('assignment-id', organizationId);
      expect(mockPrisma.rubric.findMany).toHaveBeenCalledWith({
        where: {
          assignmentId: 'assignment-id',
          assignment: { class: { organizationId } },
        },
        include: { criteria: true },
      });
    });
  });

  describe('findOne', () => {
    it('should return rubric by id', async () => {
      const rubric = { id: 'id', title: 'Test', criteria: [], assignment: {} };
      mockPrisma.rubric.findFirst.mockResolvedValue(rubric);
      const result = await service.findOne('id', organizationId);
      expect(result).toEqual(rubric);
    });

    it('should throw when rubric not found', async () => {
      mockPrisma.rubric.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', organizationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findConfirmedRubric', () => {
    it('should return confirmed rubric with criteria', async () => {
      const rubric = {
        id: 'rubric-id',
        title: 'Test',
        isConfirmed: true,
        criteria: [{ id: 'c1', description: 'Criterion 1', maxPoints: 10 }],
      };
      mockPrisma.rubric.findFirst.mockResolvedValue(rubric);

      const result = await service.findConfirmedRubric(
        'assignment-id',
        organizationId,
      );

      expect(mockPrisma.rubric.findFirst).toHaveBeenCalledWith({
        where: {
          assignmentId: 'assignment-id',
          isConfirmed: true,
          assignment: { class: { organizationId } },
        },
        include: { criteria: true },
      });
      expect(result).toEqual(rubric);
    });

    it('should throw when no confirmed rubric exists', async () => {
      mockPrisma.rubric.findFirst.mockResolvedValue(null);

      await expect(
        service.findConfirmedRubric('assignment-id', organizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findSimilarCriteria', () => {
    const assignmentId = 'assign-1';
    const fakeEmbedding = Array.from({ length: 1024 }, () => Math.random());
    const criteriaRows = [
      { id: 'c1', description: 'Thesis', maxPoints: 10, distance: 0.15 },
      { id: 'c2', description: 'Evidence', maxPoints: 15, distance: 0.32 },
    ];

    it('should return criteria ordered by cosine distance', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(criteriaRows);

      const result = await service.findSimilarCriteria(
        fakeEmbedding,
        assignmentId,
        organizationId,
      );

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('c1');
      expect(
        (result[0] as { id: string; distance: number }).distance,
      ).toBeLessThan((result[1] as { id: string; distance: number }).distance);
    });

    it('should fall back to findConfirmedRubric when no embeddings exist', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const rubric = {
        id: 'rubric-id',
        title: 'Test',
        isConfirmed: true,
        criteria: [{ id: 'c1', description: 'Criterion 1', maxPoints: 10 }],
      };
      mockPrisma.rubric.findFirst.mockResolvedValue(rubric);

      const result = await service.findSimilarCriteria(
        fakeEmbedding,
        assignmentId,
        organizationId,
      );

      expect(mockPrisma.rubric.findFirst).toHaveBeenCalledWith({
        where: {
          assignmentId,
          isConfirmed: true,
          assignment: { class: { organizationId } },
        },
        include: { criteria: true },
      });
      expect(result).toEqual(rubric.criteria);
    });
  });
});
