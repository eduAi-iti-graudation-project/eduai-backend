import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackWriterService } from './feedback-writer.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('FeedbackWriterService', () => {
  let service: FeedbackWriterService;
  const prisma: Record<string, Record<string, jest.Mock>> = {
    gradingScore: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    submissionChunk: {
      findMany: jest.fn(),
    },
    submission: {
      findUnique: jest.fn(),
    },
  };

  const mockLlm = {
    generateStructured: jest.fn(),
  };

  const mockNotifications = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackWriterService,
        { provide: PrismaService, useValue: prisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<FeedbackWriterService>(FeedbackWriterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should skip with warning when no scores exist', async () => {
    prisma.gradingScore.findMany.mockResolvedValue([]);

    await service.write('submission-1');

    expect(prisma.submissionChunk.findMany).not.toHaveBeenCalled();
    expect(mockLlm.generateStructured).not.toHaveBeenCalled();
    expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
  });

  it('should write feedback for each criterion', async () => {
    prisma.gradingScore.findMany.mockResolvedValue([
      {
        id: 'score-1',
        pointsAwarded: 7,
        criteriaId: 'criteria-1',
        criteria: {
          description: 'Clarity of thesis',
          maxPoints: 10,
        },
      },
      {
        id: 'score-2',
        pointsAwarded: 5,
        criteriaId: 'criteria-2',
        criteria: {
          description: 'Grammar and spelling',
          maxPoints: 10,
        },
      },
    ]);

    prisma.submissionChunk.findMany.mockResolvedValue([
      { id: 'chunk-1', content: 'This is the student submission.' },
    ]);

    prisma.submission.findUnique.mockResolvedValue({
      id: 'submission-1',
      studentId: 'student-1',
      assignmentId: 'assignment-1',
      assignment: { offering: { id: 'class-1' } },
    });

    mockLlm.generateStructured
      .mockResolvedValueOnce({ feedback: 'Good thesis but needs evidence.' })
      .mockResolvedValueOnce({ feedback: 'Several grammar errors found.' });

    await service.write('submission-1');

    expect(prisma.gradingScore.update).toHaveBeenCalledTimes(2);
    expect(prisma.gradingScore.update).toHaveBeenCalledWith({
      where: { id: 'score-1' },
      data: { aiFeedback: 'Good thesis but needs evidence.' },
    });
    expect(prisma.gradingScore.update).toHaveBeenCalledWith({
      where: { id: 'score-2' },
      data: { aiFeedback: 'Several grammar errors found.' },
    });
    expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
      'student-1',
      'FEEDBACK_READY',
      'Your assignment feedback is ready',
      expect.any(String),
      {
        submissionId: 'submission-1',
        assignmentId: 'assignment-1',
        classId: 'class-1',
      },
    );
  });

  it('should join multiple chunks into submission content', async () => {
    prisma.gradingScore.findMany.mockResolvedValue([
      {
        id: 'score-1',
        pointsAwarded: 5,
        criteriaId: 'criteria-1',
        criteria: { description: 'Content', maxPoints: 10 },
      },
    ]);

    prisma.submissionChunk.findMany.mockResolvedValue([
      { id: 'c1', content: 'First paragraph.' },
      { id: 'c2', content: 'Second paragraph.' },
    ]);

    prisma.submission.findUnique.mockResolvedValue({
      id: 'submission-1',
      studentId: 'student-1',
    });

    mockLlm.generateStructured.mockResolvedValue({ feedback: 'Okay.' });

    await service.write('submission-1');

    expect(mockLlm.generateStructured).toHaveBeenCalled();
  });

  it('should continue with remaining criteria when one fails', async () => {
    prisma.gradingScore.findMany.mockResolvedValue([
      {
        id: 'score-1',
        pointsAwarded: 7,
        criteriaId: 'criteria-1',
        criteria: { description: 'Thesis', maxPoints: 10 },
      },
      {
        id: 'score-2',
        pointsAwarded: 8,
        criteriaId: 'criteria-2',
        criteria: { description: 'Evidence', maxPoints: 10 },
      },
    ]);

    prisma.submissionChunk.findMany.mockResolvedValue([
      { id: 'c1', content: 'Submission text.' },
    ]);

    prisma.submission.findUnique.mockResolvedValue({
      id: 'submission-1',
      studentId: 'student-1',
    });

    mockLlm.generateStructured
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce({ feedback: 'Good evidence.' });

    await service.write('submission-1');

    expect(prisma.gradingScore.update).toHaveBeenCalledTimes(1);
    expect(prisma.gradingScore.update).toHaveBeenCalledWith({
      where: { id: 'score-2' },
      data: { aiFeedback: 'Good evidence.' },
    });
  });
});
