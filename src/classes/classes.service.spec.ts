import { Test, TestingModule } from '@nestjs/testing';
import { ClassesService } from './classes.service';
import { PrismaService } from '../prisma/prisma.service';
import { SectionsService } from '../sections/sections.service';

describe('ClassesService', () => {
  let service: ClassesService;

  const organizationId = 'org-1';
  const now = new Date('2026-08-01');

  const baseSection = {
    id: 'sec-1',
    organizationId,
    gradeLevelId: 'grade-1',
    name: 'English 101',
    description: null,
    createdAt: now,
    updatedAt: now,
    gradeLevel: { id: 'grade-1', level: 10, name: 'Grade 10' },
    offerings: [{ teacherId: 't-1' }],
    _count: { enrollments: 3, offerings: 1 },
  };

  const mockPrisma = {
    section: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    gradeLevel: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    course: {
      findFirst: jest.fn(),
    },
    courseOffering: {
      upsert: jest.fn(),
    },
  };

  const mockSectionsService = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addEnrollment: jest.fn(),
    removeEnrollment: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SectionsService, useValue: mockSectionsService },
      ],
    }).compile();

    service = module.get<ClassesService>(ClassesService);
  });

  describe('findAll', () => {
    it('should list sections and decorate the first offering teacher', async () => {
      mockPrisma.section.findMany.mockResolvedValue([baseSection]);

      const result = await service.findAll(organizationId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'sec-1',
        name: 'English 101',
        teacherId: 't-1',
      });
      expect(mockPrisma.section.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId } }),
      );
    });

    it('collects unique course names from offerings', async () => {
      mockPrisma.section.findMany.mockResolvedValue([
        {
          ...baseSection,
          offerings: [
            { teacherId: 't-1', course: { name: 'Algebra' } },
            { teacherId: 't-1', course: { name: 'Algebra' } },
            { teacherId: 't-2', course: { name: 'Physics' } },
          ],
        },
      ]);

      const result = await service.findAll(organizationId);

      expect(result[0].courses).toEqual(['Algebra', 'Physics']);
    });

    it('sets teacherId null when the section has no offerings', async () => {
      mockPrisma.section.findMany.mockResolvedValue([
        { ...baseSection, offerings: [] },
      ]);

      const result = await service.findAll(organizationId);

      expect(result[0].teacherId).toBeNull();
      expect(result[0].courses).toEqual([]);
    });
  });

  describe('findByGrade', () => {
    it('throws when the grade is not in the organization', async () => {
      mockPrisma.gradeLevel.findFirst.mockResolvedValue(null);

      await expect(
        service.findByGrade('grade-1', organizationId),
      ).rejects.toThrow('This grade level could not be found.');
    });

    it('returns only sections of the grade with teacher', async () => {
      mockPrisma.gradeLevel.findFirst.mockResolvedValue({ id: 'grade-1' });
      mockPrisma.section.findMany.mockResolvedValue([baseSection]);

      const result = await service.findByGrade('grade-1', organizationId);

      expect(result[0].teacherId).toBe('t-1');
      expect(mockPrisma.section.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId, gradeLevelId: 'grade-1' },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws when the section is missing', async () => {
      mockPrisma.section.findFirst.mockResolvedValue(null);

      await expect(service.findOne('sec-9', organizationId)).rejects.toThrow(
        'This class could not be found.',
      );
    });

    it('returns the section with roster and offering teacher', async () => {
      mockPrisma.section.findFirst.mockResolvedValue({
        ...baseSection,
        enrollments: [],
        offerings: [{ teacherId: 't-1' }],
      });

      const result = await service.findOne('sec-1', organizationId);

      expect(result.teacherId).toBe('t-1');
      expect(result.enrollments).toEqual([]);
    });
  });

  describe('assignTeacher', () => {
    const sectionRow = { ...baseSection, offerings: [] };

    beforeEach(() => {
      mockPrisma.section.findFirst.mockResolvedValue(sectionRow);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 't-1' });
      mockPrisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
      mockPrisma.courseOffering.upsert.mockResolvedValue({ id: 'of-1' });
    });

    it('throws when the section is missing', async () => {
      mockPrisma.section.findFirst.mockResolvedValue(null);

      await expect(
        service.assignTeacher('sec-9', 't-1', organizationId),
      ).rejects.toThrow('This class could not be found.');
    });

    it('throws when the teacher is not in the organization', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.assignTeacher('sec-1', 't-9', organizationId),
      ).rejects.toThrow('This teacher could not be found.');
    });

    it('throws when the grade has no course to attach', async () => {
      mockPrisma.course.findFirst.mockResolvedValue(null);

      await expect(
        service.assignTeacher('sec-1', 't-1', organizationId),
      ).rejects.toThrow(/no course to attach/);
    });

    it('upserts the offering with the chosen teacher and returns the class', async () => {
      mockPrisma.section.findFirst
        .mockResolvedValueOnce(sectionRow)
        .mockResolvedValueOnce({
          ...sectionRow,
          offerings: [{ teacherId: 't-1' }],
        });

      const result = await service.assignTeacher(
        'sec-1',
        't-1',
        organizationId,
      );

      const upsertCalls = mockPrisma.courseOffering.upsert.mock.calls as [
        {
          where: {
            courseId_sectionId: { courseId: string; sectionId: string };
          };
          update: { teacherId: string };
          create: Record<string, unknown>;
        },
      ][];
      expect(upsertCalls[0][0].where).toEqual({
        courseId_sectionId: { courseId: 'course-1', sectionId: 'sec-1' },
      });
      expect(upsertCalls[0][0].update).toEqual({ teacherId: 't-1' });
      expect(upsertCalls[0][0].create).toEqual(
        expect.objectContaining({ teacherId: 't-1', organizationId }),
      );
      expect(result.teacherId).toBe('t-1');
    });
  });

  describe('delegation', () => {
    it('delegates create/update/remove/enrollments to SectionsService', async () => {
      mockSectionsService.create.mockResolvedValue(baseSection);
      mockSectionsService.update.mockResolvedValue(baseSection);
      mockSectionsService.remove.mockResolvedValue(baseSection);
      mockSectionsService.addEnrollment.mockResolvedValue({});
      mockSectionsService.removeEnrollment.mockResolvedValue({});

      await service.create(
        { gradeLevelId: 'grade-1', name: 'X' },
        organizationId,
      );
      await service.update('sec-1', { name: 'Y' }, organizationId);
      await service.remove('sec-1', organizationId);
      await service.addEnrollment('sec-1', 'stu-1', organizationId);
      await service.removeEnrollment('sec-1', 'stu-1', organizationId);

      expect(mockSectionsService.create).toHaveBeenCalled();
      expect(mockSectionsService.update).toHaveBeenCalled();
      expect(mockSectionsService.remove).toHaveBeenCalled();
      expect(mockSectionsService.addEnrollment).toHaveBeenCalled();
      expect(mockSectionsService.removeEnrollment).toHaveBeenCalled();
    });
  });
});
