## Summary

Scaffolds the full EduAI backend — all feature modules, Prisma schema with pgvector, common infrastructure, and Swagger documentation. This is the foundational layer that every agent (Grading, Analysis, Assistant) builds on.

## Changes

### Dependencies
- `@nestjs/swagger` — OpenAPI generation
- `@prisma/adapter-pg` + `@prisma/client` — Prisma with pg adapter
- `@supabase/supabase-js` — Supabase client
- `nestjs-zod` + `zod` — DTO validation with auto-generated OpenAPI types
- `pg` + `@types/pg` — PostgreSQL driver types

### Database (Prisma)
- Initial school & RAG schema: `User`, `Class`, `Enrollment`, `Material` + `MaterialChunk` (with `vector(1536)` embedding), `Assignment`, `Rubric` + `RubricCriteria`, `Submission` + `SubmissionChunk` (with embedding), `GradingScore`
- `Alert` model + migration
- `MaterialChunk.embedding` and `SubmissionChunk.embedding` made optional (nullable until embeddings are generated)
- pgvector extension enabled

### API Modules
| Module | Endpoints | Purpose |
|---|---|---|
| `auth/` | `POST /auth/signup`, `POST /auth/login`, `GET /auth/me` | User registration and session |
| `classes/` | CRUD + `POST /classes/:id/enrollments`, `DELETE /classes/:classId/enrollments/:studentId` | Class and enrollment management |
| `assignments/` | CRUD | Assignment lifecycle |
| `rubrics/` | `POST /rubrics`, `GET /rubrics`, `GET /rubrics/:id`, `PATCH /rubrics/:id/confirm`, `POST /rubrics/import-pdf` | Rubric builder with PDF import scaffold |
| `submissions/` | `POST /submissions`, `GET /submissions`, `GET /submissions/:id` | Student submissions |
| `grading/` | `PATCH /grades/:id/confirm` | Teacher grade confirmation |
| `alerts/` | `GET /alerts` | Alert listing |
| `assistant/` | `POST /assistant/chat` | AI assistant scaffold |
| `students/` | `GET /students/:id/grades` | Student grade portal |

### Common Infrastructure
- `common/llm/` — `LlmModule` (OpenAI SDK wrapper scaffold)
- `common/pii/` — `PiiModule` (PII redaction scaffold)
- `common/validation/` — `ValidationModule` (Zod retry scaffold)
- `prisma/` — `PrismaModule` (global) + `PrismaService` with `PrismaPg` adapter

### App Wiring
- All modules registered in `AppModule`
- Swagger configured with Bearer auth, served at `/api`
- `nestjs-zod`'s `cleanupOpenApiDoc` applied for clean OpenAPI output

### Documentation
- `specs.md` — product spec, architecture, non-negotiable rules
- `backend-specs.md` — repo-local conventions, folder structure, dev setup
- `AGENTS.md` — canonical cross-tool instructions

## Testing

N/A — scaffold phase, no business logic beyond thin CRUD wrappers. Tests are added per-issue as the pipeline modules land.

## Related issues

- #47 (CI pipeline) — prerequisite

## Checklist

- [x] Compiles (`npm run build`)
- [x] TypeScript passes (`npx tsc --noEmit`)
- [x] Lint passes (`npm run lint`)
