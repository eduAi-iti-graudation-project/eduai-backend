# AI Agents — complete reference

The canonical product/architecture spec is `specs.md`; the honest-but-short
agent table lives in `specs.md` §7 and `README.md` §Agent Architecture. This
document is the detailed, always-current inventory of every AI agent in the
project: what it is, what it does, how it's triggered, what tools it uses, and
where the code lives.

## Two categories, one hard rule

There are two kinds of "agent" in this codebase, and the distinction is
intentional:

| Category | What it is | Examples |
|---|---|---|
| **Mastra agents** | Real `new Agent(...)` instances executed with `agent.generate()` | Struggle Signal Extractor, Lab Architect, Lab Generator |
| **Agent-class services** | NestJS injectables that run a structured tool-calling loop (or a single structured LLM call) through `LlmService` | Assistant, Quiz Generation, Homework Helper, Grading Agent, Guardian Chat, Communication Agent |

Hard rule that applies to both: **every LLM call goes through
`common/llm/LlmService`** (PII redaction → Zod-validate-and-retry), with the
one deliberate exception of the Mastra agents that drive the ITI gateway
through a `LanguageModelV2` adapter (`struggle-signals/gateway-language-model.ts`)
so Mastra can run `generate()` with `structuredOutput`.

Deterministic non-LLM pieces (Orchestrator, Analysis trigger, Criterion
Detector, Notification Dispatcher) are **not AI** and are listed at the bottom
so nobody re-adds "autonomy" to them.

---

## 1. Communication Agent

Diagnoses a student's (or a whole class's) performance after grades are
confirmed and produces audience-aware communications, alerts, reports, and
notifications.

| | |
|---|---|
| **Module** | `src/communication-agent/` |
| **Definition** | `communication-agent.agent.ts` — `createCommunicationAgent()` (Mastra `Agent`, `id: communication-agent`, model `openai/gpt-5.5`, no tools registered) |
| **Execution** | `CommunicationAgentService.analyze(submissionId)` — the service performs the tool loop itself using `LlmService.generateStructured` + deterministic `tools/` (`createGetStudentProfileTool`, `createCreateAlertTool`). The Mastra agent wrapper exists but the running path is the service. |
| **Trigger** | Fire-and-forget after `confirmAll()` bulk-confirms a submission (and on the seed). Skips orgs not on Trial/Enterprise, skips submissions already analyzed, skips students with < 2 confirmed submissions. |
| **Decision** | **Plain code, never a prompt** — `verdict()` in `trends.ts` flags a student on: last-3 confirmed average < 60%, ≥ 3 consecutive drops, weak criterion (single criterion avg < 60% becomes a `WEAK_CRITERION` / `CONSISTENT_STRUGGLE`), or class-wide attribution (`STUDENT` / `CLASS` / `BOTH`). |
| **Outputs** | Creates `StudentAnalysis` + `Alert`; generates `Explanation` (headline/reason/highlights/strengths/concerns/recommendation), teacher + guardian content via separate LLM calls, and class-level `TeacherFeedback` + `ManagementSummary`. Notifies teacher/guardian/admin, auto-triggers `ReportsService.generate()` (three-tier report), and calls `StudyLabService.recommend()` to launch a practice set for the weak criterion. |
| **Failure safety** | `safeStructured()` wraps every LLM call with a deterministic fallback, so alerts + notifications always fire even if the LLM is down. |
| **Persistence** | `StudentAnalysis` rows carry the diagnosis + all generated content; `StudentReport` rows are created for alerts. |

---

## 2. Feedback Writer

Writes natural-language, per-criterion feedback for confirmed grades —
explaining *why* a student got that score and how to improve.

| | |
| | |
|---|---|
| **Module** | `src/feedback-writer/` |
| **Definition** | `feedback-writer.agent.ts` — `createFeedbackWriterAgent(writeFeedbackTool)` (Mastra `Agent`, `id: feedback-writer`, model `openai/gpt-5.5`, tool `write-feedback`). The running path is `FeedbackWriterService.write()` which executes `createWriteFeedbackTool` directly; the Mastra wrapper is the declared shape. |
| **Trigger** | Fire-and-forget after `confirmAll()`, plus a backfill endpoint for historically confirmed scores without feedback. |
| **Work** | For each `GradingScore`, one structured LLM call (criterion description + maxPoints + pointsAwarded + full submission content) → writes `GradingScore.aiFeedback`. Notifies the student (`FEEDBACK_READY`) when ≥ 1 criterion got feedback. |
| **Tool** | `tools/write-feedback.tool.ts` wraps `LlmService.generateStructured` with the `FeedbackSchema`. |

---

## 3. Assistant Agent (teacher chat)

The teacher-facing conversational assistant. The one genuinely multi-action
tool-using loop in the product.

| | |
|---|---|
| **Module** | `src/assistant/` |
| **Definition** | `assistant.service.ts` — `AssistantService.chat()`, a hand-rolled loop (`MAX_ITERATIONS = 5`) over `LlmService.generateStructured` with a `ToolCallSchema`. Not a Mastra agent. |
| **Actions** | `search_curriculum`, `create_quiz`, `draft_rubric`, `summarize_lesson`, `plan_lesson`, `class_analytics`, `draft_assignment`, `respond`. Each generator action is a dedicated structured call (quiz, rubric, lesson summary, lesson plan, assignment draft, class analytics). |
| **Grounding** | All generated content is grounded in the class's curriculum via pgvector search; a weak/generic query falls back to the class's raw chunks (same guard quizzes and labs use). Never answers from its own knowledge. |
| **Class analytics** | `class_analytics` computes real numbers from **confirmed** grades only (per-student last-3 avg, consecutive drops, flagged list) and turns them into a summary — the numbers are code, the prose is LLM. |
| **Persistence** | Chat history survives refresh via `ai-chat/` (`AiChatConversation` / `AiChatMessage`), ChatGPT-style threads with auto-titles. Chat-generated quizzes are persisted as draft quizzes via the shared `save-quiz.tool`. |
| **Endpoint** | `POST /assistant/chat` (+ conversation list/get/delete). |

---

## 4. Quiz Generation Agent

Generates a balanced, curriculum-grounded quiz and assigns it to sections
(optionally targeting specific students).

| | |
|---|---|
| **Module** | `src/quizzes/agents/` |
| **Definition** | `quiz-generation.agent.ts` — `QuizGenerationAgent.generate()`, a hand-rolled loop (`MAX_ITERATIONS = 5`) over `LlmService.generateStructured` with a `QuizGenerationToolSchema`. Not a Mastra agent. |
| **Tools** | `search_curriculum` (scoped to the selected unit/chapter), `generate_questions` (LLM via `tools/generate-questions.tool.ts`), `review_questions` (coverage-gap check via `tools/review-questions.tool.ts`), `save_quiz` (persists via `tools/save-quiz.tool.ts`). |
| **Rules** | Always searches first; questions come only from search results (never own knowledge); a unit with no material is a clear "can't generate" reply; gap-filling regenerates with `avoidTopics`. |
| **Difficulty** | EASY/MEDIUM/HARD (default MEDIUM) calibrates question depth. |
| **Reuse** | The same quiz can be assigned to many sections and reused across courses/grades; optional `endsAt` close deadline. Also reused by `generateForConcept()` from struggle-signals. |

---

## 5. Homework Helper Agent (student)

Student-facing homework help that gives hints/explanations — never the answer.

| | |
|---|---|
| **Module** | `src/homework-helper/` |
| **Definition** | `homework-helper.agent.ts` — `HomeworkHelperAgent.help()`, a hand-rolled loop (`MAX_ITERATIONS = 5`) over `LlmService.generateStructured` with a `HomeworkToolSchema`. Not a Mastra agent. |
| **Tools** | `search_curriculum` (`tools/search-curriculum.tool.ts`), `lookup_assignment` (resolves assignment + rubric criteria, `tools/lookup-assignment.tool.ts`), `search_web` (Tavily, `tools/search-web.tool.ts` — general reference only), `log_interaction` (persists `HomeworkHelpInteraction` so the teacher sees who's struggling). |
| **Response modes** | `HINT` / `EXPLANATION` / `REDIRECT_TEACHER` (grade disputes, personal feedback, sensitive topics, or the student's own work). |
| **Grounding** | Answers come from curriculum search results; falls back to web only for general-knowledge/factual questions, never for graded assignments; never answers from its own knowledge. |
| **Endpoint** | `POST /assistant/homework-help` (+ interaction history). Also invoked by struggle-signals to produce the grounded re-explanation. |

---

## 6. Grading Agent

Grades a submission against the confirmed rubric criteria with a single
structured LLM call — no tool use, deliberately.

| | |
|---|---|
| **Module** | `src/grading/` |
| **Definition** | `grading.agent.ts` — `GradingAgent.grade(submissionId)` → `LlmService.generateStructured` with `GradingOutputSchema`. Not a Mastra agent. |
| **Retrieval** | Plain code (`collectCriteria`, `selectSubmissionChunks`) feeds the LLM: confirmed rubric criteria + the submission chunks most relevant to the criteria (keyword-scored chunk selection, ≤ 12k chars). |
| **Constraints** | Scores every criterion exactly once, using real `RubricCriterion.id`s the retrieval actually returned; points clamped to `[0, maxPoints]`; missing criteria default to 0 with an explicit note. |
| **Trigger** | Fire-and-forget from `SubmissionsService.create()` — student gets an instant response, grading runs in the background, teacher is notified on completion. |
| **Visibility** | A grade is real only after teacher confirmation (`isConfirmed = true`); students never see AI suggestions. |

---

## 7. Guardian Chat Agent

A guardian-facing copilot that answers questions about a child's school data.

| | |
|---|---|
| **Module** | `src/guardian-chat/` |
| **Definition** | `guardian-chat.agent.ts` — `GuardianChatAgent.respond()` → `LlmService.generateStructured` with `GuardianReplySchema`. Not a Mastra agent. |
| **Grounding** | Answered strictly from the ward data provided in the conversation (grades, attendance, quizzes, fees, open alerts). Never invents numbers; says plainly when data isn't visible; never reveals another student's info. |
| **Sources** | Each reply lists the ward-data sections it actually used. |
| **Persistence** | Conversations live in `ai-chat/` (kind `GUARDIAN`), with a graceful fallback reply if generation fails. |
| **Endpoint** | `POST /guardian-chat` (+ conversation list/get/delete). |

---

## 8. Struggle Signal Extractor (Mastra)

Reads recorded class-meeting transcripts and extracts per-student "confusion
signals" — concepts a student seemed unsure about during the lesson.

| | |
|---|---|
| **Module** | `src/struggle-signals/` |
| **Definition** | `struggle-signals.agent.ts` — `createStruggleSignalExtractor(chat)`, a **real executed Mastra agent** (`id: struggle-signal-extractor`, no tools, model = in-house `LanguageModelV2` adapter over `ProviderService.chat`). |
| **Trigger** | After a recorded CLASS meeting's per-participant transcripts drain (LiveKit webhooks), or teacher-gated `POST .../trigger`. Idempotent via `struggleSignalsProcessed`. |
| **PII** | Student identity is replaced with per-meeting placeholders (`Student_A`, ...) before anything reaches the model; real identity is re-attached only after the call, in the service. |
| **Structured output** | `SignalExtractionOutputSchema` — `{ signals: [{ concept, explanation }] }`, empty list is valid; bounded retry (3 attempts) on malformed output. |
| **Post-processing** | Deterministic class-wide roll-up (`similarConcepts` Jaccard ≥ 0.6; 3+ students ⇒ `classWide`). |
| **Dispatch** | Auto-dispatch (no teacher approval): for every signal, generate a scoped quiz for that student (via Quiz Engine `generateForConcept`) + a grounded re-explanation (via Homework Helper). Failures mark the signal `FAILED`; teacher can retry/dismiss. |
| **Status lifecycle** | `PENDING` → `SENT` (quiz + re-explanation) | `DISMISSED` | `FAILED`. |

---

## 9. Lab Architect (Mastra)

Designs "template" science lab games — picks a fixed, pre-tested game template
and fills it with curriculum-grounded content. No AI code is produced.

| | |
|---|---|
| **Module** | `src/labs/agents/` |
| **Definition** | `lab-architect.agent.ts` — `createLabArchitect(chat)`, a **real executed Mastra agent** (`id: lab-architect`, no tools, gateway `LanguageModelV2` adapter). |
| **Templates** | `drag-to-regions`, `sort-categories`, `match-pairs`, `flashcards` — chosen via `LabGameSpecSchema` (discriminated union). The frontend renders the chosen template with hand-written React, so interaction + win condition are guaranteed. |
| **Grounding** | Content filled strictly from the selected unit's curriculum chunks (top-k semantic search, unit-chunk fallback); never invents facts. |
| **Refine/regenerate** | In-place spec modification (never from scratch) on teacher refine; full regenerate for a fresh spec. Bounded retry on schema validation only (provider failures are not retried). |

---

## 10. Lab Generator (Mastra)

Writes free-form, self-contained interactive HTML5 game/simulation code for
the opt-in "advanced" lab mode.

| | |
|---|---|
| **Module** | `src/labs/agents/` |
| **Definition** | `lab-generator.agent.ts` — `createLabGenerator(chat)`, a **real executed Mastra agent** (`id: lab-generator`, no tools, gateway `LanguageModelV2` adapter). |
| **Output** | `LabGeneratorOutputSchema` — a single self-contained JS `code` string that runs in a sandboxed iframe. |
| **Sandbox contract** | No imports/CDN/network, no `eval`/`Function`, no parent/storage access, no busy loops; must render into `#sim`, expose interactive controls (drag/click via Pointer Events or Matter.js), and call `reportLabObjectiveComplete()` exactly once when a real win condition is met. |
| **Safety** | Deterministic plain-code guards (`guardGeneratedCode` — empty output, missing `#sim` render target) replace any LLM reviewer; the sandbox CSP + teacher manual review handle the rest. |
| **Refine/regenerate** | In-place code modification preserving existing interaction; regenerate from scratch; single pass with guards. |
| **Lifecycle** | `GENERATING` → `PENDING_TEACHER_REVIEW` (or `AI_REVIEW_FAILED` on guard failure / pipeline failure) → teacher `PUBLISH` / `REJECT`. Students only ever see PUBLISHED labs. |

---

## 11. Study Lab generators

Not agents per se, but the same family: grounded, structured LLM generators
for student study materials. Handled by `StudyLabGenerators` in
`src/study-lab/study-lab.generators.ts` (all via `LlmService.generateStructured`).

| Generator | Output | Notes |
|---|---|---|
| `podcastScript` | 2-host episode script (HOST/GUEST, 4–20 segments) → optional TTS audio via Kokoro/`STUDY_AUDIO_MODEL` | Presets: OVERVIEW, DEEP_DIVE, EXAM_CRAM, CASUAL, BREAKDOWN |
| `deck` | 8–14-slide deck JSON → `.pptx` built with PptxGenJS | Strict theme (background/accent/motion), rich blocks, optional visuals (chart/flow/timeline/comparison/concept_map) grounded in chunks |
| `studyGuide` | 3–10 prose sections + summary | Grounded only |
| `flashcards` | 5–30 spaced-repetition cards | Grounded only |
| `practiceSet` | 4–10 MCQ with explanations | Grounded when possible, general-knowledge fallback otherwise |
| `cheatSheet` | 3–12 telegraphic sections | Grounded only |

Background pipeline (`StudyLabService`): `QUEUED → GROUNDING → GENERATING →
BUILDING → READY` (or `FAILED`); rate-limited (10/hour); also drives
`recommend()` practice sets triggered by the Communication Agent. Quiz-in-progress
blocked while generating.

---

## 12. Non-AI pieces that people call "agents"

These exist so nobody is tempted to make them LLM-driven. They are plain,
testable code.

| Piece | File | What it is |
|---|---|---|
| Orchestrator | submissions state machine (`src/submissions/`) | Deterministic status transitions `SUBMITTED → GRADING_IN_PROGRESS → REVIEW_READY → CONFIRMED` — never an AI decision |
| Analysis trigger | `verdict()` in `src/communication-agent/trends.ts` | Plain threshold logic decides who's flagged; LLM only writes the explanation |
| Criterion Detector | `weakCriterion()` / `criterionStatsFromSeries()` in `trends.ts` | Plain code identifies weak criteria from confirmed-score series; LLM only explains |
| Notification Dispatcher | `src/notifications/` | Plain code calls `NotificationService` after reports/events |
| Class-wide roll-up | `similarConcepts()` in `src/struggle-signals/` | Deterministic Jaccard clustering of signals |

---

## Shared infrastructure

| Piece | File | Purpose |
|---|---|---|
| `LlmService` | `src/common/llm/llm.service.ts` | The single entry point for every LLM call — PII redaction (`common/pii/`), Zod-validate-and-retry (`common/validation/`), `generateStructured` for all structured outputs |
| `ProviderService` | `src/common/ai/provider.service.ts` | Wraps the ITI API gateway (chat + embeddings) |
| Gateway `LanguageModelV2` adapter | `src/struggle-signals/gateway-language-model.ts` | Lets Mastra agents drive the non-OpenAI-compatible ITI gateway via `agent.generate(..., { structuredOutput })`; reports `supportsStructuredOutputs: false` so the runtime injects JSON-shape instructions and validates the text response |
| `AiChatService` | `src/ai-chat/` | Shared ChatGPT-style conversation persistence for Assistant + Guardian chat (kinds `ASSISTANT`, `GUARDIAN`) |
| `MaterialsService` | `src/materials/` | pgvector curriculum search (`searchChunks`, `getChunksByOffering`, `getChunksByChapter`) used by Assistant, Quiz Gen, Homework Helper, Labs, Study Lab |

---

## Cross-agent workflows

- **Auto-grade**: submit → Grading Agent (background) → teacher review → `confirmAll()` → Feedback Writer + Communication Agent fire-and-forget.
- **Communication → practice**: Communication Agent flags a student → `StudyLabService.recommend()` launches a practice set → student notified.
- **Meeting → follow-up**: LiveKit transcripts drain → Struggle Signal Extractor → auto-dispatch → Quiz Engine (`generateForConcept`) + Homework Helper re-explanation, scoped to that student.