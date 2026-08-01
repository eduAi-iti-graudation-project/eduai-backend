import { z } from 'zod';
import { NotificationsService } from '../../notifications/notifications.service';

const InputSchema = z.object({
  userId: z.string(),
  role: z.enum(['TEACHER', 'GUARDIAN', 'ADMIN']),
  title: z.string(),
  body: z.string(),
});

export type NotifyRecipientTool = {
  execute: (
    input: z.infer<typeof InputSchema>,
  ) => Promise<{ notified: boolean }>;
};

export const createNotifyRecipientTool = (
  notificationsService: NotificationsService,
): NotifyRecipientTool => ({
  execute: async (input) => {
    await notificationsService.notifyUser(
      input.userId,
      'AGENT_ALERT',
      input.title,
      input.body,
    );
    return { notified: true };
  },
});
