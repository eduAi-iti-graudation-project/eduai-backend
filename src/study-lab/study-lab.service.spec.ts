import { Test, TestingModule } from '@nestjs/testing';
import { StudyLabService } from './study-lab.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../auth/supabase.service';
import { StudyLabGenerators } from './study-lab.generators';
import { StudyLabGatewayService } from './study-lab.gateway.service';

describe('StudyLabService', () => {
  let service: StudyLabService;

  const mockPrisma = {
    studyGeneration: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    quizAttempt: {
      findFirst: jest.fn(),
    },
    courseOffering: {
      findUnique: jest.fn(),
    },
    section: {
      findMany: jest.fn(),
    },
    enrollment: {
      count: jest.fn(),
    },
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
    providerName: 'none',
    synthesizeSpeech: jest.fn(),
    voicesFor: jest.fn(),
  };

  const mockSupabase = {
    getStorageClient: jest.fn(() => ({
      storage: {
        from: jest.fn(() => ({
          upload: jest.fn(),
          download: jest.fn(),
          remove: jest.fn(),
        })),
      },
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

  describe('submit', () => {
    it('should reject when student has active quiz', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue({ id: 'quiz-1' });

      await expect(
        service.submit('student-1', {
          courseOfferingId: 'offering-1',
          kind: 'PODCAST',
          topic: 'Photosynthesis',
        }),
      ).rejects.toThrow();

      expect(mockPrisma.courseOffering.findUnique).not.toHaveBeenCalled();
    });

    it('should reject when course offering does not exist', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue(null);
      mockPrisma.courseOffering.findUnique.mockResolvedValue(null);

      await expect(
        service.submit('student-1', {
          courseOfferingId: 'invalid-offering',
          kind: 'PODCAST',
          topic: 'Photosynthesis',
        }),
      ).rejects.toThrow('could not be found');
    });

    it('should reject STUDY_MATERIAL without materialKind', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue(null);
      mockPrisma.courseOffering.findUnique.mockResolvedValue({ id: 'offering-1' });

      await expect(
        service.submit('student-1', {
          courseOfferingId: 'offering-1',
          kind: 'STUDY_MATERIAL',
          topic: 'Math',
        }),
      ).rejects.toThrow('materialKind is required');
    });

    it('should create generation for valid request', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue(null);
      mockPrisma.courseOffering.findUnique.mockResolvedValue({ id: 'offering-1' });
      mockPrisma.studyGeneration.create.mockResolvedValue({
        id: 'gen-1',
        status: 'PROCESSING',
        stage: 'QUEUED',
      });

      const result = await service.submit('student-1', {
        courseOfferingId: 'offering-1',
        kind: 'PODCAST',
        preset: 'OVERVIEW',
        topic: 'Photosynthesis',
      });

      expect(result.generationId).toBe('gen-1');
      expect(result.status).toBe('PROCESSING');
      expect(mockPrisma.studyGeneration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          studentId: 'student-1',
          courseOfferingId: 'offering-1',
          kind: 'PODCAST',
          preset: 'OVERVIEW',
          topic: 'Photosynthesis',
          status: 'PROCESSING',
          stage: 'QUEUED',
          sources: [],
        }),
      });
    });
  });

  describe('getStudentOfferings', () => {
    it('should return offerings with material counts', async () => {
      mockPrisma.section.findMany.mockResolvedValue([
        {
          name: '10A',
          offerings: [
            {
              id: 'off-1',
              course: { name: 'Biology' },
              teacher: { name: 'Mr. Smith' },
              _count: { materials: 5 },
            },
          ],
        },
      ]);

      const result = await service.getStudentOfferings('student-1');

      expect(result.offerings).toHaveLength(1);
      expect(result.offerings[0]).toEqual({
        id: 'off-1',
        courseName: 'Biology',
        sectionName: '10A',
        teacherName: 'Mr. Smith',
        materialCount: 5,
      });
    });
  });

  describe('getHistory', () => {
    it('should return serialized generations', async () => {
      const now = new Date();
      mockPrisma.studyGeneration.findMany.mockResolvedValue([
        {
          id: 'gen-1',
          kind: 'PODCAST',
          materialKind: null,
          preset: 'OVERVIEW',
          topic: 'Test',
          status: 'READY',
          stage: 'DONE',
          error: null,
          recommendedForAnalysisId: null,
          createdAt: now,
          updatedAt: now,
          completedAt: now,
          payload: { title: 'Test' },
          audioUrl: null,
          fileUrl: null,
        },
      ]);

      const result = await service.getHistory('student-1');

      expect(result.generations).toHaveLength(1);
      expect(result.generations[0].id).toBe('gen-1');
      expect(result.generations[0].completedAt).toBe(now.toISOString());
    });
  });

  describe('getDetail', () => {
    it('should return generation detail', async () => {
      const now = new Date();
      mockPrisma.studyGeneration.findFirst.mockResolvedValue({
        id: 'gen-1',
        kind: 'SLIDES',
        materialKind: null,
        preset: null,
        topic: 'Test',
        status: 'READY',
        stage: 'DONE',
        error: null,
        recommendedForAnalysisId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        payload: { title: 'Test', slides: [] },
        audioUrl: null,
        fileUrl: 'materials/off-1/study-lab/gen-1.pptx',
      });

      const result = await service.getDetail('student-1', 'gen-1');

      expect(result.generation.id).toBe('gen-1');
      expect(result.generation.fileUrl).toBe('materials/off-1/study-lab/gen-1.pptx');
    });

    it('should throw NotFoundException for unknown generation', async () => {
      mockPrisma.studyGeneration.findFirst.mockResolvedValue(null);

      await expect(
        service.getDetail('student-1', 'unknown'),
      ).rejects.toThrow('could not be found');
    });
  });

  describe('remove', () => {
    it('should delete generation and storage files', async () => {
      mockPrisma.studyGeneration.findFirst.mockResolvedValue({
        id: 'gen-1',
        audioUrl: null,
        fileUrl: 'materials/off-1/study-lab/gen-1.pptx',
      });
      mockPrisma.studyGeneration.delete.mockResolvedValue({ id: 'gen-1' });

      await service.remove('student-1', 'gen-1');

      expect(mockPrisma.studyGeneration.delete).toHaveBeenCalledWith({
        where: { id: 'gen-1' },
      });
    });
  });

  describe('download', () => {
    it('should return buffer for pptx file', async () => {
      mockPrisma.studyGeneration.findFirst.mockResolvedValue({
        id: 'gen-1',
        audioUrl: null,
        fileUrl: 'materials/off-1/study-lab/gen-1.pptx',
      });
      const mockDownload = jest.fn().mockResolvedValue({
        data: {
          arrayBuffer: () => Buffer.from('fake-pptx'),
        },
        error: null,
      });
      mockSupabase.getStorageClient.mockReturnValue({
        storage: {
          from: jest.fn(() => ({
            download: mockDownload,
          })),
        },
      });

      const result = await service.download('student-1', 'gen-1');

      expect(result.buffer.toString()).toBe('fake-pptx');
      expect(result.contentType).toBe(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      );
      expect(result.filename).toBe('gen-1.pptx');
    });

    it('should throw BadGatewayException when no file exists', async () => {
      mockPrisma.studyGeneration.findFirst.mockResolvedValue({
        id: 'gen-1',
        audioUrl: null,
        fileUrl: null,
      });

      await expect(service.download('student-1', 'gen-1')).rejects.toThrow(
        'no downloadable file',
      );
    });
  });

  describe('serialize', () => {
    it('should serialize generation correctly', async () => {
      const now = new Date();
      const generation = {
        id: 'gen-1',
        kind: 'PODCAST',
        materialKind: null,
        preset: 'OVERVIEW',
        topic: 'Test',
        status: 'READY',
        stage: 'DONE',
        error: null,
        recommendedForAnalysisId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        payload: { title: 'Test' },
        audioUrl: 'materials/study-lab/gen-1.mp3',
        fileUrl: null,
      };

      const result = (service as any).serialize(generation);

      expect(result.id).toBe('gen-1');
      expect(result.completedAt).toBe(now.toISOString());
      expect(result.audioUrl).toBe('materials/study-lab/gen-1.mp3');
    });

    it('should handle null completedAt', async () => {
      const now = new Date();
      const generation = {
        id: 'gen-1',
        kind: 'PODCAST',
        materialKind: null,
        preset: null,
        topic: 'Test',
        status: 'PROCESSING',
        stage: 'GROUNDING',
        error: null,
        recommendedForAnalysisId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        payload: null,
        audioUrl: null,
        fileUrl: null,
      };

      const result = (service as any).serialize(generation);

      expect(result.completedAt).toBeNull();
    });
  });
});
