import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    await service.$disconnect().catch(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have $connect and $disconnect methods', () => {
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
  });
});
