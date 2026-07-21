import { Test, TestingModule } from '@nestjs/testing';
import { AlertsService } from './alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('AlertsService', () => {
  let service: AlertsService;

  const mockPrisma = {
    alert: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
    jest.clearAllMocks();
  });

  describe('resolve', () => {
    it('should update alert status to RESOLVED', async () => {
      const existingAlert = { id: 'alert-id', status: 'ACTIVE' };
      const updatedAlert = { id: 'alert-id', status: 'RESOLVED' };

      mockPrisma.alert.findUnique.mockResolvedValue(existingAlert);
      mockPrisma.alert.update.mockResolvedValue(updatedAlert);

      const result = await service.resolve('alert-id', 'RESOLVED');

      expect(mockPrisma.alert.findUnique).toHaveBeenCalledWith({
        where: { id: 'alert-id' },
      });
      expect(mockPrisma.alert.update).toHaveBeenCalledWith({
        where: { id: 'alert-id' },
        data: { status: 'RESOLVED' },
      });
      expect(result.status).toBe('RESOLVED');
    });

    it('should update alert status to DISMISSED', async () => {
      const existingAlert = { id: 'alert-id', status: 'ACTIVE' };
      const updatedAlert = { id: 'alert-id', status: 'DISMISSED' };

      mockPrisma.alert.findUnique.mockResolvedValue(existingAlert);
      mockPrisma.alert.update.mockResolvedValue(updatedAlert);

      const result = await service.resolve('alert-id', 'DISMISSED');

      expect(mockPrisma.alert.update).toHaveBeenCalledWith({
        where: { id: 'alert-id' },
        data: { status: 'DISMISSED' },
      });
      expect(result.status).toBe('DISMISSED');
    });

    it('should throw NotFoundException for non-existent alert', async () => {
      mockPrisma.alert.findUnique.mockResolvedValue(null);

      await expect(service.resolve('bad-id', 'RESOLVED')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
