# Quote Generation & Asana Project Initialization - Task List

## Confirmation: What's Already Built ✅

Based on codebase analysis, the following are **CONFIRMED COMPLETE**:

1. ✅ **Brand Origin Document Generation** (`src/workers/documentGeneration.js`)

   - Context assembly from questionnaire, client, project
   - LLM workflow (plan → compose → self-check)
   - Google Drive document creation
   - Database record creation
   - Asana task movement to "Brand Origin Doc Phase"
   - PM notification email with Review/Send buttons

2. ✅ **Brand Origin Document Regeneration** (`src/workers/emailIntent.js`)

   - Feedback detection from client emails
   - Document regeneration with feedback context
   - Update existing document records
   - Asana comments and notifications

3. ✅ **Document Sending to Client** (`src/services/documentSendingService.js`)

   - PDF conversion from Google Docs
   - Email sending via Brevo
   - Database status updates
   - Email thread management

4. ✅ **Email Intent Detection** (`src/workers/emailIntent.js`)
   - Intent classification (ACCEPT, DOC_FEEDBACK, REJECT, etc.)
   - Document type analysis
   - Client feedback extraction

---

## Phase 1: Constants & Database Migrations (CRITICAL - DO FIRST)

### 1.1 Update Constants (`src/constants/index.js`)

- [ ] Remove `DocumentType.BUDGET_TIMELINE`
- [ ] Remove `DocumentType.BUDGET_TIMELINE_VARIANT`
- [ ] Add `DocumentType.QUOTE = "QUOTE"`
- [ ] Add `DocumentType.QUOTE_VARIANT = "QUOTE_VARIANT"`
- [ ] Update `AsanaPendingProjectsBoardSections.BUDGET_TIMELINE_PHASE` → `QUOTE_DOCUMENT_PHASE: "Quote Document Phase"`
- [ ] Add new audit actions for quotes:
  - `QUOTE_CREATED`
  - `QUOTE_REGENERATED`
  - `QUOTE_ACCEPTED`
  - `INVOICE_CREATED`
- [ ] Add new system actors:
  - `QUOTE_GENERATOR: "SYSTEM (Quote Generator)"`

### 1.2 Search & Replace All Code References (NO Backward Compatibility)

- [ ] Search entire codebase for `DocumentType.BUDGET_TIMELINE` → replace with `DocumentType.QUOTE`
- [ ] Search entire codebase for `DocumentType.BUDGET_TIMELINE_VARIANT` → replace with `DocumentType.QUOTE_VARIANT`
- [ ] Search for hardcoded `"Budget/Timeline Phase"` → replace with `"Quote Document Phase"`
- [ ] Search for `BUDGET_TIMELINE_PHASE` → replace with `QUOTE_DOCUMENT_PHASE`
- [ ] Search for `"Budget/Timeline"` (title case) → replace with `"Quote Document"` or `"Quote"` as appropriate
- [ ] Search for `budget_timeline` (lowercase) → replace with `quote`
- [ ] Update all files that import/use these constants

**Files to check:**

- `src/workers/emailIntent.js` (has TODO comment and BUDGET_TIMELINE references)
- `src/services/intentPromptService.js`
- `src/services/emailTemplateService.js`
- `src/routes/actions.js`
- Any other files using DocumentType

### 1.3 Database Migration (`prisma/schema.prisma`)

- [ ] Update `Document` model:
  - Change `type` enum comment: `// BRAND_ORIGIN, QUOTE, QUOTE_VARIANT`
  - Add `erpQuoteId String? @map("erp_quote_id")` - Main quote ID from ERP
  - Add `erpVariantIds Json? @map("erp_variant_ids") @db.JsonB` - JSON array of 3 variant quote IDs
  - Add `selectedQuoteId String? @map("selected_quote_id")` - Which quote ID was sent to client
  - Remove `isVariant Boolean` (no longer needed, use type instead)
  - Remove `variantIndex Int?` (no longer needed)
  - Note: `invoiceId` will be stored in metadata JSON, not as separate field
- [ ] Create migration: `npx prisma migrate dev --name add_quote_fields_to_documents`
- [ ] Verify migration applied correctly

### 1.4 Rate Card Seeding (`scripts/seed-rate-card.js`)

- [ ] Create one-time seeding script
- [ ] Read `rateCard.json` file
- [ ] Insert/update `global_configs` table:
  - Key: `rate_card`
  - Value: JSON from `rateCard.json`
  - Description: "Studio rate card for quote generation"
- [ ] Add error handling and validation
- [ ] Run script: `node scripts/seed-rate-card.js`
- [ ] Verify data in database
- [ ] **DELETE script after successful run** (as per requirements)

---

## Phase 2: ERP Integration Service

### 2.1 Create ERP Integration Service (`src/integrations/levitateStudiosErp.js`)

- [ ] Create new file with class `LevitateStudiosErpIntegration`
- [ ] Add constructor with base URL, API key, API secret from env vars
- [ ] Implement `createQuotation(data)`:
  - Endpoint: `POST /api/method/levitate_integration.api.create_quotation`
  - Validate `success` field in response
  - Return quote ID and full response
  - Error handling for API failures
- [ ] Implement `getQuotation(quoteId)`:
  - Endpoint: `GET /api/method/levitate_integration.api.get_quotation?name={quoteId}`
  - Check for `quotation_canceled` flag
  - Return quote data or cancelled info
- [ ] Implement `updateQuotation(quoteId, data)`:
  - Endpoint: `POST /api/method/levitate_integration.api.update_quotation`
  - **Critical**: Items array completely replaces existing - must fetch first, modify, send full array
  - Only works on draft quotes (docstatus: 0)
- [ ] Implement `submitQuotation(quoteId)`:
  - Endpoint: `POST /api/method/levitate_integration.api.submit_quotation`
  - Changes docstatus: 0 → 1
- [ ] Implement `cancelQuotation(quoteId)`:
  - Endpoint: `POST /api/method/levitate_integration.api.cancel_quotation?name={quoteId}`
- [ ] Implement `amendQuotation(quoteId, data)`:
  - Endpoint: `POST /api/method/levitate_integration.api.amend_quotation`
  - Creates new draft from cancelled quote
- [ ] Implement `createSalesInvoice(quoteId, data)`:
  - Endpoint: `POST /api/method/levitate_integration.api.create_sales_invoice`
  - Link invoice to quote via `quotation` field
  - Return invoice ID
- [ ] Implement `getQuotationPDF(quoteId)`:
  - Endpoint: `GET /api/method/frappe.utils.print_format.download_pdf?doctype=Quotation&name={quoteId}&format=test`
  - Handle binary PDF response
  - Return PDF buffer
- [ ] Add comprehensive error handling:
  - Check `success` field in all responses
  - Handle cancelled quotes
  - Handle network errors with retry logic
  - Log all API calls
- [ ] Add request/response logging
- [ ] Export integration instance

### 2.2 Environment Variables

- [ ] Add to `.env.example`:
  - `LEVITATE_ERP_BASE_URL`
  - `LEVITATE_ERP_API_KEY`
  - `LEVITATE_ERP_API_SECRET`
- [ ] Update config file to include ERP settings
- [ ] Document in README or env.example

---

## Phase 3: Quote Generation Services

### 3.1 Quote Prompt Service (`src/services/quotePromptService.js`)

- [ ] Create new file with class `QuotePromptService`
- [ ] Implement `generateLLMContext(project, questionnaire, brandOrigin, rateCard)`:
  - Assemble context from questionnaire responses
  - Include client context and project context
  - Include accepted brand origin document
  - Include rate card from global_configs
  - Include quote generation rules/examples (from context)
- [ ] Implement `generateSystemPrompt(context)`:
  - Role definition for quote generation
  - Rate card usage guidelines
  - Service mapping instructions
  - Pricing calculation rules
- [ ] Implement `generateQuotePrompt(context)`:
  - Project requirements analysis
  - Service identification
  - Rate card item mapping (fuzzy matching)
  - Quantity and rate calculation
- [ ] Implement `generateQuoteItemsSchema()`:
  - Zod schema for structured quote items output
  - Fields: item_code, qty, rate, description
  - Validation rules
- [ ] Implement `generateValidationPrompt(quoteItems, context)`:
  - Self-check prompt for generated quote
  - Validate against rate card
  - Check completeness
- [ ] Add methods for variant generation:
  - `generateVariantPrompt(baseQuote, variantIndex, context)`
  - Different pricing/scope strategies per variant

### 3.2 Quote Service (`src/services/quoteService.js`)

- [ ] Create new file with class `QuoteService`
- [ ] Implement `assembleQuoteContext(projectId)`:
  - Get project, client, questionnaire responses
  - Get accepted brand origin document
  - Get rate card from global_configs
  - Return structured context object
- [ ] Implement `mapServicesToRateCard(requirements, rateCard)`:
  - Fuzzy matching algorithm
  - Handle "TBD" prices gracefully
  - Map project services to rate card items
- [ ] Implement `generateQuoteItemsWithLLM(context)`:
  - Use QuotePromptService to generate items
  - Call LLM with structured schema
  - Validate output
  - Return quote items array
- [ ] Implement `createQuotesViaERP(quoteItems, customer, project)`:
  - Create main quote via ERP API
  - Create 3 variant quotes with different strategies
  - All in DRAFT (docstatus: 0)
  - Return array of quote IDs
- [ ] Implement `downloadQuotePDFs(quoteIds)`:
  - Download PDFs for all 4 quotes
  - Return array of PDF buffers with metadata
- [ ] Implement `uploadQuotePDFsToDrive(pdfs, project)`:
  - Upload main quote PDF to Google Drive
  - and upload variant PDFs
  - Return Drive file IDs
- [ ] Add error handling and logging

---

## Phase 4: Quote Generation Worker

### 4.1 Create Quote Generation Worker (`src/workers/quoteGeneration.js`)

- [ ] Create new file with `quoteGenerationProcessor` function
- [ ] Implement main processor:
  - Extract job data (projectId, dedupeKey, correlationId)
  - Assemble context using QuoteService
  - Generate quote items using LLM
  - Create 4 quotes via ERP API
  - Download PDFs
  - Upload to Google Drive
  - Create Document record with quote IDs
  - Create DocumentRevision
  - Update Asana task
  - Send email notifications
  - Update project phase
- [ ] Implement error handling:
  - Retry logic for ERP API failures
  - Partial success handling
  - Audit logging
- [ ] Add comprehensive logging
- [ ] Export processor for queue registration

### 4.2 Update Queue Service (`src/queues/index.js`)

- [ ] Add `quote-generation` queue if not exists
- [ ] Implement `addQuoteGenerationJob(data, priority)`:
  - Dedupe key: `project:<id>:quote:generate`
  - Add to `quote-generation` queue
  - Return job object
- [ ] Register worker processor in queue setup

### 4.3 Update Email Intent Handler (`src/workers/emailIntent.js`)

- [ ] Update `handleAcceptIntent()` function:
  - Check if document type is `DocumentType.BRAND_ORIGIN`
  - If Brand Origin accepted:
    - Update document status to ACCEPTED
    - **NO confirmation email** - directly enqueue quote generation
    - Dedupe key: `project:<id>:quote:generate`
    - Update project phase: BRAND_ORIGIN → QUOTE_DOCUMENT
    - Move Asana task to "Quote Document Phase"
    - Log phase transition
  - If Quote accepted (for Step 7):
    - Handle quote acceptance (see Phase 7)
- [ ] Remove TODO comment about Budget/Timeline
- [ ] Add quote acceptance handling logic

---

## Phase 5: Quote Selection & Sending

### 5.1 Quote Selection Endpoint (`src/routes/actions.js`)

- [ ] Add new endpoint `POST /actions/select-quote`:
  - Authenticate action token
  - Extract: documentId, selectedQuoteId (main or variant), userId
  - Update `Document.selected_quote_id`
  - Create audit log
  - Return success
- [ ] Update `POST /actions/send-to-client`:
  - Check if document type is QUOTE
  - If quote, require `selected_quote_id` to be set
  - Use selected quote PDF for sending
  - Update `last_sent_revision_id` with selected quote info

### 5.2 Quote Email Templates (`src/services/emailTemplateService.js`)

- [ ] Add `generateQuoteNotificationTemplate()`:
  - For Finance Manager & Admin
  - Include View button (Drive link to main quote)
  - Include Send to Client button (with quote selection)
  - Include Manage button (UI link)
  - List all 4 quote variants with IDs/links
  - Instructions for selecting which quote to send
- [ ] Add `generateQuoteSelectionTemplate()`:
  - UI for selecting which quote to send
  - Show all 4 variants with previews/links
  - Selection interface
- [ ] Update existing templates to handle QUOTE document type

### 5.3 Update Document Sending Service (`src/services/documentSendingService.js`)

- [ ] Update `sendDocumentToClient()`:
  - Check if document type is QUOTE
  - If quote, verify `selected_quote_id` is set
  - Use selected quote PDF (download from ERP if needed)
  - Upload to Drive if not already uploaded
  - Send email with selected quote PDF
  - Update `last_sent_revision_id` with quote info

---

## Phase 6: Quote Feedback Loop

### 6.1 Quote Update Logic (`src/workers/quoteGeneration.js`)

- [ ] Add `updateQuoteProcessor` function:
  - Extract feedback context
  - Get selected quote ID from document
  - Verify quote not cancelled (call `getQuotation()`)
  - If cancelled: use `amendQuotation()` to create new draft
  - If draft: fetch existing items, modify based on feedback, update quote
  - Generate new PDF
  - Upload to Drive
  - Create new DocumentRevision
  - Update `last_sent_revision_id`
  - Keep `selected_quote_id` pointing to updated quote
- [ ] Add error handling for cancelled quotes
- [ ] Add logging for quote updates

### 6.2 Update Email Intent Handler for Quote Feedback (`src/workers/emailIntent.js`)

- [ ] Update `handleDocFeedbackIntent()`:
  - Check if document type is `DocumentType.QUOTE`
  - If quote feedback:
    - Use `selected_quote_id` to know which quote client is referring to
    - Enqueue quote update job (not regeneration)
    - Pass feedback context with selected quote ID
- [ ] Update `triggerDocumentRegeneration()`:
  - Add case for `DocumentType.QUOTE`
  - Call quote update processor instead of regeneration
  - Handle quote-specific update logic

---

## Phase 7: Quote Acceptance & Invoice Creation

### 7.1 Quote Acceptance Handler (`src/workers/emailIntent.js`)

- [ ] Update `handleAcceptIntent()` for Quote documents:
  - Check if document type is `DocumentType.QUOTE`
  - If Quote accepted:
    - Update document status to ACCEPTED
    - Submit quote via ERP: `submitQuotation(selected_quote_id)` (docstatus: 0 → 1)
    - Create invoice: `createSalesInvoice(selected_quote_id, invoiceData)`
    - Store invoice ID in document metadata JSON: `{ invoiceId: "INV-xxx" }`
    - If detected via email intent: send confirmation email to Admin & Finance Manager
    - If manual accept: directly proceed to finalization
    - Create audit log

### 7.2 Invoice Creation Logic (`src/services/quoteService.js`)

- [ ] Implement `createInvoiceFromQuote(quoteId, project)`:
  - Get quote details from ERP
  - Prepare invoice data:
    - Link to quote via `quotation` field
    - Copy items from quote
    - Set posting_date and due_date
    - Set customer
  - Create invoice via ERP API
  - Return invoice ID
  - Handle errors

### 7.3 Finalization Workflow (`src/workers/emailIntent.js` or new worker)

- [ ] Implement `finalizeProjectProcessor()`:
  - Move Asana task to "Finalized" column
  - Update project phase: QUOTE_DOCUMENT → FINALIZED
  - Log phase transition in `project_phase_log`
  - Enqueue `ASANA_PROJECT_INIT` job
  - Dedupe key: `project:<id>:asana_init`

### 7.4 Confirmation Email for Quote Acceptance (`src/services/emailTemplateService.js`)

- [ ] Add `generateQuoteAcceptanceConfirmationTemplate()`:
  - For Admin & Finance Manager
  - Confirm quote acceptance
  - Button to proceed with finalization
  - Show invoice ID if created
  - Only send if detected via email intent (not manual)

---

## Phase 8: Asana Project Initialization

### 8.1 Team Member Selection Service (`src/services/teamMemberSelectionService.js`)

- [ ] Create new file with class `TeamMemberSelectionService`
- [ ] Implement `getAllActiveTeamMembers()`:
  - Query `team_members` where `is_active=true`
  - Return team members with roles
- [ ] Implement `calculateWorkloadForTeamMember(teamMemberGid, asanaIntegration)`:
  - Query Asana API for incomplete tasks across ALL projects
  - Use pagination if >1000 tasks
  - Count only incomplete tasks
  - Return workload count
  - Cache result with TTL
- [ ] Implement `analyzeProjectRequirements(project)`:
  - Extract required skills from questionnaire
  - Extract from brand origin document
  - Extract from quote (services mentioned)
  - Map to team roles (see TeamRole enum) - might not be exact match.
  - Return required roles array
- [ ] Implement `scoreTeamMember(teamMember, requiredRoles, workload)`:
  - Calculate skill match score (0-1)
  - Calculate workload score (inverse: less work = higher)
  - Combined score = (skillMatch _ 0.7) + (workloadScore _ 0.3)
  - Return score object
- [ ] Implement `selectTeamMembersForProject(project, asanaIntegration)`:
  - Get all active team members
  - Calculate workload for each
  - Analyze project requirements
  - Score each team member
  - Select top N per required role
  - Prefer lead if multiple people for same role
  - Use distributed locks for concurrent selections
  - Return selected team members array
- [ ] Add error handling and logging

### 8.2 Asana Project Initialization Worker (`src/workers/asanaProjectInit.js`)

- [ ] Update existing placeholder file
- [ ] Implement `asanaProjectInitProcessor`:
  - Extract job data (projectId, correlationId)
  - Get project, client, documents
  - Create Asana project with board layout
  - Create sections: "To Do", "In Progress", "In Review", "Completed"
  - Store `asana_project_gid` in `projects.asana_project_gid`
  - Store section GIDs in `asana_links.sections` JSON
  - Select team members using TeamMemberSelectionService
  - Add selected team members to Asana project
  - Generate project description (exclude financials):
    - Client context
    - Project requirements
    - Brand guidelines
    - Conversations
  - Add description to Asana project
  - **DO NOT** create or assign tasks yet
  - Send completion email
  - Create audit log
- [ ] Add comprehensive error handling
- [ ] Add logging

### 8.3 Project Description Generation (`src/services/quoteService.js` or new service)

- [ ] Implement `generateProjectDescription(project)`:
  - Assemble context:
    - Client context (`client.context`)
    - Project requirements (from questionnaire)
    - Brand guidelines (from accepted brand origin)
    - Conversations (from email threads)
    - Any other relevant context
  - **Exclude**: Financial information, quote details, pricing
  - Use LLM to generate comprehensive description
  - Return formatted description text

### 8.4 Completion Email (`src/services/emailTemplateService.js`)

- [ ] Add `generateProjectInitializationCompleteTemplate()`:
  - For Admin, Manager (if any), and PM
  - Subject: "Project Initialized: {project.name}"
  - Message: "Project initialized and team members have been added to the Asana project"
  - Include links:
    - Asana project link
    - Project documents
  - Note: Project ready for task assignment

---

## Phase 9: Asana Integration Updates

### 9.1 Update Asana Pending Projects Service (`src/services/asanaPendingProjectsService.js`)

- [ ] Update `ensureAsanaPendingProjectsBoard()`:
  - Change section name from "Budget/Timeline Phase" to "Quote Document Phase"
  - Update stored configuration in global_configs
  - Verify section exists with new name
- [ ] Update all references to BUDGET_TIMELINE_PHASE → QUOTE_DOCUMENT_PHASE

### 9.2 Update Asana Integration (`src/integrations/asana.js`)

- [ ] Add method `addMembersToProject(projectGid, memberGids)`:
  - Add team members to Asana project
  - Handle errors
  - Return success status
- [ ] Add method `updateProjectDescription(projectGid, description)`:
  - Update project notes/description
  - Handle errors

---

## Phase 10: Testing & Validation

### 10.1 Unit Tests

- [ ] Test ERP integration methods
- [ ] Test quote generation logic
- [ ] Test team member selection algorithm
- [ ] Test quote update logic
- [ ] Test invoice creation

### 10.2 Integration Tests

- [ ] Test full quote generation flow
- [ ] Test quote feedback loop
- [ ] Test quote acceptance and invoice creation
- [ ] Test Asana project initialization
- [ ] Test team member selection with real Asana data

### 10.3 Edge Cases

- [ ] Test cancelled quote handling
- [ ] Test quote update with items array replacement
- [ ] Test concurrent quote generation (dedupe)
- [ ] Test team member selection with >1000 tasks
- [ ] Test rate card missing scenario
- [ ] Test variant selection workflow

---

## Phase 11: Documentation & Cleanup

### 11.1 Code Documentation

- [ ] Add JSDoc comments to all new functions
- [ ] Document ERP API integration patterns
- [ ] Document quote generation workflow
- [ ] Document team member selection algorithm

### 11.2 Update Implementation Plan

- [ ] Verify all steps match Implementation Plan
- [ ] Update any discrepancies
- [ ] Mark completed phases

### 11.3 Cleanup

- [ ] Remove any unused code
- [ ] Remove TODO comments that are completed
- [ ] Clean up console.logs
- [ ] Verify all error handling is in place

---

## Critical Notes

1. **Constants Update MUST be done first** - No backward compatibility
2. **Database migration MUST be done before quote generation**
3. **Rate card seeding MUST be done before quote generation**
4. **Always verify quote not cancelled before operations**
5. **Items array in update requests completely replaces existing - fetch first, modify, send full**
6. **Finance Manager selects ONE quote to send - track via selected_quote_id**
7. **Only update selected quote during feedback, not all variants**
8. **Team member selection uses incomplete tasks only, across ALL projects**
9. **No task assignment during project initialization - only add team members**
10. **Add JSDoc comments to all new functions**

---

## Dependencies

- Phase 1 must complete before Phase 2
- Phase 2 must complete before Phase 3
- Phase 3 must complete before Phase 4
- Phase 4 must complete before Phase 5
- Phase 5 must complete before Phase 6
- Phase 6 must complete before Phase 7
- Phase 7 must complete before Phase 8
- Phase 8 can be done in parallel with Phase 9
- Phase 10 should be done after all implementation phases
- Phase 11 should be done last
