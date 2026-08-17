import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { InsightsService } from './insights.service';

describe('DashboardController', () => {
  let controller: DashboardController;

  const mockDashboardService = {
    getOverview: jest.fn(),
  };

  const mockInsightsService = {
    getInsights: jest.fn(),
    getStudentInsights: jest.fn(),
    getSectionDetail: jest.fn(),
    getStudentSectionDetail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardService, useValue: mockDashboardService },
        { provide: InsightsService, useValue: mockInsightsService },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
    jest.clearAllMocks();
  });

  it('should call service with current user', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'a@b.com',
      name: 'T',
      role: 'TEACHER',
    } as User;
    const expected = { classCount: 3 };

    mockDashboardService.getOverview.mockResolvedValue(expected);

    const result = await controller.getOverview(mockUser);

    expect(mockDashboardService.getOverview).toHaveBeenCalledWith(mockUser);
    expect(result).toEqual(expected);
  });

  describe('GET /dashboard/insights', () => {
    it('defaults the interval to week', async () => {
      const user = { id: 'u1', role: 'STUDENT' } as User;
      const expected = { interval: 'week', sections: [] };

      mockInsightsService.getInsights.mockResolvedValue(expected);

      const result = await controller.getInsights(user);

      expect(mockInsightsService.getInsights).toHaveBeenCalledWith(
        user,
        'week',
      );
      expect(result).toEqual(expected);
    });

    it('passes the requested interval', async () => {
      const user = { id: 'u1', role: 'STUDENT' } as User;

      mockInsightsService.getInsights.mockResolvedValue({});

      await controller.getInsights(user, 'month');

      expect(mockInsightsService.getInsights).toHaveBeenCalledWith(
        user,
        'month',
      );
    });

    it('rejects an invalid interval with 400', () => {
      const user = { id: 'u1', role: 'STUDENT' } as User;

      expect(() => controller.getInsights(user, 'year')).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
      );
      expect(mockInsightsService.getInsights).not.toHaveBeenCalled();
    });
  });

  describe('GET /dashboard/insights/students/:id', () => {
    it('calls the service with student id and interval', async () => {
      const user = { id: 't1', role: 'TEACHER' } as User;
      const expected = { interval: 'week', sections: [] };

      mockInsightsService.getStudentInsights.mockResolvedValue(expected);

      const result = await controller.getStudentInsights(user, 's1');

      expect(mockInsightsService.getStudentInsights).toHaveBeenCalledWith(
        user,
        's1',
        'week',
      );
      expect(result).toEqual(expected);
    });

    it('rejects an invalid interval with 400', () => {
      const user = { id: 't1', role: 'TEACHER' } as User;

      expect(() => controller.getStudentInsights(user, 's1', 'daily')).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
      );
      expect(mockInsightsService.getStudentInsights).not.toHaveBeenCalled();
    });
  });

  describe('GET /dashboard/insights/sections/:sectionKey/detail', () => {
    it('defaults the interval to week and passes the bucket', async () => {
      const user = { id: 't1', role: 'TEACHER' } as User;
      const expected = { sectionKey: 'x', records: [] };

      mockInsightsService.getSectionDetail.mockResolvedValue(expected);

      const result = await controller.getSectionDetail(
        user,
        'submissions_volume',
        undefined,
        '2026-08-10',
      );

      expect(mockInsightsService.getSectionDetail).toHaveBeenCalledWith(
        user,
        'week',
        'submissions_volume',
        '2026-08-10',
      );
      expect(result).toEqual(expected);
    });

    it('rejects an invalid interval with 400', () => {
      const user = { id: 't1', role: 'TEACHER' } as User;

      expect(() =>
        controller.getSectionDetail(user, 'submissions_volume', 'year', 'x'),
      ).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
      );
      expect(mockInsightsService.getSectionDetail).not.toHaveBeenCalled();
    });

    it('rejects a missing bucket with 400', () => {
      const user = { id: 't1', role: 'TEACHER' } as User;

      expect(() =>
        controller.getSectionDetail(user, 'submissions_volume', 'week'),
      ).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
      );
    });
  });

  describe('GET /dashboard/insights/students/:id/sections/:sectionKey/detail', () => {
    it('delegates with student id, interval and bucket', async () => {
      const user = { id: 't1', role: 'TEACHER' } as User;
      const expected = { sectionKey: 'grade_trend', records: [] };

      mockInsightsService.getStudentSectionDetail.mockResolvedValue(expected);

      const result = await controller.getStudentSectionDetail(
        user,
        's1',
        'grade_trend',
        'month',
        '2026-08-01',
      );

      expect(mockInsightsService.getStudentSectionDetail).toHaveBeenCalledWith(
        user,
        's1',
        'month',
        'grade_trend',
        '2026-08-01',
      );
      expect(result).toEqual(expected);
    });

    it('rejects an invalid interval with 400', () => {
      const user = { id: 't1', role: 'TEACHER' } as User;

      expect(() =>
        controller.getStudentSectionDetail(
          user,
          's1',
          'grade_trend',
          'daily',
          '2026-08-01',
        ),
      ).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
      );
      expect(
        mockInsightsService.getStudentSectionDetail,
      ).not.toHaveBeenCalled();
    });
  });
});
