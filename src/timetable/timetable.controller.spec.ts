import { Test, TestingModule } from '@nestjs/testing';
import { TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';

describe('TimetableController', () => {
  let controller: TimetableController;

  const mockTimetableService = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    listAll: jest.fn(),
    listForSection: jest.fn(),
    listForTeacher: jest.fn(),
    checkConflict: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TimetableController],
      providers: [
        { provide: TimetableService, useValue: mockTimetableService },
      ],
    }).compile();

    controller = module.get<TimetableController>(TimetableController);
    jest.clearAllMocks();
  });

  describe('GET /timetable/slots/check-conflict', () => {
    it('delegates to the service with the query and organization', async () => {
      const query = {
        courseOfferingId: 'offering-1',
        day: 'MONDAY' as const,
        start: '08:30',
        end: '09:30',
      };
      mockTimetableService.checkConflict.mockResolvedValue({
        conflict: null,
      });

      const result = await controller.checkConflict(query, 'org-1');

      expect(mockTimetableService.checkConflict).toHaveBeenCalledWith(
        query,
        'org-1',
      );
      expect(result).toEqual({ conflict: null });
    });

    it('returns the same conflict object the shared check reports', async () => {
      const conflict = {
        kind: 'section',
        conflictingSlot: {
          id: 'slot-x',
          dayOfWeek: 'MONDAY',
          startTime: '08:00:00',
          endTime: '09:00:00',
          courseOfferingId: 'offering-2',
          courseName: 'Science',
          sectionName: '5-A',
        },
      };
      mockTimetableService.checkConflict.mockResolvedValue({ conflict });

      const result = await controller.checkConflict(
        {
          courseOfferingId: 'offering-1',
          day: 'MONDAY' as const,
          start: '08:30',
          end: '09:30',
        },
        'org-1',
      );

      expect(result).toEqual({ conflict });
    });

    it('passes excludeSlotId through for self-edit previews', async () => {
      const query = {
        courseOfferingId: 'offering-1',
        day: 'MONDAY' as const,
        start: '08:30',
        end: '09:30',
        excludeSlotId: 'slot-1',
      };
      mockTimetableService.checkConflict.mockResolvedValue({ conflict: null });

      await controller.checkConflict(query, 'org-1');

      expect(mockTimetableService.checkConflict).toHaveBeenCalledWith(
        query,
        'org-1',
      );
    });
  });
});
