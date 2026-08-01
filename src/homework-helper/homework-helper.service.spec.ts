import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { HomeworkHelperService } from './homework-helper.service';
import { HomeworkHelperAgent } from './homework-helper.agent';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('HomeworkHelperService', () => {
  let service: HomeworkHelperService;

  const mockAgent = {
    help: jest.fn(),
  };

  const mockPrisma = {
    homeworkHelpInteraction: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    quizAttempt: {
      findFirst: jest.fn(),
    },
    class: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomeworkHelperService,
        { provide: HomeworkHelperAgent, useValue: mockAgent },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<HomeworkHelperService>(HomeworkHelperService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('help', () => {
    it('should block help while a quiz attempt is in progress in the same class', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        quiz: { classId: 'class-1', timeLimit: 30 },
      });

      await expect(
        service.help('student-1', {
          classId: 'class-1',
          question: 'Help me with question 3',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.quizAttempt.findFirst).toHaveBeenCalledWith({
        where: { studentId: 'student-1', status: 'IN_PROGRESS' },
        include: { quiz: true },
      });
      expect(mockAgent.help).not.toHaveBeenCalled();
    });

    it('should block help when attempt has no time limit in the same class', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue({
        id: 'attempt-2',
        status: 'IN_PROGRESS',
        startedAt: new Date(Date.now() - 60 * 60_000),
        quiz: { classId: 'class-1', timeLimit: null },
      });

      await expect(
        service.help('student-1', {
          classId: 'class-1',
          question: 'Help me with question 3',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAgent.help).not.toHaveBeenCalled();
    });

    it('should allow help when the attempt is in a different class', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue({
        id: 'attempt-3',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        quiz: { classId: 'class-2', timeLimit: 30 },
      });
      mockAgent.help.mockResolvedValue({
        answer: 'Try looking at the light-dependent reactions first.',
        action: 'HINT' as const,
        sources: ['Curriculum: Photosynthesis Unit'],
        interactionId: 'log-1',
      });

      const result = await service.help('student-1', {
        classId: 'class-1',
        question: 'I dont get question 3 on photosynthesis',
      });

      expect(result.action).toBe('HINT');
      expect(mockAgent.help).toHaveBeenCalled();
    });

    it('should allow help when the same-class attempt has expired', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue({
        id: 'attempt-4',
        status: 'IN_PROGRESS',
        startedAt: new Date(Date.now() - 40 * 60_000),
        quiz: { classId: 'class-1', timeLimit: 30 },
      });
      mockAgent.help.mockResolvedValue({
        answer: 'Try looking at the light-dependent reactions first.',
        action: 'HINT' as const,
        sources: ['Curriculum: Photosynthesis Unit'],
        interactionId: 'log-1',
      });

      const result = await service.help('student-1', {
        classId: 'class-1',
        question: 'I dont get question 3 on photosynthesis',
      });

      expect(result.action).toBe('HINT');
      expect(mockAgent.help).toHaveBeenCalled();
    });

    it('should allow help when no quiz is in progress', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue(null);
      mockAgent.help.mockResolvedValue({
        answer: 'Try looking at the light-dependent reactions first.',
        action: 'HINT' as const,
        sources: ['Curriculum: Photosynthesis Unit'],
        interactionId: 'log-1',
      });

      const result = await service.help('student-1', {
        classId: 'class-1',
        question: 'I dont get question 3 on photosynthesis',
      });

      expect(result.action).toBe('HINT');
      expect(mockAgent.help).toHaveBeenCalled();
    });

    it('should delegate to agent and return response', async () => {
      mockAgent.help.mockResolvedValue({
        answer: 'Try looking at the light-dependent reactions first.',
        action: 'HINT' as const,
        sources: ['Curriculum: Photosynthesis Unit'],
        interactionId: 'log-1',
      });

      const result = await service.help('student-1', {
        classId: 'class-1',
        question: 'I dont get question 3 on photosynthesis',
      });

      expect(mockAgent.help).toHaveBeenCalledWith({
        classId: 'class-1',
        studentId: 'student-1',
        question: 'I dont get question 3 on photosynthesis',
      });
      expect(result).toEqual({
        answer: 'Try looking at the light-dependent reactions first.',
        reply: 'Try looking at the light-dependent reactions first.',
        action: 'HINT',
        sources: ['Curriculum: Photosynthesis Unit'],
        interactionId: 'log-1',
        teacherNotified: false,
      });
      expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
    });

    it('should pass assignmentId to the agent when provided', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue(null);
      mockAgent.help.mockResolvedValue({
        answer: 'Try setting up the equation first.',
        action: 'HINT' as const,
        sources: ['Math Homework 1'],
        interactionId: 'log-4',
      });

      const result = await service.help('student-1', {
        classId: 'class-1',
        question: 'I dont get question 1 on the math assignment',
        assignmentId: 'assignment-1',
      });

      expect(mockAgent.help).toHaveBeenCalledWith({
        classId: 'class-1',
        studentId: 'student-1',
        question: 'I dont get question 1 on the math assignment',
        assignmentId: 'assignment-1',
      });
      expect(result.action).toBe('HINT');
    });

    it('should handle EXPLANATION action', async () => {
      mockAgent.help.mockResolvedValue({
        answer:
          'The Calvin cycle has three phases: carbon fixation, reduction, and regeneration. Here is how they work...',
        action: 'EXPLANATION' as const,
        sources: ['Curriculum: Photosynthesis Unit', 'Khan Academy'],
        interactionId: 'log-3',
      });

      const result = await service.help('student-3', {
        classId: 'class-1',
        question: 'Explain the Calvin cycle',
      });

      expect(result.action).toBe('EXPLANATION');
      expect(result.sources).toHaveLength(2);
      expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
    });

    it('should notify teacher on REDIRECT_TEACHER action', async () => {
      mockAgent.help.mockResolvedValue({
        answer:
          'This sounds like something your teacher should help with. Please ask Mr. Smith during office hours.',
        action: 'REDIRECT_TEACHER' as const,
        sources: [],
        interactionId: 'log-2',
      });
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'student-2',
        name: 'Sam L.',
      });

      const result = await service.help('student-2', {
        classId: 'class-1',
        question: 'Can you grade my essay?',
      });

      expect(result.action).toBe('REDIRECT_TEACHER');
      expect(result.sources).toEqual([]);
      expect(result.reply).toBe(
        'This sounds like something your teacher should help with. Please ask Mr. Smith during office hours.',
      );
      expect(result.teacherNotified).toBe(true);
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'teacher-1',
        'HOMEWORK_HELP_REDIRECT',
        'Sam L. needs your help',
        expect.stringContaining('Can you grade my essay?'),
      );
    });

    it('should notify teacher even if student name lookup fails', async () => {
      mockAgent.help.mockResolvedValue({
        answer: 'Please ask your teacher.',
        action: 'REDIRECT_TEACHER' as const,
        sources: [],
        interactionId: 'log-4',
      });
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'teacher-1',
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await service.help('student-4', {
        classId: 'class-1',
        question: 'Why did I get this grade?',
      });

      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'teacher-1',
        'HOMEWORK_HELP_REDIRECT',
        'A student needs your help',
        expect.any(String),
      );
    });
  });

  describe('getHistory', () => {
    it('should return empty history', async () => {
      mockPrisma.homeworkHelpInteraction.findMany.mockResolvedValue([]);

      const result = await service.getHistory('student-1');

      expect(mockPrisma.homeworkHelpInteraction.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      expect(result).toEqual({ interactions: [] });
    });

    it('should return mapped interactions', async () => {
      mockPrisma.homeworkHelpInteraction.findMany.mockResolvedValue([
        {
          id: 'log-1',
          question: 'I dont get question 3',
          answer: 'Try looking at the light-dependent reactions.',
          action: 'HINT',
          sources: ['Curriculum: Photosynthesis Unit'],
          feedback: null,
          createdAt: new Date('2026-07-30'),
        },
      ]);

      const result = await service.getHistory('student-1');

      expect(result.interactions).toHaveLength(1);
      expect(result.interactions[0]).toEqual({
        id: 'log-1',
        question: 'I dont get question 3',
        answer: 'Try looking at the light-dependent reactions.',
        action: 'HINT',
        sources: ['Curriculum: Photosynthesis Unit'],
        feedback: null,
        createdAt: '2026-07-30T00:00:00.000Z',
      });
    });

    it('should filter by classId when provided', async () => {
      mockPrisma.homeworkHelpInteraction.findMany.mockResolvedValue([]);

      await service.getHistory('student-1', 'class-9');

      expect(mockPrisma.homeworkHelpInteraction.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1', classId: 'class-9' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });
  });

  describe('submitFeedback', () => {
    it('should update feedback on own interaction', async () => {
      mockPrisma.homeworkHelpInteraction.findUnique.mockResolvedValue({
        id: 'log-1',
        studentId: 'student-1',
      });

      await service.submitFeedback('log-1', 'HELPFUL', 'student-1');

      expect(mockPrisma.homeworkHelpInteraction.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: { feedback: 'HELPFUL' },
      });
    });

    it('should throw NotFoundException for missing interaction', async () => {
      mockPrisma.homeworkHelpInteraction.findUnique.mockResolvedValue(null);

      await expect(
        service.submitFeedback('bad-id', 'HELPFUL', 'student-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for another students interaction', async () => {
      mockPrisma.homeworkHelpInteraction.findUnique.mockResolvedValue({
        id: 'log-1',
        studentId: 'student-2',
      });

      await expect(
        service.submitFeedback('log-1', 'HELPFUL', 'student-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
