import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const ORG_ID = 'org-1';
const ADMIN_ID = 'admin-1';

describe('UsersController', () => {
  let app: INestApplication<App>;

  const mockUsersService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(
      (
        req: { user?: { organizationId: string; id: string } },
        _res: unknown,
        next: () => void,
      ) => {
        req.user = { organizationId: ORG_ID, id: ADMIN_ID };
        next();
      },
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists users scoped to the caller organization', async () => {
    mockUsersService.findAll.mockResolvedValue([]);

    await request(app.getHttpServer()).get('/users').expect(200);

    expect(mockUsersService.findAll).toHaveBeenCalledWith(
      { role: undefined, q: undefined },
      ORG_ID,
    );
  });

  it('passes role and search filters through', async () => {
    mockUsersService.findAll.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/users')
      .query({ role: 'STUDENT', q: 'ali' })
      .expect(200);

    expect(mockUsersService.findAll).toHaveBeenCalledWith(
      { role: 'STUDENT', q: 'ali' },
      ORG_ID,
    );
  });

  it('returns full details for a single user', async () => {
    mockUsersService.findOne.mockResolvedValue({ id: 'u-1' });

    await request(app.getHttpServer()).get('/users/u-1').expect(200);

    expect(mockUsersService.findOne).toHaveBeenCalledWith('u-1', ORG_ID);
  });

  it('deletes a user with the admin id', async () => {
    mockUsersService.remove.mockResolvedValue({ id: 'u-1', deletedAt: 'x' });

    await request(app.getHttpServer()).delete('/users/u-1').expect(200);

    expect(mockUsersService.remove).toHaveBeenCalledWith(
      'u-1',
      ORG_ID,
      ADMIN_ID,
    );
  });

  it('requires the ADMIN role on every endpoint', () => {
    const handler = (name: string) =>
      Object.getOwnPropertyDescriptor(UsersController.prototype, name)!
        .value as () => void;

    expect(Reflect.getMetadata('roles', handler('findAll'))).toEqual(['ADMIN']);
    expect(Reflect.getMetadata('roles', handler('findOne'))).toEqual(['ADMIN']);
    expect(Reflect.getMetadata('roles', handler('remove'))).toEqual(['ADMIN']);
  });
});
