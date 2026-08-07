import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';

export const WsCurrentUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const client = ctx.switchToWs().getClient<{
      data?: { user?: User };
    }>();
    const user = client.data?.user;
    return data && user ? user[data] : user;
  },
);
