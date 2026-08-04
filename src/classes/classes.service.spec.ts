import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClassesService } from './classes.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ClassesService (tenant isolation)', () => {
  let service: ClassesService;

  const mockPrisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    class: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    enrollment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ClassesService>(ClassesService);
    jest.clearAllMocks();
  });

  it('returns only classes belonging to the requesting organization', async () => {
    mockPrisma.class.findMany.mockResolvedValue([
      { id: 'c1', organizationId: 'org-a' },
    ]);

    const result = await service.findAll('org-a');

    expect(mockPrisma.class.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
      include: { teacher: true, enrollments: true },
    });
    expect(result.every((c) => c.organizationId === 'org-a')).toBe(true);
  });

  it('throws NotFound when a class belongs to another organization', async () => {
    mockPrisma.class.findFirst.mockResolvedValue(null);

    await expect(service.findOne('class-of-org-b', 'org-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockPrisma.class.findFirst).toHaveBeenCalledWith({
      where: { id: 'class-of-org-b', organizationId: 'org-a' },
      include: { teacher: true, enrollments: { include: { student: true } } },
    });
  });

  it('scopes enrollment actions to the class organization', async () => {
    mockPrisma.enrollment.findFirst.mockResolvedValue(null);

    await expect(
      service.approveEnrollment('enrollment-of-org-b', 'org-a'),
    ).rejects.toThrow(NotFoundException);
    expect(mockPrisma.enrollment.findFirst).toHaveBeenCalledWith({
      where: { id: 'enrollment-of-org-b', class: { organizationId: 'org-a' } },
    });
  });
});
