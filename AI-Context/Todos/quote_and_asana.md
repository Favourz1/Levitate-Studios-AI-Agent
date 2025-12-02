# Quote Generation & Asana Project Initialization - Task List

## Confirmation: What's Already Built ✅

Based on codebase analysis, the following are **CONFIRMED COMPLETE**:

### Step 1: Questionnaire Intake & Processing ✅

1. ✅ **Questionnaire Form Submission Handling** (`src/services/formSubmissionService.js`, `src/routes/webhooks.js`, `src/routes/forms.js`)

   - Google Forms Apps Script webhook endpoint (`POST /webhooks/apps-script/forms`)
   - Direct API form submission endpoint (`POST /forms/submit`)
   - Uploaded document parsing support (frontend prefill)
   - Form payload validation (`validateFormPayload`)
   - Apps Script signature verification (`validateAppsScriptSignature`)
   - Client information extraction from questionnaire responses
   - Project information extraction
   - Email extraction (respondent email or from responses field)

2. ✅ **Database Processing** (`src/services/formSubmissionService.js`)

   - Client creation/update (match by email, update context if existing)
   - Project creation with phase=QUESTIONNAIRE
   - Questionnaire response storage with deduplication (UNIQUE constraint on form_id + response_id)
   - Email thread creation with unique reply-to address (`clients-<CLIENT_ID>-<PROJECT_ID>@levitate.ng`)
   - Project phase logging (QUESTIONNAIRE phase transition)
   - Audit log creation
   - Processing status tracking (PENDING, PROCESSED, FAILED)
   - Retry logic with error handling (up to 3 retries)
   - Error message storage for failed processing

3. ✅ **Asana Pending Projects Board** (`src/services/asanaPendingProjectsService.js`, `src/integrations/asana.js`)

   - Persistent "Pending Projects" board stored in `global_configs` (key: `asana_pending_projects`)
   - Database-first approach with verification
   - Board bootstrap with sections: "Filled Questionnaire", "Brand Origin Doc Phase", "Quote Document Phase", "Finalized", "Rejected"
   - Task creation in "Filled Questionnaire" section
   - PM assignment to task (lead PM or any active PM)
   - Edge case handling (board deletion, section recreation, incremental repair)
   - Webhook creation API methods (`createWebhook`, `deleteWebhook`)
   - Section GID storage in database
   - **Note**: Asana webhook event processing (`src/workers/asanaSync.js`) is currently a placeholder - webhook route exists but handler needs implementation

4. ✅ **PM Notification** (`src/services/formSubmissionService.js`, `src/services/emailTemplateService.js`)

   - Email notification to PM when questionnaire received
   - Email template with project details (`generateQuestionnaireSubmissionNotificationTemplate`)
   - Admin email included in production environment
   - Brevo transactional email integration

5. ✅ **Brand Origin Generation Trigger** (`src/services/formSubmissionService.js`, `src/queues/index.js`)
   - Automatic enqueue of brand origin generation job after questionnaire processing
   - Dedupe key: `project:<id>:brand_origin:generate`
   - Queue: `doc-generation` with priority

### Step 2: Brand Origin Document Generation ✅

6. ✅ **Brand Origin Document Generation** (`src/workers/documentGeneration.js`, `src/services/brandOriginPromptService.js`)

   - Context assembly from questionnaire responses, client context, project context
   - LLM workflow (plan → compose → self-check loop)
   - Google Drive document creation
   - Database record creation (Document + DocumentRevision)
   - Document snapshot storage (text in DB for AI access)
   - Asana task movement to "Brand Origin Doc Phase"
   - Asana comment with PM tagged and document links
   - PM notification email with Review/Send buttons
   - Action token generation for email buttons (JWT-based)

7. ✅ **Brand Origin Document Regeneration** (`src/workers/emailIntent.js`, `src/services/brandOriginPromptService.js`)
   - Feedback detection from client emails
   - Document regeneration with feedback context
   - Update existing document records
   - New revision creation with feedback summary
   - Asana comments and notifications
   - Feedback integration in LLM prompts (`generateBrandOriginRegenerationPrompt`)

### Step 3: Document Sending to Client ✅

8. ✅ **Document Sending to Client** (`src/services/documentSendingService.js`, `src/routes/actions.js`)
   - PDF conversion from Google Docs
   - Google Drive PDF upload
   - Email sending via Brevo with PDF attachment
   - Database status updates (SENT_TO_CLIENT)
   - Email thread management
   - Last sent revision tracking (`last_sent_revision_id`)
   - Action token authentication (`GET /actions/send-to-client?t=<JWT>`)
   - Idempotency handling (nonce-based)
   - Document validation before sending

### Step 4: Email Intent Detection & Feedback Loop ✅

9. ✅ **Email Intent Detection** (`src/workers/emailIntent.js`, `src/services/intentPromptService.js`)

   - Brevo inbound webhook processing (`POST /webhooks/brevo/inbound`)
   - Email parsing and storage
   - Client identification from reply-to address
   - Intent classification (ACCEPT, DOC_FEEDBACK, REJECT, OFFTOPIC, OTHER)
   - Document type analysis
   - Client feedback extraction
   - Confidence scoring
   - Enhanced context assembly using `lastSentRevisionId`
   - Accurate content tracking for feedback analysis
   - Structured JSON output via LLM

10. ✅ **Email Inbound Service** (`src/services/emailInboundService.js`)
    - Reply-to address parsing (`clients-<CLIENT_ID>-<PROJECT_ID>@levitate.ng`)
    - Email thread matching and creation
    - Email record creation in database
    - Attachment metadata storage
    - Audit logging
    - Email enqueue for intent processing

### Additional Infrastructure ✅

11. ✅ **Queue System** (`src/queues/index.js`)

    - BullMQ queue setup
    - Document generation queue (`doc-generation`)
    - Email intent queue (`email-intent`)
    - Job deduplication
    - Priority handling

12. ✅ **Email Templates** (`src/services/emailTemplateService.js`)

    - PM notification templates
    - Brand origin notification templates
    - Document review templates
    - Client document email templates
    - Regeneration notification templates

13. ✅ **Validation & Error Handling** (`src/utils/validation/`)

    - Form validation (`formValidation.js`)
    - Webhook validation (`webhookValidation.js`)
    - Apps Script signature validation
    - Error handling middleware
    - Common validation utilities

14. ✅ **Database Schema** (`prisma/schema.prisma`)
    - All required tables for Steps 1-4
    - Questionnaire response tracking with deduplication
    - Document revision tracking
    - Email thread management
    - Project phase logging
    - Audit logging
    - Global configs for system-wide settings

**Note**: According to `About This Project.md` Step 2, "If questionnaire is from google form, we send an email to client that we have received it." This appears to be **NOT YET IMPLEMENTED** - client acknowledgment email should be added if required.

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

**Customer Management Methods (CRITICAL - Must be implemented first):**

- [ ] Implement `searchCustomers(searchTerm, limit)`:
  - Endpoint: `GET /api/method/levitate_integration.api.search_customers?search_term={term}&limit={limit}`
  - Returns: `{ success: boolean, data: [{ name, customer_name, email_id, ... }], count: number }`
  - Handle response parsing
  - Return array of customer objects
- [ ] Implement `getCustomer(customerName)`:
  - Endpoint: `GET /api/method/levitate_integration.api.get_customer?name={customerName}`
  - Returns customer details if exists
- [ ] Implement `createCustomer(customerData)`:
  - Endpoint: `POST /api/method/levitate_integration.api.create_customer`
  - Body: `{ customer_name: string, email?: string }`
  - Returns: `{ success: boolean, data: { name: "customer_name", ... } }`
  - Validate `success` field
- [ ] Implement `searchOrCreateCustomer(customerName, email)`:
  - Search for customer by exact name match
  - If exact match found: return existing customer `name` field
  - If no exact match: create new customer and return `name` field
  - **Critical**: `name` field is the primary key (unique identifier)

**Item Management Methods (CRITICAL - Must be implemented for each item):**

- [ ] Implement `searchItems(searchTerm, limit)`:
  - Endpoint: `GET /api/method/levitate_integration.api.search_items?search_term={term}&limit={limit}`
  - Returns: `{ success: boolean, data: [{ name, item_code, item_name, description, standard_rate, ... }], count: number }`
  - Handle response parsing
  - Return array of item objects
- [ ] Implement `getItem(itemCode)`:
  - Endpoint: `GET /api/method/levitate_integration.api.get_item?item_code={itemCode}`
  - Returns item details if exists
- [ ] Implement `createItem(itemData)`:
  - Endpoint: `POST /api/method/levitate_integration.api.create_item`
  - Body: `{ data: { item_code: string, description: string, stock_uom: string } }`
  - Returns: `{ success: boolean, data: { name: "item_code", ... } }`
  - Validate `success` field
- [ ] Implement `searchOrCreateItem(itemCode, description, stockUom = "Nos")`:
  - Search for item by exact `item_code` or `item_name` match
  - If exact match found: return existing item `item_code`
  - If no exact match: create new item and return `item_code`
  - Default `stock_uom` to "Nos" if not provided

**Quotation Management Methods:**

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
  - **Critical**: Response returns new quote ID in `data.name` (not the cancelled ID)
  - Response format: `{ success: boolean, message: string, data: { name: "SAL-QTN-2025-00201", amended_from: "SAL-QTN-2025-00201-CANC-0", pdf_url: "...", items: [...], ... } }`
  - Return new quote ID from `data.name` for subsequent operations
- [ ] Implement `createSalesInvoice(quoteId, data)`:
  - Endpoint: `POST /api/method/levitate_integration.api.create_sales_invoice`
  - Link invoice to quote via `quotation` field
  - Return invoice ID
- [ ] Implement `getQuotationPDF(quoteId)`:
  - Endpoint: `GET /api/method/frappe.utils.print_format.download_pdf?doctype=Quotation&name={quoteId}&format=Standard`
  - Handle binary PDF response (Content-Type: application/pdf)
  - Return PDF buffer
- [ ] Add comprehensive error handling:
  - Check `success` field in all responses (not just HTTP status)
  - Handle cancelled quotes: check `quotation_canceled` flag
  - **Cancellation API Quirk**: Sometimes cancellation shows `success: false` but actually worked - always verify with `getQuotation()` to confirm
  - Handle network errors with retry logic
  - Log all API calls
  - **Amend Quote**: Always use new quote ID from `data.name` in response, not the cancelled ID
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
  - Handle "TBD" prices gracefully and decide a price.
  - Map project services to rate card items might not be exact match.
- [ ] Implement `generateQuoteItemsWithLLM(context)`:
  - Use QuotePromptService to generate items
  - Call LLM with structured schema
  - Validate output
  - Return quote items array (with item_code, qty, rate, description)
- [ ] Implement `ensureCustomerExists(client)`:
  - Search for customer by exact name using `searchCustomers(client.name)`
  - If exact match found: return existing customer `name` field
  - If no exact match: create new customer using `createCustomer({ customer_name: client.name, email: client.primaryEmail })`
  - Return customer name/ID for quote creation
- [ ] Implement `ensureItemsExist(quoteItems, erpIntegration)`:
  - For each quote item:
    - Search for item by exact `item_code` or `item_name` using `searchItems(itemCode)`
    - If exact match found: use existing item `item_code`
    - If no exact match: create new item using `createItem({ data: { item_code, description, stock_uom: "Nos" } })`
  - Return array of validated item codes (all items guaranteed to exist)
- [ ] Implement `createQuotesViaERP(quoteItems, customerName, project, erpIntegration)`:
  - **Prerequisites**: Customer must exist (call `ensureCustomerExists` first), All items must exist (call `ensureItemsExist` first)
  - Create main quote via ERP API with customer name and validated item codes
  - Create 3 variant quotes with different strategies (same customer, different items/pricing)
  - All in DRAFT (docstatus: 0)
  - Return array of quote IDs: `[mainQuoteId, variant1Id, variant2Id, variant3Id]`
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
  - **Customer Setup (CRITICAL - Must be done first):**
    - Call `QuoteService.ensureCustomerExists(client)` to search/create customer
    - Store customer name/ID for quote creation
  - **Item Setup (CRITICAL - Must be done for each item):**
    - Call `QuoteService.ensureItemsExist(quoteItems, erpIntegration)` for main quote items
    - For each variant, ensure variant-specific items exist
    - All items must exist before quote creation
  - Create 4 quotes via ERP API (using customer name and validated item codes)
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

**IMPORTANT:** I highly suggest that instead of a separate select quote api/UI etc. In the original email template that is `generateQuoteNotificationTemplate` in `src\services\emailTemplateService.js`. Let there be a "Send to client" button beside all variants and the main in the email template so if the viewer of the email be it Finance manager or admin click on any of them, it automatically select that quote and send to client. Maybe you want to append some query params to the different button send to client links so you can pass the variant id / quote id so the backend can fetch the right quote variant and send it to client and do every other process needed to send the quote to client and after. This gives better UX.

### 5.3 Update Document Sending Service (`src/services/documentSendingService.js`)

- [ ] Update `sendDocumentToClient()`:
  - Check if document type is QUOTE
  - If quote, verify `selected_quote_id` is set
  - Use selected quote PDF (download from ERP if needed)
  - Upload to Drive if not already uploaded
  - use googleIntegration.shareDocument to share the selected quote drive file with client (no notifications).
  - Send email to client with selected quote PDF
  - Update `last_sent_revision_id` with quote info

---

## Phase 6: Quote Feedback Loop

### 6.1 Quote Update Logic (`src/workers/quoteGeneration.js`)

- [ ] Add `updateQuoteProcessor` function:
  - Extract feedback context
  - Get selected quote ID from document
  - Verify quote not cancelled (call `getQuotation()`)
  - **Item Setup for New Items (CRITICAL):**
    - Identify any new items in feedback
    - For each new item: call `QuoteService.ensureItemsExist([newItem], erpIntegration)`
    - Ensure all new items exist before quote update
  - **Quote Update:**
    - If cancelled:
      - Use `amendQuotation(cancelledQuoteId, data)` to create new draft
      - **Critical**: Response returns new quote ID in `data.name` - update `selected_quote_id` with this new ID
      - Use new quote ID for subsequent operations
    - If draft:
      - Fetch existing items from quote
      - Modify items array based on feedback (replace, add, remove items)
      - Use `updateQuotation()` with complete items array (all items must exist - ensured in step above)
  - Also watch out in case items need to be removed too based on the feedback.
  - Generate new PDF using updated quote ID
  - Upload to Drive
  - Create new DocumentRevision
  - Update `last_sent_revision_id`
  - Keep `selected_quote_id` pointing to updated quote (or new quote ID if amended)
- [ ] Add error handling for cancelled quotes
- [ ] Add logging for quote updates
- [ ] Handle cancellation API quirk (verify with GET even if response shows success: false)

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
    - If manual accept (API triggered): directly proceed to finalization
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

## Phase 11: Documentation & Cleanup ✅ COMPLETED

### 11.1 Code Documentation (Write all in `guides` folder at the root of the codebase) ✅

- [x] Document ERP API integration patterns (`guides/erp-integration-patterns.md`)
- [x] Document quote generation workflow (`guides/quote-generation-workflow.md`)
- [x] Document team member selection algorithm (`guides/team-member-selection-algorithm.md`)

### 11.2 Update Implementation Plan ✅

- [x] Verify all steps match Implementation Plan
- [x] Update any discrepancies
- [x] Mark completed phases (M0-M7 all marked as completed)

### 11.3 Cleanup ✅

- [x] Add JSDoc comments to complex functions (existing JSDoc comments verified)
- [x] Remove any unused code (verified - no unused code found)
- [x] Remove TODO comments that are completed (kept valid TODOs for future work)
- [x] Clean up console.logs (replaced with proper logger calls)
- [x] Verify all error handling is in place (error handling verified across all files)

---

## Critical Notes

1. **Constants Update MUST be done first** - No backward compatibility
2. **Database migration MUST be done before quote generation**
3. **Rate card seeding MUST be done before quote generation**
4. **Customer Search/Creation (CRITICAL)**:
   - MUST search for customer by exact name before creating quote
   - Use `searchCustomers()` to find existing customer
   - If exact match found: use existing customer `name` field (primary key)
   - If no exact match: create new customer, then use `name` field
   - Customer `name` field is the unique identifier used in quote creation
5. **Item Search/Creation (CRITICAL)**:
   - MUST search for each item by exact `item_code` or `item_name` before using in quote
   - For each quote item: search first, use existing if found, otherwise create
   - All items must exist before quote creation or update
   - Default `stock_uom` to "Nos" when creating new items
6. **Always verify quote not cancelled before operations** - Use `getQuotation()` to verify
7. **Cancellation API Quirk**: Sometimes cancellation shows `success: false` but actually worked - always verify with GET
8. **Amend Quote Response**: Returns new quote ID in `data.name` - always use this new ID, not the cancelled ID
9. **Items array in update requests completely replaces existing - fetch first, modify, send full**
10. **Finance Manager selects ONE quote to send - track via selected_quote_id**
11. **Only update selected quote during feedback, not all variants**
12. **Team member selection uses incomplete tasks only, across ALL projects**
13. **No task assignment during project initialization - only add team members**
14. **Always check `success` field in ERP API responses, not just HTTP status code**

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
