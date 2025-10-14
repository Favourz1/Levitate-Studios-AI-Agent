# AI Agent Implementation Plan (Node.js + TypeScript, PostgreSQL, BullMQ, Vercel AI SDK, Brevo, Google Docs/Drive, Asana)

Below is a **single-source blueprint** for engineering, QA, and PM to implement and operate your agent end-to-end. It’s organized by principles → architecture → data model → workflows (Steps 1–9) → async jobs → LLM design → integrations (Google, Brevo, Asana) → admin UI → observability → security → testing → rollout & ops. I’ve leaned heavily into backend detail (state, idempotency, retries, failure modes) as requested.

Where the plan relies on provider behaviors or best-practice patterns, I cite authoritative docs inline.

---

## 1) Guiding principles (from Anthropic & practical agent ops)

- **Keep the agent simple and tool-centric.** Explicit tools with clear contracts; avoid giant, monolithic prompts. Let the agent call narrow tools (doc render, email parse, Asana ops) and iterate in short loops. ([Anthropic][1])
- **Make planning/evaluation explicit.** Use a _planning pass → execution → self-check_ loop for long tasks; log reasoning artifacts in your DB for auditability and failure triage. ([Anthropic][1])
- **Prefer structured outputs.** Constrain LLM outputs to JSON schemas for classification & extraction (email intent, doc outline, task guides) using Vercel AI SDK’s `generateObject` and tool-calling. ([ai-sdk.dev][2])

---

## 2) High-level system architecture

**Services (same repo, modular monolith)**

- **API Gateway** (HTTP REST): Public endpoints (webhooks, action links), Admin UI backend.
- **Agent Orchestrator**: Starts/monitors long-running jobs (BullMQ), breaks problems into tool calls, coordinates state transitions.
- **Integrations**:

  - **Google** (Forms Apps Script endpoint, Docs/Drive for content & revisions).
  - **Brevo** (transactional send, inbound-parse webhook). ([developers.brevo.com][3])
  - **Asana** (projects/sections/tasks, stories/comments, webhooks). ([developers.asana.com][4])

- **LLM Gateway**: Vercel AI SDK configured for suitable LLM models; wrapper exposes “tools” and schema-validated outputs. ([ai-sdk.dev][5])
- **Workers**: BullMQ consumers for document generation, Asana sync, email intent classification, etc. (sandboxed processors for stability). ([docs.bullmq.io][6])
- **PostgreSQL** (Railway): Source of truth for clients, projects, documents, threads, jobs, webhooks, logs.
- **Redis**: BullMQ queues, job schedulers, dedupe keys, distributed locks. ([docs.bullmq.io][7])
- **File layer**: Google Drive is canonical for shareable docs; DB keeps normalized text snapshots for cheap/fast LLM context (details in §7).

**Cross-cutting patterns**

- **State machines** for project phase & document status (strong invariants, idempotent transitions).
- **Transactional outbox** for external side effects (emails, Asana, Drive), processed by workers.
- **Idempotency keys** on webhook deliveries, action links, and job enqueues.
- **Backoff + retry** (429/5xx) honoring provider `Retry-After` (Asana) and reasonable exponential backoff for LLM & email APIs. ([developers.asana.com][8])

---

## 3) Data model (PostgreSQL)

Key tables (selected columns only; use auto incrementing PKs unless noted)
For enums listed here don't add in db level, let it be in backend level and validated before inserting in db
:

- **clients**: id, name, primary_email, status, created_at
- **projects**: id, client_id, name, phase(enum: QUESTIONNAIRE, BRAND_ORIGIN, BUDGET_TIMELINE, FINALIZED, REJECTED), asana_project_gid (nullable until Step 7), created_at, updated_at
- **project_phase_log**: id, project_id, from_phase, to_phase, reason, actor(enum: SYSTEM|USER|LLM), at
- **questionnaire_responses**: id, project_id, form_id, response_id, responses(JSONB), respondent_email, submitted_at, processed_at, processing_status(enum: PENDING|PROCESSED|FAILED), error_message(TEXT), retry_count, created_at, updated_at
- **documents**: id, project_id, type(enum: BRAND_ORIGIN|BUDGET_TIMELINE|BUDGET_TIMELINE_VARIANT), status(enum: DRAFT|PM_REVIEW|SENT_TO_CLIENT|CLIENT_FEEDBACK|ACCEPTED|REJECTED), drive_file_id, current_revision_id (FK to document_revisions), last_sent_revision_id (FK to document_revisions), is_variant(bool), variant_index(int|null), created_at, updated_at
- **document_revisions**: id, document_id, drive_revision_id(nullable), snapshot_text(TEXT, gzip/base64), snapshot_md(JSONB optional), created_by(enum: AGENT|PM|FINANCE|CLIENT), created_at
- **email_threads**: id, project_id, client_id, reply_to_address, provider_thread_id (Brevo/Message-Id), created_at
- **emails**: id, thread_id, direction(enum: INBOUND|OUTBOUND), from_addr, to_addr, subject, raw_headers(JSONB), text_body(TEXT), html_body(TEXT), attachments_meta(JSONB), brevo_event_id, received_at, intent(enum: NONE|DOC_FEEDBACK|ACCEPT|REJECT|OFFTOPIC|OTHER), intent_confidence(NUMERIC), llm_trace_id, processed(bool)
- **asana_links**: id, project_id, pending_board_gid (for "Pending Projects"), finalized_board_gid (for real project), sections(JSONB: name→gid), pm_gid, finance_gid, created_at
- **asana_tasks**: id, project_id, task_gid, section_name, assignee_gid, due_on, meta(JSONB), created_at
- **team_members**: id, name, email, asana_user_gid, roles(JSONB: \[{role, is_lead}])
- **job_runs**: id, name, args(JSONB), status(enum: QUEUED|RUNNING|SUCCEEDED|FAILED|CANCELLED), dedupe_key, attempts, last_error(TEXT), started_at, finished_at
- **webhook_subscriptions**: id, provider(enum: ASANA|BREVO|APPS_SCRIPT), resource_id, secret, callback_url, last_event_at, status
- **global_configs**: id, key, value(JSONB), description, updated_at, created_at
- **audit_log**: id, project_id, actor, action, details(JSONB), at

**Indexes**

- (emails.to_addr), (emails.received_at DESC); (document_revisions.document_id, created_at DESC); (job_runs.dedupe_key UNIQUE NULLS DISTINCT); (projects.client_id, phase); (questionnaire_responses.project_id), (questionnaire_responses.processing_status), (questionnaire_responses.submitted_at DESC); UNIQUE(questionnaire_responses.form_id, response_id); UNIQUE(global_configs.key)

**Global Configuration Storage**

The `global_configs` table stores system-wide configuration that needs to persist across restarts:

- **Key**: `asana_pending_projects` - Stores the persistent "Pending Projects" board configuration

**Configuration Access Patterns**:

- Read on startup and cache for performance
- Update when external resources change (e.g., Asana project deleted)
- Validate structure before storing to prevent data corruption
- Automatic cleanup of invalid configurations with logging

---

## 4) Enumerated states & transitions

**Project.phase**

- QUESTIONNAIRE → BRAND_ORIGIN → BUDGET_TIMELINE → FINALIZED (or REJECTED from any non-final states)
- Transitions **only through orchestrator** (ensures one-way progress & idempotent side effects).

**Document.status**

- DRAFT → PM_REVIEW → SENT_TO_CLIENT → CLIENT_FEEDBACK → ACCEPTED (or REJECTED back to DRAFT)
- Only one **active “original”** per type; “variants” are immutable (created once for Budget/Timeline).

---

## 5) Endpoints (public API)

- **POST** `/webhooks/brevo/inbound` – inbound-parse for replies; validate auth; enqueue `EMAIL_PARSE`. ([developers.brevo.com][3])
- **POST** `/webhooks/asana` – webhook handshake + events; verify `X-Hook-Secret` & `X-Hook-Signature`; enqueue `ASANA_SYNC`. ([developers.asana.com][9])
- **POST** `/webhooks/apps-script/forms` – Google Forms submission relay (Apps Script `doPost` to this URL). ([Google for Developers][10], [docs.bullmq.io][11])
- **GET** `/actions/review` – opens Admin UI with signed token linking to doc revision.
- **POST** `/actions/send-to-client` – signed action; moves doc to SENT_TO_CLIENT; sends email.
- **POST** `/actions/confirm-accepted` – PM/Finance click; deduped; starts next job.
- **POST** `/admin/project/:id/accept-doc` – manual accept from UI.
- **GET** `/healthz` – health. **GET** `/readyz` – readiness.

**Action links**: sign as `?t=<JWT>` with short TTL + one-time nonce (matches `job_runs.dedupe_key`); audit log “clicked by …”.

---

## 6) Core workflows (Step-by-step mapping)

### Step 1 — Questionnaire intake

**Paths:**
A) **Google Form** → Apps Script → our `/webhooks/apps-script/forms` → create **client** (if not exists), **project** (phase=QUESTIONNAIRE), validate & store **questionnaire_response**, **email_thread** (reply-to reserved), add **Pending Projects** Asana task in "Filled Questionnaire". ([Google for Developers][10], [docs.bullmq.io][11])
B) **Uploaded filled doc** → parse on FE → prefill UI form → submit to API same as (A).
C) **UI native form** → API same as (A).

**Questionnaire Processing:**

1. **Webhook receives form data**: Parse Google Apps Script payload containing form_id, response_id, responses (field→answer mapping), respondent_email, timestamp
2. **Validation & deduplication**: Check for existing form_id+response_id combination to prevent duplicates
3. **Data extraction**: Extract client info (name, email) and project info (name, description) from questionnaire responses. Client email is ususaly the respondent email or if not present check for email key/value pair in reponses field.
4. **Database transaction**:
   - Create/update **client** record (match by email, update context if existing)
   - Create **project** record with phase=QUESTIONNAIRE
   - Insert **questionnaire_response** with status=PENDING
   - Create **email_thread** with unique reply-to address
   - Mark questionnaire_response status=PROCESSED

**Asana "Pending Projects"**

- The "Pending Projects" board is a **persistent, global resource** stored in the `global_configs` table under key `asana_pending_projects`
- **Database-first approach**: Check if configuration exists → verify board exists in Asana → create only if missing/invalid
- Configuration structure stored in database:
  ```json
  {
    "projectGid": "1234567890",
    "sections": {
      "Filled Questionnaire": "section_gid_1",
      "Brand Origin Doc Phase": "section_gid_2",
      "Budget/Timeline Phase": "section_gid_3",
      "Finalized": "section_gid_4",
      "Rejected": "section_gid_5"
    },
    "lastVerified": "2025-09-11T00:00:00Z",
    "workspaceGid": "workspace_gid"
  }
  ```
- **Edge case handling**:
  - If entire board is deleted from Asana → detects and recreates full project
  - If only some sections are missing → recreates missing sections only (minimal disruption)
  - If sections fail to recreate → falls back to full project recreation
- **Verification process**: On each form submission, quickly verify stored projectGid exists in Asana without recreating
- **Incremental repair**: Minimally invasive - only recreates what's actually missing
- Add task per intake; assign PM; store mapping in DB. ([ai-sdk.dev][12], [developers.asana.com][4])

**Notify PM**

- Transactional email via Brevo (template with CTA "Review Brand Origin"). ([developers.brevo.com][13])

**Error Handling & Edge Cases:**

- **Duplicate submissions**: UNIQUE constraint on (form_id, response_id) prevents duplicates; return 200 OK for duplicates
- **Invalid form data**: Set processing_status=FAILED with error_message; retry up to 3 times
- **Client email mismatch**: If email differs from existing client, create new client or prompt manual merge in admin UI
- **Partial form data**: Store response even if some fields missing; flag for PM review
- **Apps Script timeout**: Use async processing with status tracking; Apps Script gets immediate 200 OK

### Step 2 — Brand Origin document generation

- Enqueue `DOC_BRAND_ORIGIN_GENERATE` (BullMQ) with **dedupe key** `project:<id>:brand_origin:generate`.
- **Worker context assembly**: Query `questionnaire_responses` for project + `client.context` + `project.context` + brand origin templates/rules. Parse questionnaire JSON into structured prompt context.
- **LLM workflow**: Use structured plan → compose → self-check loop with questionnaire data as primary input; write Drive file; create `document` & first `document_revision` (snapshot text too).
- Move Asana task to **Brand Origin Doc Phase** (update section). Add story comment, @mention PM with links to Review / Send. ([developers.asana.com][14])
- Email PM with buttons (Review / Send to Client).

**Context Sources for LLM (Priority Order):**

1. **questionnaire_responses.responses** (JSON) - Primary client requirements
2. **client.context** - Additional client background/preferences
3. **project.context** - Project-specific notes
4. **Brand origin templates** - Standard document structure
5. **Previous accepted brand origins** - For style consistency

**Versioning**

- For Google Docs, Drive “keepForever” **does not apply** to Docs editors; it’s for binary revisions only. Use our own immutable snapshots (text in DB) + optional duplicate file for “pinned” copies if required. ([Google for Developers][15])

### Step 3 — Send to client

- On PM click or Admin UI:

  - Set status SENT_TO_CLIENT; send Brevo email to client with **unique reply-to** like `clients-<CLIENT_ID>-<PROJECT_ID>@levitate.ng` (configure domain in Brevo; inbound route hits our webhook). ([developers.brevo.com][3])
  - Store outbound email in `emails` with provider ids; upsert `email_thread`.

### Step 4 — Inbound replies (intent loop with accurate content tracking)

- Brevo webhook posts parsed email + attachments to our endpoint → enqueue `EMAIL_PARSE`. ([developers.brevo.com][3])
- **Enhanced Context Assembly**: Get the exact content that was sent to client via `lastSentRevisionId`:
  - If PDF revision: Extract content from `sourceRevisionId` (the actual document content sent)
  - If Google Docs revision: Use `snapshotText` directly (edge case)
  - Fallbacks: Google Drive export if source revision missing, then last sent snapshot
- LLM classification (structured JSON): {intent, summary, requested_changes} using the exact sent content for accurate analysis.

  - **DOC_FEEDBACK** → status=CLIENT_FEEDBACK → enqueue regeneration job; add comment in Asana; email PM.
  - **ACCEPT** → proceed to Step 5.
  - **OFFTOPIC/OTHER** → log thread and do nothing (comment PM).

- Every regeneration produces a new `document` / `document_revision` and fresh Drive head; keep DB snapshots authoritative.

### Step 5 — Accept Brand Origin → Budget/Timeline creation

- On email intent=ACCEPT **or** manual accept:

  - Send **confirmation email** to PM & Finance with a single “Confirm & Create Budget/Timeline” CTA (either can click). - Confirmation email only sent if detected intent=ACCEPT, if manual accept don't send email just proceed to next phase.
  - Clicking CTA or manual accept enqueues `DOC_BUDGET_TIMELINE_GENERATE` with dedupe key; set project.phase=BRAND_ORIGIN→BUDGET_TIMELINE; move Asana task to **Budget/Timeline Phase**; comment tagging PM & Finance with review/send CTAs.
  - Generate **3 one-time variants** alongside the main Budget/Timeline doc (flag `is_variant=true`, `variant_index=1..3`); do **not** regenerate variants on later edits (only the main document).

### Step 6 — Budget/Timeline feedback loop

- Same as Step 4 but for Budget/Timeline doc until status=ACCEPTED. Variants remain immutable, for reference only.

### Step 7 — Finalize & kick off Asana project

- On accept (email intent or Admin UI):

  - Move the card in “Pending Projects” to **Finalized**; send **“Finalize & Initialize Project”** CTA to PM & Finance (deduped).
  - Enqueue `ASANA_CREATE_PROJECT` to create the **real project** with sections _To Do_, _In Progress_, _In Review_, _Completed_. Create tasks derived from the accepted Budget/Timeline breakdown; map roles to assignees (lead if multiple). Due dates = rolling offsets from initialization date.
  - Persist `asana_project_gid`, section gids, and created task gids.

### Step 8 — Task guidance comments

- For each created task, generate a **15+ line guidance** comment (LLM) with concrete cues (palette, style, deliverables). Post as Asana **story**; @mention the assignee and PM for visibility. ([developers.asana.com][14])

### Step 9 — Completion notice

- Email Admin, Manager (if any), and PM: “Project initialized 100%.” Include links (Asana project, Docs).

**Always-on sync**

- Asana webhook events (moves, comments, deletes) update our DB lightly (task section, comment metadata, deletes mirrored). Handshake & signatures are verified per Asana’s webhook guide. ([developers.asana.com][9])

---

## 7) Document strategy (Google Drive + DB snapshots + Last Sent Tracking)

- **Primary artifact**: Google Doc (collab-friendly).
- **Immutable history**: Store **normalized text snapshots** per revision in `document_revisions`.
- **Last Sent Tracking**: Track `lastSentRevisionId` on documents to identify exactly what content was sent to clients for accurate feedback processing.
- **PDF Workflow**: When sending to clients, we export as PDF and create a PDF revision that references the source revision via `sourceRevisionId` in `snapshotMd`.
- **Intent Detection**: For email intent analysis, we use the `lastSentRevision` to get the exact content the client received:
  - If PDF revision: Get content from `sourceRevisionId` revision (the actual document content)
  - If Google Docs revision: Use `snapshotText` directly (edge case)
  - Fallbacks: Google Drive export if source revision missing, then last sent snapshot
- **Why**: Drive `keepForever` is for **binary** blobs; not reliable for Docs editors content. We therefore keep our own authoritative history and track what was actually sent to clients for accurate feedback processing and optionally duplicate Docs for “pinned” milestones if required. ([Google for Developers][15])
- **AI context**: Pull content from last sent revision's source for feedback analysis; **do not** fetch live Doc in long chains to avoid quota/latency; re-sync when saving.
- **Merge model**: If PM edits the live Google Doc, we **export** (text/HTML) and save a new `document_revision` with diff summary (LLM generated) for audit trail.

---

## 8) LLM design (Vercel AI SDK)

**Providers & cost-aware model routing**

- **Classification / intent detection / extract fields** → small model via `generateObject` (schema) - the SDK supports tool-calling + structured outputs. ([ai-sdk.dev][2])
- **Document drafting** (Brand Origin, Budget/Timeline) → balanced quality/cost model; allow multi-step tool loops (web search, projec/client history reading from db, previous doc create favoring accepted ones or repo lookups etc. if needed, rules and example documents would be given in context) via AI SDK **tool calling**. ([ai-sdk.dev][16])

**Tools exposed to the agent, feel free to add if no one caters for your needs yet - but update the list here.**

- `readProjectContext(projectId)` - Gets client.context + project.context + project metadata
- `readQuestionnaireResponses(projectId)` - Gets all questionnaire responses for project with structured parsing
- `readSnapshots(documentId)` - Gets document revision history
- `writeDoc(type, content)` - Creates/updates documents in Google Drive + DB
- `createVariant(...)` - Creates document variants (Budget/Timeline only)
- `postAsanaComment(taskGid, html_text)` (supports `@mentions` via `html_text` with user gid). ([developers.asana.com][14])
- `sendEmail(templateId, to, params)` - Sends transactional emails via Brevo
- `advanceState(projectId, transition)` - Manages project phase transitions (guarded)

**Execution pattern**

- **Plan** (schema), **Execute** (tools), **Self-check** (schema), **Emit** (final content). Logged under `llm_trace_id`.
- Hard token limits mitigated by chunked context (snapshots + rules + last messages).
- Deterministic outputs via schemas; reject non-conforming JSON and auto-retry with repair instruction.

---

## 9) Background jobs (BullMQ + Redis)

**Queues**

- `doc-generation`, `email-intent`, `asana-sync`, `asana-project-init`, `notifications`, `snapshot-sync`

**Job scheduler**

- Use BullMQ **Job Schedulers** (v5.58+) for cron-like tasks (e.g., stale job rechecks, Drive export sweeps). ([docs.bullmq.io][7])

**Reliability settings**

- **Attempts** with **exponential backoff** for 429/5xx (respect `Retry-After` for Asana). ([developers.asana.com][8])
- **Stalled jobs**: run QueueScheduler; consider sandboxed workers to isolate CPU-heavy LLM formatting. ([docs.bullmq.io][17])
- **Idempotency**: All producers pass `dedupe_key`; workers check `job_runs` before side-effects.
- **RemoveOnComplete/Fail** configured to retain last N for ops forensic. ([api.docs.bullmq.io][18])

---

## 10) Google integrations

**Google Forms → Apps Script**

- Create an **installable trigger** on form submit to call a **Web App** (`doPost`) which forwards structured payload to our `/webhooks/apps-script/forms`. ([Google for Developers][10], [docs.bullmq.io][11])

**Drive/Docs**

- Use Drive v3 `files.create/update/export` + `revisions.list`. Keep named “milestones” by duplicating file; **do not rely** on `keepForever` for Google Docs editors. ([Google for Developers][15])

---

## 11) Brevo email (send + inbound)

- **Transactional send** with templates and dynamic params (buttons link to our action endpoints). ([developers.brevo.com][13])
- **Inbound Parse**: configure `type: inbound`, `events: inboundEmailProcessed`, domain mapping to webhook; secure with basic/bearer and optional IP allowlist. ([developers.brevo.com][3])
- **Dedicated reply-to** per project/thread stored in DB; match inbound by `To:` and `In-Reply-To` headers.

---

## 12) Asana integration

- **Pending Projects** board bootstrap (if not found): create sections _Filled Questionnaire_, _Brand Origin Doc Phase_, _Budget/Timeline Phase_, _Finalized_, _Rejected_; persist gids. ([ai-sdk.dev][12])
- **Webhooks**: create on project; complete handshake by echoing `X-Hook-Secret`; verify HMAC signatures on future events. ([developers.asana.com][4])
- **Moves & deletes**: track section changes and deletions; mirror deletes locally (edge case #13).
- **Comments (@mentions)** via **Stories API** with `html_text` containing `<a data-asana-gid="...">` to mention users (supports PM/Finance tagging). ([developers.asana.com][14])
- **Rate limits**: handle 429 with `Retry-After`, gradual concurrency; backoff in worker. ([developers.asana.com][8])

---

## 13) Admin/Manager/PM UI (frontend)

- Admin can set functionalities that PM and manager can access from UI.

**Screens**

- **Dashboard**: all clients & projects with phase, last action, error badges; filters by PM/Finance.
- **Project detail**: current phase, Asana links, documents & revision history (diffs), email thread, logs timeline.
- **Document viewer**: snapshot text (read-only), open live Google Doc; actions: “Send to Client”, “Accept”, “Recreate”.
- **Context editor**: add/update client/project context text and upload reference files (stored as text extracts).
- **Ops**: job queue status, dead-letter, webhook subscriptions health, provider quota.

**UX mechanics**

- All potentially long actions **post commands** that enqueue work; UI shows a live job status feed (SSE or polling).
- **Action links** clicked from email land here; after JWT validation, UI calls the internal action API.

---

## 14) Observability & audit

- **Structured logs** with correlation ids: `project_id`, `job_id`, `llm_trace_id`, `provider_event_id`.
- **Metrics**: job latency/success rate; Asana 429s; Brevo delivery/open; LLM token spend.
- **Audit Log**: human & system actions per project for “what changed when and why”.

---

## 15) Questionnaire & Data Flow Edge Cases

**Questionnaire Submission Edge Cases:**

1. **Multiple submissions from same respondent**:

   - **Detection**: Track by form_id + response_id (Google Forms unique identifiers)
   - **Action**: Return 200 OK for duplicates; log for audit but don't reprocess
   - **Admin override**: Allow manual reprocessing via admin UI if needed

2. **Malformed questionnaire data**:

   - **Validation**: Check required fields (client name, email, project description)
   - **Partial data**: Store what's available, set processing_status=FAILED with specific error
   - **Retry logic**: Up to 3 automatic retries with exponential backoff
   - **PM notification**: Email PM for manual review if all retries fail

3. **Client email conflicts**:

   - **Existing client, different name**: Update client.context with new info; flag for PM review
   - **Same email, different projects**: Create new project under existing client
   - **Typo in email**: Store as-is; PM can merge clients via admin UI later

4. **Large questionnaire responses**:

   - **Size limit**: Max 1MB per response JSON (PostgreSQL JSONB limit)
   - **Truncation**: If exceeds limit, truncate with warning in error_message
   - **File attachments**: Store metadata only; actual files handled separately

5. **Apps Script failures**:
   - **Timeout**: Apps Script gets immediate 200 OK; actual processing is async
   - **Google Forms API changes**: Validate expected field structure; fail gracefully
   - **Rate limiting**: Implement exponential backoff for Google API calls

**LLM Context Assembly Edge Cases:**

6. **Missing questionnaire data**:

   DOn't process if questionaire data missing

   - **Corrupted JSON**: Attempt parsing with error recovery; log parsing errors

7. **Questionnaire format changes**:

   - **New fields**: Ignore unknown fields; focus on core requirements
   - **Removed fields**: Handle missing expected fields gracefully
   - **Field name changes**: Maintain backward compatibility mapping for 6 months

8. **Context size limits**:
   - **Token overflow**: Prioritize most recent questionnaire + client context
   - **Multiple questionnaires**: If client submits multiple forms, use latest by submitted_at
   - **Chunking strategy**: Split large context into sections (client info, project details, style preferences)

**Database Consistency Edge Cases:**

9. **Transaction failures**:

   - **Partial writes**: Use database transactions; rollback if any step fails
   - **Foreign key violations**: Handle gracefully; create referenced records if missing
   - **Unique constraint violations**: Return appropriate error; don't crash

10. **Concurrent processing**:
    - **Duplicate project creation**: Use upsert patterns; check for existing projects by client email + project name
    - **Race conditions**: Use proper database locks for critical sections
    - **Job deduplication**: BullMQ dedupe keys prevent duplicate document generation

**Document Generation Edge Cases:**

11. **LLM failures during brand origin creation**:

    - **Token check middleware**:
      - Before processing queued docs, check available token balance with provider
      - If tokens below threshold (configurable in global_configs), notify admin with button to manaually retry when token replenished and skip processing
      - Re-queue skipped docs with exponential backoff once tokens replenished
    - **API errors**: Retry with exponential backoff; escalate to PM after 3 failures
    - **Invalid output**: Validate LLM response structure; regenerate if malformed
    - **Context too large**: Summarize questionnaire responses before sending to LLM
    - **Cost optimization**:
      - Track token usage per document generation
      - Cache common responses/patterns to reduce redundant LLM calls
      - Implement token budget per project phase

12. **Google Drive integration failures**:
    - **Quota exceeded**: Queue for retry when quota resets; notify admin
    - **Permission errors**: Ensure service account has proper folder access
    - **File corruption**: Keep database snapshots as source of truth; recreate Drive file from snapshot

---

## 16) Security, auth, and integrity

- Secrets in Railway env vars; rotate regularly.
- **Inbound webhooks**

  - Asana: handshake echo `X-Hook-Secret`; verify `X-Hook-Signature` on events; reject invalid. ([developers.asana.com][9])
  - Brevo: use basic/bearer auth and optionally IP allowlist per docs. ([developers.brevo.com][19])

- **Action links**: JWT (short TTL) + single-use nonce; capture actor info; replay-safe.
- **PII**: store minimal email bodies; redact attachments unless whitelisted.

---

## 16) Error handling & retries (per integration)

- **Asana**: if 429, sleep `Retry-After` seconds; if project/section not found, attempt re-bootstrap once; for 4xx validation errors, mark job unrecoverable (stop retries). ([developers.asana.com][8])
- **Brevo**: if send error, queue retry with capped backoff; if inbound payload malformed, dead-letter and notify Admin.
- **Drive**: quota errors → backoff; export failures → retry 3x; if Doc missing, recreate from last snapshot.

---

## 17) Testing strategy

- **Unit**: tools, schema validation, state transitions, signature verifiers.
- **Contract tests**: stub Asana/Brevo/Drive with fixed payloads (webhook handshake, move event, inbound email).
- **E2E**: golden flows (Steps 1–9), rejection paths, duplicate clicks (idempotency), race tests (PM & Finance).
- **Load**: N projects × M emails; monitor 429 handling and queue throughput.

---

## 18) Rollout & operations

- **Phased rollout**: start with one PM + one Finance; simulate inbound emails; verify Asana sync; then enable client-facing addresses.
- **Runbooks**:

  - “Asana webhook expired” → re-create & store new secret. ([developers.asana.com][9])
  - “Client reply not detected” → inspect `emails` row & LLM classification; force re-parse.
  - “Drive history lost” → restore from `document_revisions` snapshot (duplicate a new Doc from snapshot).

---

## 19) Cost controls

- Prefer **small models** for classification; reserve larger models only for longform docs; enforce token caps but don't limit quality of LLM response. ([ai-sdk.dev][2])
- Batch Asana writes when possible; respect rate limits; collapse duplicate comments. ([developers.asana.com][8])
- Snapshot **text only** (compressed) rather than storing PDFs for every revision.

---

## 20) Implementation backlog (by milestone)

**M0 – Foundations (1–1.5 weeks)**

- Repo scaffolding; DB migrations; queues/workers; health & auth; action link signing; basic Admin shell.

**M1 – Intake & Pending Board (1 week)**

- Apps Script endpoint + Brevo send; Asana pending board bootstrap & webhook; Step 1 + PM notify. ([Google for Developers][10], [docs.bullmq.io][11], [ai-sdk.dev][12], [developers.asana.com][4])

**M2 – Brand Origin loop (1.5–2 weeks)**

- Doc generator + snapshots; review/send; inbound parse + intent; regeneration loop; Asana comments. ([developers.brevo.com][3])

**M3 – Budget/Timeline + variants (1.5 weeks)**

- Confirm flow; main + 3 variants; loop until accepted.

**M4 – Project initialization (1.5 weeks)**

- Create Asana real project, sections & tasks; guidance comments; completion email.

**M5 – Observability & polish (1 week)**

- Logs/metrics, admin ops (replay, re-bootstrap), error dashboards.

---

### Notes & constraints surfaced during design

- **Drive non-purgeable revisions for Google Docs aren’t supported via `keepForever`** (binary only). We meet the “non-purgeable” requirement by **DB snapshots** + optional duplicated Docs at milestones. ([Google for Developers][15])
- **Asana @mentions** via `html_text` with `data-asana-gid` let us tag PM/Finance reliably from API comments. ([developers.asana.com][14])
- **Webhooks security** must honor provider-specific guidance (Asana secrets/signatures; Brevo auth/allowlists). ([developers.asana.com][9], [developers.brevo.com][19])
- Check here on how to structure system prompts: (https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools)[https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools]

[1]: https://www.anthropic.com/research/building-effective-agents "Building Effective AI Agents"
[2]: https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data "Generating Structured Data"
[3]: https://developers.brevo.com/docs/inbound-parse-webhooks "Inbound parsing webhooks"
[4]: https://developers.asana.com/reference/createwebhook "Establish a webhook"
[5]: https://ai-sdk.dev/docs/introduction "AI SDK by Vercel"
[6]: https://docs.bullmq.io/guide/jobs/stalled "Stalled"
[7]: https://docs.bullmq.io/guide/job-schedulers "Job Schedulers"
[8]: https://developers.asana.com/docs/rate-limits "Rate limits - Asana Docs"
[9]: https://developers.asana.com/docs/webhooks-guide "Webhooks"
[10]: https://developers.google.com/apps-script/guides/web "Web Apps | Apps Script"
[11]: https://docs.bullmq.io/guide/retrying-failing-jobs "Retrying failing jobs"
[12]: https://ai-sdk.dev/providers/ai-sdk-providers "Vercel AI SDK providers"
[13]: https://developers.brevo.com/docs/send-a-transactional-email "Send a transactional email"
[14]: https://developers.asana.com/reference/createstoryfortask "Create a story on a task"
[15]: https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions "REST Resource: revisions | Google Drive - Google for Developers"
[16]: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling "AI SDK Core: Tool Calling"
[17]: https://docs.bullmq.io/guide/queuescheduler "QueueScheduler"
[18]: https://api.docs.bullmq.io/interfaces/v1.JobsOptions.html "Interface JobsOptions"
[19]: https://developers.brevo.com/docs/username-and-password-authentication "Secured webhook calls"
