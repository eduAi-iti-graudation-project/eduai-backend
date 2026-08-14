# AI Request Optimization Plan — EduAI

**Goal:** Reduce redundant LLM/embedding HTTP requests. All wins are in the backend; the frontend was scanned and is clean (react-query single queries, no N+1).

## 1. Embedding batching (materials + rubrics) — N→1

- **`common/ai/provider.service.ts`**: add `hfEmbedMany(inputs: string[]): Promise<number[][]>` — same `/pipeline/feature-extraction` endpoint, body `{ inputs: string[] }`; HF returns array-of-arrays.
- **`common/llm/llm.service.ts`**: add `embedMany(texts: string[]): Promise<number[][]>` with a **fallback to sequential `embed()`** if the array call fails or returns an unexpected shape.
- **`materials/materials.service.ts:186-199`**: replace the per-chunk `await this.llm.embed(chunk.content)` loop with one `embedMany(material.chunks.map(c => c.content))`; update each row from the returned vectors. On batch failure, mark all chunk ids in `embedErrors` (keeps upload resilient).
- **`rubrics/rubrics.service.ts:138-153`**: same replacement for `updated.criteria` descriptions.
- Single-query embeds (`materials.service.ts:504,542`) stay as-is.

## 2. Feedback writer — N→1

- **`feedback-writer/tools/feedback-generator.ts`**: add `generateFeedbackBatch(llmService, inputs: WriteFeedbackInput[]): Promise<{ feedback: string }[]>` — one prompt listing all criteria (shared `submissionContent`), schema `{ feedbacks: [{ feedback: string }] }` indexed 1:1.
- **`feedback-writer/feedback-writer.service.ts:45-65`**: call the batch once; if returned count ≠ criteria count, **fall back to per-criterion** `generateFeedback`.
- Keep `generateFeedback` + `write-feedback.tool.ts` unchanged (a Mastra agent registers that tool).

## 3. Quiz essay grading — N→1

- **`quizzes/quizzes-grading.service.ts`**: add `gradeEssays(items: { question; answer; maxPoints }[]): Promise<EssayGrade[]>` — one `generateStructured` call with schema `{ grades: [{ pointsAwarded, feedback }] }`.
- **`quizzes/quizzes.service.ts:399-419`**: replace the per-answer `gradeEssay` loop with one `gradeEssays` call (MCQ/TF remain local). Fall back to per-item `gradeEssay` if counts mismatch.
- Keep single `gradeEssay` (no other callers, but harmless).

## 4. Document bulk upload — 2N→N + parallel

- **`documents/documents.service.ts`**: add a merged single-call classifier `classifyDocumentText(rawText): Promise<{ category: string | null; studentName: string | null }>` (one `generateStructured`, one prompt, both fields).
- Use it in `classifyAndMatch` (`:220-221`). Keep `suggestCategory`/`extractPrintedName` — `students/students.service.ts:729` still uses `suggestCategory`.
- Parallelize the bulk loop (`:249-294`) with `Promise.allSettled`, optional concurrency cap (e.g. 3-4 files at a time) to bound memory/rate spikes.

## Out of scope (by design)
- Agentic loops: `quizzes/agents/quiz-generation.agent.ts`, `assistant/assistant.service.ts`, `labs` generator/reviewer (retry wrapper), `struggle-signals`, `communication-agent` — sequential calls feed the next; batching breaks semantics.
- `generateStructured` schema-failure retries (`validateWithRetry`, 5 attempts) — intentional retry, not redundancy.

## Verification
- Backend: `npx prettier --write <files>` + `npx eslint <files>` + `npm run typecheck`; run existing jest specs (materials, rubrics, feedback-writer, quizzes, documents) and update any asserting call counts.
- Smoke tests: material upload (embeddings present), rubric confirm, feedback write, quiz with essays, document bulk upload.
- Watch for: HF array-input support (fallback covers), batch count mismatch (fallback covers).