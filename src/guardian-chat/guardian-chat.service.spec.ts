import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { GuardianChatService } from './guardian-chat.service';
import { GuardianChatAgent } from './guardian-chat.agent';
import { GuardianService } from '../guardian/guardian.service';
import { AiChatService } from '../ai-chat/ai-chat.service';

describe('GuardianChatService', () => {
  let service: GuardianChatService;
  let agent: { respond: jest.Mock };
  let aiChat: Record<string, jest.Mock>;
  let guardianService: Record<string, jest.Mock>;

  const mockAgent = { respond: jest.fn() };
  const mockAiChat = {
    createConversation: jest.fn(),
    getOwnedConversation: jest.fn(),
    getMessages: jest.fn(),
    addUserMessage: jest.fn(),
    addAssistantMessage: jest.fn(),
    deleteConversation: jest.fn(),
  };
  const mockGuardianService = { wardInsights: jest.fn() };

  const guardian = { id: 'guardian-1', role: 'GUARDIAN' } as User;
  const studentId = '00000000-0000-0000-0000-0000000000aa';

  const insights = {
    ward: { id: studentId, name: 'Sam' },
    grades: [],
    attendance: [],
    quizzes: { completed: 0, averageScorePct: null, attempts: [] },
    fees: { unpaidCount: 0, unpaidTotal: 0 },
    openAlerts: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuardianChatService,
        { provide: GuardianChatAgent, useValue: mockAgent },
        { provide: GuardianService, useValue: mockGuardianService },
        { provide: AiChatService, useValue: mockAiChat },
      ],
    }).compile();

    service = module.get<GuardianChatService>(GuardianChatService);
    agent = mockAgent;
    aiChat = mockAiChat;
    guardianService = mockGuardianService;

    jest.clearAllMocks();
    guardianService.wardInsights.mockResolvedValue(insights);
    aiChat.createConversation.mockResolvedValue({
      id: 'convo-1',
      kind: 'GUARDIAN',
      courseOfferingId: null,
      studentId,
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

    agent.respond.mockResolvedValue({
      reply: 'Sam has 92% attendance.',
      sources: ['Attendance'],
    });

    const result = await service.chat(
      guardian,
      { studentId, messages: [], newMessage: 'How is Sam doing?' },
      send,
    );

    expect(result.conversationId).toBe('convo-1');
    expect(aiChat.createConversation).toHaveBeenCalledWith(
      'guardian-1',
      'GUARDIAN',
      {
        studentId,
      },
    );
    expect(aiChat.addUserMessage).toHaveBeenCalledWith(
      'convo-1',
      'How is Sam doing?',
    );
    expect(aiChat.addAssistantMessage).toHaveBeenCalledWith(
      'convo-1',
      'Sam has 92% attendance.',
      ['Attendance'],
    );
    expect(events.at(-1)).toEqual({
      type: 'done',
      data: {
        reply: 'Sam has 92% attendance.',
        sources: ['Attendance'],
        conversationId: 'convo-1',
      },
    });
  });

  it('should reuse stored history when a conversationId is provided', async () => {
    aiChat.getOwnedConversation.mockResolvedValue({
      id: 'convo-2',
      kind: 'GUARDIAN',
      studentId,
      title: 'How is Sam doing?',
    });
    aiChat.getMessages.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'convo-2',
        role: 'user',
        content: 'How is Sam doing?',
        sources: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'm2',
        conversationId: 'convo-2',
        role: 'assistant',
        content: 'Sam is doing well.',
        sources: ['Attendance'],
        createdAt: new Date().toISOString(),
      },
    ]);
    agent.respond.mockResolvedValue({
      reply: 'His grades are steady.',
      sources: ['Grades'],
    });

    await service.chat(guardian, {
      studentId,
      conversationId: 'convo-2',
      messages: [],
      newMessage: 'And grades?',
    });

    expect(aiChat.createConversation).not.toHaveBeenCalled();
    const respondMock = agent.respond as jest.Mock<
      Promise<{ reply: string; sources: string[] }>,
      [unknown]
    >;
    const respondCall = respondMock.mock.calls[0][0] as {
      history: Array<{ role: string; content: string }>;
      question: string;
    };
    expect(respondCall.history).toContainEqual({
      role: 'user',
      content: 'How is Sam doing?',
    });
    expect(respondCall.history).toContainEqual({
      role: 'assistant',
      content: 'Sam is doing well.',
    });
    expect(respondCall.question).toBe('And grades?');
  });

  it('should persist the fallback reply when generation fails', async () => {
    agent.respond.mockRejectedValue(new Error('LLM down'));

    await service.chat(guardian, { studentId, messages: [], newMessage: 'Hi' });

    expect(aiChat.addAssistantMessage).toHaveBeenCalledWith(
      'convo-1',
      expect.stringContaining('hit a snag'),
      [],
    );
  });
});
