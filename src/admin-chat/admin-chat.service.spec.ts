import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { AdminChatService } from './admin-chat.service';
import { AdminSupervisor } from './admin-supervisor.agent';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { InsightsService } from '../dashboard/insights.service';
import { AiChatService } from '../ai-chat/ai-chat.service';

describe('AdminChatService', () => {
  let service: AdminChatService;
  let supervisor: { respond: jest.Mock };
  let aiChat: Record<string, jest.Mock>;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let dashboardService: { getOverview: jest.Mock };
  let insightsService: { getInsights: jest.Mock };

  const mockSupervisor = { respond: jest.fn() };
  const mockAiChat = {
    createConversation: jest.fn(),
    getOwnedConversation: jest.fn(),
    getMessages: jest.fn(),
    addUserMessage: jest.fn(),
    addAssistantMessage: jest.fn(),
    deleteConversation: jest.fn(),
    listConversations: jest.fn(),
  };
  const mockPrisma = {
    alert: { findMany: jest.fn() },
    joinRequest: { count: jest.fn() },
    organization: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    attendance: { findMany: jest.fn() },
    gradingScore: { findMany: jest.fn() },
    enrollment: { findMany: jest.fn() },
    courseOffering: { findMany: jest.fn() },
  };
  const mockDashboard = { getOverview: jest.fn() };
  const mockInsights = { getInsights: jest.fn() };

  const admin = {
    id: 'admin-1',
    role: 'ADMIN',
    organizationId: 'org-1',
  } as User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminChatService,
        { provide: AdminSupervisor, useValue: mockSupervisor },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DashboardService, useValue: mockDashboard },
        { provide: InsightsService, useValue: mockInsights },
        { provide: AiChatService, useValue: mockAiChat },
      ],
    }).compile();

    service = module.get<AdminChatService>(AdminChatService);
    supervisor = mockSupervisor;
    aiChat = mockAiChat;
    prisma = mockPrisma;
    dashboardService = mockDashboard;
    insightsService = mockInsights;

    jest.clearAllMocks();
    dashboardService.getOverview.mockResolvedValue({
      teacherCount: 4,
      studentCount: 31,
      classCount: 9,
      flaggedStudentCount: 2,
      averagePassRate: 0.78,
    });
    insightsService.getInsights.mockResolvedValue({
      interval: 'week',
      sections: [],
      agentInsights: [],
      unreadNotifications: 0,
    });
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.joinRequest.count.mockResolvedValue(0);
    prisma.organization.findUnique.mockResolvedValue({
      name: 'Demo School',
      subscriptionStatus: 'ACTIVE',
      subscriptionTier: 'ENTERPRISE',
      trialReminderSentAt: null,
      trialExpiredSentAt: null,
      createdAt: new Date().toISOString(),
    });
    aiChat.createConversation.mockResolvedValue({
      id: 'convo-1',
      kind: 'ADMIN',
      courseOfferingId: null,
      studentId: null,
      title: null,
      lastMessage: null,
      lastMessageRole: null,
      messageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    aiChat.addUserMessage.mockResolvedValue({});
    aiChat.addAssistantMessage.mockResolvedValue({});
    aiChat.getMessages.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a conversation, persist both turns, and emit done with conversationId', async () => {
    const events: unknown[] = [];
    const send = (e: unknown) => events.push(e);

    supervisor.respond.mockResolvedValue({
      reply: '2 students are flagged right now.',
      sources: ['Overview', 'Active alerts'],
    });

    const result = await service.chat(
      admin,
      { messages: [], newMessage: 'Which students are at risk?' },
      send,
    );

    expect(result.conversationId).toBe('convo-1');
    expect(aiChat.createConversation).toHaveBeenCalledWith('admin-1', 'ADMIN', {
      studentId: undefined,
    });
    expect(aiChat.addUserMessage).toHaveBeenCalledWith(
      'convo-1',
      'Which students are at risk?',
    );
    expect(aiChat.addAssistantMessage).toHaveBeenCalledWith(
      'convo-1',
      '2 students are flagged right now.',
      ['Overview', 'Active alerts'],
    );
    expect(events.at(-1)).toEqual({
      type: 'done',
      data: {
        reply: '2 students are flagged right now.',
        sources: ['Overview', 'Active alerts'],
        conversationId: 'convo-1',
      },
    });
  });

  it('should reuse stored history when a conversationId is provided', async () => {
    aiChat.getOwnedConversation.mockResolvedValue({
      id: 'convo-2',
      kind: 'ADMIN',
      studentId: null,
      title: 'Which students are at risk?',
    });
    aiChat.getMessages.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'convo-2',
        role: 'user',
        content: 'Which students are at risk?',
        sources: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'm2',
        conversationId: 'convo-2',
        role: 'assistant',
        content: '2 students are flagged.',
        sources: ['Overview'],
        createdAt: new Date().toISOString(),
      },
    ]);
    supervisor.respond.mockResolvedValue({
      reply: '3 submissions await review.',
      sources: ['Overview'],
    });

    await service.chat(admin, {
      conversationId: 'convo-2',
      messages: [],
      newMessage: 'What is waiting in the review queue?',
    });

    expect(aiChat.createConversation).not.toHaveBeenCalled();
    const respondMock = supervisor.respond as jest.Mock<
      Promise<{ reply: string; sources: string[] }>,
      [unknown]
    >;
    const respondCall = respondMock.mock.calls[0][0] as {
      history: Array<{ role: string; content: string }>;
      question: string;
    };
    expect(respondCall.history).toContainEqual({
      role: 'user',
      content: 'Which students are at risk?',
    });
    expect(respondCall.history).toContainEqual({
      role: 'assistant',
      content: '2 students are flagged.',
    });
    expect(respondCall.question).toBe('What is waiting in the review queue?');
  });

  it('should pass the scoped student profile into the context', async () => {
    const studentId = '00000000-0000-0000-0000-0000000000aa';
    aiChat.getOwnedConversation.mockResolvedValue({
      id: 'convo-3',
      kind: 'ADMIN',
      studentId,
      title: null,
    });
    aiChat.getMessages.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      id: studentId,
      name: 'Sam',
      organizationId: 'org-1',
    });
    prisma.attendance.findMany.mockResolvedValue([
      { status: 'PRESENT' },
      { status: 'PRESENT' },
      { status: 'ABSENT' },
    ]);
    prisma.gradingScore.findMany.mockResolvedValue([]);
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.enrollment.findMany.mockResolvedValue([]);
    supervisor.respond.mockResolvedValue({ reply: 'Sam is doing fine.', sources: ['Student profile'] });

    await service.chat(admin, {
      conversationId: 'convo-3',
      messages: [],
      newMessage: 'How is Sam doing?',
    });

    const respondCall = (supervisor.respond as jest.Mock).mock.calls[0][0] as {
      schoolContext: { scope: Record<string, unknown> };
    };
    expect(respondCall.schoolContext.scope).toMatchObject({
      kind: 'student',
      name: 'Sam',
      attendance: { total: 3, present: 2, absent: 1 },
    });
  });

  it('should persist the fallback reply when generation fails', async () => {
    supervisor.respond.mockRejectedValue(new Error('LLM down'));

    await service.chat(admin, { messages: [], newMessage: 'Hi' });

    expect(aiChat.addAssistantMessage).toHaveBeenCalledWith(
      'convo-1',
      expect.stringContaining('hit a snag'),
      [],
    );
  });
});