import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;

  const mockDashboardService = {
    getOverview: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardService, useValue: mockDashboardService },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
    jest.clearAllMocks();
  });

  it('should call service with current user', async () => {
    const mockUser = { id: 'user-1', email: 'a@b.com', name: 'T', role: 'TEACHER' } as User;
    const expected = { classCount: 3 };

    mockDashboardService.getOverview.mockResolvedValue(expected);

    const result = await controller.getOverview(mockUser);

    expect(mockDashboardService.getOverview).toHaveBeenCalledWith(mockUser);
    expect(result).toEqual(expected);
  });
});
