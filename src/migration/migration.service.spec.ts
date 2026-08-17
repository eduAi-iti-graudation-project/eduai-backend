import { Test, TestingModule } from '@nestjs/testing';
import { MigrationService, TEMPLATE_CSV } from './migration.service';
import type { ImportableField } from './migration.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { JoinRequestsService } from '../join-requests/join-requests.service';

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
  };

  const mockLlm = {
    generateStructured: jest.fn(),
  };

  const mockJoinRequests = {
    stageRoster: jest
      .fn()
      .mockImplementation((_org: string, rows: Array<{ row: number }>) => ({
        staged: rows.length,
        notStaged: [],
      })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockJoinRequests.stageRoster
      .mockReset()
      .mockImplementation((_org: string, rows: Array<{ row: number }>) => ({
        staged: rows.length,
        notStaged: [],
      }));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LlmService, useValue: mockLlm },
        { provide: JoinRequestsService, useValue: mockJoinRequests },
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

  describe('pasted input (Path B) converges with file input (Path A)', () => {
    it('should analyze a pasted tab-separated range exactly like a CSV file', async () => {
      mockLlm.generateStructured.mockResolvedValue({
        mappings: [
          {
            sourceColumn: 'First Name',
            mappedField: 'FIRST_NAME',
            confidence: 1,
          },
          {
            sourceColumn: 'Last Name',
            mappedField: 'LAST_NAME',
            confidence: 1,
          },
          { sourceColumn: 'Email', mappedField: 'EMAIL', confidence: 1 },
        ],
      });

      const pasted = [
        'First Name\tLast Name\tEmail',
        'Aya\tHassan\taya.hassan@example.com',
        'Omar\tAli\tomar.ali@example.com',
      ].join('\n');
      const asCsv = [
        'First Name,Last Name,Email',
        'Aya,Hassan,aya.hassan@example.com',
        'Omar,Ali,omar.ali@example.com',
      ].join('\n');

      const pastedResult = await service.analyzePasted(pasted);
      const fileResult = await service.analyzeCsv(asCsv);

      expect(pastedResult.totalRows).toBe(2);
      expect(pastedResult).toEqual(fileResult);
    });

    it('should treat a comma-pasted range as CSV too', async () => {
      mockLlm.generateStructured.mockResolvedValue({ mappings: [] });

      const result = await service.analyzePasted(
        'student name,email\nAya,aya@example.com',
      );

      expect(result.totalRows).toBe(1);
    });
  });

  describe('blank template (Path C)', () => {
    const TEMPLATE = TEMPLATE_CSV;

    it('skips the LLM entirely when the header matches the template exactly', async () => {
      const result = await service.analyzeCsv(TEMPLATE);

      expect(mockLlm.generateStructured).not.toHaveBeenCalled();
      const byField = Object.fromEntries(
        result.columns.map((c) => [c.suggestedField, c.sourceColumn]),
      );
      expect(byField).toMatchObject({
        FIRST_NAME: 'firstName',
        LAST_NAME: 'lastName',
        EMAIL: 'email',
        GRADE_LEVEL: 'gradeLevelName',
        SECTION: 'sectionName',
      });
      expect(
        result.columns
          .filter((c) => c.sourceColumn === 'dateOfBirth')
          .every((c) => c.suggestedField === 'UNMAPPED'),
      ).toBe(true);
    });

    it('does not stage the template example row', async () => {
      mockPrisma.gradeLevel.findMany.mockResolvedValue([
        { id: 'g5', name: 'Grade 5', level: 5 },
      ]);
      mockPrisma.section.findMany.mockResolvedValue([]);
      mockJoinRequests.stageRoster.mockResolvedValue({
        staged: 0,
        notStaged: [],
      });

      const result = await service.importCsv(
        TEMPLATE,
        [
          { sourceColumn: 'firstName', mappedField: 'FIRST_NAME' },
          { sourceColumn: 'lastName', mappedField: 'LAST_NAME' },
          { sourceColumn: 'email', mappedField: 'EMAIL' },
        ],
        organizationId,
      );

      expect(result.imported).toBe(0);
      expect(result.needsFollowUp).toHaveLength(1);
      expect(result.needsFollowUp[0].reason).toContain('Template example row');
      expect(mockJoinRequests.stageRoster).not.toHaveBeenCalled();
    });
  });

  describe('importCsv', () => {
    const mapping: Array<{
      sourceColumn: string;
      mappedField: ImportableField | 'UNMAPPED';
    }> = [
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
    });

    it('should never call the LLM', async () => {
      await service.importCsv(CSV, mapping, organizationId);

      expect(mockLlm.generateStructured).not.toHaveBeenCalled();
    });

    it('should stage rows with matched grade/section instead of creating users', async () => {
      const result = await service.importCsv(CSV, mapping, organizationId);

      expect(result.imported).toBe(2);
      expect(result.needsFollowUp).toHaveLength(0);
      expect(result.unassignedGradeOrSection).toHaveLength(0);
      expect(result.unmatchedSectionsOrGrades).toHaveLength(0);

      const stageCall = mockJoinRequests.stageRoster.mock.calls[0] as [
        string,
        Array<Record<string, unknown>>,
      ];
      expect(stageCall[0]).toBe(organizationId);
      expect(stageCall[1]).toEqual([
        expect.objectContaining({
          row: 2,
          email: 'aya.hassan@example.com',
          firstName: 'Aya Hassan',
          gradeId: 'g7',
          gradeLevelName: '7th Grade',
          sectionId: 'sA',
          sectionName: 'A',
        }),
        expect.objectContaining({
          row: 3,
          email: 'omar.ali@example.com',
          firstName: 'Omar Ali',
          gradeId: 'g8',
          gradeLevelName: '8th Grade',
          sectionId: 'sB',
          sectionName: 'B',
        }),
      ]);
    });

    it('should compose a full name from FIRST_NAME / LAST_NAME columns and split email', async () => {
      const csv = [
        'first,last,email,grade,section',
        'Aya,Hassan,aya.hassan@example.com,7th Grade,A',
      ].join('\n');

      await service.importCsv(
        csv,
        [
          { sourceColumn: 'first', mappedField: 'FIRST_NAME' },
          { sourceColumn: 'last', mappedField: 'LAST_NAME' },
          { sourceColumn: 'email', mappedField: 'EMAIL' },
          { sourceColumn: 'grade', mappedField: 'GRADE_LEVEL' },
          { sourceColumn: 'section', mappedField: 'SECTION' },
        ],
        organizationId,
      );

      const stageCall = mockJoinRequests.stageRoster.mock.calls[0] as [
        string,
        Array<Record<string, unknown>>,
      ];
      expect(stageCall[1][0]).toMatchObject({
        firstName: 'Aya',
        lastName: 'Hassan',
        email: 'aya.hassan@example.com',
      });
    });

    it('should let stageRoster surface its not-staged rows as needsFollowUp', async () => {
      mockJoinRequests.stageRoster.mockResolvedValue({
        staged: 1,
        notStaged: [
          {
            row: 3,
            reason: 'already a member of this school',
          },
        ],
      });

      const result = await service.importCsv(CSV, mapping, organizationId);

      expect(result.imported).toBe(1);
      expect(result.needsFollowUp).toEqual([
        { row: 3, reason: 'already a member of this school' },
      ]);
    });

    it('should report per-row needsFollowUp for missing required fields without guessing', async () => {
      const csv = [
        'student name,email',
        'Aya Hassan,',
        ',omar.ali@example.com',
        'Omar Ali,omar.ali@example.com',
      ].join('\n');
      mockJoinRequests.stageRoster.mockResolvedValue({
        staged: 1,
        notStaged: [],
      });

      const result = await service.importCsv(
        csv,
        [
          { sourceColumn: 'student name', mappedField: 'STUDENT_NAME' },
          { sourceColumn: 'email', mappedField: 'EMAIL' },
        ],
        organizationId,
      );

      expect(result.imported).toBe(1);
      expect(result.needsFollowUp).toHaveLength(2);
      expect(result.needsFollowUp[0]).toMatchObject({ row: 2 });
      expect(result.needsFollowUp[0].reason).toContain('self-register');
      expect(result.needsFollowUp[1]).toMatchObject({ row: 3 });
      expect(result.needsFollowUp[1].reason).toContain('name');
    });

    it('imports 9 of 10 rows when only one row is missing an email (partial success)', async () => {
      const rows = Array.from(
        { length: 10 },
        (_, i) => `Student${i},student${i}@example.com,Grade 7,`,
      );
      rows[9] = 'Bob,,7th Grade,A';
      mockJoinRequests.stageRoster.mockResolvedValue({
        staged: 9,
        notStaged: [],
      });

      const result = await service.importCsv(
        `student name,email,grade\n${rows.join('\n')}`,
        [
          { sourceColumn: 'student name', mappedField: 'STUDENT_NAME' },
          { sourceColumn: 'email', mappedField: 'EMAIL' },
          { sourceColumn: 'grade', mappedField: 'GRADE_LEVEL' },
        ],
        organizationId,
      );

      expect(result.imported).toBe(9);
      expect(result.needsFollowUp).toHaveLength(1);
      expect(result.needsFollowUp[0]).toMatchObject({ row: 11 });
    });

    it('flags staged rows whose grade/section are empty as unassigned', async () => {
      const csv = [
        'student name,email,grade,section',
        'Aya Hassan,aya@example.com,,',
      ].join('\n');

      const result = await service.importCsv(
        csv,
        [
          { sourceColumn: 'student name', mappedField: 'STUDENT_NAME' },
          { sourceColumn: 'email', mappedField: 'EMAIL' },
          { sourceColumn: 'grade', mappedField: 'GRADE_LEVEL' },
          { sourceColumn: 'section', mappedField: 'SECTION' },
        ],
        organizationId,
      );

      expect(result.imported).toBe(1);
      const unassigned = result.unassignedGradeOrSection[0];
      expect(unassigned.studentId).toBeUndefined();
      expect(unassigned.reason).toContain('grade');
      expect(unassigned.reason).toContain('section');
    });

    it('stages the row but records an unmatched grade value for later resolution', async () => {
      const csv = [
        'student name,email,grade,section',
        'Aya Hassan,aya@example.com,Grade 99,A',
      ].join('\n');

      const result = await service.importCsv(csv, mapping, organizationId);

      expect(result.imported).toBe(1);
      expect(result.needsFollowUp).toHaveLength(0);
      expect(result.unmatchedSectionsOrGrades).toContainEqual({
        row: 2,
        providedValue: 'Grade 99',
      });
      expect(result.unassignedGradeOrSection[0].reason).toContain(
        'could not be matched',
      );
    });

    it('skips grade/section attestation when the section does not exist yet', async () => {
      const csv = [
        'student name,email,grade,section',
        'Aya Hassan,aya@example.com,Grade 7,Section Z',
      ].join('\n');

      const result = await service.importCsv(csv, mapping, organizationId);

      expect(result.imported).toBe(1);
      expect(result.unmatchedSectionsOrGrades).toContainEqual({
        row: 2,
        providedValue: 'Section Z',
      });
      expect(result.unassignedGradeOrSection[0].reason).toContain(
        'could not be matched',
      );
      const stageCall = mockJoinRequests.stageRoster.mock.calls[0] as [
        string,
        Array<Record<string, unknown>>,
      ];
      expect(stageCall[1][0]).not.toHaveProperty('sectionId');
    });
  });
});
