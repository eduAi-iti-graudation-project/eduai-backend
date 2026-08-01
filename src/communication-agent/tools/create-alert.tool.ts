import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';

const InputSchema = z.object({
  studentId: z.string(),
  type: z.string(),
  reason: z.string(),
});

export type CreateAlertTool = {
  execute: (input: z.infer<typeof InputSchema>) => Promise<{ alertId: string }>;
};

export const createCreateAlertTool = (
  prisma: PrismaService,
): CreateAlertTool => ({
  execute: async (input) => {
    const alert = await prisma.alert.create({
      data: {
        type: input.type,
        reason: input.reason,
        status: 'ACTIVE',
        studentId: input.studentId,
      },
    });
    return { alertId: alert.id };
  },
});
