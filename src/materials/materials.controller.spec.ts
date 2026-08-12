import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MulterModule } from '@nestjs/platform-express';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

const COURSE_OFFERING_ID = '00000000-0000-0000-0000-000000000001';
const ORGANIZATION_ID = 'org-1';

describe('MaterialsController (upload)', () => {
  let app: INestApplication<App>;

  const mockMaterialsService = {
    upload: jest.fn<
      Promise<{ id: string; chunkCount: number }>,
      [string, string, Buffer, string, string]
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
      COURSE_OFFERING_ID,
      expect.any(Buffer),
      'sample.pdf',
      ORGANIZATION_ID,
      undefined,
      undefined,
    );
    const bufferArg = mockMaterialsService.upload.mock.calls[0][2];
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
      COURSE_OFFERING_ID,
      expect.any(Buffer),
      'notes.txt',
      ORGANIZATION_ID,
      undefined,
      undefined,
    );
  });

  it('should forward the chapter id to the service', async () => {
    await request(app.getHttpServer())
      .post('/materials/upload')
      .attach('file', Buffer.from('hello world'), 'notes.txt')
      .field('title', 'Notes')
      .field('courseOfferingId', COURSE_OFFERING_ID)
      .field('chapterId', '00000000-0000-0000-0000-000000000099')
      .expect(201);

    expect(mockMaterialsService.upload).toHaveBeenCalledWith(
      'Notes',
      COURSE_OFFERING_ID,
      expect.any(Buffer),
      'notes.txt',
      ORGANIZATION_ID,
      undefined,
      '00000000-0000-0000-0000-000000000099',
    );
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
      COURSE_OFFERING_ID,
      'Chapter 1',
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
      init(): Promise<void>;
      close(): Promise<void>;
    };
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
    );
    await searchApp.close();
  });
});
