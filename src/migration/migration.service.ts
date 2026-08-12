import { Injectable, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { JoinRequestsService } from '../join-requests/join-requests.service';
import { encryptSsn, ssnTail4 } from '../common/crypto/ssn';
import { isEmailLike, isPhoneLike, parseCsv, parsePasted } from './csv-parser';

export const IMPORTABLE_FIELDS = [
  'STUDENT_NAME',
  'FIRST_NAME',
  'LAST_NAME',
  'EMAIL',
  'GRADE_LEVEL',
  'SECTION',
  'GUARDIAN_NAME',
  'GUARDIAN_EMAIL',
  'GUARDIAN_SSN',
  'GUARDIAN_PHONE',
  'GUARDIAN_NATIONALITY',
] as const;

export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

export const MAPPED_FIELD_VALUES = [...IMPORTABLE_FIELDS, 'UNMAPPED'] as const;

/** The blank template (Path C): exact header + one example row. */
export const TEMPLATE_HEADERS = [
  'firstName',
  'lastName',
  'email',
  'gradeLevelName',
  'sectionName',
  'dateOfBirth',
  'guardianName',
  'guardianEmail',
  'guardianPhone',
  'guardianSsn',
  'guardianNationality',
] as const;

const TEMPLATE_EXAMPLE_ROW = [
  'Jane',
  'Doe',
  'jane.doe@example.com',
  'Grade 7',
  'A',
  '2014-03-12',
  'Joan Doe',
  'joan.doe@example.com',
  '+20 100 000 0000',
  '123-45-6789',
  'Egyptian',
];

export const TEMPLATE_CSV = [
  TEMPLATE_HEADERS.join(','),
  TEMPLATE_EXAMPLE_ROW.join(','),
].join('\n');

/**
 * Exact header match against the template → the mapping is unambiguous, so
 * the AI mapping call is skipped entirely (a school using the template
 * never pays for, or waits on, an LLM round-trip it doesn't need).
 */
export function isTemplateHeader(header: string[]): boolean {
  return (
    header.length === TEMPLATE_HEADERS.length &&
    header.every(
      (h, i) => h.trim().toLowerCase() === TEMPLATE_HEADERS[i].toLowerCase(),
    )
  );
}

function isTemplateExampleRow(header: string[], row: string[]): boolean {
  if (!isTemplateHeader(header) || row.length < TEMPLATE_EXAMPLE_ROW.length) {
    return false;
  }
  return TEMPLATE_EXAMPLE_ROW.every((value, i) => row[i].trim() === value);
}

const MappingSuggestionSchema = z.object({
  mappings: z.array(
    z.object({
      sourceColumn: z.string().min(1),
      mappedField: z.enum(MAPPED_FIELD_VALUES),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export interface AnalyzedColumn {
  sourceColumn: string;
  sampleValues: string[];
  suggestedField: ImportableField | 'UNMAPPED';
  confidence: number;
  masked: boolean;
}

export interface FollowUpRow {
  row: number;
  reason: string;
}

export interface UnassignedRow {
  row: number;
  studentId?: string;
  reason: string;
}

export interface UnmatchedRow {
  row: number;
  providedValue: string;
}

/**
 * Structured import summary. Buckets are mutually exclusive per row:
 * - imported: rows that were staged (PENDING, awaiting admin approval) or,
 *   with roster auto-approval, provisioned immediately
 * - autoApproved: count of rows provisioned instantly (WP2 — no admin click)
 * - queued: rows left PENDING after a failed auto-approval (admin review)
 * - needsFollowUp: row NOT staged (missing name/email, duplicate, already a
 *   member, an email-less row that must be self-registered later, or a
 *   split-import row whose guardian data was dropped)
 * - unmatchedSectionsOrGrades: reporting detail for rows whose PROVIDED
 *   grade/section value failed to match (the row is still staged)
 * - unassignedGradeOrSection: staged rows whose grade/section are missing or
 *   unmatched — the admin can resolve these before approval
 */
export interface ImportResult {
  /** Rows staged as PENDING join requests awaiting approval (or imported, when NOT auto-approved). */
  imported: number;
  /** Rows provisioned instantly by roster auto-approval (WP2). */
  autoApproved: number;
  /** Rows left PENDING after a failed auto-approval — admin review needed. */
  queued: number;
  unassignedGradeOrSection: UnassignedRow[];
  needsFollowUp: FollowUpRow[];
  unmatchedSectionsOrGrades: UnmatchedRow[];
}

const EMAIL_MASK = 'name@example.com';
const PHONE_MASK = '+20 100 000 0000';
const NAME_MASK = 'Jane Doe';
const DATE_MASK = '2000-01-01';

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  const shared = [...ta].filter((token) => tb.has(token)).length;
  return shared / Math.max(ta.size, tb.size);
}

function maskColumn(
  header: string,
  samples: string[],
): {
  maskedSamples: string[];
  masked: boolean;
} {
  const headerLower = header.toLowerCase();
  if (/email|mail/.test(headerLower)) {
    return { maskedSamples: samples.map(() => EMAIL_MASK), masked: true };
  }
  if (/phone|mobile|tel(ephone)?/.test(headerLower)) {
    return { maskedSamples: samples.map(() => PHONE_MASK), masked: true };
  }
  if (/name|student|guardian|parent/.test(headerLower)) {
    return { maskedSamples: samples.map(() => NAME_MASK), masked: true };
  }
  if (/birth|dob|date/.test(headerLower)) {
    return { maskedSamples: samples.map(() => DATE_MASK), masked: true };
  }

  const maskedSamples = samples.map((value) => {
    if (isEmailLike(value)) return EMAIL_MASK;
    if (isPhoneLike(value)) return PHONE_MASK;
    return value;
  });
  const masked = maskedSamples.some((m, i) => m !== samples[i]);
  return { maskedSamples, masked };
}

const TEMPLATE_1_TO_1: Record<string, ImportableField | 'UNMAPPED'> = {
  firstname: 'FIRST_NAME',
  lastname: 'LAST_NAME',
  email: 'EMAIL',
  gradelevelname: 'GRADE_LEVEL',
  sectionname: 'SECTION',
  dateofbirth: 'UNMAPPED',
  guardianname: 'GUARDIAN_NAME',
  guardianemail: 'GUARDIAN_EMAIL',
  guardianphone: 'GUARDIAN_PHONE',
  guardianssn: 'GUARDIAN_SSN',
  guardiannationality: 'GUARDIAN_NATIONALITY',
};

@Injectable()
export class MigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly joinRequests: JoinRequestsService,
  ) {}

  async analyzeCsv(text: string): Promise<AnalyzeResult> {
    const rows = parseCsv(text);
    return this.analyzeRows(rows);
  }

  /** Paste path: tab-separated spreadsheet ranges, comma as fallback. */
  async analyzePasted(text: string): Promise<AnalyzeResult> {
    const rows = parsePasted(text);
    return this.analyzeRows(rows);
  }

  /**
   * The ONE analyze pipeline. Every input path (file upload, paste, and
   * returned template template) converges here once parsed into string[][];
   * the only branch in this function is the template short-circuit that
   * replaces the LLM mapping call with a deterministic one.
   */
  private async analyzeRows(rows: string[][]): Promise<AnalyzeResult> {
    if (rows.length === 0) {
      throw new ApiError(
        ErrorCode.CSV_PARSE_ERROR,
        HttpStatus.BAD_REQUEST,
        'The CSV file is empty or could not be read.',
      );
    }

    const header = rows[0];
    const dataRows = rows.slice(1);
    const totalRows = dataRows.length;

    const columns = header.map((sourceColumn, index) => {
      const sampleValues = dataRows
        .map((row) => row[index] ?? '')
        .filter((v) => v.length > 0)
        .slice(0, 5);
      const { maskedSamples, masked } = maskColumn(sourceColumn, sampleValues);
      return {
        sourceColumn,
        sampleValues,
        maskedSamples,
        masked,
      };
    });

    const maskedColumns = columns
      .filter((c) => c.masked)
      .map((c) => c.sourceColumn);

    const mappingPreview = columns.map((c) => ({
      sourceColumn: c.sourceColumn,
      samples: c.maskedSamples,
    }));

    interface Suggestion {
      mappedField: ImportableField | 'UNMAPPED';
      confidence: number;
    }
    const suggestionsByColumn = new Map<string, Suggestion>();

    if (isTemplateHeader(header)) {
      header.forEach((sourceColumn) => {
        suggestionsByColumn.set(sourceColumn, {
          mappedField:
            TEMPLATE_1_TO_1[sourceColumn.trim().toLowerCase()] ?? 'UNMAPPED',
          confidence: 1,
        });
      });
    } else {
      const result = await this.llm.generateStructured({
        systemPrompt: `You are a school data import assistant. Given a CSV header and masked sample values, propose which EduAI field each column maps to. Supported fields: STUDENT_NAME, FIRST_NAME, LAST_NAME, EMAIL, GRADE_LEVEL, SECTION, GUARDIAN_NAME, GUARDIAN_EMAIL, GUARDIAN_SSN, GUARDIAN_PHONE, GUARDIAN_NATIONALITY. Use UNMAPPED for columns that do not match any field. Respond with JSON only: {"mappings": [{"sourceColumn": "...", "mappedField": "...", "confidence": 0.0}]}.`,
        userPrompt: `Columns (samples are masked placeholders):\n${JSON.stringify(mappingPreview, null, 2)}`,
        schema: MappingSuggestionSchema,
      });
      for (const m of result.mappings) {
        if (!suggestionsByColumn.has(m.sourceColumn)) {
          suggestionsByColumn.set(m.sourceColumn, {
            mappedField: m.mappedField,
            confidence: m.confidence,
          });
        }
      }
    }

    return {
      columns: columns.map<AnalyzedColumn>((c) => {
        const suggestion = suggestionsByColumn.get(c.sourceColumn);
        return {
          sourceColumn: c.sourceColumn,
          sampleValues: c.sampleValues,
          suggestedField: suggestion?.mappedField ?? 'UNMAPPED',
          confidence: suggestion?.confidence ?? 0,
          masked: c.masked,
        };
      }),
      totalRows,
      maskedColumns,
    };
  }

  async importCsv(
    text: string,
    mapping: Array<{
      sourceColumn: string;
      mappedField: ImportableField | 'UNMAPPED';
    }>,
    organizationId: string,
    decidedBy?: string,
  ): Promise<ImportResult> {
    const rows = parseCsv(text);
    if (rows.length === 0) {
      throw new ApiError(
        ErrorCode.CSV_IMPORT_EMPTY,
        HttpStatus.BAD_REQUEST,
        'The CSV file is empty or could not be read.',
      );
    }

    const header = rows[0];
    const isTemplate = isTemplateHeader(header);
    const columnIndex = new Map<string, number>();
    header.forEach((name, index) => {
      if (!columnIndex.has(name)) columnIndex.set(name, index);
    });
    const fieldToColumn = new Map<ImportableField, string>();
    for (const m of mapping) {
      if (m.mappedField === 'UNMAPPED') continue;
      if (!columnIndex.has(m.sourceColumn)) continue;
      if (!fieldToColumn.has(m.mappedField)) {
        fieldToColumn.set(m.mappedField, m.sourceColumn);
      }
    }

    const cell = (row: string[], field: ImportableField): string => {
      const source = fieldToColumn.get(field);
      if (!source) return '';
      const index = columnIndex.get(source);
      if (index === undefined) return '';
      return (row[index] ?? '').trim();
    };

    const SSN_PATTERN = /^\d{3}[- ]?\d{2}[- ]?\d{4}$/;

    const gradeLevels = await this.prisma.gradeLevel.findMany({
      where: { organizationId },
      select: { id: true, name: true, level: true },
    });
    const sections = await this.prisma.section.findMany({
      where: { organizationId },
      select: { id: true, name: true, gradeLevelId: true },
    });

    const result: ImportResult = {
      imported: 0,
      autoApproved: 0,
      queued: 0,
      unassignedGradeOrSection: [],
      needsFollowUp: [],
      unmatchedSectionsOrGrades: [],
    };

    type PendingStage = {
      row: number;
      email: string;
      firstName: string;
      lastName?: string;
      gradeId?: string;
      gradeLevelName?: string;
      sectionId?: string;
      sectionName?: string;
      guardianName?: string;
      guardianEmail?: string;
      guardianSsnEncrypted?: string;
      guardianSsnTail4?: string;
      guardianPhone?: string;
      guardianNationality?: string;
    };
    const pendingStages: PendingStage[] = [];

    for (let i = 0; i < rows.length - 1; i++) {
      const row = rows[i + 1];
      const rowNumber = i + 2;

      if (isTemplate && isTemplateExampleRow(header, row)) {
        result.needsFollowUp.push({
          row: rowNumber,
          reason: 'Template example row — remove it before importing.',
        });
        continue;
      }

      const firstName = cell(row, 'FIRST_NAME');
      const lastName = cell(row, 'LAST_NAME');
      const singleName = cell(row, 'STUDENT_NAME');
      const name =
        singleName || [firstName, lastName].filter(Boolean).join(' ').trim();
      const email = cell(row, 'EMAIL').toLowerCase();

      if (!name) {
        result.needsFollowUp.push({
          row: rowNumber,
          reason: 'Missing required field: name',
        });
        continue;
      }
      if (!email) {
        result.needsFollowUp.push({
          row: rowNumber,
          reason:
            'No email — this student will need to self-register with the school code.',
        });
        continue;
      }

      const gradeValue = cell(row, 'GRADE_LEVEL');
      let gradeId: string | undefined;
      if (gradeValue) {
        const match = this.matchGradeLevel(gradeValue, gradeLevels);
        if (match) {
          gradeId = match.id;
        } else {
          result.unmatchedSectionsOrGrades.push({
            row: rowNumber,
            providedValue: gradeValue,
          });
        }
      }

      const sectionValue = cell(row, 'SECTION');
      let sectionId: string | undefined;
      if (sectionValue) {
        const match = this.matchSection(
          sectionValue,
          sections,
          gradeId ?? undefined,
        );
        if (match) {
          sectionId = match.id;
        } else {
          result.unmatchedSectionsOrGrades.push({
            row: rowNumber,
            providedValue: sectionValue,
          });
        }
      }

      const unassignedReasons = [
        ...(!gradeId
          ? gradeValue
            ? [`Grade level "${gradeValue}" could not be matched`]
            : ['no grade level provided']
          : []),
        ...(!sectionId
          ? sectionValue
            ? [`Section "${sectionValue}" could not be matched`]
            : ['no section provided']
          : []),
      ];
      if (unassignedReasons.length > 0) {
        result.unassignedGradeOrSection.push({
          row: rowNumber,
          reason: unassignedReasons.join(' · '),
        });
      }

      const guardianName = cell(row, 'GUARDIAN_NAME');
      const guardianEmail = cell(row, 'GUARDIAN_EMAIL').toLowerCase();
      const guardianSsn = cell(row, 'GUARDIAN_SSN');
      const guardianPhone = cell(row, 'GUARDIAN_PHONE');
      const guardianNationality = cell(row, 'GUARDIAN_NATIONALITY');

      const hasGuardianData =
        guardianName ||
        guardianEmail ||
        guardianSsn ||
        guardianPhone ||
        guardianNationality;

      // WP2 split-import: incomplete guardian data no longer skips the whole
      // row. The student is imported (guardian columns dropped) and flagged so
      // a guardian can be attached later (parent verify invite or admin link).
      const guardianBlocked =
        hasGuardianData &&
        (!guardianName ||
          !guardianEmail ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail));
      const guardianSsnInvalid = Boolean(
        guardianSsn && !SSN_PATTERN.test(guardianSsn),
      );
      let guardianData: {
        guardianName: string;
        guardianEmail: string;
        guardianSsnEncrypted?: string;
        guardianSsnTail4?: string;
        guardianPhone?: string;
        guardianNationality?: string;
      } | null = null;
      if (guardianBlocked) {
        result.needsFollowUp.push({
          row: rowNumber,
          reason:
            'Guardian data present but missing a valid guardian name + email — student imported without a guardian, provision the parent later.',
        });
      } else if (guardianSsnInvalid) {
        result.needsFollowUp.push({
          row: rowNumber,
          reason: `Guardian SSN "${guardianSsn}" is not a valid 9-digit SSN — student imported without a guardian, provision the parent later.`,
        });
      } else if (hasGuardianData) {
        guardianData = {
          guardianName,
          guardianEmail,
          ...(guardianSsn
            ? {
                guardianSsnEncrypted: encryptSsn(guardianSsn),
                guardianSsnTail4: ssnTail4(guardianSsn),
              }
            : {}),
          ...(guardianPhone ? { guardianPhone } : {}),
          ...(guardianNationality ? { guardianNationality } : {}),
        };
      }

      pendingStages.push({
        row: rowNumber,
        email,
        firstName: singleName || firstName,
        ...(singleName ? {} : lastName ? { lastName } : {}),
        ...(gradeId ? { gradeId } : {}),
        ...(gradeValue ? { gradeLevelName: gradeValue } : {}),
        ...(sectionId ? { sectionId } : {}),
        ...(sectionValue ? { sectionName: sectionValue } : {}),
        ...(guardianData ?? {}),
      });
    }

    if (pendingStages.length > 0) {
      // WP2: migration imports auto-approve complete rows (no admin click).
      // An admin id is required for the "decided by" audit trail.
      const autoApprove = Boolean(decidedBy);
      const staged = await this.joinRequests.stageRoster(
        organizationId,
        pendingStages,
        autoApprove ? { autoApprove, decidedBy } : undefined,
      );
      result.imported = staged.staged;
      result.autoApproved = autoApprove ? staged.staged : 0;
      result.queued = staged.queued;
      result.needsFollowUp.push(...staged.notStaged);
    }

    return result;
  }

  private matchGradeLevel(
    value: string,
    grades: Array<{ id: string; name: string | null; level: number }>,
  ): { id: string } | null {
    const normalized = normalizeName(value);
    const numeric = value.match(/(\d+)/)?.[1];
    for (const grade of grades) {
      if (normalizeName(grade.name ?? '') === normalized)
        return { id: grade.id };
      if (numeric && String(grade.level) === numeric) return { id: grade.id };
    }
    let best: { id: string; score: number } | null = null;
    for (const grade of grades) {
      const score = tokenOverlap(value, grade.name ?? String(grade.level));
      if (score > (best?.score ?? 0)) best = { id: grade.id, score };
    }
    if (best && best.score >= 0.75) return best;
    return null;
  }

  private matchSection(
    value: string,
    sections: Array<{ id: string; name: string; gradeLevelId: string }>,
    gradeId?: string,
  ): { id: string } | null {
    const normalized = normalizeName(value).replace(/^section\s*/, '');
    let candidates = sections;
    if (gradeId) {
      const inGrade = sections.filter((s) => s.gradeLevelId === gradeId);
      if (inGrade.length > 0) candidates = inGrade;
    }
    for (const section of candidates) {
      if (normalizeName(section.name) === normalized) return { id: section.id };
    }
    let best: { id: string; score: number } | null = null;
    for (const section of candidates) {
      const score = tokenOverlap(value, section.name);
      if (score > (best?.score ?? 0)) best = { id: section.id, score };
    }
    if (best && best.score >= 0.75) return best;
    return null;
  }
}

export interface AnalyzeResult {
  columns: AnalyzedColumn[];
  totalRows: number;
  maskedColumns: string[];
}
