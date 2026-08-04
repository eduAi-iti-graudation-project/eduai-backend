import { Test, TestingModule } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;

  const mockPrisma = {
    class: { count: jest.fn() },
    gradingScore: { count: jest.fn(), findMany: jest.fn() },
    alert: { findMany: jest.fn(), count: jest.fn() },
    submission: { findMany: jest.fn() },
    notification: { count: jest.fn() },
    enrollment: { findMany: jest.fn() },
    attendance: { findMany: jest.fn() },
    user: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    studentReport: { count: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.clearAllMocks();
  });

  function mockUser(overrides: Partial<User>): User {
    return {
      id: '',
      email: '',
      name: '',
      role: 'TEACHER',
      authId: null,
      guardianId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as User;
  }

  describe('teacherDashboard', () => {
    const teacherUser = mockUser({ id: 'teacher-1', role: 'TEACHER' });

    it('should return teacher dashboard shape', async () => {
      mockPrisma.class.count.mockResolvedValue(3);
      mockPrisma.gradingScore.count.mockResolvedValue(5);
      mockPrisma.alert.findMany.mockResolvedValue([
        {
          id: 'a1',
          type: 'FAILING',
          reason: 'Low scores',
          createdAt: new Date(),
          student: { name: 'Student A' },
        },
      ]);
      mockPrisma.submission.findMany.mockResolvedValue([
        {
          id: 's1',
          createdAt: new Date(),
          student: { name: 'Student B' },
          assignment: { title: 'Essay 1' },
        },
      ]);
      mockPrisma.alert.count
        .mockResolvedValueOnce(2) // activeAlertCount
        .mockResolvedValueOnce(5); // resolvedAlertCount
      mockPrisma.notification.count.mockResolvedValue(2);

      const result = await service.getOverview(teacherUser);

      expect(result).toMatchObject({
        classCount: 3,
        pendingConfirmations: 5,
        activeAlertCount: 2,
        resolvedAlertCount: 5,
        unreadNotifications: 2,
      });
      expect(result.recentAlerts).toHaveLength(1);
      expect(result.recentAlerts).toMatchObject([
        { studentName: 'Student A', type: 'FAILING' },
      ]);
      expect(result.submissionsNeedingReview).toHaveLength(1);
      expect(result.submissionsNeedingReview).toMatchObject([
        { studentName: 'Student B', assignmentTitle: 'Essay 1' },
      ]);
    });
  });

  describe('studentDashboard', () => {
    const studentUser = mockUser({ id: 'student-1', role: 'STUDENT' });

    it('should return student dashboard shape', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      mockPrisma.enrollment.findMany.mockResolvedValue([
        {
          class: {
            name: 'Math 101',
            assignments: [
              {
                title: 'Homework 1',
                dueDate: futureDate,
              },
            ],
          },
        },
      ]);
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        {
          pointsAwarded: 8,
          criteria: { maxPoints: 10 },
          submission: {
            assignment: { id: 'a1', title: 'Quiz 1', totalPoints: 10 },
          },
        },
        {
          pointsAwarded: 9,
          criteria: { maxPoints: 10 },
          submission: {
            assignment: { id: 'a2', title: 'Quiz 2', totalPoints: 10 },
          },
        },
      ]);
      mockPrisma.attendance.findMany.mockResolvedValue([
        { status: 'PRESENT' },
        { status: 'PRESENT' },
        { status: 'ABSENT' },
        { status: 'PRESENT' },
      ]);
      mockPrisma.alert.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(1);

      const result = await service.getOverview(studentUser);

      expect(result).toMatchObject({
        upcomingAssignments: [{ title: 'Homework 1', className: 'Math 101' }],
        attendanceRate: 0.75,
        activeAlerts: [],
        unreadNotifications: 1,
      });
      expect(result.recentGrades).toHaveLength(2);
    });

    it('should handle empty enrollments', async () => {
      mockPrisma.enrollment.findMany.mockResolvedValue([]);
      mockPrisma.gradingScore.findMany.mockResolvedValue([]);
      mockPrisma.attendance.findMany.mockResolvedValue([]);
      mockPrisma.alert.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      const result = await service.getOverview(studentUser);

      expect(result).toMatchObject({
        upcomingAssignments: [],
        recentGrades: [],
        attendanceRate: 0,
        activeAlerts: [],
        unreadNotifications: 0,
      });
    });
  });

  describe('guardianDashboard', () => {
    const guardianUser = mockUser({ id: 'guardian-1', role: 'GUARDIAN' });

    it('should return guardian dashboard with children', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'guardian-1',
        wards: [
          {
            id: 'ward-1',
            name: 'Child A',
            enrollments: [{ class: { name: 'Science' } }],
          },
        ],
      });
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        { pointsAwarded: 8 },
        { pointsAwarded: 7 },
      ]);
      mockPrisma.attendance.findMany.mockResolvedValue([
        { status: 'PRESENT' },
        { status: 'PRESENT' },
        { status: 'LATE' },
      ]);
      mockPrisma.alert.count.mockResolvedValue(1);
      mockPrisma.studentReport.count.mockResolvedValue(0);
      mockPrisma.notification.count.mockResolvedValue(2);

      const result = await service.getOverview(guardianUser);

      expect(result).toMatchObject({
        children: [
          {
            name: 'Child A',
            className: 'Science',
            activeAlertCount: 1,
            unreadReportCount: 0,
          },
        ],
        unreadNotifications: 2,
      });
      const children = result.children as Array<{ attendanceRate: number }>;
      expect(children[0].attendanceRate).toBeCloseTo(0.67, 1);
    });

    it('should handle guardian with no wards', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'guardian-1',
        wards: [],
      });
      mockPrisma.notification.count.mockResolvedValue(0);

      const result = await service.getOverview(guardianUser);

      expect(result).toMatchObject({
        children: [],
        unreadNotifications: 0,
      });
    });
  });

  describe('adminDashboard', () => {
    const adminUser = mockUser({ id: 'admin-1', role: 'ADMIN' });

    it('should return admin dashboard shape', async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(5) // teacherCount
        .mockResolvedValueOnce(100) // studentCount
        .mockResolvedValueOnce(3); // flaggedStudentCount
      mockPrisma.class.count.mockResolvedValue(15);
      mockPrisma.studentReport.count.mockResolvedValue(2);
      mockPrisma.notification.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 't1',
          name: 'Teacher A',
          taughtClasses: [
            {
              assignments: [
                {
                  submissions: [
                    {
                      studentId: 's1',
                      scores: [{ pointsAwarded: 8 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
      mockPrisma.gradingScore.findMany.mockResolvedValue([
        { pointsAwarded: 9, criteria: { maxPoints: 10 } },
        { pointsAwarded: 4, criteria: { maxPoints: 10 } },
        { pointsAwarded: 7, criteria: { maxPoints: 10 } },
      ]);

      const result = await service.getOverview(adminUser);

      expect(result).toMatchObject({
        teacherCount: 5,
        studentCount: 100,
        classCount: 15,
        flaggedStudentCount: 3,
        pendingReportCount: 2,
      });
      const teachers = result.teachers as Array<{
        name: string;
        studentCount: number;
      }>;
      expect(teachers).toHaveLength(1);
      expect(teachers[0]).toMatchObject({
        name: 'Teacher A',
        studentCount: 1,
      });
    });
  });
});
