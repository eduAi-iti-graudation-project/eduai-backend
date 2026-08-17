import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MulterModule } from '@nestjs/platform-express';
import { ZodValidationPipe } from 'nestjs-zod';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

const COURSE_OFFERING_ID = 'f393ec45-b984-43f9-a8bd-b9fe5d41b712';
const COURSE_ID = '06704ba5-2172-4cf9-a4f5-31bf7ef2606f';
const CHAPTER_ID = '11111111-2222-4333-8444-555555555555';
const ORGANIZATION_ID = 'org-1';
const TEACHER = {
  id: 'teacher-1',
  role: 'TEACHER',
  organizationId: ORGANIZATION_ID,
};

describe('MaterialsController (upload)', () => {
  let app: INestApplication<App>;

  const mockMaterialsService = {
    upload: jest.fn<
      Promise<{ id: string; chunkCount: number }>,
      [string, Buffer, string, Record<string, unknown>, Record<string, unknown>]
    >(),
    findByClass: jest.fn(),
    findOne: jest.fn(),
    searchChunks: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MulterModule.register({ dest: './uploads' })],
      controllers: [MaterialsController],
      providers: [
        { provide: MaterialsService, useValue: mockMaterialsService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    app.use(
      (
        req: {
          user?: { id: string; role: string; organizationId: string };
        },
        _res: unknown,
        next: () => void,
      ) => {
        req.user = TEACHER;
        next();
      },
    );
    await app.init();
    mockMaterialsService.upload
      .mockReset()
      .mockResolvedValue({ id: 'm1', chunkCount: 1 });
  });

  afterEach(async () => {
    await app.close();
  });

  it('should pass the uploaded PDF file buffer to the service', async () => {
    const pdfBytes = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
        'trailer<</Size 3/Root 1 0 R>>\n%%EOF',
    );

    await request(app.getHttpServer())
      .post('/materials/upload')
      .attach('file', pdfBytes, 'sample.pdf')
      .field('title', 'Sample')
      .field('courseOfferingId', COURSE_OFFERING_ID)
      .expect(201);

    expect(mockMaterialsService.upload).toHaveBeenCalledWith(
      'Sample',
      expect.any(Buffer),
      'sample.pdf',
      TEACHER,
      {
        courseOfferingId: COURSE_OFFERING_ID,
        sectionId: undefined,
        courseId: undefined,
        assignmentId: undefined,
        chapterId: undefined,
      },
    );
    const bufferArg = mockMaterialsService.upload.mock.calls[0][1];
    expect(Buffer.isBuffer(bufferArg)).toBe(true);
    expect(bufferArg.length).toBeGreaterThan(0);
  });

  it('should pass the uploaded text file buffer to the service', async () => {
    await request(app.getHttpServer())
      .post('/materials/upload')
      .attach('file', Buffer.from('hello world'), 'notes.txt')
      .field('title', 'Notes')
      .field('courseOfferingId', COURSE_OFFERING_ID)
      .expect(201);

    expect(mockMaterialsService.upload).toHaveBeenCalledWith(
      'Notes',
      expect.any(Buffer),
      'notes.txt',
      TEACHER,
      {
        courseOfferingId: COURSE_OFFERING_ID,
        sectionId: undefined,
        courseId: undefined,
        assignmentId: undefined,
        chapterId: undefined,
      },
    );
  });

  it('should forward the chapter id to the service', async () => {
    await request(app.getHttpServer())
      .post('/materials/upload')
      .attach('file', Buffer.from('hello world'), 'notes.txt')
      .field('title', 'Notes')
      .field('courseOfferingId', COURSE_OFFERING_ID)
      .field('chapterId', CHAPTER_ID)
      .expect(201);

    expect(mockMaterialsService.upload).toHaveBeenCalledWith(
      'Notes',
      expect.any(Buffer),
      'notes.txt',
      TEACHER,
      {
        courseOfferingId: COURSE_OFFERING_ID,
        sectionId: undefined,
        courseId: undefined,
        assignmentId: undefined,
        chapterId: CHAPTER_ID,
      },
    );
  });

  it('should pass courseId to the service for a course upload', async () => {
    await request(app.getHttpServer())
      .post('/materials/upload')
      .attach('file', Buffer.from('hello world'), 'notes.txt')
      .field('title', 'Notes')
      .field('courseId', COURSE_ID)
      .expect(201);

    expect(mockMaterialsService.upload).toHaveBeenCalledWith(
      'Notes',
      expect.any(Buffer),
      'notes.txt',
      TEACHER,
      {
        courseOfferingId: undefined,
        sectionId: undefined,
        courseId: COURSE_ID,
        assignmentId: undefined,
        chapterId: undefined,
      },
    );
  });

  it('should pass sectionId and courseId to the service for a section upload', async () => {
    await request(app.getHttpServer())
      .post('/materials/upload')
      .attach('file', Buffer.from('hello world'), 'notes.txt')
      .field('title', 'Notes')
      .field('sectionId', COURSE_OFFERING_ID)
      .field('courseId', COURSE_ID)
      .expect(201);

    expect(mockMaterialsService.upload).toHaveBeenCalledWith(
      'Notes',
      expect.any(Buffer),
      'notes.txt',
      TEACHER,
      {
        courseOfferingId: undefined,
        sectionId: COURSE_OFFERING_ID,
        courseId: COURSE_ID,
        assignmentId: undefined,
        chapterId: undefined,
      },
    );
  });

  it('should reject an upload that supplies both courseOfferingId and sectionId', async () => {
    await request(app.getHttpServer())
      .post('/materials/upload')
      .attach('file', Buffer.from('hello world'), 'notes.txt')
      .field('title', 'Notes')
      .field('courseOfferingId', COURSE_OFFERING_ID)
      .field('sectionId', COURSE_OFFERING_ID)
      .expect(400);
    expect(mockMaterialsService.upload).not.toHaveBeenCalled();
  });

  it('should reject an upload that supplies both courseOfferingId and courseId', async () => {
    await request(app.getHttpServer())
      .post('/materials/upload')
      .attach('file', Buffer.from('hello world'), 'notes.txt')
      .field('title', 'Notes')
      .field('courseOfferingId', COURSE_OFFERING_ID)
      .field('courseId', COURSE_ID)
      .expect(400);
    expect(mockMaterialsService.upload).not.toHaveBeenCalled();
  });

  it('should reject an upload that supplies no target', async () => {
    await request(app.getHttpServer())
      .post('/materials/upload')
      .attach('file', Buffer.from('hello world'), 'notes.txt')
      .field('title', 'Notes')
      .expect(400);
    expect(mockMaterialsService.upload).not.toHaveBeenCalled();
  });
});

describe('MaterialsController (chapters)', () => {
  let app: INestApplication<App>;

  const mockMaterialsService = {
    createChapter: jest.fn(),
    updateChapter: jest.fn(),
    deleteChapter: jest.fn(),
    moveMaterialToChapter: jest.fn(),
    findByOfferingGrouped: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MaterialsController],
      providers: [
        { provide: MaterialsService, useValue: mockMaterialsService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(
      (
        req: { user?: { organizationId: string } },
        _res: unknown,
        next: () => void,
      ) => {
        req.user = { organizationId: ORGANIZATION_ID };
        next();
      },
    );
    await app.init();
    jest.clearAllMocks();
    mockMaterialsService.createChapter.mockResolvedValue({ id: 'ch-1' });
    mockMaterialsService.updateChapter.mockResolvedValue({ id: 'ch-1' });
    mockMaterialsService.deleteChapter.mockResolvedValue({ deleted: true });
    mockMaterialsService.moveMaterialToChapter.mockResolvedValue({
      id: 'm1',
      chapterId: 'ch-1',
    });
    mockMaterialsService.findByOfferingGrouped.mockResolvedValue({
      chapters: [],
      unassigned: [],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /materials/chapters creates a chapter', async () => {
    await request(app.getHttpServer())
      .post('/materials/chapters')
      .send({ courseOfferingId: COURSE_OFFERING_ID, title: 'Chapter 1' })
      .expect(201);

    expect(mockMaterialsService.createChapter).toHaveBeenCalledWith(
      { courseOfferingId: COURSE_OFFERING_ID },
      'Chapter 1',
      ORGANIZATION_ID,
    );
  });

  it('POST /materials/chapters creates a section chapter with a course', async () => {
    await request(app.getHttpServer())
      .post('/materials/chapters')
      .send({ sectionId: COURSE_OFFERING_ID, courseId: COURSE_ID, title: 'Ch' })
      .expect(201);

    expect(mockMaterialsService.createChapter).toHaveBeenCalledWith(
      { sectionId: COURSE_OFFERING_ID, courseId: COURSE_ID },
      'Ch',
      ORGANIZATION_ID,
    );
  });

  it('PATCH /materials/chapters/:id renames a chapter', async () => {
    await request(app.getHttpServer())
      .patch('/materials/chapters/ch-1')
      .send({ title: 'Renamed' })
      .expect(200);

    expect(mockMaterialsService.updateChapter).toHaveBeenCalledWith(
      'ch-1',
      ORGANIZATION_ID,
      { title: 'Renamed' },
    );
  });

  it('DELETE /materials/chapters/:id deletes a chapter', async () => {
    await request(app.getHttpServer())
      .delete('/materials/chapters/ch-1')
      .expect(200);

    expect(mockMaterialsService.deleteChapter).toHaveBeenCalledWith(
      'ch-1',
      ORGANIZATION_ID,
    );
  });

  it('POST /materials/chapters/:id/materials/:materialId links a material', async () => {
    await request(app.getHttpServer())
      .post('/materials/chapters/ch-1/materials/m-1')
      .expect(201);

    expect(mockMaterialsService.moveMaterialToChapter).toHaveBeenCalledWith(
      'm-1',
      'ch-1',
      ORGANIZATION_ID,
    );
  });

  it('DELETE /materials/chapters/:id/materials/:materialId unlinks a material', async () => {
    await request(app.getHttpServer())
      .delete('/materials/chapters/ch-1/materials/m-1')
      .expect(200);

    expect(mockMaterialsService.moveMaterialToChapter).toHaveBeenCalledWith(
      'm-1',
      null,
      ORGANIZATION_ID,
    );
  });

  it('GET /materials/chapters/offering/:courseOfferingId returns grouped materials', async () => {
    await request(app.getHttpServer())
      .get(`/materials/chapters/offering/${COURSE_OFFERING_ID}`)
      .expect(200);

    expect(mockMaterialsService.findByOfferingGrouped).toHaveBeenCalledWith(
      COURSE_OFFERING_ID,
      ORGANIZATION_ID,
    );
  });

  it('GET /materials/chapters/offering/:courseOfferingId/search passes chapterId', async () => {
    const service = {
      ...mockMaterialsService,
      searchChunks: jest.fn().mockResolvedValue([]),
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MaterialsController],
      providers: [{ provide: MaterialsService, useValue: service }],
    }).compile();
    const searchApp = moduleFixture.createNestApplication() as unknown as {
      getHttpServer(): Parameters<typeof request>[0];
      use(...args: unknown[]): unknown;
      init(): Promise<void>;
      close(): Promise<void>;
    };
    searchApp.use(
      (
        req: { user?: { organizationId: string } },
        _res: unknown,
        next: () => void,
      ) => {
        req.user = { organizationId: ORGANIZATION_ID };
        next();
      },
    );
    await searchApp.init();
    await request(searchApp.getHttpServer())
      .get(
        `/materials/offering/${COURSE_OFFERING_ID}/search?q=query&chapterId=${COURSE_OFFERING_ID}`,
      )
      .expect(200);
    expect(service.searchChunks).toHaveBeenCalledWith(
      COURSE_OFFERING_ID,
      'query',
      5,
      COURSE_OFFERING_ID,
      ORGANIZATION_ID,
    );
    await searchApp.close();
  });
});
