import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService, COURSE_COLOR_TAGS } from './courses.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

describe('CoursesService', () => {
  let service: CoursesService;

  const mockPrisma = {
    gradeLevel: { findFirst: jest.fn() },
    course: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CoursesService>(CoursesService);
  });

  const organizationId = 'org-1';

  describe('create (colorTag auto-assign)', () => {
    beforeEach(() => {
      mockPrisma.gradeLevel.findFirst.mockResolvedValue({ id: 'grade-1' });
      mockPrisma.course.findUnique.mockResolvedValue(null);
      mockPrisma.course.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'course-new', ...data }),
      );
    });

    it('assigns the first unused palette color in sequence', async () => {
      mockPrisma.course.findMany.mockResolvedValue([
        { colorTag: COURSE_COLOR_TAGS[0] },
        { colorTag: COURSE_COLOR_TAGS[2] },
      ]);

      const result = await service.create(
        { gradeLevelId: 'grade-1', name: 'Physics' },
        organizationId,
      );

      expect(result.colorTag).toBe(COURSE_COLOR_TAGS[1]);
    });

    it('reuses a freed color before cycling (unused is preferred over sequence)', async () => {
      mockPrisma.course.findMany.mockResolvedValue([
        { colorTag: COURSE_COLOR_TAGS[0] },
      ]);

      const result = await service.create(
        { gradeLevelId: 'grade-1', name: 'Chemistry' },
        organizationId,
      );

      expect(result.colorTag).toBe(COURSE_COLOR_TAGS[1]);
    });

    it('cycles through the palette in order once every color is used', async () => {
      const allUsed = COURSE_COLOR_TAGS.map((colorTag) => ({ colorTag }));
      mockPrisma.course.findMany.mockResolvedValue(allUsed);

      const result = await service.create(
        { gradeLevelId: 'grade-1', name: 'Astronomy' },
        organizationId,
      );

      expect(result.colorTag).toBe(COURSE_COLOR_TAGS[0]);
    });

    it('scopes the used-color query to the organization', async () => {
      mockPrisma.course.findMany.mockResolvedValue([]);

      await service.create(
        { gradeLevelId: 'grade-1', name: 'Biology' },
        organizationId,
      );

      expect(mockPrisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId } }),
      );
    });
  });

  describe('create (existing rules intact)', () => {
    it('rejects when the grade level belongs to another organization', async () => {
      mockPrisma.gradeLevel.findFirst.mockResolvedValue(null);

      const err = await service
        .create({ gradeLevelId: 'grade-x', name: 'Math' }, organizationId)
        .catch((e: unknown) => e);

      expect((err as ApiError).code).toBe(ErrorCode.GRADE_LEVEL_NOT_FOUND);
      expect(mockPrisma.course.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate course name within the same grade level', async () => {
      mockPrisma.gradeLevel.findFirst.mockResolvedValue({ id: 'grade-1' });
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'existing' });

      const err = await service
        .create({ gradeLevelId: 'grade-1', name: 'Math' }, organizationId)
        .catch((e: unknown) => e);

      expect((err as ApiError).code).toBe(ErrorCode.COURSE_CONFLICT);
      expect((err as ApiError).getStatus()).toBe(HttpStatus.CONFLICT);
      expect(mockPrisma.course.create).not.toHaveBeenCalled();
    });
  });
});
