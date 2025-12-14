# AI Agent UI – Design Specification (Lovable)

## 1. Executive Summary

- Purpose: Single admin/ops UI to run the Levitate AI Agent pipeline end-to-end: questionnaire intake → brand origin → quote → Asana project init → workplan, with manual overrides, monitoring, and auditability.
- Value: Centralized control, real-time visibility, safe overrides, and audited actions across docs, Asana, ERP, Brevo, and Drive.
- Target users: Admin, Project Manager (PM), Finance Manager, Creative Director / Art Director, Manager, Specialists (design/marketing roles), Read-only viewers (optional), Client-facing public form users.
- Core workflows: Intake (questionnaire upload/form), document review/send/accept/reject/regenerate, quote selection/send, project phase advancement, workplan regen, ops monitoring, permission admin, audit review.
- Differentiators: Role-scoped UI with “Act as role” switch, live job feed, full audit trail, document snapshots/revisions, quote variant selection, workplan slide-level regeneration, inline rate card editor.

## 2. User Roles & Permissions Matrix

Roles (from `TeamRole`): ADMIN, PROJECT_MANAGER, FINANCE_MANAGER, MANAGER, CREATIVE_DIRECTOR, ART_DIRECTOR, DIGITAL_MARKETER, MOTION_GRAPHICS_DESIGNER, WEB_DESIGNER, GRAPHICS_DESIGNER, UI_DESIGNER, COPY_WRITER, HR_MANAGER, CLIENT_SERVICE (others map to read/limited actions).

Default permissions (admin can override per user/role):

- Admin: Full access; manage users/roles/passwords; view all audit logs; edit rate card/global configs; force phase transitions; clean/retry jobs; merge clients.
- Project Manager: View all projects/docs/emails; send/recreate/accept brand origin; advance to quote; log manual emails; view queues read-only; cannot change permissions.
- Finance Manager: View quotes/variants; select & send quote; accept quote; view invoices metadata; cannot edit rate card by default (admin can enable).
- Creative Director / Art Director: View projects/workplan; trigger workplan regen; view design directives; add feedback; no permissions to send quotes.
- Manager: Read-most, can advance phases when enabled; cannot change permissions.
- Specialists (design/marketing roles): View assigned projects/workplans; download/view docs; cannot send/accept/regenerate unless enabled.
- HR Manager: View team roster; cannot alter projects unless enabled.
- Client Service: View email threads; log manual emails; read-only docs unless enabled.

Permission rules:

- Multi-role users: Aggregate union of permissions; UI shows “Act as [role]” switch to constrain visible actions to selected role (default = highest-privilege role available). Actions executed under the selected role for audit.
- Protected removals: Cannot remove the last Admin, Finance Manager, Project Manager, or Creative Director. Others can be removed even if last of role.
- Overrides: Admin can toggle any permission per user; defaults are templates.
- Audit: Every action stored with actor, selected role, timestamp, payload summary.

## 3. Authentication & Authorization

- Login: JWT-based. Admin signup gated by ENV admin email + email verification code. Team members: password set/reset by Admin.
- Session: Store JWT in httpOnly secure cookie or Authorization Bearer; include user id, roles array.
- Role selection: After login, user picks active role from allowed roles. Persist in local storage; include as `x-acting-role` header for audit tagging.
- Permission check: Frontend guards per route/component + backend RBAC via JWT roles; block buttons when unauthorized; show reason.
- Password management: Admin sets/resets; enforce complexity; force reset on first login for non-admins.

## 4. Screen Specifications

### Dashboard

- Goals: Quick health + workload + pipeline status; jump to projects needing action.
- Metrics (cards): Forms submitted (questionnaire responses count), Brand origins created, Quotes created, Workplans generated, Pending internal approvals (doc status in PM_REVIEW/FINANCE_MANAGER_REVIEW), Active jobs, Incubated/initialized Asana projects, Rejected projects.
- Active projects table: Columns: Client, Project, Phase (`QUESTIONNAIRE/BRAND_ORIGIN/QUOTE_DOCUMENT/ASANA_INIT/WORKPLAN_GENERATION/FINALIZED/REJECTED`), Last action, Responsible role, Pending action, Asana section, Errors badge, Updated at. Filters: phase, role, error, assigned PM/Finance, text search.
- Live processing feed: Current queue items (from /status + job_runs): job name, project, stage, progress (if available), started at, attempts, status.
- Error badges: Any failed jobs or processing_status=FAILED; link to detail.
- Quick actions: Create/search project, Open queues monitor, View dead-letter (failed jobs), Manual reprocess questionnaire, Manual advance phase, Refresh data.
- Real-time: Poll /status (queueMonitor) every 10–15s or SSE if added; refresh project/job snapshots every 30–60s with backoff.

### Project Detail

- Goals: Single view of project health, docs, emails, history, Asana linkage.
- Header: Project name, client, phase, created/updated, Asana links (pending board section + final project board).
- Phase controls (role-gated): Advance phase, Reject project, Reopen? (if allowed).
- Documents panel: List by type (Brand Origin, Quote, Workplan). Show status, last sent revision, drive link/PDF link, actions: View, Send to Client, Accept, Reject, Regenerate (with notes), Download PDF (if available), Variant selector (quote).
- Revision history: Timeline of `document_revisions` with snapshotText/markdown render; show diff vs previous (text diff); show createdBy & createdAt.
- Email threads: List threads + emails (direction, subject, intent, confidence, metadata); render html/text; show intent metadata. Action: log manual email (cannot delete system-logged).
- Audit timeline: From `audit_log` + `project_phase_log`; filter by actor/action; show timestamps and payload summary.
- Asana: Pending board section, finalized project link, task list (basic), members added.
- Workplan slides (if applicable): Slide list with research/content/design statuses; per-slide regen; view research sources, content copy, design directives.
- Status updates: Poll project details; optionally subscribe to job events (poll job_runs).

### Document Viewer

- Goals: Deep view of a document + actions.
- Metadata: Type, status, driveFileId link, lastSentRevisionId, currentRevisionId, created/updated, selected_quote_id (for quotes), erp ids.
- Content: Snapshot text/markdown render; if snapshot_md json exists, render structured; link to live Google Doc/PDF.
- Revisions: List revisions with creator, summary, createdAt; diff view (text).
- Actions (role-gated by type/status):
  - Send to Client (opens action link; for quotes allow variant selection/main id)
  - Accept / Reject
  - Regenerate (Brand Origin, Quote, Workplan) with feedback textarea
  - End project → move to Rejected
- Related: Quote variants list; previous accepted versions.

### Context Editor

- Goals: Edit client/project context stored as markdown text.
- Editor: WYSIWYG + markdown source toggle; autosave draft; Save/Cancel; Preview markdown.
- Scope tabs: Client context, Project context. Show last updated and actor.
- Validation: Max length (e.g., 50k chars), required text, sanitize HTML.

### Ops / Monitoring

- Goals: Operational visibility into queues/webhooks/providers.
- Queues: From `/status` (queueMonitor) and/or Bull Board link; show waiting/active/completed/failed/delayed per queue.
- Dead-letter/failures: List failed jobs with error, attempts, createdAt; actions: retry, clean (admin).
- Webhooks health: Last event time per provider (asana/brevo/apps-script); status from DB if available; manual re-verify buttons.
- Provider quota: Display known rate-limit/backoff info; surfaced errors.
- Logs: Link to audit logs filtered to errors.

### Client Management

- Goals: Manage clients and their projects.
- Client list: Name, email, status, project count, last activity. Filters/search.
- Detail: Client info, context editor, projects list with phases, questionnaire responses, email threads.
- Actions: Add/edit context, Merge clients (select target + source), view stats (forms, docs, accepted docs).

### Permission Management (Admin)

- Team list: Name, email, roles (multi), isLead flag per role, active status, createdAt.
- Actions: Invite/create member (assign roles, set password), reset password, deactivate, remove (respect protected roles), set lead per role, set default role order.
- Permission matrix: Per role toggle for features (view/edit per screen/action). Save as role template; per-user overrides.
- “Act as role” preview mode (admin-only) to see UI as role.

### Quote Management UI

- Show main quote + 3 variants with IDs, status, drive links/PDF download.
- Variant selector (radio) and “Send to Client” button; for quotes already sent show lastSentRevision.
- ERP metadata: erp_quote_id, erp_variant_ids, invoiceId if present.
- Actions: Regenerate selected quote (feedback), Accept quote, Submit quote (if not submitted), View invoice link if available.

### Workplan Management UI

- Workplan doc header: status (DRAFT/RESEARCHING/GENERATING/COMPLETED/FAILED), drive link.
- Slides table: slideNumber, slideType, titles, researchStatus/contentStatus/designStatus, last updated.
- Slide detail: research sources, content copy, design directives (layout, colors, typography, placements, visual elements).
- Actions: Regenerate slide (reason), Full regeneration (reason), Download/open doc, View research sources list.

### Questionnaire Submission UI (Public)

- Modes: Native form entry.
- Fields: Client name/email, project name/description, required questionnaire fields per current form schema.
- Questions:

```json
{
  "Email": "string response",
  "What is your company name?": "string response",
  "Provide your company's social media handles": "string response",
  "Briefly describe your company's mission and core values": "string response",
  "Which industry does your business belong to?": [
    "Technology",
    "Healthcare",
    "Finance",
    "Retail",
    "Education",
    "Logistics & Shipping",
    "Other"
  ],
  "What do you want this project to be called?": "string response",
  "Which of our services are you interested in? (Select all that apply)": [
    "Marketing campaign",
    "Go-To-Market strategy",
    "Social media strategy",
    "Brand design",
    "Advertising"
  ],
  "More details of the selected service - be descriptive about what you want us to achieve for your brand/company and the purpose": "string response",
  "Do you have an existing brand guideline to follow (colours, typography, styles)?": [
    "Yes",
    "No"
  ],
  "If yes to the above question. Please state it below": "string response",
  "What are the key services or products you offer?": "string response",
  "Expected timeline for completion": "string response",
  "Who is your primary audience (demographics, psychographics)?": "string response",
  "Who are your main competitors, and how do you differentiate yourself from them?": "string response",
  "What style do you prefer?": [
    "Modern",
    "Classic",
    "Minimalist",
    "Bold",
    "Other"
  ],
  "Do you have any inspiration or references you admire? (Please insert brand name below)": "string response",
  "Is there anything else you would like us to know before we begin?": "string response"
}
```

- Validation: Required core fields; email format; size limits; show errors inline.
- Submission: POST to forms webhook; success screen with reference id.

## 5. API Endpoints Reference

Response envelope: `{ error: boolean, statusCode: number, message: string, data: T | null}` (sendSuccessResponse/sendErrorResponse). Error: HTTP status with message.
error - true if an error occured and request wasnt successful and false if it was successful
message: human readble message
statusCode: http status code
data: T generic of response in successs response and can be null for errro responses.

Webhooks (public):

- POST `/webhooks/brevo/inbound` – inbound email parse.
- POST `/webhooks/asana` – Asana events (signature-verified).
- POST `/webhooks/apps-script/forms` – Google Forms submissions.

Actions (JWT action token):

- GET `/actions/send-to-client?t=...&quoteId?=` – send doc (brand origin or quote; optional quote variant id).
- POST `/actions/confirm-accepted` (in actions router; confirm accepted) – use token; advances flow.
- GET `/actions/review` (if present) – open review link.
- POST `/actions/confirm-rejection` (if present) – confirm rejection.

Internal:

- GET `/admin/projects` – list projects (placeholder returns empty; extend to real data amd refactor to arrange where all UI apis would be structured).
- POST `/admin/project/:id/accept-doc` – manual accept document. (placeholder returns empty; extend to real data amd refactor to arrange where all UI apis would be structured).
- POST `/workplan/:documentId/slide/:slideId/regenerate` – slide regen `{reason?}`.
- POST `/workplan/:documentId/regenerate` – full workplan regen `{reason?}`.
- POST `/forms` (or `/webhooks/apps-script/forms`) – questionnaire submission.
- Health: GET `/healthz`, `/readyz`.
- Tests: GET `/tests/google-apis`.
- Queue monitor (separate port): GET `/status`, UI at `/admin/queues`.

Auth:

- JWT creation/verification via `auth.js`; Bearer token required for protected routes.

Suggested (UI-facing thin wrappers if needed, reusing services; no new heavy services): list projects, list documents, job_runs search, audit logs search, rate card get/update (from global_configs), team members CRUD, permissions templates. Keep within existing services; add arguments only.

## 6. Data Models & Schemas (TypeScript shapes aligned to Prisma)

```ts
type ProjectPhase =
  | "QUESTIONNAIRE"
  | "BRAND_ORIGIN"
  | "QUOTE_DOCUMENT"
  | "ASANA_INIT"
  | "WORKPLAN_GENERATION"
  | "FINALIZED"
  | "REJECTED";
type DocumentType = "BRAND_ORIGIN" | "QUOTE" | "QUOTE_VARIANT" | "WORKPLAN";
type DocumentStatus =
  | "DRAFT"
  | "PM_REVIEW"
  | "FINANCE_MANAGER_REVIEW"
  | "SENT_TO_CLIENT"
  | "CLIENT_FEEDBACK"
  | "ACCEPTED"
  | "REJECTED"
  | "RESEARCHING"
  | "GENERATING"
  | "COMPLETED"
  | "FAILED";

interface Client {
  id: number;
  name: string;
  primaryEmail: string;
  status: string;
  context?: string;
  createdAt: string;
  updatedAt: string;
}
interface Project {
  id: number;
  clientId: number;
  name: string;
  phase: ProjectPhase;
  asanaProjectGid?: string;
  context?: string;
  serviceTypes?: any;
  createdAt: string;
  updatedAt: string;
}
interface Document {
  id: number;
  projectId: number;
  type: DocumentType;
  status: DocumentStatus;
  driveFileId?: string;
  currentRevisionId?: number;
  lastSentRevisionId?: number;
  erpQuoteId?: string;
  erpVariantIds?: any;
  selectedQuoteId?: string;
  metadataInfo?: any;
  createdAt: string;
  updatedAt: string;
}
interface DocumentRevision {
  id: number;
  documentId: number;
  driveRevisionId?: string;
  snapshotText: string;
  snapshotMd?: any;
  createdBy: "AGENT" | "PM" | "FINANCE" | "CLIENT";
  summary?: string;
  createdAt: string;
}
interface WorkplanSlide {
  id: number;
  documentId: number;
  slideNumber: number;
  slideType: string;
  title: string;
  researchData?: any;
  contentCopy?: string;
  dataPoints?: any;
  designDirectives?: any;
  layoutType?: string;
  visualElements?: any;
  researchStatus: string;
  contentStatus: string;
  designStatus: string;
  qualityScore?: string;
  metadataInfo?: any;
  requiresBigIdea: boolean;
  isOptional: boolean;
  createdAt: string;
  updatedAt: string;
}
interface EmailThread {
  id: number;
  projectId: number;
  clientId: number;
  replyToAddress: string;
  providerThreadId?: string;
  createdAt: string;
}
interface Email {
  id: number;
  threadId: number;
  direction: "INBOUND" | "OUTBOUND";
  fromAddr: string;
  toAddr: string;
  subject: string;
  rawHeaders: any;
  textBody?: string;
  htmlBody?: string;
  attachmentsMeta?: any;
  brevoEventId?: string;
  receivedAt: string;
  intent?: string;
  intentConfidence?: string;
  intentMetadata?: any;
  llmTraceId?: string;
  processed: boolean;
}
interface AsanaLink {
  id: number;
  projectId: number;
  pendingBoardGid?: string;
  finalizedBoardGid?: string;
  sections: any;
  pmGid?: string;
  financeGid?: string;
  createdAt: string;
}
interface AsanaTask {
  id: number;
  projectId: number;
  taskGid: string;
  sectionName: string;
  assigneeGid?: string;
  dueOn?: string;
  meta: any;
  createdAt: string;
}
interface TeamMember {
  id: number;
  name: string;
  email: string;
  asanaUserGid: string;
  roles: any;
  isActive: boolean;
  createdAt: string;
}
interface JobRun {
  id: number;
  name: string;
  args: any;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  dedupeKey?: string;
  attempts: number;
  lastError?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}
interface QuestionnaireResponse {
  id: number;
  projectId: number;
  formId: string;
  responseId: string;
  responses: any;
  respondentEmail?: string;
  submittedAt: string;
  processedAt?: string;
  processingStatus: string;
  errorMessage?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}
interface AuditLog {
  id: number;
  projectId?: number;
  actor: string;
  action: string;
  details: any;
  at: string;
}
interface GlobalConfig {
  id: number;
  key: string;
  value: any;
  description?: string;
  updatedAt: string;
  createdAt: string;
}
```

## 7. User Flows

1.  PM reviews & sends brand origin:

- Entry: Project in BRAND_ORIGIN; doc status PM_REVIEW.
- Steps: Open Project → open doc → review snapshot/live doc → click Send to Client → select action token flow → job enqueued (doc send) → status SENT_TO_CLIENT → audit log.
- API: GET project/docs, GET revisions, GET /actions/send-to-client link (from backend), trigger via action token.
- Errors: Show send failure; allow retry; keep audit.

2.  Finance selects quote variant & sends:

- Entry: Quote document exists (draft), status FINANCE_MANAGER_REVIEW.
- Steps: Open Quote UI → view main/variants → pick variant or main → click Send to Client → action token processes send; status SENT_TO_CLIENT; audit.
- API: Same send-to-client with quoteId param.

3.  manually accepts document:

- Steps: Project detail → document → Accept → POST `< api to be decided>` with doc id/status; update phase if applicable; audit.

4.  regenerates workplan with feedback:

- Steps: Workplan view → add reason → POST `/workplan/:documentId/regenerate`; job queued; statuses reset to DRAFT/PENDING; monitor job_runs/queues; audit.

5.  Creative Director reviews workplan slides:

- Steps: Project detail → Workplan tab → view slides with statuses, research sources, directives → optional per-slide regen with reason (POST slide regen).

6.  Admin manages permissions:

- Steps: Permission screen → edit role template toggles → per-user overrides → save; updates stored in backend (extend team member model/claims).

7.  Client submits questionnaire:

- Steps: Public form/upload → validate → POST `< api to be decided>` (or forms route) → immediate success message; async processing creates project/task.

8.  advances project phase manually:

- Steps: Project detail → Phase control → select next phase → confirm → backend transition + audit + Asana section move if needed.

9.  views audit logs:

- Steps: Audit screen → filters (project, action, actor, date) → paginate; click row to expand details.

10. Team member switches roles:

- Steps: Role switcher → select role → UI re-evaluates permissions; store selection; future actions tagged with selected role.

11. Admin edits rate card:

- Steps: Ops/Config → load `rate_card` global config → JSON editor with validation → save → audit.

12. Manual email logging:

- Steps: Project detail → Email thread → “Log email” → choose inbound/outbound, to/from, subject, body, timestamp, attachments meta → save; flagged as manual; system-logged emails read-only.

## 8. Real-time Features

- Job status: Poll queue monitor `/status` every 10–15s; optionally poll `job_runs` (filter by project) every 20–30s; exponential backoff on errors.
- Live processing feed: Merge active queue items + latest job_runs.
- Progress: Show attempts/remaining; mark completed/failed; provide retry (admin) button that calls backend retry/clean endpoints (extend QueueService thin routes).
- Connection handling: On failures, show banner and slow polling; SSE/WebSocket optional future enhancement—design UI to swap transport without UX change.

## 9. Design System

- Theme: shadcn “slate” palette; support light/dark; no gradients.
- Icons: `lucide-react`; use `Loader2` for button spinners.
- Loading: `react-loading-skeleton` for full page, sections of page , list/table cards etc.; button-level spinners.
- Layout: Responsive breakpoints (sm, md, lg, xl); cards + tables; sticky headers for detail views.
- States: Empty (descriptive, with CTA), Error (message + retry), Success toasts, Disabled buttons when unauthorized or in-flight.

## 10. Edge Cases & Error Handling

- Job failures: Surface error + retry; link to audit/stack snippet.
- Partial data: If revisions missing, show warning and live doc link.
- Network/API errors: Show toast + inline; retry/backoff; keep user inputs.
- Permission denial: Hide or disable with tooltip; log attempted restricted action (optional).
- Permission should also be enforced on backend apis for security.
- Document not found: 404 page with back link.
- Phase transition errors: Show reason, keep prior state, log audit.
- Offline: Basic offline notice; queue UI refresh when online.
- Token depletion (LLM): Show banner + “Retry when replenished” button (queues regeneration job).

## 11. Special Features & Complex Interactions

- Multi-role handling: Role switcher in top bar; acting role sent in header; UI filters actions to acting role.
- Document regeneration: Buttons in doc/workplan screens; modal for feedback; enqueue job; show pending state and link to queue/job log.
- Rate card editor: JSON editor with schema check (sections/items); show diff before save; confirm modal.
  Current rate card structure is :

```json
{
  "metadata": {
    "agency_name": "...",
    "country_region": "...",
    "document_title": "..."
  },
  "sections": [
    {
      "category": "...",
      "items": [
        { "item": "...", "price": ... }
      ]
    }
    // more sections...
  ],
  "terms_and_conditions": [
    "..."
  ]
}

```

- Manual email logging: Form with direction, to/from, subject, body, sent/received time, attachments meta; mark immutable for system-logged emails.
- Audit log viewing: Table with filters; expandable rows showing details JSON; show actor + acting role.
- Manual project advancement: Dropdown to allowed next phases; confirm; audit.

## 12. Technical Requirements

- Auth: JWT (Bearer) with roles array; action tokens for email links (short TTL).
- API base: `/api` (backend express); queue monitor on separate port (3567 by default).
- CORS: Allow UI origin; send credentials if cookies used.
- File upload: Use form-data for questionnaire uploads; enforce size/type.
- Real-time: Polling by default; optional SSE later.
- Logging/monitoring: Use backend structured logs; surface key errors in UI.
- Performance: Paginate tables; lazy-load revisions; cache project lists; debounce filters.

## 13. Accessibility & UX

- Keyboard: Tab order, focus rings, ESC to close modals, Enter to submit forms.
- Screen readers: aria-labels on buttons/inputs; announce toasts.
- Contrast: Meet WCAG AA; slate palette tuned for both themes.
- Loading/error messaging: Clear, actionable text; preserve context.
- Confirm destructive: Reject project/doc, remove user, merge clients require confirm modal.

## 14. Implementation Notes for Lovable

- Components: Reusable cards/tables/forms/modals; role-guard wrappers; markdown editor component; JSON editor for rate card.
- State: Use global store for user + roles + actingRole; SWR/React Query for polling endpoints with stale-while-revalidate.
- API integration: Central client with auth header; helpers for success/error envelope; retry with backoff for GET polling.
- Knowledge files: Include constants (DocumentType, Status, Phases), rateCard structure, endpoint list, permission matrix defaults.
- Real-time patterns: Poll queues `/status` + job_runs; abstract to data hooks so transport can switch to SSE later without UI change.

---

Checklist alignment:

- All screens covered; roles/permissions defined; endpoints listed; data models mapped; flows documented; real-time + edge cases handled; design system specified; technical + accessibility + implementation notes included.
