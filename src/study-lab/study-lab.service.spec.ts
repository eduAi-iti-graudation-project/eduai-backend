import { Test, TestingModule } from '@nestjs/testing';
import { StudyLabService } from './study-lab.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudyLabGenerators } from './study-lab.generators';
import { StudyLabGatewayService } from './study-lab.gateway.service';
import { SupabaseService } from '../auth/supabase.service';

describe('StudyLabService (getStudentOfferings)', () => {
  let service: StudyLabService;

  const offeringA = 'aaaaaaaa-1111-4111-8111-111111111111';
  const offeringB = 'bbbbbbbb-2222-4222-8222-222222222222';
  const courseX = 'cccccccc-3333-4333-8333-333333333333';
  const courseY = 'dddddddd-4444-4444-8444-444444444444';

  const mockPrisma = {
    studyGeneration: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    quizAttempt: { findFirst: jest.fn() },
    courseOffering: { findUnique: jest.fn() },
    section: { findMany: jest.fn() },
    material: { findMany: jest.fn() },
  };

  const mockGenerators = {
    ground: jest.fn(),
    podcastScript: jest.fn(),
    deck: jest.fn(),
    studyGuide: jest.fn(),
    flashcards: jest.fn(),
    practiceSet: jest.fn(),
    cheatSheet: jest.fn(),
  };

  const mockGateway = {
    audioEnabled: false,
    providerName: 'mock',
    synthesizeSpeech: jest.fn(),
    voicesFor: jest.fn(),
  };

  const mockSupabase = {
    getStorageClient: jest.fn(() => ({
      storage: { from: jest.fn(() => ({ upload: jest.fn() })) },
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudyLabService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StudyLabGenerators, useValue: mockGenerators },
        { provide: StudyLabGatewayService, useValue: mockGateway },
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get<StudyLabService>(StudyLabService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return one entry per course, deduped across sections', async () => {
    mockPrisma.section.findMany.mockResolvedValue([
      {
        id: 'section-1',
        offerings: [
          { id: offeringA, courseId: courseX, course: { name: 'Algebra' } },
          { id: offeringB, courseId: courseY, course: { name: 'Biology' } },
        ],
      },
      {
        id: 'section-2',
        offerings: [
          {
            id: 'eeeeeeee-5555-4555-8555-555555555555',
            courseId: courseX,
            course: { name: 'Algebra' },
          },
        ],
      },
    ]);
    mockPrisma.material.findMany.mockResolvedValue([]);

    const result = await service.getStudentOfferings('student-1');

    // Duplicate course across two sections collapses to the first offering.
    expect(result.offerings).toEqual([
      {
        offeringId: offeringA,
        courseId: courseX,
        courseName: 'Algebra',
        materialCount: 0,
      },
      {
        offeringId: offeringB,
        courseId: courseY,
        courseName: 'Biology',
        materialCount: 0,
      },
    ]);
  });

  it('should never expose a section name or id to the student', async () => {
    mockPrisma.section.findMany.mockResolvedValue([
      {
        id: 'section-secret',
        offerings: [
          { id: offeringA, courseId: courseX, course: { name: 'Algebra' } },
        ],
      },
    ]);
    mockPrisma.material.findMany.mockResolvedValue([]);

    const result = await service.getStudentOfferings('student-1');

    expect(JSON.stringify(result)).not.toContain('section');
    expect(result.offerings[0]).toEqual({
      offeringId: offeringA,
      courseId: courseX,
      courseName: 'Algebra',
      materialCount: 0,
    });
  });

  it('should count both legacy and scoped materials per offering', async () => {
    mockPrisma.section.findMany.mockResolvedValue([
      {
        id: 'section-1',
        offerings: [
          { id: offeringA, courseId: courseX, course: { name: 'Algebra' } },
        ],
      },
    ]);
    mockPrisma.material.findMany.mockResolvedValue([
      { courseOfferingId: offeringA, scopes: [] },
      { courseOfferingId: offeringA, scopes: [] },
      { courseOfferingId: null, scopes: [{ courseOfferingId: offeringA }] },
      { courseOfferingId: null, scopes: [{ courseOfferingId: offeringB }] },
    ]);

    const result = await service.getStudentOfferings('student-1');

    expect(result.offerings[0].materialCount).toBe(3);
    expect(mockPrisma.material.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { courseOfferingId: { in: [offeringA] } },
          { scopes: { some: { courseOfferingId: { in: [offeringA] } } } },
        ],
      },
      select: {
        courseOfferingId: true,
        scopes: { select: { courseOfferingId: true } },
      },
    });
  });

  it('should return an empty list when the student has no approved enrollments', async () => {
    mockPrisma.section.findMany.mockResolvedValue([]);

    const result = await service.getStudentOfferings('student-1');

    expect(result.offerings).toEqual([]);
    expect(mockPrisma.material.findMany).not.toHaveBeenCalled();
  });

  it('should only consider approved enrollments', async () => {
    await service.getStudentOfferings('student-1');

    expect(mockPrisma.section.findMany).toHaveBeenCalledWith({
      where: {
        enrollments: {
          some: { studentId: 'student-1', status: 'APPROVED' },
        },
      },
      include: {
        offerings: {
          include: { course: true },
        },
      },
    });
  });
});
