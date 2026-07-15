import { Test, TestingModule } from '@nestjs/testing';
import { RubricsService } from './rubrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('RubricsService', () => {
  let service: RubricsService;

  const mockPrisma = {
    rubric: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RubricsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<RubricsService>(RubricsService);
    jest.clearAllMocks();
  });

  describe('confirm', () => {
    it('should set isConfirmed to true', async () => {
      const rubricId = 'test-rubric-id';
      const expectedRubric = {
        id: rubricId,
        title: 'Test Rubric',
        isConfirmed: true,
        criteria: [],
      };

      mockPrisma.rubric.findUnique.mockResolvedValue(expectedRubric);
      mockPrisma.rubric.update.mockResolvedValue(expectedRubric);

      const result = await service.confirm(rubricId);

      expect(mockPrisma.rubric.findUnique).toHaveBeenCalledWith({
        where: { id: rubricId },
      });
      expect(mockPrisma.rubric.update).toHaveBeenCalledWith({
        where: { id: rubricId },
        data: { isConfirmed: true },
        include: { criteria: true },
      });
      expect(result.isConfirmed).toBe(true);
    });

    it('should throw NotFoundException for missing rubric', async () => {
      mockPrisma.rubric.findUnique.mockResolvedValue(null);

      await expect(service.confirm('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a rubric with criteria', async () => {
      const dto = {
        title: 'Test Rubric',
        assignmentId: 'assignment-id',
        criteria: [{ description: 'Criterion 1', maxPoints: 10 }],
      };

      mockPrisma.rubric.create.mockResolvedValue({
        id: 'new-rubric-id',
        ...dto,
        criteria: dto.criteria,
      });

      const result = await service.create(dto);

      expect(mockPrisma.rubric.create).toHaveBeenCalled();
      expect(result.title).toBe(dto.title);
    });
  });

  describe('findAll', () => {
    it('should return rubrics without filter', async () => {
      mockPrisma.rubric.findMany.mockResolvedValue([]);
      const result = await service.findAll();
      expect(result).toEqual([]);
      expect(mockPrisma.rubric.findMany).toHaveBeenCalledWith({
        include: { criteria: true },
      });
    });

    it('should filter by assignmentId', async () => {
      mockPrisma.rubric.findMany.mockResolvedValue([]);
      await service.findAll('assignment-id');
      expect(mockPrisma.rubric.findMany).toHaveBeenCalledWith({
        where: { assignmentId: 'assignment-id' },
        include: { criteria: true },
      });
    });
  });

  describe('findOne', () => {
    it('should return rubric by id', async () => {
      const rubric = { id: 'id', title: 'Test', criteria: [], assignment: {} };
      mockPrisma.rubric.findUnique.mockResolvedValue(rubric);
      const result = await service.findOne('id');
      expect(result).toEqual(rubric);
    });

    it('should throw when rubric not found', async () => {
      mockPrisma.rubric.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
