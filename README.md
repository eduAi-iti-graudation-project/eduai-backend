<div align="center">

<img src="https://img.shields.io/badge/EduAI-Backend-23305A?style=for-the-badge&logoColor=white" height="36"/>

# eduai-backend

### NestJS API server for the EduAI platform

[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?style=flat-square&logo=nestjs)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-5.x-2D3748?style=flat-square&logo=prisma)](https://prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)](https://www.postgresql.org)
[![pgvector](https://img.shields.io/badge/pgvector-latest-6366F1?style=flat-square)](https://github.com/pgvector/pgvector)

[Getting Started](#-getting-started) · [Project Structure](#-project-structure) · [API Modules](#-api-modules--endpoints) · [Tech Stack](#-tech-stack) · [Agent Architecture](#-agent-architecture) · [Scripts](#-scripts) · [Contributing](#-contributing)

</div>

---

## 📋 Overview

This repository contains the backend API for **EduAI** — an AI-assisted grading and classroom management platform. It owns all business logic, all database access, and all AI/LLM calls; the frontend never talks to the database, Supabase, or any LLM API directly.

- **Teachers** — build rubrics, review AI-suggested grades, confirm them, get early alerts on struggling students
- **Students** — submit assignments, view confirmed grades and feedback

A grade is never visible to a student, and never eligible for the alerts pipeline, until a teacher has confirmed it. See [`specs.md`](specs.md) §4 for the full list of non-negotiable rules.

---

## ⚡ Getting Started

### Prerequisites

| Tool | Version | Download |
|---|---|---|
| Node.js | v20 LTS | [nodejs.org](https://nodejs.org) |
| npm | v10+ | ships with Node |
| Docker | latest | [docker.com](https://docker.com) |
| Git | latest | [git-scm.com](https://git-scm.com) |

---

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/your-org/eduai-backend.git
cd eduai-backend
```

**2. Install dependencies**

```bash
npm install
```

**3. Start the local database**

```bash
docker compose up -d
```

This runs Postgres with the `pgvector` extension available (image: `pgvector/pgvector:pg16`). It's the **only** thing Docker is used for in this project — there's no containerized deploy. `docker compose up -d` also starts the self-hosted **Kokoro TTS** container (`eduai_kokoro_tts`, port 8880) used by Study Lab podcast audio — first start downloads the ~1.6 GB image once, after which generation is free and offline.

**4. Set up environment variables**

```bash
cp .env.example .env
```

```bash
DATABASE_URL=postgresql://postgres:development_password@localhost:5432/eduai_db
SUPABASE_URL=your-supabase-project-url
SUPABASE_SERVICE_KEY=your-supabase-service-key
OPENAI_API_KEY=your-openai-key
```

**5. Run migrations**

```bash
npx prisma migrate dev
```

> ⚠️ The pgvector extension is named `vector` in Postgres, not `pgvector`. The
> schema must declare `extensions = [vector]` — declaring `extensions = [pgvector]`
> fails with a confusing "extension not available" error. See
> [Database & Migrations](#-database--migrations) below.

**6. Start the dev server**

```bash
npm run start:dev
```

API available at **http://localhost:3000**, Swagger docs at **http://localhost:3000/api**, raw OpenAPI JSON at **http://localhost:3000/api-json** (this is what the frontend syncs its types from).

---

## 🗂️ Entity Relationship Diagram

<!-- TODO: replace with the exported ERD image, e.g. docs/erd.png -->
![EduAI ERD](./docs/erd.png)

> Placeholder — export the current diagram (e.g. from dbdiagram.io, or
> generated straight from `schema.prisma`) and drop it at `docs/erd.png`.
> Regenerate it whenever models are renamed or added — it should reflect
> `schema.prisma` exactly, not an earlier draft.

---

## 📁 Project Structure

```
eduai-backend/
│
├── src/
│   ├── auth/              # Supabase auth guard, role decorator, session handling
│   ├── classes/           # Class, Enrollment
│   ├── rubrics/           # Rubric, RubricCriteria, Prompt Factory (PDF import)
│   ├── assignments/
│   ├── submissions/       # Submission, SubmissionChunk, status state machine
│   ├── grading/           # Grading Agent — retrieval + LLM call + citation
│   ├── analysis/          # Analysis Agent — threshold rule + explanation LLM call
│   ├── assistant/         # Assistant Agent — tool-calling loop
│   ├── ai-chat/           # Shared ChatGPT-style conversation persistence
│   ├── quizzes/           # Quiz Engine — generation agent, CRUD, anti-cheat, grading
│   ├── feedback-writer/   # Feedback Writer — per-criterion feedback
│   ├── homework-helper/   # Homework Helper — student tool-loop, never the answer
│   ├── communication-agent/ # Communication Agent — post-confirm diagnosis + alerts
│   ├── guardian-chat/     # Guardian copilot — ward-data Q&A
│   ├── struggle-signals/  # Meeting-transcript struggle signals (Mastra extractor)
│   ├── labs/              # Lab Architect + Lab Generator (Mastra, template + code)
│   ├── study-lab/         # Study Lab — grounded generators (podcast, slides, notes)
│   ├── mastra/            # Global Mastra instance
│   ├── alerts/
│   ├── materials/         # ClassMaterial, MaterialChunk, curriculum chunking
│   │
│   ├── common/
│   │   ├── llm/           # LlmService — every LLM call goes through this, no exceptions
│   │   ├── pii/           # Redaction middleware
│   │   └── validation/    # Shared Zod schemas + retry-once wrapper
│   │
│   ├── prisma/            # PrismaService (injectable wrapper), migrations/
│   │
│   ├── app.module.ts
│   └── main.ts             # Swagger/OpenAPI setup lives here
│
├── docs/
│   ├── erd.png             # See Entity Relationship Diagram above
│   └── agents.md           # Complete AI agent inventory (see Agent Architecture)
│
├── .claude/skills/
│   ├── nestjs-conventions/
│   ├── prisma-pgvector-rag/
│   └── llm-structured-output/
│
├── AGENTS.md                # Canonical agent instructions (cross-tool)
├── CLAUDE.md                # Imports AGENTS.md for Claude Code
├── specs.md                 # Full product/architecture spec
├── backend-specs.md         # This repo's conventions
├── docker-compose.yml       # Local Postgres+pgvector only — not used for deploy
├── .env.example
├── .eslintrc.json
├── .prettierrc
└── tsconfig.json
```

---

## 🔌 API Modules & Endpoints

Full, always-current contract is served live at `/api` (Swagger UI) and
`/api-json` (raw OpenAPI document) — the frontend generates its types from
the latter, so this table is a map of what exists, not the source of truth.

| Module | Example Endpoints |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` |
| Classes | `GET /classes`, `POST /classes`, `GET /classes/:id/students` |
| Rubrics | `POST /rubrics`, `POST /rubrics/import-pdf`, `PATCH /rubrics/:id/confirm` |
| Assignments | `GET /assignments/:id`, `POST /classes/:classId/assignments` |
| Submissions | `POST /submissions`, `GET /assignments/:id/submissions?status=pending` |
| Grading | `POST /submissions/:id/grade`, `PATCH /grades/:id/confirm` |
| Alerts | `GET /classes/:id/alerts` |
| Assistant | `POST /assistant/chat` |
| Materials | `POST /classes/:id/materials` |

---

## 🛠️ Tech Stack

### Core

| Library | Version | Purpose |
|---|---|---|
| NestJS | 10 | API framework — modular, opinionated, DI throughout |
| TypeScript | 5.x | Type safety |
| Prisma | 5.x | ORM, migrations, typed database client |

### Database

| Library | Version | Purpose |
|---|---|---|
| PostgreSQL | 16 | Primary datastore |
| pgvector | latest | Vector similarity search — rubric criteria, submission chunks, curriculum chunks |
| Supabase | — | Hosts Postgres, Auth, and file storage |

### Validation & AI

| Library | Version | Purpose |
|---|---|---|
| Zod | v3 | Schema validation for every DTO and every LLM response |
| nestjs-zod | latest | Bridges Zod schemas into NestJS DTOs and Swagger/OpenAPI |
| openai | latest | LLM + embeddings API client, wrapped by `common/llm/LlmService` |

### API Docs

| Library | Version | Purpose |
|---|---|---|
| @nestjs/swagger | latest | Generates the OpenAPI document the frontend syncs its types from |

### Testing

| Library | Version | Purpose |
|---|---|---|
| Jest | latest | Unit tests — focused on deterministic logic (PII redaction, validation/retry, alert threshold, state machine), not on grading AI creativity |
| Supertest | latest | HTTP-level endpoint tests |

---

## 🤖 Agent Architecture

The honest version — see `specs.md` §7 for the full rationale and
[`docs/agents.md`](docs/agents.md) for the complete, always-current inventory.

| Piece | What it actually is |
|---|---|
| Grading Agent | One LLM call, retrieval feeds it, no tool use |
| Analysis Agent | Plain code decides the flag; LLM only writes the explanation |
| Assistant Agent | Real tool-calling loop (`search_curriculum`, `create_quiz`, `draft_rubric`, `summarize_lesson`, `plan_lesson`, `class_analytics`, `draft_assignment`), max 5 iterations |
| Feedback Writer | One LLM call per criterion (write-feedback tool); saves to `GradingScore.aiFeedback`; fires after `confirmAll` + backfill endpoint |
| Homework Helper | Multi-tool agent (`search_curriculum`, `lookup_assignment`, `search_web`, `log_interaction`); student-facing, never gives away the answer |
| Communication Agent | Plain-code verdict + LLM explanations after `confirmAll`; creates alerts, notifies teacher/guardian/admin, auto-triggers reports + Study Lab practice |
| Quiz Generation | Tool loop (`search_curriculum`, `generate_questions`, `review_questions`, `save_quiz`) |
| Guardian Chat | Guardian copilot grounded in ward data (grades/attendance/quizzes/fees/alerts) |
| Struggle Signal Extractor | Real executed Mastra agent over meeting transcripts; auto-dispatches quiz + re-explanation (PII-tokenized) |
| Lab Architect / Lab Generator | Real executed Mastra agents — template game specs and sandbox-safe game code, grounded in curriculum |
| Study Lab generators | Grounded structured LLM generators: podcast, slides (pptx), study guide, flashcards, practice set, cheat sheet |
| Orchestrator | Not an LLM at all — deterministic status-transition logic |
| Criterion Detector / Notification Dispatcher | Plain code, never AI — same rule as Analysis |

RAG has two independent retrieval paths: rubric criteria retrieval (grading) and curriculum chunk retrieval (the Assistant). Both use pgvector cosine similarity. Full design in `specs.md` §6.

---

## 🗄️ Database & Migrations

- Embeddings: **HuggingFace, 1024 dimensions** (default model `mixedbread-ai/mxbai-embed-large-v1`, override with `HF_EMBED_MODEL`) — served through `common/ai/ProviderService`. Locked decision, changing providers means a schema migration, not a config change.
- Vector columns are `Unsupported("vector(1024)")` — Prisma creates the column but **not** a similarity index. Add the HNSW index as a raw SQL migration:
  ```sql
  CREATE INDEX ON "RubricCriteria" USING hnsw (embedding vector_cosine_ops);
  CREATE INDEX ON "SubmissionChunk" USING hnsw (embedding vector_cosine_ops);
  CREATE INDEX ON "MaterialChunk" USING hnsw (embedding vector_cosine_ops);
  ```
- `extensions = [vector]` in `schema.prisma`, not `[pgvector]` — see the warning in Getting Started.
- Locally the extension installs into the `public` schema; Supabase installs it into an `extensions` schema by default — confirm which form (`[vector]` vs `[pgvector(map: "vector", schema: "extensions")]`) your deployed `DATABASE_URL` needs before assuming local and deployed behavior match.

---

## 📜 Scripts

```bash
# Start dev server with hot reload
npm run start:dev

# Run database migrations
npx prisma migrate dev

# Open Prisma Studio (visual DB browser)
npx prisma studio

# Type-check without building
npm run type-check

# Lint / lint and fix
npm run lint
npm run lint:fix

# Run tests
npm run test

# Production build
npm run build
```

---

## 📐 Code Conventions

Full detail lives in [`backend-specs.md`](backend-specs.md) and the
`.claude/skills/nestjs-conventions/` skill. Summary:

- **Controllers stay thin** — validate via DTO, call one service method, return. No business logic, no Prisma calls in a controller.
- **Dependency injection, always** — never `new SomeService()`.
- **One `PrismaService`**, injected everywhere — never a second Prisma client instance.
- **Vector queries isolated** in a single named method per concern (e.g. `RubricsService.findSimilarCriteria`) — never inlined or duplicated.
- **Guards for auth**, not inline role checks scattered through services.
- **Every LLM call goes through `common/llm/LlmService`** — this is what makes PII redaction and the Zod-validate-and-retry pattern consistent instead of reimplemented per agent.

---

## 🤝 Contributing

Feature branches target **`dev`**, not `main`. Both branches are protected (PR + 1 review + passing CI required, no force-push).

### Branch Naming

```
feature/[feature-name]     → new endpoint or feature
fix/[bug-description]      → bug fixes
chore/[task-description]   → config, deps, tooling
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat(grading): add rubric citation validation to Grading Agent response
fix(migrations): correct pgvector extension name in schema.prisma
chore(deps): bump nestjs-zod for OpenAPI generation support
```

### Pull Request Checklist

Before opening a PR into `dev`, confirm:

- [ ] `npm run type-check` passes with no errors
- [ ] `npm run lint` passes with no warnings
- [ ] `npm run test` passes — and a test was added if the change touches PII redaction, LLM response validation, the alert threshold rule, or the submission state machine
- [ ] New/changed endpoints have `@ApiOkResponse`/`@ApiBody` so they appear correctly in `/api-json`
- [ ] New embedding columns have a follow-up raw SQL migration for the HNSW index
- [ ] Migrations run cleanly on a fresh `docker compose down -v && docker compose up -d`

---

## 👥 Team

| Name | GitHub |
|---|---|
| Abdallah Ehab Wageeh | [@Abdallah-Ehab](https://github.com/Abdallah-Ehab) |
| Eyad Emad Hamdy Sharara | [@eyademad1](https://github.com/eyademad1) |
| Alaa Anwar Abo Elazm | [@Alaa-Anwer](https://github.com/Alaa-Anwer) |
| Ahmed Sameh Mohamed | [@REPLACE_ME](https://github.com) |
| Ahmed Adel Selim | [@AhmedAdelSelim01](https://github.com/AhmedAdelSelim01) |

---

## 🔗 Related Repositories

| Repository | Description |
|---|---|
| [`eduai-frontend`](https://github.com/your-org/eduai-frontend) | React + Vite client application |

---

<div align="center">

Part of the **EduAI** platform · Built with ❤️

</div>