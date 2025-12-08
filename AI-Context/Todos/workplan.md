# Step 8: Workplan Generation - Implementation Tasks

**EXECUTION ORDER: These tasks must be executed in the exact order listed below.**

## Phase 1: Database Schema & Constants (CRITICAL - DO FIRST)

### 1.1 Database Migration (`prisma/schema.prisma`)

- [ ] **Task 1.1.0**: Verify `projects.serviceTypes` field exists

  - File: `prisma/schema.prisma`
  - Check that `projects` model has `serviceTypes Json? @map("service_types") @db.JsonB` field (line 36)
  - This field stores cached LLM output: `[{serviceType, rating, reasoning}, ...]`
  - If missing, add migration to add this field
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 1.3

- [ ] **Task 1.1.1**: Add `workplan_slides` table to Prisma schema

  - File: `prisma/schema.prisma`
  - Add model `WorkplanSlide` with all fields from implementation plan:
    - `id` (SERIAL PRIMARY KEY)
    - `documentId` (INTEGER, FK to documents, ON DELETE CASCADE)
    - `slideNumber` (INTEGER, NOT NULL)
    - `slideType` (TEXT, NOT NULL)
    - `title` (TEXT, NOT NULL)
    - `researchData` (JSONB, nullable)
    - `contentCopy` (TEXT, nullable)
    - `dataPoints` (JSONB, nullable)
    - `designDirectives` (JSONB, nullable)
    - `layoutType` (TEXT, nullable)
    - `visualElements` (JSONB, nullable)
    - `researchStatus` (TEXT, DEFAULT 'PENDING')
    - `contentStatus` (TEXT, DEFAULT 'PENDING')
    - `designStatus` (TEXT, DEFAULT 'PENDING')
    - `qualityScore` (NUMERIC(3,2), nullable)
    - `metadataInfo` (JSONB, nullable)
    - `requiresBigIdea` (BOOLEAN, DEFAULT FALSE)
    - `isOptional` (BOOLEAN, DEFAULT FALSE)
    - `createdAt` (TIMESTAMP, DEFAULT NOW())
    - `updatedAt` (TIMESTAMP, DEFAULT NOW())
  - Add UNIQUE constraint on `(documentId, slideNumber)`
  - Add indexes:
    - `idx_workplan_slides_document_id` on `documentId`
    - `idx_workplan_slides_type` on `slideType`
    - `idx_workplan_slides_research_status` on `researchStatus`
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 1.1

- [ ] **Task 1.1.2**: Run Prisma migration
  - Command: `npx prisma migrate dev --name add_workplan_slides`
  - Verify migration file created in `prisma/migrations/`
  - Verify schema compiles without errors

### 1.2 Update Constants (`src/constants/index.js`)

- [ ] **Task 1.2.1**: Add WorkplanServiceType enum

  - Add `WorkplanServiceType` object with values:
    - `LOGO_DESIGN: "LOGO_DESIGN"`
    - `MARKETING_CAMPAIGN: "MARKETING_CAMPAIGN"`
    - `GTM_STRATEGY: "GTM_STRATEGY"`
    - `GTM_360_CAMPAIGN: "GTM_360_CAMPAIGN"`
    - `SOCIAL_MEDIA_STRATEGY: "SOCIAL_MEDIA_STRATEGY"`
    - `BRAND_DESIGN: "BRAND_DESIGN"`
    - `WEB_DESIGN: "WEB_DESIGN"`
    - `PACKAGING_DESIGN: "PACKAGING_DESIGN"`
    - `VIDEO_PRODUCTION: "VIDEO_PRODUCTION"`
    - `MOTION_DESIGN: "MOTION_DESIGN"`
    - `ADVERTISING: "ADVERTISING"`
  - Export in module.exports
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 1.2

- [ ] **Task 1.2.2**: Verify DocumentStatus includes workplan statuses

  - Note: Workplan status is stored in `Document.status` field using `DocumentStatus` enum
  - Verify `DocumentStatus` includes: `DRAFT`, `RESEARCHING`, `GENERATING`, `COMPLETED`, `FAILED`
  - These statuses are already added to `DocumentStatus` in Task 1.2.1
  - No separate `WorkplanStatus` enum needed - use `DocumentStatus` directly

- [ ] **Task 1.2.3**: Add SlideType enum

  - Add `SlideType` object with all slide types from implementation plan:
    - Core slides: `INDUSTRY_STRENGTHS`, `OPPORTUNITY_IN_MARKET`, `TARGET_AND_NEEDS`, `CURRENT_SOLUTION`, `WHY_CURRENT_SOLUTION`, `COMPETITIVE_LANDSCAPE`, `COMPETITOR_POSITIONING`, `INDUSTRY_SHIFT`
    - Marketing slides: `MARKET_GAPS`, `MARKET_GAPS_RESPONSE`, `ALL_TRUTHS_CONSIDERED`, `STRATEGIC_INTERPRETATION`, `STRATEGY_TO_IDEA`, `BIG_IDEA`
    - Logo/Branding slides: `VISUAL_RATIONALE`, `LOGO_OPTIONS`
  - Export in module.exports
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 1.2

- [ ] **Task 1.2.4**: Add ResearchStatus enum

  - Add `ResearchStatus` object with values:
    - `PENDING: "PENDING"`
    - `RESEARCHING: "RESEARCHING"`
    - `COMPLETED: "COMPLETED"`
    - `FAILED: "FAILED"`
  - Export in module.exports

- [ ] **Task 1.2.5**: Add Workplan audit actions

  - Add to `AuditActions` object:
    - `WORKPLAN_GENERATION_STARTED: "WORKPLAN_GENERATION_STARTED"`
    - `WORKPLAN_GENERATION_COMPLETED: "WORKPLAN_GENERATION_COMPLETED"`
    - `WORKPLAN_GENERATION_FAILED: "WORKPLAN_GENERATION_FAILED"`
    - `WORKPLAN_REGENERATION_REQUESTED: "WORKPLAN_REGENERATION_REQUESTED"`
    - `WORKPLAN_SLIDE_REGENERATION_REQUESTED: "WORKPLAN_SLIDE_REGENERATION_REQUESTED"`
    - `WORKPLAN_SLIDE_RESEARCH_COMPLETED: "WORKPLAN_SLIDE_RESEARCH_COMPLETED"`
    - `WORKPLAN_SLIDE_CONTENT_COMPLETED: "WORKPLAN_SLIDE_CONTENT_COMPLETED"`
    - `WORKPLAN_SLIDE_DESIGN_COMPLETED: "WORKPLAN_SLIDE_DESIGN_COMPLETED"`

- [ ] **Task 1.2.6**: Verify DocumentType.WORKPLAN exists
  - Check `src/constants/index.js` - `DocumentType.WORKPLAN` should already exist (line 14)
  - If missing, add it

### 1.3 Update Validation Schemas (`src/utils/validation.js`)

- [ ] **Task 1.3.1**: Add Zod schemas for workplan enums
  - Import new enums from `@/constants`
  - Create `workplanServiceTypeSchema` using `z.enum(Object.values(WorkplanServiceType))`
  - Create `workplanStatusSchema` using `z.enum(Object.values(DocumentStatus))` (filter to workplan-specific statuses: DRAFT, RESEARCHING, GENERATING, COMPLETED, FAILED)
  - Create `slideTypeSchema` using `z.enum(Object.values(SlideType))`
  - Create `researchStatusSchema` using `z.enum(Object.values(ResearchStatus))`
  - Export all schemas

### 🔍 **CHECKPOINT 1**: Verify Database & Constants Setup

**Human Action Required**:

- Run `npx prisma generate` to regenerate Prisma client
- Verify Prisma client includes `WorkplanSlide` model
- Run `npm run test` (if tests exist) to ensure no import errors
- Check that all constants are exported and accessible
- Verify database migration applied successfully

---

## Phase 2: Queue Setup & Worker Structure

### 2.1 Add Workplan Queue (`src/queues/index.js`)

- [ ] **Task 2.1.1**: Add WORKPLAN_GENERATION queue name

  - Add `WORKPLAN_GENERATION: "workplan-generation"` to `QUEUE_NAMES` object

- [ ] **Task 2.1.2**: Create workplanGeneration queue instance

  - Add `workplanGeneration: new Queue(QUEUE_NAMES.WORKPLAN_GENERATION, { connection: redis })` to `queues` object

- [ ] **Task 2.1.3**: Add QueueService method for workplan generation

  - Add `static async addWorkplanGenerationJob(data, priority = 0)` method to `QueueService` class
  - Use dedupe key: `workplan:<projectId>:<serviceType>` or `workplan:<documentId>:regenerate` for regenerations
  - Follow same pattern as `addDocumentGenerationJob` and `addQuoteGenerationJob`
  - Include `documentId` in data if regeneration
  - Include `isRegeneration` boolean flag
  - Include `regenerationReason` string if regeneration

- [ ] **Task 2.1.4**: Add QueueService method for slide regeneration
  - Add `static async addSlideRegenerationJob(data, priority = 0)` method
  - Use dedupe key: `workplan-slide:<documentId>:<slideId>:regenerate`
  - Accept `{ documentId, slideId, regenerationReason }` in data

### 2.2 Create Worker File (`src/workers/workplanGeneration.js`)

- [ ] **Task 2.2.1**: Create workplanGeneration worker file

  - File: `src/workers/workplanGeneration.js`
  - Import required dependencies:
    - `getPrismaClient` from `@/database`
    - `createLogger` from `@/utils/logger`
    - `QueueService` from `@/queues`
    - `DocumentType`, `DocumentStatus`, `SystemActors`, `AuditActions` from `@/constants`
    - All workplan service classes (to be created in Phase 3)
  - Create `workplanGenerationProcessor` async function that accepts `job` parameter
  - Extract job data: `projectId`, `serviceType`, `documentId` (optional), `isRegeneration`, `regenerationReason`, `retryCount`
  - Add basic error handling and logging
  - Return success result object
  - Export processor function

- [ ] **Task 2.2.2**: Register worker in `src/workers/index.js`
  - Import `workplanGenerationProcessor` from `@/workers/workplanGeneration`
  - Add worker config to `workerConfigs` array:
    ```javascript
    {
      name: QUEUE_NAMES.WORKPLAN_GENERATION,
      processor: workplanGenerationProcessor,
      concurrency: 2, // Moderate concurrency for workplan generation
    }
    ```
  - Ensure worker starts with other workers

### 🔍 **CHECKPOINT 2**: Verify Queue & Worker Setup

**Human Action Required**:

- Start workers: `npm run workers` (or equivalent command)
- Verify workplan-generation queue appears in Redis
- Check logs for worker startup success
- Verify no import errors or missing dependencies

---

## Phase 3: Tavily Integration (Research Tool)

### 3.1 Create Tavily Integration (`src/integrations/tavily.js`)

- [ ] **Task 3.1.1**: Create Tavily integration file

  - File: `src/integrations/tavily.js`
  - Create `TavilyIntegration` class
  - Add constructor that reads `TAVILY_API_KEY` from environment variables
  - Validate API key exists, throw error if missing
  - Set base URL: `https://api.tavily.com`
  - Add logger using `createLogger("tavily")`

- [ ] **Task 3.1.2**: Implement `search(query, options)` method

  - Endpoint: `POST /search`
  - Request body: `{ api_key, query, search_depth: "basic"|"advanced", include_answer: false, include_raw_content: false, include_images: false, max_results: 5 }`
  - Handle API errors (429, 401, 500)
  - Return: `{ results: [{ title, url, content, score }], query }`
  - Add retry logic with exponential backoff (3 attempts)
  - Log integration calls using existing `logIntegrationCall` pattern

- [ ] **Task 3.1.3**: Implement `searchWithFilters(query, filters)` method

  - Support filters: `dateRange`, `domains`, `excludeDomains`
  - Build request with filter options
  - Return same format as `search()`

- [ ] **Task 3.1.4**: Export singleton instance

  - Export `tavilyIntegration = new TavilyIntegration()`
  - Follow same pattern as `googleIntegration` and `asanaIntegration`

- [ ] **Task 3.1.5**: Add environment variable to `env.example`
  - Add `TAVILY_API_KEY=your_tavily_api_key_here` to `env.example`
  - Document in comments that Tavily API key is required for workplan research

### 🔍 **CHECKPOINT 3**: Test Tavily Integration

**Human Action Required**:

- Set `TAVILY_API_KEY` in environment
- Create simple test script to call `tavilyIntegration.search("test query")`
- Verify API calls succeed and return results
- Check error handling with invalid API key

---

## Phase 4: Agent A - The Planner (TOC Generation)

### 4.1 Create Planner Service (`src/services/workplanPlannerService.js`)

- [ ] **Task 4.1.1**: Create workplanPlannerService file

  - File: `src/services/workplanPlannerService.js`
  - Import dependencies:
    - `getPrismaClient` from `@/database`
    - `createLogger` from `@/utils/logger`
    - `WorkplanServiceType`, `SlideType`, `DocumentType`, `DocumentStatus` from `@/constants`
    - `LLMClient` from `@/llm/client`
    - `tocGenerationSchema` from `@/llm/schemas/workplanSchemas` (to be created)

- [ ] **Task 4.1.2**: Define slide templates and service type mapping

  - Create `SLIDE_TEMPLATES` object with:
    - `CORE_SLIDES` array (all core slides from SlideType)
    - `MARKETING_SLIDES` array (marketing-specific slides)
    - `LOGO_SLIDES` array (logo/branding slides)
  - Create `SERVICE_TYPE_SLIDE_MAP` object mapping each `WorkplanServiceType` to array of slide types
  - Include `GENERAL` fallback for unknown service types
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 3.2

- [ ] **Task 4.1.3**: Implement `generateTOC(projectId, serviceType, context)` static method

  - If `serviceType` not provided: call `getServiceType(projectId)` to get service type (see Task 4.1.4)
  - Load project context (questionnaire, brand origin, client info)
  - Validate service type - use `GENERAL` fallback if not in SERVICE_TYPE_SLIDE_MAP
  - Log warning if unknown service type
  - Use LLM with structured output (`generateStructured`) to determine slides
  - Apply business rules (service type mapping) to filter/enhance LLM output
  - Create document record with `type=DocumentType.WORKPLAN` and `status=DocumentStatus.DRAFT`
  - Store TOC in `document.metadataInfo`:
    ```json
    {
      "serviceType": "...", // Reference copy (primary source is project.serviceTypes) SO DO NOT ADD THIS AND USE IT.
      "tableOfContents": [...],
      "generatedAt": "..."
    }
    ```
  - Note: Document status is stored in `document.status` field, not in metadataInfo
  - Note: Service type is cached in `project.serviceTypes` - use `getServiceType()` to access
  - Return slide definitions array
  - Handle errors and log appropriately

- [ ] **Task 4.1.4**: Implement service type determination with caching (LLM-based)

  - **Public API**: Create `getServiceType(projectId, forceRefresh = false)` static method

    - Check `project.serviceTypes` JSONB array first (cache)
    - If cache exists and not empty: return highest-rated from cache
    - If cache missing/empty or `forceRefresh=true`: call `_determineServiceTypeWithLLM()`
    - Store full LLM output array in `project.serviceTypes` (cache)
    - Return highest-rated service type
    - Handle errors: store fallback `[{serviceType: "GENERAL", rating: 0, reasoning: "Error message"}]`, return "GENERAL"

  - **Helper**: Create `getHighestRatedServiceType(serviceMatches)` static method

    - Sort array by `rating` (descending)
    - Return top match if `rating >= 5`
    - Return "GENERAL" if rating < 5 or array empty

  - **Inspection**: Create `getServiceTypeMatches(projectId)` static method

    - Returns full array of `{serviceType, rating, reasoning}` for debugging

  - **Internal**: Create `_determineServiceTypeWithLLM(projectId)` private static method

    - Assemble context for LLM:
      - Load project with relations (client, questionnaire responses, brand origin document, quote document if available)
      - Extract questionnaire responses JSON
      - Extract accepted brand origin document content (from latest revision snapshotText)
      - Extract client context
      - Extract quote PDF text if quote document exists and is accepted (from document revisions or Drive export)
    - Use LLM with structured output schema:
      ```javascript
      z.object({
        serviceMatches: z.array(
          z.object({
            serviceType: z.enum([
              ...Object.values(WorkplanServiceType),
              "GENERAL",
            ]),
            rating: z
              .number()
              .min(0)
              .max(10)
              .describe("Confidence rating 0-10"),
            reasoning: z.string().describe("Why this service type matches"),
          })
        ),
      });
      ```
    - Pass all available service types (including `GENERAL`) as context in prompt
    - LLM returns array of all services that match with ratings
    - Return full array (caller will store in cache and select highest-rated)
    - Handle errors: return fallback array `[{serviceType: "GENERAL", rating: 0, reasoning: "Error message"}]`

  - **Key Points:**
    - Service type determined **once** per project (cached in `project.serviceTypes`)
    - Full LLM output stored (all matches with ratings), not just selected one
    - Subsequent calls read from cache (no redundant LLM calls)
    - Ensures consistency across all agents in pipeline
    - Reference: See detailed architecture in `AI-Context/Implementation-Plan-Step-8.md` → Section 10.1

### 4.2 Create TOC Generation Schema (`src/llm/schemas/workplanSchemas.js`)

- [ ] **Task 4.2.1**: Create workplanSchemas file

  - File: `src/llm/schemas/workplanSchemas.js`
  - Import `z` from `zod`
  - Import `SlideType` from `@/constants`

- [ ] **Task 4.2.2**: Create `tocGenerationSchema`
  - Define schema:
    ```javascript
    z.object({
      slides: z.array(
        z.object({
          slideNumber: z.number().int().positive(),
          slideType: z.enum(Object.values(SlideType)),
          title: z.string(),
          isOptional: z.boolean().default(false),
          requiresBigIdea: z.boolean().default(false),
          researchQueries: z.array(z.string()).optional(),
        })
      ),
      rationale: z.string().describe("Why these slides were selected"),
    });
    ```
  - Export schema
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 3.3

### 🔍 **CHECKPOINT 4**: Test Planner Agent

**Human Action Required**:

- Create test project with questionnaire data
- Call `WorkplanPlannerService.generateTOC(projectId, "MARKETING_CAMPAIGN", context)`
- Verify document record created with type=WORKPLAN
- Verify TOC stored in metadataInfo
- Check that correct slides are selected for each service type
- Test GENERAL fallback with unknown service type

---

## Phase 5: Agent B - The Researcher (Data Sourcing)

### 5.1 Create Research Tools (`src/llm/tools/researchTools.js`)

- [ ] **Task 5.1.1**: Create researchTools file

  - File: `src/llm/tools/researchTools.js`
  - Import `tool` from `ai`, `z` from `zod`
  - Import `tavilyIntegration` from `@/integrations/tavily`
  - Import `SlideType` from `@/constants`
  - Import `createLogger` from `@/utils/logger`

- [ ] **Task 5.1.2**: Create `competitorAnalysisTool`

  - Description: "Research competitor positioning, market share, and activities"
  - Parameters: `z.object({ competitorNames: z.array(z.string()), industry: z.string(), slideType: z.enum(Object.values(SlideType)) })`
  - Execute: Multi-query search for each competitor using Tavily
  - Extract: positioning, market share, recent campaigns, slogans
  - Return structured data object
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 4.2

- [ ] **Task 5.1.3**: Create `marketDataTool`

  - Description: "Extract market statistics, growth rates, population data"
  - Parameters: `z.object({ industry: z.string(), region: z.string().optional(), dataType: z.enum(["GROWTH_RATE", "MARKET_SIZE", "POPULATION", "BEHAVIOR"]) })`
  - Execute: Determine target region from context (default to "Nigeria" if not specified)
  - Search for specific data types in determined region
  - Extract numbers, percentages, dates
  - Validate data quality
  - Return structured JSON
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 4.2

- [ ] **Task 5.1.4**: Export all tools
  - Export `competitorAnalysisTool` and `marketDataTool`

### 5.2 Create Researcher Service (`src/services/workplanResearcherService.js`)

- [ ] **Task 5.2.1**: Create workplanResearcherService file

  - File: `src/services/workplanResearcherService.js`
  - Import dependencies:
    - `getPrismaClient` from `@/database`
    - `createLogger` from `@/utils/logger`
    - `tavilyIntegration` from `@/integrations/tavily`
    - `SlideType`, `ResearchStatus` from `@/constants`
    - Research tools from `@/llm/tools/researchTools`

- [ ] **Task 5.2.2**: Define research strategies per slide type

  - Create `RESEARCH_STRATEGIES` object mapping each `SlideType` to:
    - `queries` array (with `{region}` placeholder)
    - `dataPoints` array
    - `requiresCompetitorList` boolean (if applicable)
  - Include strategies for: `INDUSTRY_STRENGTHS`, `COMPETITIVE_LANDSCAPE`, `MARKET_GAPS`, `BIG_IDEA`
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 4.3

- [ ] **Task 5.2.3**: Implement `determineTargetRegion(context)` static method

  - Extract from questionnaire: `targetMarket`, `targetRegion`, `geographicFocus`
  - Extract from client context: `marketFocus`, `targetCountries`
  - Extract from accepted brand origin document
  - Return determined region or `"Nigeria"` as fallback
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 4.4

- [ ] **Task 5.2.4**: Implement `researchSlide(slide, context)` static method

  - Update slide `researchStatus` to `ResearchStatus.RESEARCHING`
  - Determine target region using `determineTargetRegion()`
  - Generate research queries based on slide type (replace `{region}` placeholder)
  - Execute parallel searches using Tavily API
  - Extract structured data from search results
  - Validate data quality (check for numbers, source credibility, cross-reference)
  - Store sources with relevance scores in `slide.metadataInfo.researchSources`:
    ```json
    {
      "researchSources": [
        {
          "source_type": "web",
          "source_url": "...",
          "source_title": "...",
          "extracted_data": {...},
          "relevance_score": 8.5,
          "verified": true
        }
      ]
    }
    ```
  - Store research data in `slide.researchData` JSONB field
  - Update slide `researchStatus` to `ResearchStatus.COMPLETED`
  - Return research data JSON
  - Handle errors: set status to `FAILED`, log error, return fallback data if available
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 4.4

- [ ] **Task 5.2.5**: Implement `validateResearchQuality(researchData)` static method

  - Check for: at least 3 sources per slide, numbers/statistics present (where required), source URLs valid, relevance score > 7.0
  - Return boolean indicating quality is sufficient

- [ ] **Task 5.2.6**: Implement `researchWithFallback(slide, context)` static method
  - Try `researchSlide()` first
  - If quality insufficient, use cached industry data
  - If research fails completely, flag for manual review
  - Return research data (even if minimal)
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 4.5

### 🔍 **CHECKPOINT 5**: Test Researcher Agent

**Human Action Required**:

- Create test slide record
- Call `WorkplanResearcherService.researchSlide(slide, context)`
- Verify research data stored in `researchData` field
- Verify sources stored in `metadataInfo.researchSources`
- Check that region detection works correctly
- Test fallback behavior with invalid queries
- Verify research quality validation

---

## Phase 6: Agent C - The Strategist (Content Synthesis)

### 6.1 Create Strategist Service (`src/services/workplanStrategistService.js`)

- [ ] **Task 6.1.1**: Create workplanStrategistService file

  - File: `src/services/workplanStrategistService.js`
  - Import dependencies:
    - `getPrismaClient` from `@/database`
    - `createLogger` from `@/utils/logger`
    - `LLMClient` from `@/llm/client`
    - `SlideType`, `DocumentStatus` from `@/constants`
    - Content synthesis schemas (to be created)

- [ ] **Task 6.1.2**: Implement `synthesizeSlideContent(slide, researchData, context)` static method

  - Context includes: researchData, questionnaire responses, accepted brand origin document, client context, project context, `regenerationFeedback` (optional)
  - Build LLM prompt following BRICS framework:
    1. BRIEF: Slide requirements (incorporate regenerationFeedback if present)
    2. RESEARCH: Research data with sources from Agent B
    3. INSPIRATION: Brand context + creative references
    4. CREATE: Synthesize into strategic copy (address feedback if present)
    5. SHARE: Output format (structured copy ready for design)
  - Use LLM `generateStructured()` with content schema
  - Update slide `contentStatus` to `GENERATING` then `COMPLETED`
  - Store synthesized copy in `slide.contentCopy`
  - Handle errors: set status to `FAILED`, log error
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 5.2

- [ ] **Task 6.1.3**: Implement slide-specific synthesis rules

  - Create prompt templates for:
    - `INDUSTRY_STRENGTHS`: Include population, behavior, market size, growth rate, opportunity, "What this means" section
    - `MARKET_GAPS`: Two pages - Page 1 (competitor weaknesses), Page 2 (client response)
    - `BIG_IDEA`: Generate 2 distinct options with rationale, store in `metadataInfo.bigIdeaOptions`
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 5.3

- [ ] **Task 6.1.4**: Implement `generateBigIdeaOptions(documentId, slideId, context)` static method
  - Get "All Truths Considered" slide data
  - Generate 2 distinct options via LLM
  - Store in `workplan_slides.metadata_info.bigIdeaOptions`:
    ```json
    {
      "bigIdeaOptions": [
        {
          "option_number": 1,
          "big_idea_text": "...",
          "rationale": "...",
          "strategic_fit_score": 8.5
        },
        {
          "option_number": 2,
          "big_idea_text": "...",
          "rationale": "...",
          "strategic_fit_score": 8.2
        }
      ]
    }
    ```
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 8.1

### 6.2 Create Content Synthesis Schemas (`src/llm/schemas/workplanSchemas.js`)

- [ ] **Task 6.2.1**: Add content synthesis schemas to workplanSchemas.js
  - Create `slideContentSchema`:
    ```javascript
    z.object({
      contentCopy: z.string().min(100),
      keyPoints: z.array(z.string()),
      dataPoints: z.object({...}).optional(),
      sourceCitations: z.array(z.string()),
      qualityScore: z.number().min(0).max(10),
    })
    ```
  - Create `bigIdeaOptionsSchema`:
    ```javascript
    z.object({
      options: z
        .array(
          z.object({
            optionNumber: z.number().int().positive(),
            bigIdeaText: z.string(),
            rationale: z.string(),
            strategicFitScore: z.number().min(0).max(10),
          })
        )
        .length(2),
    });
    ```
  - Export schemas

### 🔍 **CHECKPOINT 6**: Test Strategist Agent

**Human Action Required**:

- Create test slide with research data
- Call `WorkplanStrategistService.synthesizeSlideContent(slide, researchData, context)`
- Verify content stored in `contentCopy` field
- Test Big Idea generation with 2 options
- Verify BRICS framework followed in output
- Test regeneration with feedback context

---

## Phase 7: Agent D - The Art Director (Design Directives)

### 7.1 Create Design Tools (`src/llm/tools/designTools.js`)

- [ ] **Task 7.1.1**: Create designTools file

  - File: `src/llm/tools/designTools.js`
  - Import `tool` from `ai`, `z` from `zod`
  - Import `createLogger` from `@/utils/logger`

- [ ] **Task 7.1.2**: Create `imageSearchTool` and `iconSearchTool`

  - Description: "Search for relevant images/icons for slide design"
  - Parameters: `z.object({ query: z.string(), imageType: z.enum(["PHOTO", "ICON", "ILLUSTRATION"]), style: z.string().default("professional") })`
  - Execute: Use Pexels API for images and https://thenounproject.com/ for icons
  - Return: `[{ url, description, license }]`
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 6.5
  - Note: Implement 100% no placeholders!

  **THENOUNPROJECT API GUIDE (SEARCH THE WEB ONLINE TO GET MORE DETAILS):**
  The Noun Project API documentation is available through several resources.

* **Official API Documentation:**
  - **Main Documentation Page:** [https://api.thenounproject.com/documentation.html](https://api.thenounproject.com/documentation.html)
  - **Getting Started Guide:** [https://api.thenounproject.com/getting_started.html](https://api.thenounproject.com/getting_started.html) https://api.thenounproject.com/getting_started.html#making-requests , https://api.thenounproject.com/getting_started.html#supported-file-formats-and-http-responses , https://api.thenounproject.com/getting_started.html#sample-code (Covers creating an API key, authentication, making requests, and pricing).
* **API Explorer:** You can try out the API endpoints directly with your credentials using the API Explorer: [https://api.thenounproject.com/explorer](https://api.thenounproject.com/explorer)

The API is a **REST API** secured with **OAuth 1.0a**.
We need api key and secret key from env see sample code in python
import requests
from requests_oauthlib import OAuth1

auth = OAuth1("your-api-key", "your-api-secret")
endpoint = "https://api.thenounproject.com/v2/icon/1"

response = requests.get(endpoint, auth=auth)
print(response.content)

### Key API Information

- **Base URL:** `https://api.thenounproject.com`
- **API Version:** They offer both **V1** and **V2** endpoints, but they recommend using the newer **V2** endpoints - SO USE V2.
- **Key Endpoints (V2 Examples):**
  - **Retrieve Icons:** `GET https://api.thenounproject.com/v2/icons` (Used for searching icons)
  - **Retrieve a Single Icon:** `GET https://api.thenounproject.com/v2/icon/{icon_id}`
  - **Get Usage:** `GET https://api.thenounproject.com/v2/client/usage`

### How to Get Started

1.  **Sign Up/Log In:** You first need a Noun Project account.
2.  **Get API Key & Secret:** Once logged in, you can visit the app management page (linked from the Getting Started guide) to generate your client key and secret.
3.  **Authenticate:** You must use your client key and secret to sign requests using **OAuth 1.0a**. They provide sample code in languages like Python and Ruby.

The API allows you to access millions of icons, search by term, filter results, and get icon assets in **PNG** (all users) and **SVG** (paid plans, or public domain only for free users).

**PEXELS API GUIDE (SEARCH THE WEB ONLINE TO GET MORE DETAILS):**
The Pexels API allows developers to access their vast library of high-quality photos and videos to integrate into apps and websites. Access to the API is free, and the latest version is a simple REST API.

Here are the essential resources for the Pexels API:

### Official Documentation and Getting Started

| Resource                                 | Direct Link                                                                                                                                                                      |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Official API Documentation**           | [https://www.pexels.com/api/documentation/](https://www.pexels.com/api/documentation/)                                                                                           |
| **API Key Request Page**                 | [https://www.pexels.com/api/new/](https://www.google.com/search?q=https://www.pexels.com/api/new/)                                                                               |
| **Guide: How to Get an API Key**         | [https://help.pexels.com/hc/en-us/articles/900004904026-How-do-I-get-an-API-key](https://help.pexels.com/hc/en-us/articles/900004904026-How-do-I-get-an-API-key)                 |
| **Guide: How to Get Unlimited Requests** | [https://help.pexels.com/hc/en-us/articles/900005852323-How-do-I-get-unlimited-requests](https://help.pexels.com/hc/en-us/articles/900005852323-How-do-I-get-unlimited-requests) |

---

### Key API Information

| Detail             | Description                                                                                                                               |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **Base URL**       | `https://api.pexels.com/v1/`                                                                                                              |
| **Authentication** | API Key (sent in the `Authorization` HTTP header).                                                                                        |
| **Default Limits** | 200 requests per hour and 20,000 requests per month.                                                                                      |
| **Core Endpoints** | **Photo Search:** `/v1/search` **Curated Photos:** `/v1/curated` **Video Search:** `/videos/search` **Popular Videos:** `/videos/popular` |

### Getting Started

1.  **Create an Account:** You must first sign up for a free Pexels account.
2.  **Request API Key:** Use the **API Key Request Page** to generate your unique key, which you will receive immediately.
3.  **Make Requests:** Authenticate your calls by including your API key in the `Authorization` header of every request.

**Example Endpoint (Search for Photos):**
`GET https://api.pexels.com/v1/search?query=nature&per_page=1`

### 7.2 Create Art Director Service (`src/services/workplanArtDirectorService.js`)

- [ ] **Task 7.2.1**: Create workplanArtDirectorService file

  - File: `src/services/workplanArtDirectorService.js`
  - Import dependencies:
    - `getPrismaClient` from `@/database`
    - `createLogger` from `@/utils/logger`
    - `LLMClient` from `@/llm/client`
    - `SlideType`, `DocumentStatus` from `@/constants`
    - Design directive schema (to be created)
    - Levitate brand guidelines from constants

- [ ] **Task 7.2.2**: Add Levitate brand guidelines to constants

  - Add `LEVITATE_BRAND_GUIDELINES` object to `src/constants/index.js`:
    ```javascript
    const LEVITATE_BRAND_GUIDELINES = {
      colors: {
        primary: "#1A1A1A",
        secondary: "#FFFFFF",
        accent: "#FF6B35",
        background: "#F5F5F5",
      },
      typography: {
        headingFont: "Inter Bold",
        bodyFont: "Inter Regular",
        headingSizes: [32, 24, 18],
        bodySize: 14,
      },
      iconStyle: "Minimalist, line-based",
      imageStyle: "High-quality, professional, authentic",
    };
    ```
  - Export in module.exports
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 6.3

- [ ] **Task 7.2.3**: Implement `determineLayout(slideType, contentStructure)` static method

  - Create `layoutRules` object mapping slide types to layout types:
    - `INDUSTRY_STRENGTHS` → `"SPLIT_LEFT_RIGHT"`
    - `COMPETITIVE_LANDSCAPE` → `"GRID_3COL"`
    - `MARKET_GAPS` → `"COMPARISON_TABLE"`
    - `BIG_IDEA` → `"CENTERED"`
    - Default → `"FULL_WIDTH"`
  - Return layout type string
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 6.4

- [ ] **Task 7.2.4**: Implement `generateDesignDirectives(slide, contentCopy)` static method
  - Update slide `designStatus` to `GENERATING`
  - Analyze content structure (stats, images, text)
  - Determine optimal layout using `determineLayout()`
  - Select colors from brand guidelines
  - Suggest images & icons using `imageSearchTool`and `iconSearchTool`
  - Define typography hierarchy
  - Use LLM with structured output to generate complete design directive JSON
  - Store in `slide.designDirectives` JSONB field
  - Update slide `designStatus` to `COMPLETED`
  - Return design directive object
  - Handle errors: set status to `FAILED`, log error
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 6.4

### 7.3 Create Design Directive Schema (`src/llm/schemas/workplanSchemas.js`)

- [ ] **Task 7.3.1**: Add design directive schema to workplanSchemas.js
  - Create `designDirectiveSchema`:
    ```javascript
    z.object({
      layoutType: z.enum([
        "SPLIT_LEFT_RIGHT",
        "SPLIT_TOP_BOTTOM",
        "FULL_WIDTH",
        "GRID_2COL",
        "GRID_3COL",
        "CENTERED",
        "TIMELINE",
        "COMPARISON_TABLE",
      ]),
      colorPalette: z.object({
        primary: z.string(),
        secondary: z.string(),
        accent: z.string(),
        background: z.string(),
        text: z.string(),
      }),
      typography: z.object({
        headingFont: z.string(),
        bodyFont: z.string(),
        headingSize: z.number(),
        bodySize: z.number(),
      }),
      visualElements: z.array(
        z.object({
          type: z.enum(["ICON", "IMAGE", "ILLUSTRATION", "CHART", "GRAPH"]),
          description: z.string(),
          url: z.string().url().optional(),
          placement: z.enum([
            "LEFT",
            "RIGHT",
            "TOP",
            "BOTTOM",
            "CENTER",
            "BACKGROUND",
          ]),
          size: z.enum(["SMALL", "MEDIUM", "LARGE", "FULL_WIDTH"]),
        })
      ),
      contentPlacement: z.object({
        statsPosition: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM"]),
        imagePosition: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM", "BACKGROUND"]),
        textAlignment: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFY"]),
        contentMapping: z
          .array(
            z.object({
              contentSection: z.string(),
              placement: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM", "CENTER"]),
              visualElement: z.string().optional(),
              emphasis: z.enum(["NORMAL", "HIGH", "LOW"]).default("NORMAL"),
            })
          )
          .optional(),
      }),
      spacing: z.object({
        sectionSpacing: z.number(),
        elementSpacing: z.number(),
      }),
      specialInstructions: z.string().optional(),
    });
    ```
  - Export schema
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 6.2

### 🔍 **CHECKPOINT 7**: Test Art Director Agent

**Human Action Required**:

- Create test slide with content copy
- Call `WorkplanArtDirectorService.generateDesignDirectives(slide, contentCopy)`
- Verify design directives stored in `designDirectives` field
- Check that layout selection works correctly
- Verify brand guidelines applied
- Test visual element suggestions

---

## Phase 8: Agent E - The Document Builder (Google Docs Renderer)

> **CRITICAL NOTE for Task 8.1:**  
> When fixing or rebuilding the `createFormattedDocument` implementation and related Google Docs integration, you **must** review the detailed documentation and critical findings in [`@AI-Context/Third Party Docs/google_docs_formatted_doc_fixes.md`](../Third%20Party%20Docs/google_docs_formatted_doc_fixes.md). - GO ONLINE AND BROWSE ALL LINKS IN `@AI-Context/Third Party Docs/google_docs_formatted_doc_fixes.md` TO GET MORE INFORMATION .

EVEN THOUGH THEY ARE BREAKING CHANGES WITH THE METHOD YOU CAN PROCEED.

- **VISIT THE LINKS ONLINE** provided in that file for authoritative reference on Google Docs API requests and behavior, especially around `batchUpdate`.
- **READ AND APPLY** the agent notes there:
  - _Index Shifting Problem_
  - _Paragraph vs. Text Style Separation_
  - _Newline Handling_
  - _Image & Table insertion gotchas_
- Following these guides is mandatory to ensure the new `createFormattedDocument` and block processing logic handle all edge cases and formatting needs correctly.

### 8.1 Fix/Rebuild Google Docs Integration (`src/integrations/google.js`)

- [ ] **Task 8.1.1**: Review current `createFormattedDocument` implementation

  - File: `src/integrations/google.js`
  - Review `processDocumentBlocks` method (around line 700+)
  - Identify issues with index tracking or block processing
  - Document current problems

- [ ] **Task 8.1.2**: Rebuild `processDocumentBlocks` method (Option B from implementation plan)

  - Use sequential `batchUpdate` calls (one per slide or major section)
  - Simplify block processing logic
  - Add better error recovery
  - Ensure proper index tracking for insertions
  - Test with sample blocks to verify it works
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 7.1

- [ ] **Task 8.1.3**: Add support for new block types if needed
  - Ensure support for: headings (levels 1-3), paragraphs, bullets, tables, images, spacers
  - Add support for formatting options: bold, italic, underline, strikethrough, text color, background color, links/hyperlinks, font family, font size, alignment (left/center/right/justify), indentation, list nesting (bullets/numbered), horizontal separators + more available through the google docs API.
  - Verify image insertion works with URLs and files.
  - Test formatting (bold, italic, colors)

### 8.2 Create Document Builder Service (`src/services/workplanDocumentBuilderService.js`)

- [ ] **Task 8.2.1**: Create workplanDocumentBuilderService file

  - File: `src/services/workplanDocumentBuilderService.js`
  - Import dependencies:
    - `getPrismaClient` from `@/database`
    - `createLogger` from `@/utils/logger`
    - `googleIntegration` from `@/integrations/google`
    - `DocumentType`, `DocumentStatus`, `CreatedBy` from `@/constants`

- [ ] **Task 8.2.2**: Implement `convertSlideToBlocks(slide)` static method

  - Convert slide data to Google Docs blocks array
  - Structure:
    1. Slide Title (Heading 1)
    2. Slide Type (Heading 2) - "Type of slide: {formatted slide type}"
    3. Spacer
    4. Content Section (Heading 2) - THE ACTUAL CONTENT FOR THE SLIDE
       - Strategic copy (formatted paragraph)
    5. Spacer
    6. Design Directives Section (Heading 2)
       - Design spec (formatted paragraph)
       - Content Placement Instructions (Heading 3) if `contentMapping` exists
       - Visual elements (if any) with image blocks
       - Link blocks below each image/icon/visual element with URL
    7. Spacer
    8. Research Data Section (Heading 2)
       - Sources (bullets) from `metadataInfo.researchSources` only (no JSON dump)
       - Show "[Research data not available]" if no sources
  - Return blocks array
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 7.3

- [ ] **Task 8.2.3**: Implement `formatResearchData(researchData)` helper method

  - Format research data JSON into readable text
  - Include statistics, numbers, key findings
  - Return formatted string

- [ ] **Task 8.2.4**: Implement `formatDesignDirectives(designDirectives)` helper method

  - Format design directive JSON into readable text
  - Include layout, colors, typography, spacing
  - Return formatted string

- [ ] **Task 8.2.5**: Implement `buildGoogleDoc(documentId)` static method

  - Fetch workplan document from database (type=WORKPLAN)
  - Fetch all slides ordered by `slideNumber` (where `documentId` matches)
  - Generate cover page blocks:
    - Levitate Logo (from `BrandAssets.LEVITATE_LOGO_FILE_ID`)
    - Project Name
    - Client Name
  - Generate TOC blocks (auto-generated from slides)
  - For each slide: convert to blocks using `convertSlideToBlocks()`
  - Assemble all blocks in order
  - Call `googleIntegration.createFormattedDocument()` with assembled blocks
  - Update `document.status` to `DocumentStatus.COMPLETED`
  - Update `document.metadataInfo.completedAt` timestamp
  - Create `DocumentRevision` with snapshot text
  - Update document `currentRevisionId`
  - Return Google Doc URL
  - Handle errors and log appropriately
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 7.4

- [ ] **Task 8.2.6**: Handle special slide cases
  - Big Idea slide: Render all 2 options with rationale
  - Market Gaps: Handle 2-page structure (2 separate slides)
  - Competitive Landscape: Handle 2-page structure

### 🔍 **CHECKPOINT 8**: Test Document Builder Agent

**Human Action Required**:

- Create test workplan document with multiple slides
- Call `WorkplanDocumentBuilderService.buildGoogleDoc(documentId)`
- Verify Google Doc created successfully
- Check document structure: cover page, TOC, all slides
- Verify each slide has: Content → Design Directives → Research Data sections
- Verify slide type heading appears below slide title
- Verify TOC includes slide type in format: "Title (Slide Type)"
- Verify links appear below images/icons/visual elements
- Verify research data shows only bullet points (no JSON dump)
- Test with Big Idea slide (2 options)
- Verify images/icons inserted correctly
- Check formatting and styling

---

## Phase 9: Complete Worker Implementation

### 9.1 Implement Main Worker Processor (`src/workers/workplanGeneration.js`)

- [ ] **Task 9.1.1**: Implement full pipeline in `workplanGenerationProcessor`

  - Extract job data: `projectId`, `serviceType: providedServiceType`, `documentId`, `isRegeneration`, `regenerationReason`, `retryCount`
  - Create correlation ID for logging
  - Load project with relations (client, questionnaire, brand origin document)
  - If regeneration: load existing document, incorporate `regenerationReason` as feedback context
  - **Get service type ONCE at start** (checks `project.serviceTypes` cache):
    - If `providedServiceType` exists: use it
    - Otherwise: call `WorkplanPlannerService.getServiceType(projectId)` (uses cache or calls LLM once)
  - Store service type in context: `const context = { projectId, serviceType, ... }`
  - **Important**: All agents use `serviceType` from context - do NOT call `getServiceType()` again

  - **Agent A: The Planner**

    - Call `WorkplanPlannerService.generateTOC(projectId, serviceType, context)`
    - Get document ID and TOC from result
    - Update document status to `RESEARCHING`

  - **Agent B: The Researcher**

    - Fetch all slides for document
    - For each slide: call `WorkplanResearcherService.researchWithFallback(slide, context)`
    - Update slide research status
    - Continue even if some slides fail (flag for manual review)

  - **Agent C: The Strategist**

    - For each slide: call `WorkplanStrategistService.synthesizeSlideContent(slide, researchData, context)`
    - Special handling for Big Idea slide: call `generateBigIdeaOptions()`
    - Update slide content status

  - **Agent D: The Art Director**

    - For each slide: call `WorkplanArtDirectorService.generateDesignDirectives(slide, contentCopy)`
    - Update slide design status

  - **Agent E: The Document Builder**

    - Call `WorkplanDocumentBuilderService.buildGoogleDoc(documentId)`
    - Get Google Doc URL from result

  - Update document status to `COMPLETED`
  - Create audit log entries for each major step
  - Handle errors at each stage with appropriate logging
  - Return success result with document ID and Google Doc URL
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 2.2

- [ ] **Task 9.1.2**: Add retry logic

  - Retry research failures: up to 3 times
  - Retry LLM failures: exponential backoff
  - Retry Google Docs failures: once, then flag for manual review
  - Use `retryCount` from job data
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 9.5

- [ ] **Task 9.1.3**: Add error handling
  - Catch errors at each agent stage
  - Mark workplan as `FAILED` if critical error
  - Log detailed error information
  - Create audit log for failures
  - Notify admin via email if workplan generation fails completely, attach error logs and stack.

### 9.2 Integrate with Asana Project Init (`src/workers/asanaProjectInit.js`)

- [ ] **Task 9.2.1**: Add workplan generation trigger

  - File: `src/workers/asanaProjectInit.js`
  - After project initialization completes (after line 411, before completion email)
  - **Get service type** (uses cache if available, calls LLM if needed):
    ```javascript
    const serviceType = await WorkplanPlannerService.getServiceType(project.id);
    ```
  - Enqueue workplan generation job:
    ```javascript
    await QueueService.addWorkplanGenerationJob(
      {
        projectId: project.id,
        serviceType, // Cached or newly determined
      },
      {
        priority: 5, // High priority
      }
    );
    ```
  - **Note**: Service type is cached in `project.serviceTypes` - subsequent calls will use cache
  - Log workplan job enqueued
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 10.1

- [ ] **Task 9.2.2**: Move completion email to after workplan generation
  - Remove completion email from `asanaProjectInit.js` (currently at line 413)
  - Add completion email sending to workplan generation worker (after document builder completes)
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 10.3

### 9.3 Add Asana Task Creation (`src/workers/workplanGeneration.js`)

- [ ] **Task 9.3.1**: Create Asana task for Creative Director

  - After workplan generation completes successfully
  - Get Creative Director from team members in asana project or fallback to lead creative director in team_members table
  - Use `asanaIntegration.createTask()` to create task:
    - Name: "Review Workplan Document"
    - Assignee: Creative Director's Asana user GID
    - Notes: Include Google Doc URL
    - Due date: 3 business days from now
    - Section: "To Do" section of project board
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 10.2

- [ ] **Task 9.3.2**: Implement `getCreativeDirector(projectId)` helper

  - Get first team meber with role `CREATIVE_DIRECTOR` on the asna initialized project, if no one:
  - Query `team_members` table for members with `CREATIVE_DIRECTOR` role
  - Filter for `isLead: true` in roles JSONB
  - Return lead creative director or first creative director if no lead
  - Handle case where no creative director exists then fallback to selecting PM (preferrably lead PM)

- [ ] **Task 9.3.3**: Send completion email
  - Send email to Creative Director with workplan link
  - Send completion email to Admin, Manager, and PM (moved from asanaProjectInit)
  - Include project name, client name, workplan URL, slide count
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 10.3

### 🔍 **CHECKPOINT 9**: Test Complete Pipeline

**Human Action Required**:

- Trigger Asana project initialization for test project
- Verify workplan generation job enqueued
- Monitor worker logs for each agent stage
- Verify workplan document created in database
- Verify all slides have research, content, and design data
- Verify Google Doc created and accessible
- Verify Asana task created for Creative Director
- Verify completion emails sent
- Test error handling by simulating failures at each stage

---

## Phase 10: AI Agent API Routes for Regeneration

### 10.1 Create Routes (`src/routes/workplan.js`)

- [ ] **Task 10.1.1**: Add slide regeneration endpoint

  - File: `src/routes/workplan.js` (create if doesn't exist)
  - Endpoint: `POST /workplan/:documentId/slide/:slideId/regenerate`
  - Extract `documentId` and `slideId` from params
  - Extract `reason` from request body (optional)
  - Validate slide exists and belongs to document
  - Update slide statuses to `PENDING`:
    - `researchStatus = "PENDING"`
    - `contentStatus = "PENDING"`
    - `designStatus = "PENDING"`
  - Store `regenerationReason` in `metadataInfo`
  - Enqueue slide regeneration job using `QueueService.addSlideRegenerationJob()`
  - Create audit log entry
  - Return success response with standard format
  - Handle errors appropriately
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 9.3

- [ ] **Task 10.1.2**: Add full workplan regeneration endpoint

  - Endpoint: `POST /workplan/:documentId/regenerate`
  - Extract `documentId` from params
  - Extract `reason` from request body (optional)
  - Validate document exists and is type=WORKPLAN
  - Update document `status` to `DocumentStatus.DRAFT`
  - Store `regenerationReason` in `metadataInfo`
  - Update all slides statuses to `PENDING`
  - **Get service type** (uses cache if available): `await WorkplanPlannerService.getServiceType(document.projectId)`
  - Enqueue workplan generation job with `isRegeneration: true`
  - Create audit log entry
  - Return success response
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 9.4

- [ ] **Task 10.1.3**: Add slide regeneration worker processor
  - Create `slideRegenerationProcessor` in `src/workers/workplanGeneration.js`
  - Extract `documentId`, `slideId`, `regenerationReason` from job data
  - Load slide and document
  - Execute only affected agents:
    - If research failed: re-run Agent B (with regenerationReason as feedback)
    - If content failed: re-run Agent C (with regenerationReason as feedback)
    - If design failed: re-run Agent D (with regenerationReason as feedback)
  - Update slide statuses accordingly
  - If document already built, rebuild Google Doc
  - Return success result

### 🔍 **CHECKPOINT 10**: Test Regeneration Endpoints

**Human Action Required**:

- Test slide regeneration endpoint with valid slide ID
- Verify slide statuses reset to PENDING
- Verify regeneration job enqueued
- Test full workplan regeneration endpoint
- Verify all slides reset and workplan regenerated
- Test error handling with invalid IDs
- Verify audit logs created

---

## Phase 11: Service Integration & Helper Functions

### 11.1 Create Workplan Service (`src/services/workplanService.js`)

- [ ] **Task 11.1.1**: Create workplanService file

  - File: `src/services/workplanService.js`
  - Import `getPrismaClient` from `@/database`
  - Import `createLogger` from `@/utils/logger`
  - Import workplan enums from `@/constants`

- [ ] **Task 11.1.2**: Implement helper functions

  - `getWorkplanByProjectId(projectId)` - Get workplan document for project
  - `getWorkplanSlides(documentId)` - Get all slides for workplan, ordered by slideNumber
  - `getSlideById(slideId)` - Get single slide with document relation
  - `updateSlideStatus(slideId, statusFields)` - Update slide status fields
  - `getWorkplanStatus(documentId)` - Get current workplan status from document.status field
  - **Note**: Service type helpers are in `WorkplanPlannerService` (see Task 4.1.4):
    - `getServiceType(projectId, forceRefresh)` - Main entry point (uses cache)
    - `getServiceTypeMatches(projectId)` - Get full array for inspection
    - `getHighestRatedServiceType(serviceMatches)` - Extract highest-rated from array

- [ ] **Task 11.1.3**: Export service functions
  - Export all helper functions

### 11.2 Update Service Index (`src/services/index.js`)

- [ ] **Task 11.2.1**: Export workplan services
  - Add exports for:
    - `WorkplanPlannerService`
    - `WorkplanResearcherService`
    - `WorkplanStrategistService`
    - `WorkplanArtDirectorService`
    - `WorkplanDocumentBuilderService`
    - `WorkplanService`

### 🔍 **CHECKPOINT 11**: Verify Service Integration

**Human Action Required**:

- Test all helper functions with sample data
- Verify service exports work correctly
- Check that services can be imported from `@/services`

---

## Phase 12: Edge Cases & Error Handling

### 12.1 Handle Edge Cases

- [ ] **Task 12.1.1**: Handle unknown service types

  - Ensure `GENERAL` fallback works correctly
  - Log warnings when unknown service type detected
  - Verify core slides always included

- [ ] **Task 12.1.2**: Handle missing research data

  - Ensure fallback data used when research fails
  - Flag slides for manual review
  - Continue pipeline even with partial research

- [ ] **Task 12.1.3**: Handle Big Idea slide generation

  - Ensure 2 options always generated
  - Store options in metadataInfo correctly
  - Render both options in Google Doc

- [ ] **Task 12.1.4**: Handle Market Gaps 2-page structure

  - Ensure 2 separate slides created (MARKET_GAPS and MARKET_GAPS_RESPONSE)
  - Verify correct slide numbers assigned
  - Test rendering in Google Doc

- [ ] **Task 12.1.5**: Handle region detection fallback

  - Ensure "Nigeria" used as default when region not specified
  - Verify region replacement in research queries works

- [ ] **Task 12.1.6**: Handle Google Docs creation failures
  - Retry once on failure
  - Flag for manual review if retry fails
  - Log detailed error information
  - Don't mark workplan as failed if only Doc creation fails (keep data in DB)

### 12.2 Quality Control

- [ ] **Task 12.2.1**: Implement content quality validation

  - Check for specific numbers (not vague statements)
  - Verify source citations present
  - Check for actionable insights (not generic fluff)
  - Validate strategic depth
  - Reference: `AI-Context/Implementation-Plan-Step-8.md` → Section 9.2

- [ ] **Task 12.2.2**: Add quality scoring
  - Calculate quality score for each slide
  - Store in `slide.qualityScore` field
  - Use for flagging slides that need improvement

### 12.3 Update Email Templates (`src/services/emailTemplateService.js`)

- [ ] **Task 12.3.1**: Add workplan completion email template

  - Create template for Creative Director
  - Include: project name, client name, workplan URL, slide count
  - Add "View Workplan" button linking to Google Doc
  - Reference existing email template patterns
  - Send this email to the cretive director after the completion email has been sent.

### 12.4: Refactor to Centralized Constants

- [ ] **Task 12.4.1**: Refactor to Centralized Constants
- Move all constant values (enums, status keys, service types, asset URLs, etc.) to `src/constants/index.js`
- Replace hardcoded strings in service, model, and integration code with imports from `@/constants`
- Ensure no logic or switch statements depend on raw string literals for business/domain values
- Update tests and helper files to use centralized constants
- Do **not** break existing functionality; verify all usages are properly refactored and regression tested

### 🔍 **CHECKPOINT 12**: Test Edge Cases

**Human Action Required**:

- Test with unknown service type
- Test with research API failures
- Test Big Idea generation
- Test Market Gaps 2-page structure
- Test region detection fallback
- Test Google Docs failure recovery
- Verify quality validation works
- Test with missing data scenarios

---

## Phase 13: Final Integration & Testing

### 13.1 Update Email Templates (`src/services/emailTemplateService.js`)

- [ ] **Task 13.1.1**: Add workplan completion email template

  - Create template for Creative Director
  - Include: project name, client name, workplan URL, slide count
  - Add "View Workplan" button linking to Google Doc
  - Reference existing email template patterns
  - Send this after the completion email has been sent

### 13.3 Final Testing

- [ ] **Task 13.3.1**: End-to-end test complete flow

  - Create test project with questionnaire
  - Complete brand origin acceptance
  - Complete quote acceptance
  - Trigger Asana project initialization
  - Verify workplan generation completes
  - Verify all agents executed successfully
  - Verify Google Doc created correctly
  - Verify Asana task created
  - Verify emails sent

- [ ] **Task 13.3.2**: Test regeneration flows

  - Test slide regeneration
  - Test full workplan regeneration
  - Verify feedback incorporated correctly

- [ ] **Task 13.3.3**: Performance testing
  - Test with multiple projects
  - Verify queue processing works correctly
  - Check for memory leaks or performance issues
  - Monitor API rate limits (Tavily, Google, LLM)

### 🔍 **CHECKPOINT 13**: Final Verification

**Human Action Required**:

- Complete end-to-end test with real project data
- Verify all features work as expected
- Test error scenarios and recovery
- Verify performance is acceptable
- Check logs for any errors or warnings
- Verify database queries are efficient
- Test with different service types
- Verify all checkpoints passed

---

## Phase 14: Documentation & Cleanup

### 14.1 Code Documentation

- [ ] **Task 14.1.1**: Add JSDoc comments to all service methods

  - Document parameters, return values, errors
  - Add usage examples where helpful

- [ ] **Task 14.1.2**: Document complex algorithms in `guides` directory at project root - all in one file.
  - Document research strategy selection
  - Document layout determination logic
  - Document service type mapping

### 14.2 Update Implementation Plan

- [ ] **Task 14.2.1**: Update implementation plan for step 8 with any deviations - READ CODES TO FIND OUT, IF NO DEVIATIONS DO NOT TOUCH THE STEP 8 IMPLEMENTATION PLAN
  - Document any changes from original plan
  - Note any issues encountered and solutions

### 14.3 Cleanup

- [ ] **Task 14.3.1**: Remove any temporary test code

  - Clean up console.logs
  - Remove commented-out code

- [ ] **Task 14.3.2**: Verify all imports are used
  - Remove unused imports
  - Fix any linting errors

### 🔍 **FINAL CHECKPOINT**: Production Readiness

**Human Action Required**:

- Review all code for quality
- Verify all tests pass
- Check documentation is complete
- Verify environment variables documented
- Review error handling is comprehensive
- Verify logging is adequate
- Check performance metrics
- Get approval for deployment

---

## 🎯 **SUCCESS CRITERIA**

The implementation is complete when:

1. ✅ All tasks above are checked off
2. ✅ All checkpoints have been passed
3. ✅ Workplan generation completes successfully for all service types
4. ✅ All 5 agents execute correctly in sequence
5. ✅ Google Doc is created with proper structure (Content → Design Directives → Research Data)
6. ✅ Research data has traceable sources
7. ✅ Content synthesis follows BRICS framework
8. ✅ Design directives are complete and actionable
9. ✅ Regeneration flows work correctly
10. ✅ Integration with Asana project initialization works
11. ✅ Error handling is robust
12. ✅ Performance is acceptable
13. ✅ Code quality meets production standards
14. ✅ Saves the designer and creative team 100% cognitive loaand they don't have to research or think when designing the workplan.

---

## 📝 **IMPORTANT NOTES**

- Each task should be completed fully before moving to the next
- If any checkpoint fails, resolve issues before continuing
- Follow existing code patterns and conventions
- Ensure all database operations use Prisma client
- All LLM calls should use structured outputs with Zod schemas
- All external API calls should have retry logic and error handling
- Log all important actions for debugging and audit
- Test thoroughly at each checkpoint to catch issues early
- Reference `AI-Context/Implementation-Plan-Step-8.md` for detailed specifications

### ⚠️ **CRITICAL: Service Type Caching**

- **Service type is determined ONCE per project** using LLM and cached in `project.serviceTypes` JSONB field
- **Always use `WorkplanPlannerService.getServiceType(projectId)`** - it checks cache first
- **Get service type at pipeline start** and pass through context to all agents
- **DO NOT call `getServiceType()` multiple times** - it's cached, so use the value from context
- **Full LLM output stored** in `project.serviceTypes`: `[{serviceType, rating, reasoning}, ...]`
- **Highest-rated match selected** when service type is needed (rating >= 5, otherwise "GENERAL")
- See `AI-Context/Implementation-Plan-Step-8.md` → Section 10.1 for full architecture
