import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { ChatGateway } from './chat.gateway';
import { WsAuthGuard } from './ws-auth.guard';
import { ChatService } from './chat.service';
import type { User } from '@prisma/client';

describe('WsAuthGuard', () => {
  const supabase = { verifyToken: jest.fn() };
  const prisma = { user: { findUnique: jest.fn() } };

  function makeSocket(handshake: Record<string, unknown> = {}): {
    handshake: Partial<Socket['handshake']>;
    data: Record<string, unknown>;
  } {
    return {
      handshake: {
        headers: handshake['headers'] as Record<string, string> | undefined,
        auth: handshake['auth'],
      },
      data: {},
    } as {
      handshake: Partial<Socket['handshake']>;
      data: Record<string, unknown>;
    };
  }

  function makeContext(socket: {
    handshake: Partial<Socket['handshake']>;
    data: Record<string, unknown>;
  }): ExecutionContext {
    return {
      switchToWs: () => ({ getClient: () => socket }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a socket with no handshake token', async () => {
    const guard = new WsAuthGuard(supabase as never, prisma as never);
    await expect(guard.canActivate(makeContext(makeSocket()))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(supabase.verifyToken).not.toHaveBeenCalled();
  });

  it('rejects a socket with an unknown user', async () => {
    supabase.verifyToken.mockResolvedValue({ id: 'sb-user' });
    prisma.user.findUnique.mockResolvedValue(null);
    const guard = new WsAuthGuard(supabase as never, prisma as never);
    await expect(
      guard.canActivate(makeContext(makeSocket({ auth: { token: 'jwt' } }))),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('authenticates a socket and stores the local user', async () => {
    supabase.verifyToken.mockResolvedValue({ id: 'sb-user' });
    const localUser: User = {
      id: 'user-1',
      authId: 'sb-user',
      role: 'STUDENT',
    } as User;
    prisma.user.findUnique.mockResolvedValue(localUser);

    const socket = makeSocket({ auth: { token: 'jwt' } });
    const guard = new WsAuthGuard(supabase as never, prisma as never);
    await expect(guard.canActivate(makeContext(socket))).resolves.toBe(true);
    expect(socket.data).toEqual({ user: localUser });
  });
});

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let service: { getMessages: jest.Mock; sendMessage: jest.Mock };
  let toMock: jest.Mock;

  const socketMock = {
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    data: { user: { id: 'user-1', role: 'STUDENT' } },
  };
  const socket = socketMock as unknown as Socket;

  beforeEach(() => {
    service = {
      getMessages: jest.fn(),
      sendMessage: jest.fn(),
    };
    gateway = new ChatGateway(service as unknown as ChatService);
    const emitMock: jest.Mock = jest.fn();
    toMock = jest.fn().mockReturnValue({ emit: emitMock });
    gateway.server = { to: toMock } as unknown as Server;
    jest.clearAllMocks();
  });

  it('joins a room and replays recent messages', async () => {
    service.getMessages.mockResolvedValue({ items: [{ id: 'm1' }] });

    await gateway.join(
      { threadId: 'thread-1' },
      { id: 'user-1', role: 'STUDENT' } as User,
      socket,
    );

    expect(service.getMessages).toHaveBeenCalledWith(
      'thread-1',
      'user-1',
      undefined,
      50,
    );
    expect(socketMock.join).toHaveBeenCalledWith('thread:thread-1');
    expect(socketMock.emit).toHaveBeenCalledWith('thread:joined', {
      threadId: 'thread-1',
      items: [{ id: 'm1' }],
    });
  });

  it('broadcasts a message to the room on send', async () => {
    const message = { id: 'msg-1', text: 'hi', authorId: 'user-1' };
    service.sendMessage.mockResolvedValue(message);

    await gateway.sendMessage({ threadId: 'thread-1', text: 'hi' }, {
      id: 'user-1',
      role: 'STUDENT',
    } as User);

    expect(service.sendMessage).toHaveBeenCalledWith(
      'thread-1',
      'user-1',
      'hi',
    );
    expect(toMock).toHaveBeenCalledWith('thread:thread-1');
  });
});
