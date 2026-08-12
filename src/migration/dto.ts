import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IMPORTABLE_FIELDS } from './migration.service';

export const AnalyzeCsvSchema = z.object({
  csv: z.string().min(1),
});

export const AnalyzePastedSchema = z.object({
  text: z.string().min(1),
});

export const ImportCsvSchema = z.object({
  csv: z.string().min(1),
  mapping: z.array(
    z.object({
      sourceColumn: z.string().min(1),
      mappedField: z.enum([...IMPORTABLE_FIELDS, 'UNMAPPED']),
    }),
  ),
});

export class AnalyzeCsvDto extends createZodDto(AnalyzeCsvSchema) {}
export class AnalyzePastedDto extends createZodDto(AnalyzePastedSchema) {}
export class ImportCsvDto extends createZodDto(ImportCsvSchema) {}
