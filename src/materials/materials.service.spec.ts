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
  const offeringB = '00000000-0000-0000-0000-000000000002';
  const courseId = '00000000-0000-0000-0000-000000000010';

  const teacherUser = {
    id: 'teacher-1',
    role: 'TEACHER',
    organizationId,
  } as const;
  const adminUser = { id: 'admin-1', role: 'ADMIN', organizationId } as const;

  const mockPrisma = {
    courseOffering: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    course: {
      findFirst: jest.fn(),
    },
    section: {
      findFirst: jest.fn(),
    },
    assignment: {
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

  describe('upload (legacy offering path)', () => {
    const title = 'Test Material';

    function mockLegacyOffering(overrides: Record<string, unknown> = {}) {
      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
        teacherId: teacherUser.id,
        courseId,
        ...overrides,
      });
    }

    it('should chunk and embed a text file scoped to the offering', async () => {
      const text = 'Hello world. '.repeat(500);
      const buffer = Buffer.from(text);
      const filename = 'test.txt';

      mockLegacyOffering();
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
        buffer,
        filename,
        teacherUser,
        {
          courseOfferingId,
        },
      );

      expect(result.id).toBe('mat-1');
      expect(result.chunkCount).toBe(1);
      expect(mockLlm.embed).toHaveBeenCalled();
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalled();
      expect(mockPrisma.material.create).toHaveBeenCalledWith({
        data: {
          title,
          courseOfferingId,
          courseId,
          assignmentId: null,
          chapterId: null,
          createdById: teacherUser.id,
          fileUrl: filename,
          scopes: {
            create: [{ courseOfferingId }],
          },
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
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {
          courseOfferingId,
        }),
      ).rejects.toMatchObject({ code: 'OFFERING_NOT_FOUND' });

      expect(mockPrisma.courseOffering.findFirst).toHaveBeenCalledWith({
        where: { id: courseOfferingId, organizationId },
        select: { id: true, teacherId: true, courseId: true },
      });
    });

    it('should forbid a teacher from uploading to a section they do not teach', async () => {
      mockLegacyOffering({ teacherId: 'teacher-other' });

      await expect(
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {
          courseOfferingId,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.material.create).not.toHaveBeenCalled();
    });

    it('should allow an admin to upload to any section in the org', async () => {
      mockLegacyOffering({ teacherId: 'teacher-other' });
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId,
        chunks: [{ id: 'chunk-1', content: 'x' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(
        title,
        Buffer.from('x'),
        'x.txt',
        adminUser,
        {
          courseOfferingId,
        },
      );

      expect(result.id).toBe('mat-1');
    });

    it('should throw for empty text', async () => {
      const buffer = Buffer.from('   \n\n  ');
      const filename = 'empty.txt';

      mockLegacyOffering();
      await expect(
        service.upload(title, buffer, filename, teacherUser, {
          courseOfferingId,
        }),
      ).rejects.toMatchObject({ code: 'FILE_NO_TEXT' });
    });

    it('should upload a PDF to the bucket and persist the object path', async () => {
      const filename = 'lesson.pdf';
      const buffer = Buffer.from('%PDF-1.4 fake');

      mockLegacyOffering();
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
        buffer,
        filename,
        teacherUser,
        {
          courseOfferingId,
        },
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
      expect(result.chunkCount).toBe(1);
    });

    it('should roll back the created row and fail when storage upload rejects', async () => {
      const filename = 'lesson.pdf';
      const buffer = Buffer.from('%PDF-1.4 fake');

      mockLegacyOffering();
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
        service.upload(title, buffer, filename, teacherUser, {
          courseOfferingId,
        }),
      ).rejects.toThrow(BadGatewayException);

      expect(mockPrisma.material.delete).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
      });
      expect(mockPrisma.material.update).not.toHaveBeenCalled();
    });

    it('should reject an assignment that does not belong to the offering', async () => {
      mockLegacyOffering();
      mockPrisma.assignment.findFirst.mockResolvedValue(null);

      await expect(
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {
          courseOfferingId,
          assignmentId: 'assign-other',
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_FOUND' });
    });

    it('should link the material to an explicit chapter', async () => {
      const buffer = Buffer.from('Just some flat text here.'.repeat(40));

      mockLegacyOffering();
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

      const result = await service.upload('T', buffer, 'x.txt', teacherUser, {
        courseOfferingId,
        chapterId: 'ch-1',
      });

      expect(result.chapterId).toBe('ch-1');
      const createCalls = mockPrisma.material.create.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(createCalls[0][0].data).toEqual(
        expect.objectContaining({ chapterId: 'ch-1' }),
      );
    });

    it('should reject a chapter that belongs to another class', async () => {
      mockLegacyOffering();
      mockPrisma.materialChapter.findFirst.mockResolvedValue(null);

      await expect(
        service.upload('T', Buffer.from('x'), 'x.txt', teacherUser, {
          courseOfferingId,
          chapterId: 'ch-other',
        }),
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

      mockLegacyOffering();
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
        Buffer.from(text),
        'book.txt',
        teacherUser,
        {
          courseOfferingId,
        },
      );

      expect(mockPrisma.materialChapter.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.materialChapter.create).toHaveBeenNthCalledWith(1, {
        data: {
          courseOfferingId,
          courseId,
          title: 'Chapter 1 Introduction',
          order: 0,
        },
      });
      expect(result.chapterId).toBe('auto-1');
      expect(result.detectedChapterCount).toBe(2);
    });
  });

  describe('upload (course path)', () => {
    const title = 'Test Material';

    it("should scope a course upload to all of the teacher's sections", async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        { id: courseOfferingId },
        { id: offeringB },
      ]);
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId: null,
        courseId,
        chunks: [{ id: 'chunk-1', content: 'x' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(
        title,
        Buffer.from('x'),
        'x.txt',
        teacherUser,
        {
          courseId,
        },
      );

      expect(result.courseId).toBe(courseId);
      expect(result.courseOfferingId).toBeNull();
      expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
        where: { courseId, organizationId, teacherId: teacherUser.id },
        select: { id: true },
      });
      const createCalls = mockPrisma.material.create.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(createCalls[0][0].data).toEqual(
        expect.objectContaining({
          courseOfferingId: null,
          courseId,
          createdById: teacherUser.id,
          scopes: {
            create: [{ courseOfferingId }, { courseOfferingId: offeringB }],
          },
        }),
      );
    });

    it('should scope to a single offering when the teacher teaches one section', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        { id: courseOfferingId },
      ]);
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId: null,
        courseId,
        chunks: [{ id: 'chunk-1', content: 'x' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(
        title,
        Buffer.from('x'),
        'x.txt',
        teacherUser,
        {
          courseId,
        },
      );

      const createCalls = mockPrisma.material.create.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(createCalls[0][0].data).toEqual(
        expect.objectContaining({
          scopes: { create: [{ courseOfferingId }] },
        }),
      );
      expect(result.courseId).toBe(courseId);
    });

    it('should forbid a course upload when the teacher teaches no sections', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([]);

      await expect(
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {
          courseId,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.material.create).not.toHaveBeenCalled();
    });

    it('should scope an admin course upload to all org offerings of the course', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        { id: courseOfferingId },
        { id: offeringB },
      ]);
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId: null,
        courseId,
        chunks: [{ id: 'chunk-1', content: 'x' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      await service.upload(title, Buffer.from('x'), 'x.txt', adminUser, {
        courseId,
      });

      expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
        where: { courseId, organizationId },
        select: { id: true },
      });
    });

    it('should reject an assignment on the course path', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });

      await expect(
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {
          courseId,
          assignmentId: 'assign-1',
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_FOUND' });
      expect(mockPrisma.courseOffering.findMany).not.toHaveBeenCalled();
    });

    it('should throw when the course does not exist', async () => {
      mockPrisma.course.findFirst.mockResolvedValue(null);

      await expect(
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {
          courseId,
        }),
      ).rejects.toMatchObject({ code: 'COURSE_NOT_FOUND' });
    });

    it('should require exactly one target', async () => {
      await expect(
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {}),
      ).rejects.toMatchObject({ code: 'INVALID_UPLOAD_TARGET' });
    });

    it('should store course PDFs under the course path', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        { id: courseOfferingId },
      ]);
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId: null,
        courseId,
        fileUrl: null,
        chunks: [{ id: 'chunk-1', content: 'text' }],
      });
      mockStorageBucket.upload.mockResolvedValue({ error: null });
      mockPrisma.material.update.mockResolvedValue({
        id: 'mat-1',
        fileUrl: `materials/${courseId}/mat-1.pdf`,
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      await service.upload(
        title,
        Buffer.from('%PDF-1.4 fake'),
        'lesson.pdf',
        teacherUser,
        {
          courseId,
        },
      );

      const expectedPath = `materials/${courseId}/mat-1.pdf`;
      expect(mockStorageBucket.upload).toHaveBeenCalledWith(
        expectedPath,
        expect.any(Buffer),
        { contentType: 'application/pdf' },
      );
      expect(mockPrisma.material.update).toHaveBeenCalledWith({
        where: { id: 'mat-1' },
        data: { fileUrl: expectedPath },
      });
    });

    it('should auto-create course-level chapters (courseOfferingId null)', async () => {
      const text = [
        'Chapter 1: Cell Biology —',
        'The cell is the basic structural unit and functional unit of life.',
        'The cell theory rests on three principles about living organisms.',
        'All living organisms are composed of one or more cells.',
        'The smallest unit of life is the cell itself.',
        'Cells arise from pre-existing cells through cell division.',
      ].join('\n');

      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        { id: courseOfferingId },
      ]);
      mockPrisma.materialChapter.aggregate.mockResolvedValue({
        _max: { order: null },
      });
      mockPrisma.materialChapter.create.mockResolvedValueOnce({
        id: 'auto-1',
        order: 0,
      });
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title: 'T',
        courseOfferingId: null,
        courseId,
        chapterId: 'auto-1',
        chunks: [{ id: 'c1', content: 'x' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.upload(
        'T',
        Buffer.from(text),
        'book.txt',
        teacherUser,
        {
          courseId,
        },
      );

      expect(mockPrisma.materialChapter.aggregate).toHaveBeenCalledWith({
        where: { courseId, courseOfferingId: null },
        _max: { order: true },
      });
      expect(mockPrisma.materialChapter.create).toHaveBeenNthCalledWith(1, {
        data: {
          courseId,
          title: 'Chapter 1: Cell Biology',
          order: 0,
        },
      });
      expect(result.chapterId).toBe('auto-1');
    });
  });

  describe('upload (section path)', () => {
    const title = 'Test Material';
    const sectionId = '00000000-0000-0000-0000-000000000003';

    function mockSectionUpload(
      offerings: Array<{ id: string; courseId: string }>,
    ) {
      mockPrisma.section.findFirst.mockResolvedValue({ id: sectionId });
      mockPrisma.courseOffering.findMany.mockResolvedValue(offerings);
      mockPrisma.material.create.mockResolvedValue({
        id: 'mat-1',
        title,
        courseOfferingId: null,
        courseId,
        chunks: [{ id: 'chunk-1', content: 'text' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);
    }

    it('should scope a section upload to the section offering for the selected course', async () => {
      const text = 'Hello world. '.repeat(500);
      mockSectionUpload([{ id: courseOfferingId, courseId }]);

      const result = await service.upload(
        title,
        Buffer.from(text),
        't.txt',
        teacherUser,
        { sectionId, courseId },
      );

      expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
        where: {
          sectionId,
          organizationId,
          courseId,
          teacherId: teacherUser.id,
        },
        select: { id: true, courseId: true },
      });
      const createCalls = mockPrisma.material.create.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(createCalls[0][0].data).toEqual(
        expect.objectContaining({
          title,
          courseOfferingId,
          courseId,
          createdById: teacherUser.id,
          scopes: { create: [{ courseOfferingId }] },
        }),
      );
      expect(result.courseId).toBe(courseId);
    });

    it("should scope a section upload to all of the teacher's offerings when no course is given", async () => {
      mockSectionUpload([
        { id: courseOfferingId, courseId },
        { id: offeringB, courseId },
      ]);

      await service.upload(
        title,
        Buffer.from('x '.repeat(300)),
        't.txt',
        teacherUser,
        {
          sectionId,
        },
      );

      expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
        where: { sectionId, organizationId, teacherId: teacherUser.id },
        select: { id: true, courseId: true },
      });
      const createCalls = mockPrisma.material.create.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(createCalls[0][0].data).toEqual(
        expect.objectContaining({
          courseOfferingId,
          scopes: {
            create: [{ courseOfferingId }, { courseOfferingId: offeringB }],
          },
        }),
      );
    });

    it('should forbid a section upload for a course the teacher does not teach in the section', async () => {
      mockPrisma.section.findFirst.mockResolvedValue({ id: sectionId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([]);

      await expect(
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {
          sectionId,
          courseId,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('should reject a section upload that attaches an assignment', async () => {
      mockPrisma.section.findFirst.mockResolvedValue({ id: sectionId });

      await expect(
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {
          sectionId,
          courseId,
          assignmentId: 'assign-1',
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_FOUND' });
    });

    it('should throw when the section does not exist', async () => {
      mockPrisma.section.findFirst.mockResolvedValue(null);

      await expect(
        service.upload(title, Buffer.from('x'), 'x.txt', teacherUser, {
          sectionId,
          courseId,
        }),
      ).rejects.toMatchObject({ code: 'SECTION_NOT_FOUND' });
    });

    it('should scope an admin section upload to all org offerings of the course', async () => {
      mockSectionUpload([
        { id: courseOfferingId, courseId },
        { id: offeringB, courseId },
      ]);

      await service.upload(
        title,
        Buffer.from('x '.repeat(300)),
        't.txt',
        adminUser,
        {
          sectionId,
          courseId,
        },
      );

      expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
        where: { sectionId, organizationId, courseId },
        select: { id: true, courseId: true },
      });
    });
  });

  describe('findByOffering', () => {
    it('should return legacy and scoped materials for a course offering', async () => {
      mockPrisma.material.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          title: 'M1',
          courseOfferingId: 'of-1',
          _count: { chunks: 3 },
        },
      ]);
      mockPrisma.courseOffering.findFirst.mockResolvedValue({ id: 'of-1' });

      const result = await service.findByOffering('of-1', organizationId);

      expect(result).toHaveLength(1);
      expect(mockPrisma.material.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            {
              courseOfferingId: { in: ['of-1'] },
              offering: { organizationId },
            },
            {
              scopes: {
                some: {
                  courseOfferingId: { in: ['of-1'] },
                  offering: { organizationId },
                },
              },
            },
          ],
        },
        include: {
          _count: { select: { chunks: true } },
          course: { select: { name: true } },
          offering: { select: { course: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should include course-scoped materials covered by the offering', async () => {
      mockPrisma.material.findMany.mockResolvedValue([
        { id: 'mat-course', courseOfferingId: null, _count: { chunks: 2 } },
      ]);
      mockPrisma.courseOffering.findFirst.mockResolvedValue({ id: 'of-1' });

      const result = await service.findByOffering('of-1', organizationId);

      expect(result).toHaveLength(1);
      const findCalls = mockPrisma.material.findMany.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      const where = findCalls[0][0].where as {
        OR?: { scopes?: { some?: unknown } }[];
      };
      const scopedBranch = where.OR?.find((b) => b.scopes);
      expect(scopedBranch?.scopes?.some).toEqual({
        courseOfferingId: { in: ['of-1'] },
        offering: { organizationId },
      });
    });
  });

  describe('findByCourse', () => {
    it('should let a teacher see only materials scoped to their own offerings', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        { id: courseOfferingId },
      ]);
      mockPrisma.material.findMany.mockResolvedValue([
        {
          id: 'mat-1',
          courseOfferingId: null,
          courseId,
          _count: { chunks: 1 },
        },
      ]);

      await service.findByCourse(courseId, organizationId, teacherUser);

      expect(mockPrisma.material.findMany).toHaveBeenCalledWith({
        where: {
          courseId,
          OR: [
            { courseOfferingId: { in: [courseOfferingId] } },
            {
              scopes: {
                some: { courseOfferingId: { in: [courseOfferingId] } },
              },
            },
          ],
        },
        include: {
          _count: { select: { chunks: true } },
          course: { select: { name: true } },
          offering: { select: { course: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it("should isolate a teacher from another teacher's materials", async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([]);
      mockPrisma.material.findMany.mockResolvedValue([]);

      await service.findByCourse(courseId, organizationId, teacherUser);

      // No offerings in scope → the query must match nothing.
      expect(mockPrisma.material.findMany).toHaveBeenCalledWith({
        where: {
          courseId,
          id: '00000000-0000-0000-0000-000000000000',
        },
        include: {
          _count: { select: { chunks: true } },
          course: { select: { name: true } },
          offering: { select: { course: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should let an admin see all org course materials', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.material.findMany.mockResolvedValue([]);

      await service.findByCourse(courseId, organizationId, adminUser);

      expect(mockPrisma.courseOffering.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.material.findMany).toHaveBeenCalledWith({
        where: { courseId },
        include: {
          _count: { select: { chunks: true } },
          course: { select: { name: true } },
          offering: { select: { course: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should scope a student to their enrolled offering', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.courseOffering.findMany.mockResolvedValue([
        { id: courseOfferingId },
      ]);
      mockPrisma.material.findMany.mockResolvedValue([]);

      await service.findByCourse(courseId, organizationId, {
        id: 'student-1',
        role: 'STUDENT',
        organizationId,
      } as never);

      expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith({
        where: {
          courseId,
          organizationId,
          section: {
            enrollments: {
              some: { studentId: 'student-1', status: 'APPROVED' },
            },
          },
        },
        select: { id: true },
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

    it('should resolve course-scoped rows via the course organization', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        id: 'mat-course',
        title: 'M1',
        chunks: [],
      });

      await service.findOne('mat-course', organizationId);

      expect(mockPrisma.material.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'mat-course',
          OR: [
            { offering: { organizationId } },
            { course: { organizationId } },
          ],
        },
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

    it('should include scoped rows via material_section_scopes', async () => {
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await service.searchChunks('of-1', 'query', 3);

      const call = mockPrisma.$queryRaw.mock.calls[0] as unknown as [
        string[],
        unknown,
      ];
      const sql = call[0].join('');
      expect(sql).toContain('material_section_scopes');
      expect(sql).toContain('m."courseOfferingId"');
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

    it('should resolve a section id to its offerings when an organization is given', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue(null);
      mockPrisma.section.findFirst.mockResolvedValue({
        offerings: [{ id: 'of-1' }, { id: 'of-2' }],
      });
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await service.searchChunks(
        'section-1',
        'query',
        3,
        undefined,
        organizationId,
      );

      expect(mockPrisma.section.findFirst).toHaveBeenCalledWith({
        where: { id: 'section-1', organizationId },
        select: { offerings: { select: { id: true } } },
      });
      const call = mockPrisma.$queryRaw.mock.calls[0] as unknown as [
        string[],
        unknown,
      ];
      expect(call[0].join('')).toContain('IN (');
      expect(JSON.stringify(call)).toContain('of-1');
      expect(JSON.stringify(call)).toContain('of-2');
    });
  });

  describe('searchChunksByCourse', () => {
    it('should filter by m."courseId" and not drop null-offering rows', async () => {
      mockLlm.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await service.searchChunksByCourse(courseId, 'query', 3);

      const call = mockPrisma.$queryRaw.mock.calls[0] as unknown as [
        string[],
        unknown,
      ];
      const sql = call[0].join('');
      expect(sql).toContain('m."courseId"');
      expect(sql).not.toContain('JOIN course_offerings');
    });
  });

  describe('getChunksByChapter', () => {
    it('should return a unit chunk without an embedding distance filter', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'chunk-1',
          content: 'content',
          distance: 0,
          materialId: 'material-1',
          materialTitle: 'Material',
          chapterId: 'ch-1',
          chapterTitle: 'Unit 1',
        },
      ]);

      const result = await service.getChunksByChapter(courseId, 'ch-1', 50);

      const call = mockPrisma.$queryRaw.mock.calls[0] as unknown as [
        string[],
        unknown,
      ];
      const sql = call[0].join('');
      expect(sql).toContain('m."chapterId" = ');
      expect(sql).not.toContain('<=>');
      expect(sql).not.toContain('embedding IS NOT NULL');
      expect(result[0].chapterTitle).toBe('Unit 1');
    });
  });

  describe('listChaptersWithMaterial', () => {
    it('should return chapters that have material with chunks', async () => {
      mockPrisma.materialChapter.findMany.mockResolvedValue([
        { id: 'ch-1', title: 'Unit 1' },
      ]);

      const result = await service.listChaptersWithMaterial(courseId);

      expect(mockPrisma.materialChapter.findMany).toHaveBeenCalledWith({
        where: {
          courseId,
          materials: { some: { chunks: { some: {} } } },
        },
        select: { id: true, title: true },
        orderBy: { order: 'asc' },
      });
      expect(result).toEqual([{ id: 'ch-1', title: 'Unit 1' }]);
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
        { courseOfferingId },
        'Chapter 9',
        organizationId,
      );

      expect(mockPrisma.materialChapter.create).toHaveBeenCalledWith({
        data: {
          courseOfferingId,
          courseId: undefined,
          title: 'Chapter 9',
          order: 5,
        },
      });
      expect(result.order).toBe(5);
    });

    it('should create a course-level chapter when target is a courseId', async () => {
      mockPrisma.course.findFirst.mockResolvedValue({ id: courseId });
      mockPrisma.materialChapter.aggregate.mockResolvedValue({
        _max: { order: 0 },
      });
      mockPrisma.materialChapter.create.mockResolvedValue({
        id: 'ch-course',
        courseId,
        title: 'Course Chapter',
        order: 1,
      });

      const result = await service.createChapter(
        { courseId },
        'Course Chapter',
        organizationId,
      );

      expect(mockPrisma.materialChapter.create).toHaveBeenCalledWith({
        data: {
          courseId,
          title: 'Course Chapter',
          order: 1,
        },
      });
      expect(result.courseId).toBe(courseId);
    });

    it('should create a section chapter scoped to the section offering', async () => {
      mockPrisma.section.findFirst.mockResolvedValue({ id: courseOfferingId });
      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
        courseId,
      });
      mockPrisma.materialChapter.aggregate.mockResolvedValue({
        _max: { order: 0 },
      });
      mockPrisma.materialChapter.create.mockResolvedValue({
        id: 'ch-sec',
        courseOfferingId,
        courseId,
        title: 'Section Chapter',
        order: 1,
      });

      const result = await service.createChapter(
        { sectionId: courseOfferingId, courseId },
        'Section Chapter',
        organizationId,
      );

      expect(mockPrisma.courseOffering.findFirst).toHaveBeenCalledWith({
        where: {
          sectionId: courseOfferingId,
          courseId,
          organizationId,
        },
        select: { id: true, courseId: true },
      });
      expect(result.courseOfferingId).toBe(courseOfferingId);
    });

    it('should reject a chapter for a missing section', async () => {
      mockPrisma.section.findFirst.mockResolvedValue(null);

      await expect(
        service.createChapter(
          { sectionId: courseOfferingId, courseId },
          'X',
          organizationId,
        ),
      ).rejects.toMatchObject({ code: 'SECTION_NOT_FOUND' });
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

    it('should resolve course-scoped materials when moving', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        id: 'mat-course',
        courseOfferingId: null,
        courseId,
      });
      mockPrisma.materialChapter.findFirst.mockResolvedValue({ id: 'ch-2' });
      mockPrisma.material.update.mockResolvedValue({
        id: 'mat-course',
        chapterId: 'ch-2',
      });

      await service.moveMaterialToChapter('mat-course', 'ch-2', organizationId);

      expect(mockPrisma.material.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'mat-course',
          OR: [
            { offering: { organizationId } },
            { course: { organizationId } },
          ],
        },
        select: { id: true, courseOfferingId: true, courseId: true },
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

    it('should return offering and course chapters plus ungrouped materials', async () => {
      mockPrisma.courseOffering.findFirst.mockResolvedValue({
        id: courseOfferingId,
      });
      mockPrisma.courseOffering.findMany.mockResolvedValue([{ courseId }]);
      mockPrisma.materialChapter.findMany
        .mockResolvedValueOnce([
          { id: 'ch-off', title: 'Offering chapter', order: 0, materials: [] },
        ])
        .mockResolvedValueOnce([
          { id: 'ch-course', title: 'Course chapter', order: 1, materials: [] },
        ]);
      mockPrisma.material.findMany.mockResolvedValue([
        { id: 'm-x', title: 'Loose' },
      ]);

      const result = await service.findByOfferingGrouped(
        courseOfferingId,
        organizationId,
      );

      expect(result.chapters).toHaveLength(2);
      expect(result.chapters.map((c) => c.id)).toEqual(['ch-off', 'ch-course']);
      expect(result.unassigned).toHaveLength(1);
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
      scopes: [],
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

    it('should forbid a teacher who does not teach any scoped offering', async () => {
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

    it('should allow access to a course-scoped material via any scoped offering', async () => {
      const scopedBase = {
        ...materialBase,
        courseOfferingId: null,
        offering: null,
        scopes: [
          {
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
          },
        ],
      };
      mockPrisma.material.findUnique.mockResolvedValue(scopedBase);
      mockStorageBucket.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://signed/url' },
        error: null,
      });

      const result = await service.getMaterialFileUrl('mat-course', {
        id: 'teacher-1',
        role: 'TEACHER',
      } as never);

      expect(result.url).toBe('https://signed/url');
    });

    it('should forbid access to a course-scoped material when not in any scoped offering', async () => {
      const scopedBase = {
        ...materialBase,
        courseOfferingId: null,
        offering: null,
        scopes: [
          {
            offering: {
              teacherId: 'teacher-other',
              section: {
                enrollments: [
                  {
                    student: { id: 'student-other', guardianId: null },
                  },
                ],
              },
            },
          },
        ],
      };
      mockPrisma.material.findUnique.mockResolvedValue(scopedBase);

      await expect(
        service.getMaterialFileUrl('mat-course', {
          id: 'teacher-1',
          role: 'TEACHER',
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

    it('should scope deletion to the organization and resolve course rows', async () => {
      mockPrisma.material.findFirst.mockResolvedValue(null);

      await expect(
        service.delete('org-b-material', organizationId),
      ).rejects.toMatchObject({ code: 'MATERIAL_NOT_FOUND' });
      expect(mockPrisma.material.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'org-b-material',
          OR: [
            { offering: { organizationId } },
            { course: { organizationId } },
          ],
        },
      });
    });
  });
});
