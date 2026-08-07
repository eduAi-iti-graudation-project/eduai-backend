import { Test, TestingModule } from '@nestjs/testing';
import { MigrationService } from './migration.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';

describe('MigrationService', () => {
  let service: MigrationService;

  const organizationId = 'org-1';

  const mockPrisma = {
    gradeLevel: {
      findMany: jest.fn(),
    },
    section: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    enrollment: {
      create: jest.fn(),
    },
  };

  const mockLlm = {
    generateStructured: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
      ],
    }).compile();

    service = module.get<MigrationService>(MigrationService);
  });

  const CSV = [
    'student name,email,guardian phone,grade,section',
    'Aya Hassan,aya.hassan@example.com,+20 111 222 3333,7th Grade,A',
    'Omar Ali,omar.ali@example.com,+20 122 333 4444,8th Grade,B',
  ].join('\n');

  describe('analyzeCsv', () => {
    it('should mask PII before calling the LLM', async () => {
      mockLlm.generateStructured.mockResolvedValue({ mappings: [] });

      await service.analyzeCsv(CSV);

      const call = mockLlm.generateStructured.mock.calls[0] as unknown as [
        { userPrompt: string },
      ];
      const prompt = call[0].userPrompt;
      expect(prompt).not.toContain('aya.hassan@example.com');
      expect(prompt).not.toContain('omar.ali@example.com');
      expect(prompt).not.toContain('+20 111 222 3333');
      expect(prompt).toContain('name@example.com');
      expect(prompt).toContain('+20 100 000 0000');
    });

    it('should return the proposed mapping with confidence', async () => {
      mockLlm.generateStructured.mockResolvedValue({
        mappings: [
          {
            sourceColumn: 'student name',
            mappedField: 'STUDENT_NAME',
            confidence: 0.95,
          },
          { sourceColumn: 'email', mappedField: 'EMAIL', confidence: 1 },
          {
            sourceColumn: 'grade',
            mappedField: 'GRADE_LEVEL',
            confidence: 0.8,
          },
          { sourceColumn: 'section', mappedField: 'SECTION', confidence: 0.7 },
        ],
      });

      const result = await service.analyzeCsv(CSV);

      expect(result.totalRows).toBe(2);
      expect(result.columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceColumn: 'student name',
            suggestedField: 'STUDENT_NAME',
            confidence: 0.95,
          }),
          expect.objectContaining({
            sourceColumn: 'email',
            suggestedField: 'EMAIL',
            confidence: 1,
          }),
        ]),
      );
      expect(result.maskedColumns).toEqual(
        expect.arrayContaining(['student name', 'email', 'guardian phone']),
      );
    });

    it('should fall back to UNMAPPED for columns the LLM did not mention', async () => {
      mockLlm.generateStructured.mockResolvedValue({ mappings: [] });

      const result = await service.analyzeCsv(CSV);

      expect(result.columns.every((c) => c.suggestedField === 'UNMAPPED')).toBe(
        true,
      );
    });

    it('should reject an empty CSV', async () => {
      await expect(service.analyzeCsv('')).rejects.toMatchObject({
        code: 'CSV_PARSE_ERROR',
      });
    });
  });

  describe('importCsv', () => {
    const mapping = [
      { sourceColumn: 'student name', mappedField: 'STUDENT_NAME' },
      { sourceColumn: 'email', mappedField: 'EMAIL' },
      { sourceColumn: 'grade', mappedField: 'GRADE_LEVEL' },
      { sourceColumn: 'section', mappedField: 'SECTION' },
    ];

    beforeEach(() => {
      mockPrisma.gradeLevel.findMany.mockResolvedValue([
        { id: 'g7', name: 'Grade 7', level: 7 },
        { id: 'g8', name: 'Grade 8', level: 8 },
      ]);
      mockPrisma.section.findMany.mockResolvedValue([
        { id: 'sA', name: 'A', gradeLevelId: 'g7' },
        { id: 'sB', name: 'B', gradeLevelId: 'g8' },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.create.mockImplementation(
        ({ data }: { data: { email: string } }) => ({
          id: `user-${data.email}`,
          email: data.email,
        }),
      );
      mockPrisma.enrollment.create.mockResolvedValue({ id: 'e1' });
    });

    it('should never call the LLM', async () => {
      await service.importCsv(CSV, mapping, organizationId);

      expect(mockLlm.generateStructured).not.toHaveBeenCalled();
    });

    it('should import rows and match grade and section', async () => {
      const result = await service.importCsv(CSV, mapping, organizationId);

      expect(result.created).toBe(2);
      const createCall = mockPrisma.user.create.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ];
      expect(createCall[0].data).toMatchObject({
        email: 'aya.hassan@example.com',
        name: 'Aya Hassan',
        role: 'STUDENT',
        organizationId,
        gradeId: 'g7',
      });
      const enrollmentCall = mockPrisma.enrollment.create.mock
        .calls[0] as unknown as [{ data: Record<string, unknown> }];
      expect(enrollmentCall[0].data).toMatchObject({
        sectionId: 'sA',
        status: 'APPROVED',
      });
    });

    it('should treat a re-import as an idempotent no-op via email dedupe', async () => {
      await service.importCsv(CSV, mapping, organizationId);
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(2);

      mockPrisma.user.findMany.mockResolvedValue([
        { email: 'aya.hassan@example.com' },
        { email: 'omar.ali@example.com' },
      ]);

      const second = await service.importCsv(CSV, mapping, organizationId);

      expect(second.created).toBe(0);
      expect(second.duplicates).toBe(2);
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(2);
    });

    it('should report per-row errors for missing required fields without guessing', async () => {
      const csv = [
        'student name,email',
        'Aya Hassan,',
        ',omar.ali@example.com',
        'Omar Ali,omar.ali@example.com',
      ].join('\n');
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.importCsv(
        csv,
        [
          { sourceColumn: 'student name', mappedField: 'STUDENT_NAME' },
          { sourceColumn: 'email', mappedField: 'EMAIL' },
        ],
        organizationId,
      );

      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toMatchObject({ row: 2 });
      expect(result.errors[0].reason).toContain('email');
      expect(result.errors[1]).toMatchObject({ row: 3 });
      expect(result.errors[1].reason).toContain('name');
    });

    it('should flag unmatched grade levels instead of creating the student', async () => {
      const csv = [
        'student name,email,grade',
        'Aya Hassan,aya@example.com,Grade 99',
      ].join('\n');

      const result = await service.importCsv(
        csv,
        [
          { sourceColumn: 'student name', mappedField: 'STUDENT_NAME' },
          { sourceColumn: 'email', mappedField: 'EMAIL' },
          { sourceColumn: 'grade', mappedField: 'GRADE_LEVEL' },
        ],
        organizationId,
      );

      expect(result.created).toBe(0);
      expect(result.flagged).toHaveLength(1);
      expect(result.flagged[0].reason).toContain('Grade 99');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should flag unmatched sections', async () => {
      const csv = [
        'student name,email,section',
        'Aya Hassan,aya@example.com,Section Z',
      ].join('\n');

      const result = await service.importCsv(
        csv,
        [
          { sourceColumn: 'student name', mappedField: 'STUDENT_NAME' },
          { sourceColumn: 'email', mappedField: 'EMAIL' },
          { sourceColumn: 'section', mappedField: 'SECTION' },
        ],
        organizationId,
      );

      expect(result.created).toBe(0);
      expect(result.flagged).toHaveLength(1);
      expect(result.flagged[0].reason).toContain('Section Z');
    });
  });
});
