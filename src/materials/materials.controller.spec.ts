import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MulterModule } from '@nestjs/platform-express';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

const CLASS_ID = '00000000-0000-0000-0000-000000000001';
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
      .field('classId', CLASS_ID)
      .expect(201);

    expect(mockMaterialsService.upload).toHaveBeenCalledWith(
      'Sample',
      CLASS_ID,
      expect.any(Buffer),
      'sample.pdf',
      ORGANIZATION_ID,
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
      .field('classId', CLASS_ID)
      .expect(201);

    expect(mockMaterialsService.upload).toHaveBeenCalledWith(
      'Notes',
      CLASS_ID,
      expect.any(Buffer),
      'notes.txt',
      ORGANIZATION_ID,
    );
  });
});
