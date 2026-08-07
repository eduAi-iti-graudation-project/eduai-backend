import { Injectable, HttpStatus, BadGatewayException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import pdfParse from 'pdf-parse';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { SupabaseService } from '../auth/supabase.service';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/codes';

const DOCUMENT_CATEGORIES = [
  'BIRTH_CERTIFICATE',
  'IMMUNIZATION_RECORD',
  'PREVIOUS_TRANSCRIPT',
  'PAYMENT_RECEIPT',
  'ID_DOCUMENT',
  'OTHER',
] as const;

const DocumentCategorySuggestionSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
});

const DocumentStudentNameSchema = z.object({
  studentName: z.string().min(1).nullable(),
});

interface ClassifiedFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  objectPath: string;
  rawText: string | null;
  aiSuggestedCategory: string | null;
  aiSuggestedStudentId: string | null;
  aiMatchConfidence: number | null;
}

export interface BulkUploadResult {
  created: Array<{
    id: string;
    fileName: string;
    aiSuggestedCategory: string | null;
    aiSuggestedStudentId: string | null;
    aiMatchConfidence: number | null;
    category: string;
    studentId: string | null;
  }>;
  failed: Array<{ fileName: string; reason: string }>;
}

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

@Injectable()
export class DocumentsService {
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly supabase: SupabaseService,
  ) {
    this.bucket = process.env.SUPABASE_DOCUMENT_BUCKET || 'documents';
  }

  async extractText(buffer: Buffer, fileName: string): Promise<string | null> {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.pdf')) {
      try {
        const pdfData = await pdfParse(buffer);
        const text = (pdfData.text ?? '').trim();
        return text.length > 0 ? text : null;
      } catch {
        return null;
      }
    }
    if (/\.(txt|md|csv|rtf)$/.test(lower)) {
      const text = buffer.toString('utf-8').trim();
      return text.length > 0 ? text : null;
    }
    return null;
  }

  async suggestCategory(rawText: string): Promise<string | null> {
    try {
      const result = await this.llm.generateStructured({
        systemPrompt:
          'You are a school registrar assistant. Classify the student document excerpt below into exactly one category. Only pick a category that is clearly supported by the text; otherwise use OTHER. Respond with JSON only: {"category": "..."}.',
        userPrompt: `Categories: ${DOCUMENT_CATEGORIES.join(', ')}\n\nDocument text:\n${rawText.slice(0, 3000)}`,
        schema: DocumentCategorySuggestionSchema,
      });
      return result.category === 'OTHER' ? 'OTHER' : result.category;
    } catch {
      return null;
    }
  }

  async extractPrintedName(rawText: string): Promise<string | null> {
    try {
      const result = await this.llm.generateStructured({
        systemPrompt:
          'You are a school registrar assistant. Find the printed full name of the student this document belongs to. Return the name exactly as printed. If the document does not clearly state a student name, return null. Respond with JSON only: {"studentName": "..."}.',
        userPrompt: `Document text:\n${rawText.slice(0, 3000)}`,
        schema: DocumentStudentNameSchema,
      });
      return result.studentName;
    } catch {
      return null;
    }
  }

  async matchStudent(
    name: string,
    organizationId: string,
  ): Promise<{ studentId: string; confidence: number } | null> {
    if (!name || name.trim().length === 0) return null;
    const students = await this.prisma.user.findMany({
      where: { role: 'STUDENT', organizationId },
      select: { id: true, name: true },
    });
    if (students.length === 0) return null;

    const target = normalizeName(name);
    const exact = students.find((s) => normalizeName(s.name) === target);
    if (exact) return { studentId: exact.id, confidence: 1 };

    let best: { studentId: string; score: number } | null = null;
    for (const student of students) {
      const score = tokenOverlap(name, student.name);
      if (score > (best?.score ?? 0)) {
        best = { studentId: student.id, score };
      }
    }
    if (!best || best.score < 0.75) return null;
    return {
      studentId: best.studentId,
      confidence: Math.round(best.score * 100) / 100,
    };
  }

  async storeFile(
    organizationId: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectPath = `${this.bucket}/${organizationId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await this.supabase
      .getClient()
      .storage.from(this.bucket)
      .upload(objectPath, buffer, {
        contentType: mimeType || 'application/octet-stream',
      });
    if (error) {
      throw new ApiError(
        ErrorCode.DOCUMENT_UPLOAD_FAILED,
        HttpStatus.INTERNAL_SERVER_ERROR,
        `Could not store the uploaded file: ${error.message}`,
      );
    }
    return objectPath;
  }

  async createSignedUrl(objectPath: string): Promise<string> {
    const { data, error } = await this.supabase
      .getClient()
      .storage.from(this.bucket)
      .createSignedUrl(objectPath, 3600);
    if (error || !data) {
      throw new BadGatewayException('Failed to create download URL');
    }
    return data.signedUrl;
  }

  async removeFromStorage(objectPath: string): Promise<void> {
    if (!objectPath || !objectPath.startsWith(`${this.bucket}/`)) return;
    await this.supabase
      .getClient()
      .storage.from(this.bucket)
      .remove([objectPath]);
  }

  private async classifyAndMatch(
    buffer: Buffer,
    fileName: string,
    organizationId: string,
  ): Promise<
    Pick<
      ClassifiedFile,
      | 'rawText'
      | 'aiSuggestedCategory'
      | 'aiSuggestedStudentId'
      | 'aiMatchConfidence'
    >
  > {
    const rawText = await this.extractText(buffer, fileName);
    if (!rawText) {
      return {
        rawText: null,
        aiSuggestedCategory: null,
        aiSuggestedStudentId: null,
        aiMatchConfidence: null,
      };
    }
    const aiSuggestedCategory = await this.suggestCategory(rawText);
    const printedName = await this.extractPrintedName(rawText);
    const match = printedName
      ? await this.matchStudent(printedName, organizationId)
      : null;
    return {
      rawText,
      aiSuggestedCategory,
      aiSuggestedStudentId: match?.studentId ?? null,
      aiMatchConfidence: match?.confidence ?? null,
    };
  }

  async bulkUpload(
    files: Express.Multer.File[],
    organizationId: string,
    adminId: string,
  ): Promise<BulkUploadResult> {
    if (!files || files.length === 0) {
      throw new ApiError(
        ErrorCode.BULK_UPLOAD_EMPTY,
        HttpStatus.BAD_REQUEST,
        'Attach at least one file to upload.',
      );
    }

    const created: BulkUploadResult['created'] = [];
    const failed: BulkUploadResult['failed'] = [];

    for (const file of files) {
      try {
        const objectPath = await this.storeFile(
          organizationId,
          file.buffer,
          file.originalname,
          file.mimetype,
        );
        const ai = await this.classifyAndMatch(
          file.buffer,
          file.originalname,
          organizationId,
        );
        const doc = await this.prisma.studentDocument.create({
          data: {
            organizationId,
            studentId: null,
            category: 'OTHER',
            title:
              file.originalname.replace(/\.[^/.]+$/, '') || file.originalname,
            fileName: file.originalname,
            fileUrl: objectPath,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            uploadedById: adminId,
            aiSuggestedCategory: ai.aiSuggestedCategory,
            aiSuggestedStudentId: ai.aiSuggestedStudentId,
            aiMatchConfidence: ai.aiMatchConfidence,
          },
        });
        created.push({
          id: doc.id,
          fileName: doc.fileName,
          aiSuggestedCategory: doc.aiSuggestedCategory,
          aiSuggestedStudentId: doc.aiSuggestedStudentId,
          aiMatchConfidence: doc.aiMatchConfidence,
          category: doc.category,
          studentId: doc.studentId,
        });
      } catch (err) {
        failed.push({
          fileName: file.originalname,
          reason: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    }

    return { created, failed };
  }

  async listBulk(organizationId: string) {
    return this.prisma.studentDocument.findMany({
      where: { organizationId, studentId: null },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  async confirmAssignment(
    documentId: string,
    organizationId: string,
    dto: { studentId: string; category: string },
  ) {
    const doc = await this.prisma.studentDocument.findFirst({
      where: { id: documentId, organizationId },
    });
    if (!doc) {
      throw new ApiError(
        ErrorCode.DOCUMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This document could not be found.',
      );
    }
    const student = await this.prisma.user.findFirst({
      where: { id: dto.studentId, role: 'STUDENT', organizationId },
      select: { id: true },
    });
    if (!student) {
      throw new ApiError(
        ErrorCode.DOCUMENT_ASSIGNMENT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This student does not belong to your school.',
      );
    }
    return this.prisma.studentDocument.update({
      where: { id: doc.id },
      data: {
        studentId: student.id,
        category: dto.category as never,
        aiSuggestedStudentId: null,
        aiMatchConfidence: null,
        aiSuggestedCategory: null,
      },
    });
  }
}

export { DOCUMENT_CATEGORIES };
