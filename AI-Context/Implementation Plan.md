# AI Agent Implementation Plan (Node.js + TypeScript, PostgreSQL, BullMQ, Vercel AI SDK, Brevo, Google Docs/Drive, Asana)

Below is a **single-source blueprint** for engineering, QA, and PM to implement and operate your agent end-to-end. It’s organized by principles → architecture → data model → workflows (Steps 1–9) → async jobs → LLM design → integrations (Google, Brevo, Asana) → admin UI → observability → security → testing → rollout & ops. I’ve leaned heavily into backend detail (state, idempotency, retries, failure modes) as requested.

Where the plan relies on provider behaviors or best-practice patterns, I cite authoritative docs inline.

---

## 1) File Structure & Key Files

**New Files to Create:**

- `src/integrations/levitateStudiosErp.js` - ERP API integration service
- `src/workers/quoteGeneration.js` - Quote generation worker processor
- `src/services/quoteService.js` - Quote business logic and operations
- `src/services/quotePromptService.js` - LLM prompts for quote generation
- `src/services/teamMemberSelectionService.js` - Team member selection algorithm
- `scripts/seed-rate-card.js` - One-time rate card seeding script (delete after running)

**Files to Modify:**

- `src/constants/index.js` - Update DocumentType enums (remove BUDGET_TIMELINE, add QUOTE)
- `src/workers/emailIntent.js` - Add quote acceptance handling
- `src/workers/asanaProjectInit.js` - Implement project creation and team member addition
- `src/services/documentSendingService.js` - Handle quote PDF sending and selection
- `src/routes/actions.js` - Add quote selection and sending endpoints
- `src/services/emailTemplateService.js` - Add quote email templates
- `prisma/schema.prisma` - Add quote tracking fields to Document model
- All files using `DocumentType.BUDGET_TIMELINE` - Replace with `DocumentType.QUOTE`
- All files with hardcoded `"Budget/Timeline Phase"` - Replace with `"Quote Document Phase"`

**Reference Files:**

- `AI-Context/Third Party Docs/Levitate ERP Software API Documentation.md` - ERP API reference
- `AI-Context/Third Party Docs/asana_auto_assign_task_based_on_workload.md` - Team selection reference
- `rateCard.json` - Rate card structure for seeding
- `AI-Context/About This Project.md` - Project requirements

---

## 2) Guiding principles (from Anthropic & practical agent ops)

- **Keep the agent simple and tool-centric.** Explicit tools with clear contracts; avoid giant, monolithic prompts. Let the agent call narrow tools (doc render, email parse, Asana ops) and iterate in short loops. ([Anthropic][1])
- **Make planning/evaluation explicit.** Use a _planning pass → execution → self-check_ loop for long tasks; log reasoning artifacts in your DB for auditability and failure triage. ([Anthropic][1])
- **Prefer structured outputs.** Constrain LLM outputs to JSON schemas for classification & extraction (email intent, doc outline, task guides) using Vercel AI SDK’s `generateObject` and tool-calling. ([ai-sdk.dev][2])

---

## 3) High-level system architecture

**Services (same repo, modular monolith)**

- **API Gateway** (HTTP REST): Public endpoints (webhooks, action links), Admin UI backend.
- **Agent Orchestrator**: Starts/monitors long-running jobs (BullMQ), breaks problems into tool calls, coordinates state transitions.
- **Integrations**:

  - **Google** (Forms Apps Script endpoint, Docs/Drive for content & revisions).
  - **Brevo** (transactional send, inbound-parse webhook). ([developers.brevo.com][3])
  - **Asana** (projects/sections/tasks, stories/comments, webhooks). ([developers.asana.com][4])
  - **Levitate ERP Software** (quotation creation, updates, submission, invoice generation via ERPNext API). (See `AI-Context/Third Party Docs/Levitate ERP Software API Documentation.md`)

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

## 4) Data model (PostgreSQL)

Key tables (selected columns only; use auto incrementing PKs unless noted)
For enums listed here don't add in db level, let it be in backend level and validated before inserting in db
:

- **clients**: id, name, primary_email, status, created_at
- **projects**: id, client_id, name, phase(enum: QUESTIONNAIRE, BRAND_ORIGIN, BUDGET_TIMELINE, FINALIZED, REJECTED), asana_project_gid (nullable until Step 7), created_at, updated_at
- **project_phase_log**: id, project_id, from_phase, to_phase, reason, actor(enum: SYSTEM|USER|LLM), at
- **questionnaire_responses**: id, project_id, form_id, response_id, responses(JSONB), respondent_email, submitted_at, processed_at, processing_status(enum: PENDING|PROCESSED|FAILED), error_message(TEXT), retry_count, created_at, updated_at
- **documents**: id, project_id, type(enum: BRAND_ORIGIN|QUOTE|QUOTE_VARIANT), status(enum: DRAFT|PM_REVIEW|SENT_TO_CLIENT|CLIENT_FEEDBACK|ACCEPTED|REJECTED), drive_file_id, current_revision_id (FK to document_revisions), last_sent_revision_id (FK to document_revisions), erp_quote_id(String|nullable), erp_variant_ids(JSONB|nullable), selected_quote_id(String|nullable), invoice_id(String|nullable, stored in metadata JSON), created_at, updated_at
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
- **Key**: `rate_card` - Stores the studio rate card JSON (see `rateCard.json` for structure). Seeded via one-time script `scripts/seed-rate-card.js` (delete after running).

**Configuration Access Patterns**:

- Read on startup and cache for performance
- Update when external resources change (e.g., Asana project deleted)
- Validate structure before storing to prevent data corruption
- Automatic cleanup of invalid configurations with logging

---

## 5) Enumerated states & transitions

**Project.phase**

- QUESTIONNAIRE → BRAND_ORIGIN → BUDGET_TIMELINE → FINALIZED (or REJECTED from any non-final states)
- Transitions **only through orchestrator** (ensures one-way progress & idempotent side effects).

**Document.status**

- DRAFT → PM_REVIEW → SENT_TO_CLIENT → CLIENT_FEEDBACK → ACCEPTED (or REJECTED back to DRAFT)
- Only one **active "original"** per type; "variants" are immutable (created once for Quote documents - 3 variants generated alongside main quote).
- For Quote documents: Finance Manager selects ONE quote (main or variant) to send to client; tracked via `selected_quote_id`. Only the selected quote is updated during feedback loops.

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
      "Quote Document Phase": "section_gid_3",
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

### Step 5 — Accept Brand Origin → Quote Document creation

**Implementation Files:**

- `src/workers/emailIntent.js` - Handle ACCEPT intent for Brand Origin
- `src/workers/quoteGeneration.js` - Quote generation worker
- `src/services/quoteService.js` - Quote business logic
- `src/services/quotePromptService.js` - LLM prompts for quote generation
- `src/integrations/levitateStudiosErp.js` - ERP API integration

**Workflow:**

- On email intent=ACCEPT **or** manual accept from Admin UI:
  - **NO confirmation email** - directly enqueue `QUOTE_GENERATION` job with dedupe key `project:<id>:quote:generate`
  - Update document status to ACCEPTED
  - Set project.phase=BRAND_ORIGIN→BUDGET_TIMELINE (internal phase name)
  - Move Asana task to **"Quote Document Phase"** section

**Quote Generation Process (`src/workers/quoteGeneration.js`):**

1. **Context Assembly:**

   - Query `questionnaire_responses` for project
   - Get `client.context` and `project.context`
   - Get accepted Brand Origin document (latest revision)
   - Load rate card from `global_configs` (key: `rate_card`) - see `rateCard.json` for structure
   - Include quote generation rules/examples (provided as context)

2. **LLM Workflow (`src/services/quotePromptService.js`):**

   - Analyze project requirements from questionnaire and brand origin
   - Map services to rate card items (fuzzy matching; handle "TBD" prices gracefully)
   - Generate quote items with quantities, rates, and descriptions
   - Use structured output schema for quote items array

3. **Customer & Item Setup (`src/integrations/levitateStudiosErp.js`):**

   - **Customer Management (CRITICAL - Must be done first):**

     - Search for customer by exact name using `searchCustomers(client.name)`
     - If exact match found: use existing customer `name` field
     - If no exact match: create new customer using `createCustomer({ customer_name: client.name, email: client.primaryEmail })`
     - Store customer name/ID for quote creation

   - **Item Management (CRITICAL - Must be done for each item):**
     - For each quote item generated by LLM:
       - Search for item by exact `item_code` or `item_name` using `searchItems(itemCode)`
       - If exact match found: use existing item `item_code`
       - If no exact match: create new item using `createItem({ data: { item_code, description, stock_uom: "Nos" } })`
     - Ensure all items exist before quote creation

4. **ERP Quote Creation (`src/integrations/levitateStudiosErp.js`):**

   - Create **4 quotes** via ERP API (all in DRAFT, docstatus: 0):
     - Main quote (original) - use customer name and item codes from step 3
     - Variant 1 (alternative pricing/scope) - same customer, different items/pricing
     - Variant 2 (alternative pricing/scope) - same customer, different items/pricing
     - Variant 3 (alternative pricing/scope) - same customer, different items/pricing
   - Store quote IDs:
     - `erp_quote_id` = main quote ID
     - `erp_variant_ids` = JSON array `[variant1_id, variant2_id, variant3_id]`
     - `selected_quote_id` = null (set when Finance Manager selects one)

5. **PDF Generation & Storage:**

   - Download PDFs from ERP for all 4 quotes using `getQuotationPDF(quoteId)`
   - Upload main quote PDF to Google Drive
   - Create `Document` record:
     - `type = DocumentType.QUOTE`
     - `status = DocumentStatus.DRAFT`
     - `erp_quote_id`, `erp_variant_ids` populated
   - Create `DocumentRevision` with Drive file ID

6. **Asana Updates:**

   - Move task to "Quote Document Phase" section
   - Add comment tagging Finance Manager (no quote link in comment)
   - Comment: "Quote document created. Please check your email to review and send to client."

7. **Email Notification (`src/services/emailTemplateService.js`):**

   - Send to Finance Manager & Admin
   - Include:
     - **View button** - Opens Drive link to main quote PDF
     - **Send to Client button** - Action to select and send quote
     - **Manage button** - Opens Admin UI
   - List all 4 quote variants with links/IDs for selection
   - Finance Manager selects ONE quote (main or variant) to send

8. **Quote Selection (`src/routes/actions.js`):**
   - When Finance Manager clicks "Send to Client" from email or UI:
     - Track which quote was selected (main or variant index)
     - Update `Document.selected_quote_id` with chosen quote ID
     - Use this selected quote for sending to client
     - Store in `last_sent_revision_id` for future reference

**Error Handling:**

- If ERP API fails, retry with exponential backoff
- If quote creation partially succeeds, store what was created and notify admin
- Always verify quote status before operations (check if cancelled via `getQuotation()`)

### Step 6 — Quote Document feedback loop

**Implementation Files:**

- `src/workers/emailIntent.js` - Intent detection for quote feedback
- `src/workers/quoteGeneration.js` - Quote update logic
- `src/integrations/levitateStudiosErp.js` - ERP API update methods

**Workflow:**

- Brevo webhook → enqueue `EMAIL_PARSE` → detect intent on Quote document
- **Important**: Use `selected_quote_id` to know which quote client is referring to

**Feedback Processing:**

1. **Intent Detection:**

   - Check document status (not ACCEPTED)
   - Extract requested changes from email
   - Use `last_sent_revision_id` to get exact content sent to client

2. **Item Setup for Updates (`src/integrations/levitateStudiosErp.js`):**

   - **For any new items in feedback:**
     - Search for each new item by exact `item_code` or `item_name` using `searchItems(itemCode)`
     - If exact match found: use existing item `item_code`
     - If no exact match: create new item using `createItem({ data: { item_code, description, stock_uom: "Nos" } })`
     - Ensure all new items exist before quote update

3. **Quote Update (`src/integrations/levitateStudiosErp.js`):**

   - **Before update**: Call `getQuotation(selected_quote_id)` to verify not cancelled
   - **If cancelled**:
     - Use `amendQuotation(cancelledQuoteId, data)` to create new draft
     - **Critical**: Response returns new quote ID in `data.name` - update `selected_quote_id` with this new ID
     - Use new quote ID for subsequent operations
   - **If draft**:
     - Fetch existing items from quote
     - Modify items array based on feedback (replace items, add new items, remove items)
     - Use `updateQuotation()` with complete items array (all items must exist - search/create done in step 2)
   - **Critical**: Items array in update request **completely replaces** existing items - must fetch existing items first, modify, then send full array
   - **Only update the selected quote** (main or variant), not all 4 quotes
   - Keep `selected_quote_id` pointing to the updated quote (or new quote ID if amended)

4. **PDF & Revision:**

   - Generate new PDF from updated quote (use `getQuotationPDF()` with updated quote ID)
   - Upload to Google Drive
   - Create new `DocumentRevision`
   - Update `last_sent_revision_id`

5. **Asana & Email:**
   - Add comment in Asana task
   - Email Finance Manager about quote update

**Variants:**

- Variants remain immutable - only the selected quote is updated
- If client wants major changes, just update the quote (still in draft on ERP)

### Step 7 — Quote Acceptance → Invoice Creation → Project Finalization

**Implementation Files:**

- `src/workers/emailIntent.js` - Handle ACCEPT intent for Quote
- `src/integrations/levitateStudiosErp.js` - Quote submission and invoice creation
- `src/workers/asanaProjectInit.js` - Asana project initialization
- `src/services/teamMemberSelectionService.js` - Team member selection logic

**Workflow:**

**A. Quote Acceptance:**

- On email intent=ACCEPT **or** manual accept from Admin UI:
  - Update document status to ACCEPTED
  - Submit quote via ERP: `submitQuotation(selected_quote_id)` (docstatus: 0 → 1)
  - Create invoice: `createSalesInvoice(selected_quote_id, invoiceData)` - link invoice to quote
  - Store invoice ID in `Document` metadata JSON: `{ invoiceId: "INV-xxx" }`
  - If detected via email intent: send **confirmation email** to Admin & Finance Manager
  - If manual accept: directly proceed to finalization

**B. Finalization:**

- Move Asana task to **"Finalized"** column in "Pending Projects" board
- Project phase: `BUDGET_TIMELINE` → `FINALIZED`
- Log phase transition in `project_phase_log`
- Enqueue `ASANA_PROJECT_INIT` job with dedupe key `project:<id>:asana_init`

**C. Asana Project Initialization (`src/workers/asanaProjectInit.js`):**

1. **Project Creation:**

   - Create Asana project with board layout
   - Create sections: "To Do", "In Progress", "In Review", "Completed"
   - Store `asana_project_gid` in `projects.asana_project_gid`
   - Store section GIDs in `asana_links.sections` JSON

2. **Team Member Selection (`src/services/teamMemberSelectionService.js`):**

   - **Algorithm** (improved from `AI-Context/Third Party Docs/asana_auto_assign_task_based_on_workload.md`):
     - Get all active team members from DB (`team_members` where `is_active=true`)
     - For each team member:
       - Get their roles and skills from `roles` JSONB field
       - Query Asana API for **incomplete tasks count across ALL projects** (not just current)
       - Use pagination if project has >1000 tasks
       - Calculate workload score (inverse: less work = higher score)
     - Analyze project requirements:
       - Extract required skills/services from questionnaire, brand origin, quote
       - Map to team roles (see `src/constants/index.js` TeamRole enum)
     - Score each team member:
       - Skill match score (0-1) - how well their roles match project needs
       - Workload score (based on incomplete tasks only)
       - Combined score = (skillMatch _ 0.7) + (workloadScore _ 0.3)
     - Select top N team members per required role
     - If multiple people for same role, prefer lead if available (`isLead: true`)
     - Handle concurrent selections with distributed locks (Redis)
   - **Improvements over original script:**
     - Query workload across all projects (not just current project)
     - Use pagination for projects with >1000 tasks
     - Handle concurrent task additions with distributed locks
     - Consider only incomplete tasks for workload calculation
     - Cache workload data with TTL to reduce API calls

3. **Add Team Members to Project:**

   - Add selected team members to Asana project (not assign tasks yet)
   - Use Asana API to add members to project
   - Store team member GIDs in project metadata

4. **Project Description:**

   - Generate comprehensive project description (exclude financials):
     - Client context (`client.context`)
     - Project requirements (from questionnaire)
     - Brand guidelines (from accepted brand origin)
     - Conversations (from email threads)
     - Any other relevant context
   - Add description to Asana project

5. **No Task Assignment:**
   - **Do NOT** create or assign tasks at this stage
   - Tasks will be created in Step 8 (future implementation)

### Step 8 — Task guidance comments

**Note:** Step 8 details to be shared later. This step will handle task creation and guidance comment generation.

### Step 9 — Completion notice

- Email Admin, Manager (if any), and PM: "Project initialized and team members have been added to the Asana project."
- Include links: Asana project, project documents
- Notify that project is ready for task assignment

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
- **Document drafting** (Brand Origin, Quote) → balanced quality/cost model; allow multi-step tool loops (web search, project/client history reading from db, previous doc create favoring accepted ones or repo lookups etc. if needed, rules and example documents would be given in context) via AI SDK **tool calling**. ([ai-sdk.dev][16])
- **Quote generation** → Use rate card from `global_configs` to map project requirements to pricing; generate structured quote items with quantities and rates; create 4 variations (main + 3 variants) via ERP API.

**Tools exposed to the agent, feel free to add if no one caters for your needs yet - but update the list here.**

- `readProjectContext(projectId)` - Gets client.context + project.context + project metadata
- `readQuestionnaireResponses(projectId)` - Gets all questionnaire responses for project with structured parsing
- `readSnapshots(documentId)` - Gets document revision history
- `readRateCard()` - Gets rate card from global_configs (key: rate_card)
- `writeDoc(type, content)` - Creates/updates documents in Google Drive + DB
- `searchOrCreateCustomer(customerName, email)` - Searches for customer by exact name, creates if not found (returns customer name/ID)
- `searchOrCreateItem(itemCode, description)` - Searches for item by exact code/name, creates if not found (returns item_code)
- `createQuotation(items, customer, ...)` - Creates quote via ERP API (returns quote ID) - requires customer and items to exist first
- `updateQuotation(quoteId, items, ...)` - Updates draft quote via ERP API - requires all items to exist first
- `getQuotation(quoteId)` - Gets quote details and verifies not cancelled
- `submitQuotation(quoteId)` - Submits quote (docstatus: 0 → 1)
- `amendQuotation(cancelledQuoteId, data)` - Creates new draft from cancelled quote (returns new quote ID in data.name)
- `createInvoice(quoteId, ...)` - Creates invoice from quote
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

- `doc-generation` - Document generation (Brand Origin, Quote)
- `quote-generation` - Quote generation via ERP API
- `email-intent` - Email intent classification and processing
- `asana-sync` - Asana webhook event processing
- `asana-project-init` - Asana project initialization and team member addition
- `notifications` - Email notifications
- `snapshot-sync` - Document snapshot synchronization

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

## 12) Levitate ERP Software integration

**Implementation File:** `src/integrations/levitateStudiosErp.js`

**API Documentation:** See `AI-Context/Third Party Docs/Levitate ERP Software API Documentation.md`

**Base Configuration:**

- Base URL: `{{base_url}}` (from environment variables)
- Authentication: Token-based `Authorization: token {api_key}:{api_secret}`
- Headers: `Content-Type: application/json`

**Key Methods:**

**Customer Management (CRITICAL - Must be done before quote creation):**

- `searchCustomers(searchTerm, limit)` - Search customers by name, email, mobile, or tax ID

  - Endpoint: `GET /api/method/levitate_integration.api.search_customers?search_term={term}&limit={limit}`
  - Returns: `{ success: boolean, data: [{ name, customer_name, email_id, mobile_no, tax_id, ... }], count: number }`
  - **Critical**: Use exact name match to find existing customer before creating quote
  - `name` field is the primary key (unique identifier for customer records)

- `getCustomer(customerName)` - Get single customer by name/ID

  - Endpoint: `GET /api/method/levitate_integration.api.get_customer?name={customerName}`
  - Returns customer details if exists

- `createCustomer(customerData)` - Create new customer

  - Endpoint: `POST /api/method/levitate_integration.api.create_customer`
  - Body: `{ customer_name: string, email?: string }`
  - Returns: `{ success: boolean, data: { name: "customer_name", ... } }`
  - **Workflow**: Search first using exact customer name, use existing if exact match found, otherwise create new

**Item Management (CRITICAL - Must be done for each item before quote creation):**

- `searchItems(searchTerm, limit)` - Search items by keyword (searches Name, Code, Description)

  - Endpoint: `GET /api/method/levitate_integration.api.search_items?search_term={term}&limit={limit}`
  - Returns: `{ success: boolean, data: [{ name, item_code, item_name, description, item_group, stock_uom, standard_rate, ... }], count: number }`
  - **Critical**: Search for exact match on `item_code` or `item_name` before creating

- `getItem(itemCode)` - Get single item by item_code

  - Endpoint: `GET /api/method/levitate_integration.api.get_item?item_code={itemCode}`
  - Returns item details if exists

- `createItem(itemData)` - Create new item

  - Endpoint: `POST /api/method/levitate_integration.api.create_item`
  - Body: `{ data: { item_code: string, description: string, stock_uom: string } }`
  - Returns: `{ success: boolean, data: { name: "item_code", ... } }`
  - **Workflow**: Search for exact match first, use existing if found, otherwise create new item

**Quotation Management:**

- `createQuotation(data)` - Create draft quote (docstatus: 0)

  - Endpoint: `POST /api/method/levitate_integration.api.create_quotation`
  - **Prerequisites**: Customer must exist (search/create first), All items must exist (search/create each item first)
  - Returns: `{ success: boolean, data: { name: "SAL-QTN-2025-00001", ... } }`
  - **Critical**: Always check `success` field, not just HTTP status code

- `getQuotation(quoteId)` - Get quote details (verify not cancelled)

  - Endpoint: `GET /api/method/levitate_integration.api.get_quotation?name={quoteId}`
  - Check for `quotation_canceled: true` in response
  - Returns latest cancelled ID if cancelled: `latest_canceled_id`
  - **Note**: Sometimes cancellation shows `success: false` but actually worked - always verify with GET

- `updateQuotation(quoteId, data)` - Update draft quote

  - Endpoint: `POST /api/method/levitate_integration.api.update_quotation`
  - **Critical**: Items array **completely replaces** existing items
  - Must fetch existing items first, modify, then send full array
  - Only works on draft quotes (docstatus: 0)
  - **Prerequisites**: All items in array must exist (search/create each item before updating)

- `submitQuotation(quoteId)` - Submit quote (docstatus: 0 → 1)

  - Endpoint: `POST /api/method/levitate_integration.api.submit_quotation`
  - Once submitted, cannot be edited

- `cancelQuotation(quoteId)` - Cancel submitted quote

  - Endpoint: `POST /api/method/levitate_integration.api.cancel_quotation?name={quoteId}`
  - **Note**: Response may show `success: false` but cancellation may have worked - always verify with GET

- `amendQuotation(quoteId, data)` - Create new draft from cancelled quote

  - Endpoint: `POST /api/method/levitate_integration.api.amend_quotation`
  - Creates new draft copy of cancelled quotation
  - Returns: `{ success: boolean, message: string, data: { name: "SAL-QTN-2025-00201", amended_from: "SAL-QTN-2025-00201-CANC-0", pdf_url: "...", party_name: "...", items: [...], ... } }`
  - **Critical**: Returns new quote ID in `data.name`, not the cancelled ID - use this new ID for subsequent operations

- `createSalesInvoice(quoteId, data)` - Create invoice from quote

  - Endpoint: `POST /api/method/levitate_integration.api.create_sales_invoice`
  - Link invoice to quote via `quotation` field

- `getQuotationPDF(quoteId)` - Download PDF binary
  - Endpoint: `GET /api/method/frappe.utils.print_format.download_pdf?doctype=Quotation&name={quoteId}&format=Standard`
  - Returns: Binary PDF data (Content-Type: application/pdf)

**Error Handling:**

- Always check `success` field in JSON response (not just HTTP status)
- Handle cancelled quotes: check `quotation_canceled` flag, use `latest_canceled_id` for amend
- **Cancellation API Quirk**: Sometimes cancellation shows `success: false` but actually worked - always verify with `getQuotation()` to confirm cancellation status
- Items array replacement: fetch → modify → send full array
- Document status: 0=Draft, 1=Submitted, 2=Cancelled
- **Amend Quote Response**: Returns new quote ID in `data.name` - always use this new ID, not the cancelled ID
- No rate limiting needed (per requirements)
- **Customer/Item Search**: Always search for exact match before creating - prevents duplicates

**Rate Card Integration:**

- Rate card stored in `global_configs` (key: `rate_card`)
- Structure: See `rateCard.json` for full schema
- Seeded via one-time script: `scripts/seed-rate-card.js` (delete after running)
- Used by LLM to map project requirements to pricing

## 13) Asana integration

- **Pending Projects** board bootstrap (if not found): create sections _Filled Questionnaire_, _Brand Origin Doc Phase_, _Quote Document Phase_, _Finalized_, _Rejected_; persist gids. ([ai-sdk.dev][12])
- **Webhooks**: create on project; complete handshake by echoing `X-Hook-Secret`; verify HMAC signatures on future events. ([developers.asana.com][4])
- **Moves & deletes**: track section changes and deletions; mirror deletes locally (edge case #13).
- **Comments (@mentions)** via **Stories API** with `html_text` containing `<a data-asana-gid="...">` to mention users (supports PM/Finance tagging). ([developers.asana.com][14])
- **Rate limits**: handle 429 with `Retry-After`, gradual concurrency; backoff in worker. ([developers.asana.com][8])
- **Team member selection**: See Step 7 for workload-based selection algorithm

---

## 14) Admin/Manager/PM UI (frontend)

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

## 15) Observability & audit

- **Structured logs** with correlation ids: `project_id`, `job_id`, `llm_trace_id`, `provider_event_id`.
- **Metrics**: job latency/success rate; Asana 429s; Brevo delivery/open; LLM token spend.
- **Audit Log**: human & system actions per project for “what changed when and why”.

---

## 16) Questionnaire & Data Flow Edge Cases

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

**ERP Integration Edge Cases:**

13. **Customer/Item not found during quote creation**:

    - **Customer**: Search first, if not found create new customer before quote creation
    - **Item**: Search for each item, if not found create new item before using in quote
    - **Validation**: Ensure all prerequisites exist before quote API call

14. **Quote cancellation verification**:

    - **Cancellation quirk**: API may return `success: false` but cancellation actually worked
    - **Solution**: Always call `getQuotation()` after cancellation to verify status
    - **Amend handling**: Use new quote ID from `data.name` in amend response, not cancelled ID

15. **Items array replacement in updates**:
    - **Critical**: Update API completely replaces items array
    - **Solution**: Fetch existing items first, modify array, send complete array
    - **Validation**: Ensure all items in array exist (search/create before update)

---

## 17) Security, auth, and integrity

- Secrets in Railway env vars; rotate regularly.
- **Inbound webhooks**

  - Asana: handshake echo `X-Hook-Secret`; verify `X-Hook-Signature` on events; reject invalid. ([developers.asana.com][9])
  - Brevo: use basic/bearer auth and optionally IP allowlist per docs. ([developers.brevo.com][19])

- **Action links**: JWT (short TTL) + single-use nonce; capture actor info; replay-safe.
- **PII**: store minimal email bodies; redact attachments unless whitelisted.

---

## 18) Error handling & retries (per integration)

- **Asana**: if 429, sleep `Retry-After` seconds; if project/section not found, attempt re-bootstrap once; for 4xx validation errors, mark job unrecoverable (stop retries). ([developers.asana.com][8])
- **Brevo**: if send error, queue retry with capped backoff; if inbound payload malformed, dead-letter and notify Admin.
- **Drive**: quota errors → backoff; export failures → retry 3x; if Doc missing, recreate from last snapshot.
- **Levitate ERP**: if quote cancelled, use `amendQuotation()` to create new draft; if update fails on submitted quote, cancel then amend; always check `success` field in response; retry with exponential backoff for network errors.

---

## 19) Testing strategy

- **Unit**: tools, schema validation, state transitions, signature verifiers.
- **Contract tests**: stub Asana/Brevo/Drive with fixed payloads (webhook handshake, move event, inbound email).
- **E2E**: golden flows (Steps 1–9), rejection paths, duplicate clicks (idempotency), race tests (PM & Finance).
- **Load**: N projects × M emails; monitor 429 handling and queue throughput.

---

## 20) Rollout & operations

- **Phased rollout**: start with one PM + one Finance; simulate inbound emails; verify Asana sync; then enable client-facing addresses.
- **Runbooks**:

  - “Asana webhook expired” → re-create & store new secret. ([developers.asana.com][9])
  - “Client reply not detected” → inspect `emails` row & LLM classification; force re-parse.
  - “Drive history lost” → restore from `document_revisions` snapshot (duplicate a new Doc from snapshot).

---

## 21) Cost controls

- Prefer **small models** for classification; reserve larger models only for longform docs; enforce token caps but don't limit quality of LLM response. ([ai-sdk.dev][2])
- Batch Asana writes when possible; respect rate limits; collapse duplicate comments. ([developers.asana.com][8])
- Snapshot **text only** (compressed) rather than storing PDFs for every revision.

---

## 22) Implementation backlog (by milestone)

**M0 – Foundations & Constants Update (1 week)**

- **CRITICAL FIRST STEP**: Update constants and enums (NO backward compatibility):
  - Update `src/constants/index.js`: Remove `DocumentType.BUDGET_TIMELINE` and `DocumentType.BUDGET_TIMELINE_VARIANT`
  - Add `DocumentType.QUOTE` and `DocumentType.QUOTE_VARIANT`
  - Update `AsanaPendingProjectsBoardSections.BUDGET_TIMELINE_PHASE` → `QUOTE_DOCUMENT_PHASE: "Quote Document Phase"`
  - Search entire codebase for hardcoded strings: `"Budget/Timeline Phase"` → `"Quote Document Phase"`
  - Search for `DocumentType.BUDGET_TIMELINE` → replace with `DocumentType.QUOTE`
  - Search for `DocumentType.BUDGET_TIMELINE_VARIANT` → replace with `DocumentType.QUOTE_VARIANT`
- Database migrations: Add quote fields to `documents` table (erp_quote_id, erp_variant_ids, selected_quote_id)
- Rate card seeding: Create and run `scripts/seed-rate-card.js` (delete after running)
- Repo scaffolding; queues/workers; health & auth; action link signing; basic Admin shell.

**M1 – Intake & Pending Board (1 week)**

- Apps Script endpoint + Brevo send; Asana pending board bootstrap & webhook; Step 1 + PM notify. ([Google for Developers][10], [docs.bullmq.io][11], [ai-sdk.dev][12], [developers.asana.com][4])
- Ensure "Quote Document Phase" section is created in Pending Projects board.

**M2 – Brand Origin loop (1.5–2 weeks)**

- Doc generator + snapshots; review/send; inbound parse + intent; regeneration loop; Asana comments. ([developers.brevo.com][3])

**M3 – ERP Integration & Quote Generation (2 weeks)**

- Create `src/integrations/levitateStudiosErp.js` with all ERP API methods
- Create `src/workers/quoteGeneration.js` - Quote generation worker
- Create `src/services/quoteService.js` - Quote business logic
- Create `src/services/quotePromptService.js` - LLM prompts for quote generation
- Update `src/workers/emailIntent.js` - Handle Brand Origin acceptance (no confirmation email, direct quote generation)
- Quote generation: main + 3 variants via ERP API
- PDF generation and Drive upload
- Quote selection tracking (selected_quote_id)
- Email templates for quote notifications
- Feedback loop: quote updates via ERP API

**M4 – Quote Acceptance & Invoice (1 week)**

- Quote submission (docstatus: 0 → 1)
- Invoice creation from quote
- Invoice ID storage in document metadata
- Finalization workflow

**M5 – Asana Project Initialization (1.5 weeks)**

- Create `src/services/teamMemberSelectionService.js` - Team member selection logic
- Update `src/workers/asanaProjectInit.js` - Implement project creation and team member addition
- Workload-based team selection (incomplete tasks only, across all projects)
- Project description generation (exclude financials)
- Add team members to project (no task assignment yet)
- Completion email notifications

**M6 – Observability & polish (1 week)**

- Logs/metrics, admin ops (replay, re-bootstrap), error dashboards.
- ERP integration error handling and monitoring

---

### Notes & constraints surfaced during design

- **Drive non-purgeable revisions for Google Docs aren't supported via `keepForever`** (binary only). We meet the "non-purgeable" requirement by **DB snapshots** + optional duplicated Docs at milestones. ([Google for Developers][15])
- **Asana @mentions** via `html_text` with `data-asana-gid` let us tag PM/Finance reliably from API comments. ([developers.asana.com][14])
- **Webhooks security** must honor provider-specific guidance (Asana secrets/signatures; Brevo auth/allowlists). ([developers.asana.com][9], [developers.brevo.com][19])
- **Constants Update (CRITICAL)**: All `DocumentType.BUDGET_TIMELINE` references must be replaced with `DocumentType.QUOTE` throughout the codebase. No backward compatibility. Search for hardcoded strings `"Budget/Timeline Phase"` and replace with `"Quote Document Phase"`. See M0 in Implementation backlog.
- **ERP API Critical Notes**: Always check `success` field in JSON response (not just HTTP status). **Customer Management**: Must search for customer by exact name before creating quote - use existing if found, otherwise create. Customer `name` field is the primary key. **Item Management**: Must search for each item by exact `item_code` or `item_name` before using in quote - use existing if found, otherwise create. All items must exist before quote creation/update. Items array in update requests completely replaces existing items - must fetch existing items first, modify, then send full array. Verify quote not cancelled before operations using `getQuotation()`. **Cancellation Quirk**: Sometimes shows `success: false` but actually worked - always verify with GET. **Amend Quote**: Returns new quote ID in `data.name` - use this new ID, not the cancelled ID.
- **Quote Selection**: Finance Manager selects ONE quote (main or variant) to send to client. Track via `selected_quote_id`. Only the selected quote is updated during feedback loops. Variants remain immutable.
- **Team Member Selection**: Query workload across ALL projects (not just current), use only incomplete tasks for workload calculation, implement pagination for projects with >1000 tasks. See Step 7 for full algorithm.
- **Rate Card**: Stored in `global_configs` (key: `rate_card`). Seeded via one-time script `scripts/seed-rate-card.js` (delete after running). Used by LLM to map project requirements to pricing with fuzzy matching.
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
