import { Injectable, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';
import { isEmailLike, isPhoneLike, parseCsv } from './csv-parser';

export const IMPORTABLE_FIELDS = [
  'STUDENT_NAME',
  'EMAIL',
  'GRADE_LEVEL',
  'SECTION',
] as const;

export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

export const MAPPED_FIELD_VALUES = [...IMPORTABLE_FIELDS, 'UNMAPPED'] as const;

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

export interface ImportResult {
  created: number;
  duplicates: number;
  errors: Array<{ row: number; reason: string }>;
  flagged: Array<{ row: number; reason: string }>;
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

@Injectable()
export class MigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async analyzeCsv(text: string): Promise<{
    columns: AnalyzedColumn[];
    totalRows: number;
    maskedColumns: string[];
  }> {
    const rows = parseCsv(text);
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

    const result = await this.llm.generateStructured({
      systemPrompt:
        'You are a school data import assistant. Given a CSV header and masked sample values, propose which EduAI field each column maps to. Supported fields: STUDENT_NAME, EMAIL, GRADE_LEVEL, SECTION. Use UNMAPPED for columns that do not match any field. Respond with JSON only: {"mappings": [{"sourceColumn": "...", "mappedField": "...", "confidence": 0.0}]}.',
      userPrompt: `Columns (samples are masked placeholders):\n${JSON.stringify(mappingPreview, null, 2)}`,
      schema: MappingSuggestionSchema,
    });

    const byColumn = new Map(result.mappings.map((m) => [m.sourceColumn, m]));

    const analyzed = columns.map<AnalyzedColumn>((c) => {
      const suggestion = byColumn.get(c.sourceColumn);
      return {
        sourceColumn: c.sourceColumn,
        sampleValues: c.sampleValues,
        suggestedField: suggestion?.mappedField ?? 'UNMAPPED',
        confidence: suggestion?.confidence ?? 0,
        masked: c.masked,
      };
    });

    return { columns: analyzed, totalRows, maskedColumns };
  }

  async importCsv(
    text: string,
    mapping: Array<{
      sourceColumn: string;
      mappedField: ImportableField | 'UNMAPPED';
    }>,
    organizationId: string,
  ): Promise<ImportResult> {
    const rows = parseCsv(text);
    if (rows.length === 0) {
      throw new ApiError(
        ErrorCode.CSV_PARSE_ERROR,
        HttpStatus.BAD_REQUEST,
        'The CSV file is empty or could not be read.',
      );
    }

    const header = rows[0];
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

    const gradeLevels = await this.prisma.gradeLevel.findMany({
      where: { organizationId },
      select: { id: true, name: true, level: true },
    });
    const sections = await this.prisma.section.findMany({
      where: { organizationId },
      select: { id: true, name: true, gradeLevelId: true },
    });
    const existingEmails = new Set(
      (
        await this.prisma.user.findMany({
          where: { organizationId, role: 'STUDENT' },
          select: { email: true },
        })
      ).map((u) => u.email.toLowerCase()),
    );

    const result: ImportResult = {
      created: 0,
      duplicates: 0,
      errors: [],
      flagged: [],
    };

    for (let i = 0; i < rows.length - 1; i++) {
      const row = rows[i + 1];
      const rowNumber = i + 2;

      const name = cell(row, 'STUDENT_NAME');
      const email = cell(row, 'EMAIL').toLowerCase();

      const missing: string[] = [];
      if (!name) missing.push('name');
      if (!email) missing.push('email');
      if (missing.length > 0) {
        result.errors.push({
          row: rowNumber,
          reason: `Missing required field: ${missing.join(', ')}`,
        });
        continue;
      }

      if (existingEmails.has(email)) {
        result.duplicates++;
        continue;
      }

      const gradeValue = cell(row, 'GRADE_LEVEL');
      let gradeId: string | null = null;
      let gradeReason: string | null = null;
      if (gradeValue) {
        const match = this.matchGradeLevel(gradeValue, gradeLevels);
        if (match) {
          gradeId = match.id;
        } else {
          gradeReason = `Grade level "${gradeValue}" not found`;
        }
      }

      const sectionValue = cell(row, 'SECTION');
      let sectionId: string | null = null;
      let sectionReason: string | null = null;
      if (sectionValue) {
        const match = this.matchSection(
          sectionValue,
          sections,
          gradeId ?? undefined,
        );
        if (match) {
          sectionId = match.id;
        } else {
          sectionReason = `Section "${sectionValue}" not found`;
        }
      }

      if (gradeReason || sectionReason) {
        result.flagged.push({
          row: rowNumber,
          reason: [gradeReason, sectionReason].filter(Boolean).join(' · '),
        });
        continue;
      }

      const user = await this.prisma.user.create({
        data: {
          email,
          name,
          role: 'STUDENT',
          organizationId,
          ...(gradeId ? { gradeId } : {}),
        },
      });
      if (sectionId) {
        await this.prisma.enrollment.create({
          data: { sectionId, studentId: user.id, status: 'APPROVED' },
        });
      }
      existingEmails.add(email);
      result.created++;
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
