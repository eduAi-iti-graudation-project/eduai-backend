import { Test, TestingModule } from '@nestjs/testing';
import { GradeConsoleService } from './grade-console.service';
import { PrismaService } from '../prisma/prisma.service';
import { GradeLevelsService } from '../grade-levels/grade-levels.service';
import { ClassesService } from '../classes/classes.service';

describe('GradeConsoleService', () => {
  let service: GradeConsoleService;

  const organizationId = 'org-1';
  const now = new Date('2026-08-01');

  const mockPrisma = {
    gradeLevel: { findFirst: jest.fn() },
    section: { findFirst: jest.fn(), update: jest.fn() },
  };

  const mockGradeLevels = {
    findAll: jest.fn(),
    create: jest.fn(),
  };

  const mockClasses = {
    findByGrade: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradeConsoleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GradeLevelsService, useValue: mockGradeLevels },
        { provide: ClassesService, useValue: mockClasses },
      ],
    }).compile();

    service = module.get<GradeConsoleService>(GradeConsoleService);
  });

  describe('findAll / create', () => {
    it('delegates grade listing and creation to GradeLevelsService', async () => {
      mockGradeLevels.findAll.mockResolvedValue([{ id: 'g1', level: 10 }]);
      mockGradeLevels.create.mockResolvedValue({ id: 'g1', level: 10 });

      await expect(service.findAll(organizationId)).resolves.toEqual([
        { id: 'g1', level: 10 },
      ]);
      await expect(
        service.create({ level: 11, name: 'Grade 11' }, organizationId),
      ).resolves.toEqual({ id: 'g1', level: 10 });

      expect(mockGradeLevels.findAll).toHaveBeenCalledWith(organizationId);
      expect(mockGradeLevels.create).toHaveBeenCalledWith(
        { level: 11, name: 'Grade 11' },
        organizationId,
      );
    });
  });

  describe('getGradeClasses', () => {
    it('delegates to ClassesService', async () => {
      mockClasses.findByGrade.mockResolvedValue([{ id: 'sec-1' }]);

      const result = await service.getGradeClasses('grade-1', organizationId);

      expect(result).toEqual([{ id: 'sec-1' }]);
      expect(mockClasses.findByGrade).toHaveBeenCalledWith(
        'grade-1',
        organizationId,
      );
    });
  });

  describe('addClassToGrade', () => {
    it('throws when the grade is missing', async () => {
      mockPrisma.gradeLevel.findFirst.mockResolvedValue(null);

      await expect(
        service.addClassToGrade('grade-9', 'sec-1', organizationId),
      ).rejects.toThrow('This grade level could not be found.');
    });

    it('throws when the class is missing', async () => {
      mockPrisma.gradeLevel.findFirst.mockResolvedValue({ id: 'grade-1' });
      mockPrisma.section.findFirst.mockResolvedValue(null);

      await expect(
        service.addClassToGrade('grade-1', 'sec-9', organizationId),
      ).rejects.toThrow('This class could not be found.');
    });

    it('re-links the section to the grade', async () => {
      const sectionRow = {
        id: 'sec-1',
        gradeLevelId: 'grade-10',
        name: 'English',
        organizationId,
        createdAt: now,
        updatedAt: now,
      };
      mockPrisma.gradeLevel.findFirst.mockResolvedValue({ id: 'grade-1' });
      mockPrisma.section.findFirst.mockResolvedValue(sectionRow);
      mockPrisma.section.update.mockResolvedValue({
        ...sectionRow,
        gradeLevelId: 'grade-1',
      });

      const result = await service.addClassToGrade(
        'grade-1',
        'sec-1',
        organizationId,
      );

      expect(mockPrisma.section.update).toHaveBeenCalledWith({
        where: { id: 'sec-1' },
        data: { gradeLevelId: 'grade-1' },
      });
      expect(result.gradeLevelId).toBe('grade-1');
    });
  });

  describe('removeClassFromGrade', () => {
    it('deletes the class via ClassesService', async () => {
      mockClasses.remove.mockResolvedValue({ id: 'sec-1' });

      await expect(
        service.removeClassFromGrade('sec-1', organizationId),
      ).resolves.toEqual({ id: 'sec-1' });
      expect(mockClasses.remove).toHaveBeenCalledWith('sec-1', organizationId);
    });
  });
});
