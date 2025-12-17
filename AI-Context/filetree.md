# Levitate Studios AI Agent - Comprehensive File Tree Documentation

> **Purpose**: This document provides a detailed structural overview of the codebase, explaining patterns, relationships, and architectural decisions without requiring code reading.

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Root Directory Structure](#root-directory-structure)
3. [Source Code Structure (`src/`)](#source-code-structure-src)
4. [Database & Schema (`prisma/`)](#database--schema-prisma)
5. [Configuration & Scripts](#configuration--scripts)
6. [Documentation & Guides](#documentation--guides)
7. [Key Patterns & Conventions](#key-patterns--conventions)
8. [Data Flow & Component Interactions](#data-flow--component-interactions)

---

## Architecture Overview

### System Type

**AI-Powered Project Management Automation Platform**

This is a Node.js/Express backend system that automates client project workflows from initial questionnaire submission through project finalization. It integrates with multiple external services (Google Workspace, Asana, Brevo, Levitate ERP) and uses AI/LLM capabilities for document generation, email intent detection, and strategic planning.

### Core Architecture Pattern

**Layered Architecture with Queue-Based Background Processing**

```
┌─────────────────────────────────────────────────────────┐
│                    API Layer (Express)                   │
│  Routes → Middleware → Controllers (via Services)       │
└──────────────────────┬──────────────────────────────────┘
                        │
┌──────────────────────▼──────────────────────────────────┐
│              Service Layer (Business Logic)             │
│  Services orchestrate integrations, LLM calls, DB ops   │
└──────────────────────┬──────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
┌───────▼────────┐          ┌─────────▼──────────┐
│  Queue System   │          │  Database Layer    │
│  (BullMQ/Redis) │          │  (Prisma/Postgres) │
└───────┬────────┘          └────────────────────┘
        │
┌───────▼────────────────────────────────────────┐
│         Background Workers                      │
│  Process async jobs (AI, integrations, etc.)   │
└────────────────────────────────────────────────┘
```

### Key Technologies

- **Runtime**: Node.js 18+ (JavaScript/ES6+)
- **Framework**: Express.js 5.x
- **Database**: PostgreSQL with Prisma ORM
- **Queue System**: BullMQ with Redis
- **AI/LLM**: Vercel AI SDK (OpenAI, Anthropic, Groq)
- **External APIs**: Google Workspace, Asana, Brevo, Tavily, Levitate ERP

---

## Root Directory Structure

```
Levitate-Studios-AI-Agent/
│
├── 📁 AI-Context/                    # AI documentation and context files
│   ├── About This Project.md         # Project overview and goals
│   ├── Implementation Plan.md        # Development roadmap
│   ├── filetree.md                   # This file - codebase structure doc
│   ├── AI-Agent-UI-Design-Specification.md
│   └── Third Party Docs/             # External API documentation references
│
├── 📁 guides/                        # Internal development guides
│   ├── erp-integration-patterns.md    # ERP integration best practices
│   ├── quote-generation-workflow.md  # Quote generation process docs
│   └── team-member-selection-algorithm.md
│
├── 📁 prisma/                        # Database schema and migrations
│   ├── schema.prisma                 # Prisma schema definition
│   └── migrations/                   # Database migration history
│
├── 📁 scripts/                       # Utility and seeding scripts
│   ├── seed-rate-card.js             # Seed rate card data
│   ├── seed-team-members.js          # Seed team member data
│   └── tests/                        # Standalone test scripts
│
├── 📁 src/                           # Main application source code
│   ├── config/                       # Configuration management
│   ├── constants/                    # Application constants/enums
│   ├── database/                     # Database connection setup
│   ├── integrations/                 # External API integrations
│   ├── llm/                          # AI/LLM client and tools
│   ├── middleware/                   # Express middleware
│   ├── monitoring/                   # Queue monitoring tools
│   ├── queues/                       # Queue definitions and service
│   ├── routes/                       # API route handlers
│   ├── services/                     # Business logic layer
│   ├── test/                         # Test setup utilities
│   ├── utils/                        # Utility functions
│   ├── workers/                      # Background job processors
│   ├── process-manager.js            # Multi-process orchestrator
│   └── server.js                     # Main Express server entry point
│
├── 📄 package.json                   # Dependencies and npm scripts
├── 📄 package-lock.json              # Locked dependency versions
├── 📄 .env.example                   # Environment variable template
├── 📄 .eslintrc.json                 # ESLint configuration
├── 📄 .gitignore                     # Git ignore patterns
├── 📄 jsconfig.json                  # JavaScript project config (path aliases)
├── 📄 tsconfig.json                  # TypeScript config (for type checking)
├── 📄 jest.config.js                 # Jest test configuration
├── 📄 README.md                      # Project README
└── 📄 LICENSE                        # Apache 2.0 License
```

---

## Source Code Structure (`src/`)

### `src/config/`

**Purpose**: Centralized configuration management with environment variable validation

```
src/config/
├── index.js                          # Main config export (validated env vars)
└── index-file.js                     # File-based config (if needed)
```

**Pattern**: Uses Joi for environment variable validation. Exports frozen `appConfig` object to prevent runtime modifications.

**Key Sections**:

- Database configuration
- Redis configuration
- Server settings (port, JWT secret, URLs)
- Google Workspace API credentials
- Brevo email service config
- Asana API credentials
- Levitate ERP integration config
- LLM provider API keys (OpenAI, Anthropic, Groq)
- Tavily research API key
- Design asset API keys (Pexels, Noun Project)

---

### `src/constants/`

**Purpose**: Application-wide constants and enums for type safety

```
src/constants/
└── index.js                          # All constants exported
```

**Key Constant Groups**:

- `ProjectPhase`: Project lifecycle phases (QUESTIONNAIRE → BRAND_ORIGIN → QUOTE_DOCUMENT → FINALIZED/REJECTED)
- `DocumentType`: Document types (BRAND_ORIGIN, QUOTE, QUOTE_VARIANT, WORKPLAN)
- `DocumentStatus`: Document workflow statuses
- `WorkplanServiceType`: Service types for workplan generation
- `SlideType`: Workplan slide types
- `EmailIntent`: Detected email intents (ACCEPT, REJECT, DOC_FEEDBACK, etc.)
- `TeamRole`: Team member roles
- `AuditActions`: System audit log action types
- `BrandAssets`: Brand asset file IDs and URLs
- `LEVITATE_BRAND_GUIDELINES`: Design system constants

**Pattern**: All constants are exported as objects with uppercase keys for consistency and IDE autocomplete support.

---

### `src/database/`

**Purpose**: Database connection and Prisma client initialization

```
src/database/
└── index.js                          # Prisma client factory
```

**Pattern**: Creates singleton Prisma client instance with connection pooling. Handles graceful disconnection.

---

### `src/integrations/`

**Purpose**: Wrapper classes/modules for external API integrations

```
src/integrations/
├── index.js                          # Exports all integrations
├── asana.js                          # Asana API client (projects, tasks, boards)
├── brevo.js                          # Brevo email API client for sending email (send, inbound webhooks)
├── google.js                         # Google Workspace APIs (Docs, Drive, Forms)
├── levitateStudiosErp.js             # Levitate ERP API client (quotes, invoices)
└── tavily.js                         # Tavily research API client (web research)
```

**Pattern**: Each integration module:

- Encapsulates API-specific authentication
- Provides typed methods for common operations
- Handles rate limiting and retries
- Returns standardized error formats
- Logs all external API calls

**Key Responsibilities**:

- **asana.js**: Project/board creation, task management, webhook handling
- **brevo.js**: Email sending, inbound email processing, webhook verification
- **google.js**: Google Docs creation/editing, Drive file management, Forms processing
- **levitateStudiosErp.js**: Quote/invoice generation, financial document management
- **tavily.js**: Web research for workplan slides, market data gathering

---

### `src/llm/`

**Purpose**: AI/LLM client abstraction and tool definitions

```
src/llm/
├── index.js                          # Main LLM client exports
├── client.js                         # LLM client factory (OpenAI/Anthropic/Groq)
├── schemas.js                        # Zod schemas for structured outputs
├── schemas/
│   └── workplanSchemas.js           # Workplan-specific schemas
├── tools.js                          # Tool registry and definitions
└── tools/
    ├── designTools.js                # Design-related LLM tools
    └── researchTools.js              # Research-related LLM tools
```

**Pattern**:

- Uses Vercel AI SDK for provider abstraction
- Tool calling pattern for structured outputs
- Schema validation with Zod
- Provider selection based on task type (cost/performance optimization)

**Key Components**:

- **client.js**: Factory function that creates LLM clients with appropriate provider
- **schemas.js**: Zod schemas for document generation, email intent detection, etc.
- **tools.js**: Registry of available tools (design generation, research, etc.)

---

### `src/middleware/`

**Purpose**: Express middleware for request processing

```
src/middleware/
├── index.js                          # Exports all middleware
├── auth.js                           # JWT authentication middleware
├── cors.js                           # CORS configuration
├── errorHandler.js                   # Global error handling
├── logging.js                        # Request logging and tracking
├── rateLimit.js                      # Rate limiting per endpoint
└── validation.js                     # Request validation middleware
```

**Pattern**: Each middleware module exports functions that can be used in route definitions. Error handler must be last in the middleware chain.

**Key Middleware**:

- **auth.js**: Validates JWT tokens for protected routes (action links)
- **errorHandler.js**: Centralized error handling with structured responses
- **logging.js**: Request/response logging with correlation IDs
- **validation.js**: Request body/query validation using Joi schemas
- **rateLimit.js**: Per-endpoint rate limiting (webhooks vs. API vs. actions)

---

### `src/monitoring/`

**Purpose**: Queue and system monitoring tools

```
src/monitoring/
└── queueMonitor.js                   # BullMQ queue monitoring dashboard
```

**Pattern**: Uses Bull Board for visual queue monitoring. Can run as separate process.

---

### `src/queues/`

**Purpose**: BullMQ queue definitions and queue service

```
src/queues/
└── index.js                          # Queue setup and QueueService class
```

**Pattern**:

- Centralized queue definitions
- `QueueService` class provides typed methods for adding jobs
- Deduplication keys prevent duplicate jobs
- Priority system for urgent jobs (regenerations, client feedback)

**Queue Types**:

- `doc-generation`: Document generation (brand origin, quotes)
- `email-intent`: Email intent detection and processing
- `asana-sync`: Asana task/project synchronization
- `asana-project-init`: Project initialization in Asana
- `quote-generation`: Quote document generation
- `notifications`: Email notifications
- `snapshot-sync`: Google Docs snapshot synchronization
- `workplan-generation`: Workplan document generation

**QueueService Methods**:

- `addDocumentGenerationJob()`: Generic document generation
- `addBrandOriginGenerationJob()`: Brand origin with deduplication
- `addQuoteGenerationJob()`: Quote generation
- `addWorkplanGenerationJob()`: Workplan generation
- `addEmailParseJob()`: Email intent detection
- Plus queue management methods (pause, resume, stats, etc.)

---

### `src/routes/`

**Purpose**: API route definitions and handlers

```
src/routes/
├── index.js                          # Main router that mounts all sub-routers
├── actions.js                        # Action routes (email link handlers)
├── admin.js                          # Admin interface routes
├── forms.js                          # Form submission routes
├── health.js                         # Health check endpoints
├── tests.js                          # Test/debug routes
├── webhooks.js                       # Webhook endpoints (Brevo, Asana, Apps Script)
└── workplan.js                       # Workplan-specific routes
```

**Pattern**:

- Each route file exports a router
- Routes delegate to services (not direct database access)
- Validation middleware applied per route
- Error handling via asyncHandler wrapper

**Route Categories**:

- **webhooks.js**: External webhook receivers (Brevo inbound emails, Asana events, Google Forms)
- **actions.js**: JWT-protected action endpoints (document review, send to client, confirm acceptance)
- **admin.js**: Admin interface for viewing projects, clients, documents
- **forms.js**: Google Forms submission processing
- **workplan.js**: Workplan generation and management endpoints
- **health.js**: System health checks (`/healthz`, `/readyz`)

---

### `src/services/`

**Purpose**: Business logic layer - orchestrates integrations, LLM calls, and database operations

```
src/services/
├── index.js                          # Service exports
│
├── Core Services (Project/Client Management)
├── actionService.js                  # Action link token generation/validation
├── clientService.js                  # Client CRUD operations
├── projectService.js                 # Project lifecycle management
│
├── Document Services
├── documentSendingService.js         # Document sending to clients
├── brandOriginContextService.js      # Brand origin context building
├── brandOriginPromptService.js       # Brand origin prompt generation
├── quoteService.js                   # Quote generation and management
├── quotePromptService.js             # Quote prompt generation
│
├── Workplan Services (Multi-stage AI generation)
├── workplanService.js                # Workplan orchestration
├── workplanPlannerService.js         # Workplan structure planning
├── workplanResearcherService.js      # Research data gathering
├── workplanStrategistService.js      # Strategy and content generation
├── workplanArtDirectorService.js     # Design directive generation
├── workplanDocumentBuilderService.js # Google Docs document building
│
├── Integration Services
├── asanaPendingProjectsService.js    # Pending projects board management
├── asanaProjectService.js            # Production project board management
├── emailInboundService.js            # Inbound email processing
├── emailTemplateService.js          # Email template management
│
├── AI/LLM Services
├── intentPromptService.js            # Email intent detection prompts
│
├── Utility Services
├── formSubmissionService.js          # Google Forms processing
├── teamMemberSelectionService.js     # Team member assignment logic
└── rejectionConfirmationService.js  # Project rejection handling
```

**Pattern**:

- Services are stateless classes or modules with static/instance methods
- Services coordinate between integrations, LLM, and database
- No direct route handlers in services (separation of concerns)
- Services throw errors that are caught by error handler middleware

**Service Responsibilities**:

- **Core Services**: Manage entities (Client, Project) and their lifecycle
- **Document Services**: Handle document sending (email sending done via `brevoIntegration` directly)
- **Workplan Services**: Multi-stage AI pipeline (plan → research → strategy → design → build)
- **Integration Services**: Wrap external API calls with business logic (email sending via `@/integrations/brevo.js`)
- **AI Services**: Generate prompts and orchestrate LLM calls

---

### `src/utils/`

**Purpose**: Reusable utility functions and helpers

```
src/utils/
├── index.js                          # Main utility exports
├── logger.js                         # Structured logging (Pino)
├── errors.js                         # Custom error classes
├── validation.js                     # Validation utilities
├── globalConfig.js                   # Global configuration helpers
└── validation/
    ├── commonValidation.js           # Common validation schemas
    ├── formValidation.js             # Form-specific validation
    └── webhookValidation.js          # Webhook validation schemas
```

**Pattern**:

- Utility functions are pure functions where possible
- Logger uses structured logging with correlation IDs
- Custom error classes for different error types
- Validation uses Joi schemas

**Key Utilities**:

- **logger.js**: Pino-based structured logging with levels and context
- **errors.js**: Custom error classes (ValidationError, NotFoundError, etc.)
- **validation.js**: Joi validation schemas and helpers
- **index.js**: General utilities (UUID generation, token creation, text manipulation, etc.)

---

### `src/workers/`

**Purpose**: Background job processors that consume queue jobs

```
src/workers/
├── index.js                          # Worker orchestrator (starts all workers)
├── documentGeneration.js             # Processes document generation jobs
├── emailIntent.js                    # Processes email intent detection
├── asanaProjectInit.js               # Processes Asana project initialization
├── quoteGeneration.js                # Processes quote generation jobs
└── workplanGeneration.js            # Processes workplan generation jobs

Note: The following workers are placeholders and not yet implemented:
- asanaSync.js                      # Placeholder - Asana sync jobs
- notifications.js                  # Placeholder - Notification jobs
- snapshotSync.js                   # Placeholder - Google Docs snapshot sync
```

**Pattern**:

- Each worker file exports a processor function
- Processors receive job data and return results
- Workers handle errors and retries automatically (via BullMQ)
- Workers call services to perform actual work

**Worker Flow**:

1. Job added to queue via `QueueService`
2. Worker picks up job from queue
3. Processor function executes
4. Processor calls relevant services
5. Services orchestrate integrations/LLM/DB
6. Result returned (or error thrown for retry)

**Key Workers**:

- **documentGeneration.js**: Generates brand origin and quote documents
- **workplanGeneration.js**: Multi-stage workplan generation pipeline
- **emailIntent.js**: Detects intent in inbound emails and triggers actions
- **asanaProjectInit.js**: Creates Asana projects and assigns tasks
- **quoteGeneration.js**: Generates quotes with variants via ERP integration

---

### `src/server.js`

**Purpose**: Main Express application entry point

**Key Responsibilities**:

- Express app initialization
- Middleware setup (security, CORS, logging, parsing)
- Route mounting
- Database connection
- Graceful shutdown handling
- Global error handlers

**Startup Sequence**:

1. Load configuration
2. Initialize database connection
3. Setup middleware
4. Mount routes
5. Start HTTP server
6. Setup graceful shutdown handlers

---

### `src/process-manager.js`

**Purpose**: Orchestrates multiple Node.js processes (server, workers, monitor)

**Pattern**: Spawns child processes for:

- API server (`src/server.js`)
- Background workers (`src/workers/index.js`)
- Queue monitor (`src/monitoring/queueMonitor.js`)

Used in production to run all processes from a single entry point.

---

## Database & Schema (`prisma/`)

### `prisma/schema.prisma`

**Purpose**: Database schema definition using Prisma ORM

**Key Models**:

#### Core Entities

- **Client**: Client information and context
- **Project**: Project lifecycle and phase tracking
- **ProjectPhaseLog**: Audit trail of phase transitions

#### Document Management

- **Document**: Document metadata (type, status, Google Drive file ID)
- **DocumentRevision**: Version history with snapshots
- **WorkplanSlide**: Individual workplan slide data and status

#### Communication

- **EmailThread**: Email thread tracking (unique reply-to addresses)
- **Email**: Individual email messages with intent detection results

#### Project Management

- **AsanaLink**: Links between projects and Asana boards/tasks
- **AsanaTask**: Asana task metadata and assignments

#### Team & Configuration

- **TeamMember**: Team member information and Asana user mapping
- **GlobalConfig**: System-wide configuration key-value store

#### Workflow

- **QuestionnaireResponse**: Google Forms submission tracking
- **JobRun**: Background job execution tracking
- **WebhookSubscription**: External webhook subscription management
- **AuditLog**: System audit trail

**Pattern**:

- Snake_case database columns (PostgreSQL convention)
- camelCase Prisma model fields
- Relations defined with foreign keys
- Cascade deletes for dependent records
- JSON/JSONB fields for flexible data storage

---

### `prisma/migrations/`

**Purpose**: Database migration history

Each migration directory contains:

- `migration.sql`: SQL statements for schema changes
- Migration files are timestamped and sequential

---

## Configuration & Scripts

### Root Configuration Files

**`package.json`**:

- Dependencies: Express, Prisma, BullMQ, AI SDK, Google APIs, etc.
- Scripts:
  - `dev`: Development server with nodemon
  - `start`: Production server (via process-manager)
  - `start:worker`: Background workers
  - `db:*`: Database commands (generate, push, migrate, studio)
  - `test`: Jest test runner

**`jsconfig.json`**:

- Configures path aliases (`@/` → `src/`)
- Enables absolute imports throughout codebase

**`.eslintrc.json`**:

- ESLint configuration for code quality

**`jest.config.js`**:

- Jest test configuration

**`env.example`**:

- Template for required environment variables
- Documents all configuration options

---

### `scripts/`

**Purpose**: Utility scripts for seeding and testing

```
scripts/
├── seed-rate-card.js                 # Seeds rate card data (pricing)
├── seed-team-members.js              # Seeds team member data
└── tests/                            # Standalone test scripts
    ├── test-createFormattedDocument.js
    ├── test-design-tools.js
    ├── test-documentGeneration-formattedDocument.js
    └── test-tavily-integration.js
```

---

## Documentation & Guides

### `AI-Context/`

**Purpose**: AI agent context and project documentation

Contains:

- Project overview and goals
- Implementation plans
- UI design specifications
- Third-party API documentation references
- Todo lists for features

### `guides/`

**Purpose**: Internal development guides

- **erp-integration-patterns.md**: Best practices for ERP integration
- **quote-generation-workflow.md**: Quote generation process documentation
- **team-member-selection-algorithm.md**: Team assignment logic documentation

---

## Key Patterns & Conventions

### 1. **Layered Architecture**

```
Routes → Services → Integrations/LLM/Database
```

- Routes handle HTTP concerns (validation, auth)
- Services contain business logic
- Integrations/LLM/Database are infrastructure

### 2. **Queue-Based Async Processing**

- Long-running tasks (AI generation, external API calls) are queued
- Workers process jobs asynchronously
- Deduplication keys prevent duplicate work
- Priority system for urgent jobs

### 3. **Service Layer Pattern**

- Services are stateless and reusable
- Services coordinate multiple dependencies
- No direct database access from routes
- Services throw errors (caught by middleware)

### 4. **Integration Abstraction**

- Each external API has a dedicated integration module
- Integrations handle auth, rate limiting, retries
- Services use integrations (not direct API calls)

### 5. **LLM Tool Calling Pattern**

- Structured outputs via Zod schemas
- Tool calling for complex operations
- Provider abstraction via Vercel AI SDK
- Cost/performance optimization per task type

### 6. **Error Handling**

- Custom error classes for different error types
- Global error handler middleware
- Structured error responses
- Error logging with context

### 7. **Logging**

- Structured logging with Pino
- Correlation IDs for request tracking
- Log levels (error, warn, info, debug)
- Contextual logging (user, project, job ID)

### 8. **Configuration Management**

- Environment variables validated with Joi
- Frozen config object (prevents runtime changes)
- Centralized config access via `@/config`

### 9. **Path Aliases**

- `@/` prefix maps to `src/`
- Enables clean imports: `require("@/services/projectService")`
- Configured in `jsconfig.json`

### 10. **Database Patterns**

- Prisma ORM for type-safe database access
- Migrations for schema changes
- Relations defined in schema
- JSON/JSONB for flexible data storage

---

## Data Flow & Component Interactions

### 1. **Questionnaire Submission Flow**

```
Google Forms → Webhook → forms.js route
  → formSubmissionService
    → Creates Client & Project (Prisma)
    → Adds to Asana Pending Board (asanaPendingProjectsService)
    → Queues Brand Origin Generation
      → Worker processes job
        → brandOriginPromptService generates prompt
        → LLM generates content
        → google.js creates Google Doc
        → Database saves document metadata (Prisma)
        → brevoIntegration sends email to PM for review
```

### 2. **Document Generation Flow**

```
Route/Webhook → QueueService.addDocumentGenerationJob()
  → Queue (BullMQ)
    → Worker picks up job
      → documentGeneration processor
        → Appropriate prompt service (brandOrigin/quote/workplan)
        → LLM client generates content
        → google.js creates/updates Google Doc
        → Database saves revision (Prisma)
        → brevoIntegration sends notification email
```

### 3. **Email Intent Detection Flow**

```
Brevo Inbound Webhook → webhooks.js route
  → emailInboundService
    → QueueService.addEmailParseJob()
      → Queue
        → emailIntent worker
          → intentPromptService generates prompt
          → LLM detects intent
          → Database updates email record (Prisma)
          → Triggers appropriate action (regeneration, acceptance, etc.)
```

### 4. **Workplan Generation Flow** (Multi-Stage)

```
Route → QueueService.addWorkplanGenerationJob()
  → Queue
    → workplanGeneration worker
      → workplanPlannerService (Stage 1: Plan structure)
      → workplanResearcherService (Stage 2: Research slides)
      → workplanStrategistService (Stage 3: Generate content)
      → workplanArtDirectorService (Stage 4: Generate design directives)
      → workplanDocumentBuilderService (Stage 5: Build Google Doc)
      → Database saves document (Prisma)
      → brevoIntegration sends notification email
```

### 5. **Asana Project Initialization Flow**

```
Project Phase Change → projectService
  → QueueService.addAsanaProjectInitJob()
    → Queue
      → asanaProjectInit worker
        → asanaIntegration creates project board
        → asanaIntegration creates sections
        → teamMemberSelectionService selects team
        → asanaIntegration creates tasks with assignments
        → LLM generates task guidance
        → Database saves asanaLink (Prisma)
```

### 6. **Quote Generation Flow**

```
Project Phase Change → quoteService
  → QueueService.addQuoteGenerationJob()
    → Queue
      → quoteGeneration worker
        → quotePromptService generates prompt
        → LLM generates quote content
        → levitateStudiosErp.js creates quote in ERP
        → levitateStudiosErp.js creates 3 variants
        → google.js creates Google Docs for each
        → Database saves all documents (Prisma)
        → brevoIntegration sends email to Finance Manager
```

---

## Important File Relationships

### Configuration Chain

```
.env → src/config/index.js → appConfig (frozen object)
  → Used throughout codebase via require("@/config")
```

### Database Chain

```
prisma/schema.prisma → Prisma Client → src/database/index.js
  → Used in services via require("@/database")
```

### Queue Chain

```
src/queues/index.js (QueueService) → BullMQ Queues → Redis
  → src/workers/index.js (Workers) → src/workers/*.js (Processors)
```

### Route Chain

```
src/server.js → src/routes/index.js → src/routes/*.js
  → Services (src/services/*.js)
    → Integrations (src/integrations/*.js)
    → LLM (src/llm/*.js)
    → Database (Prisma)
```

### Constants Chain

```
src/constants/index.js → Exported constants
  → Used in services, workers, routes for type safety
```

---

## Codebase Patterns Summary

### File Naming Conventions

- **Services**: `*Service.js` (e.g., `projectService.js`)
- **Workers**: `*.js` in `workers/` (e.g., `documentGeneration.js`)
- **Integrations**: `*.js` in `integrations/` (e.g., `asana.js`)
- **Routes**: `*.js` in `routes/` (e.g., `webhooks.js`)
- **Middleware**: `*.js` in `middleware/` (e.g., `auth.js`)

### Import Patterns

- Absolute imports: `require("@/services/projectService")`
- Relative imports: Only within same directory
- Constants: `require("@/constants")`
- Config: `require("@/config")`

### Error Handling Pattern

```javascript
try {
  // Operation
} catch (error) {
  logger.error({ error, context }, "Operation failed");
  throw error; // Let middleware handle
}
```

### Service Method Pattern

```javascript
static async methodName(params) {
  // Validation
  // Database operations
  // Integration calls
  // Return result
}
```

### Worker Processor Pattern

```javascript
const processor = async (job) => {
  const { data } = job;
  // Call services
  // Handle errors (thrown errors trigger retry)
  return result;
};
```

---

## Entry Points

1. **API Server**: `src/server.js` (or `npm start` → `src/process-manager.js`)
2. **Workers**: `src/workers/index.js` (or `npm run start:worker`)
3. **Process Manager**: `src/process-manager.js` (runs all processes)
4. **Queue Monitor**: `src/monitoring/queueMonitor.js` (or `npm run monitor`)

---

## External Dependencies

### Required Services

- **PostgreSQL**: Database
- **Redis**: Queue system
- **Google Workspace**: Docs, Drive, Forms APIs
- **Brevo**: Email service
- **Asana**: Project management
- **Levitate ERP**: Quote/invoice management
- **OpenAI/Anthropic/Groq**: LLM providers
- **Tavily**: Research API

### Optional Services

- **Pexels**: Stock images (for design tools)
- **Noun Project**: Icons (for design tools)

---

## Development Workflow

1. **Local Development**:

   - `npm run dev` (API server)
   - `npm run dev:worker` (workers, separate terminal)
   - `npm run db:studio` (Prisma Studio for DB inspection)

2. **Database Changes**:

   - Edit `prisma/schema.prisma`
   - `npm run db:push` (dev) or `npm run db:migrate` (prod)

3. **Testing**:

   - `npm test` (Jest)
   - Standalone scripts in `scripts/tests/`

4. **Production**:
   - `npm start` (runs process-manager, starts all processes)

---

## Security Considerations

- JWT tokens for action links (time-limited)
- Webhook signature verification (Brevo, Apps Script)
- Rate limiting per endpoint type
- Input validation on all routes
- CORS protection
- Security headers (Helmet)
- Environment variable validation

---

## Monitoring & Observability

- Structured logging with correlation IDs
- Queue monitoring via Bull Board
- Health check endpoints (`/healthz`, `/readyz`)
- Error tracking in logs
- Audit logs in database (`AuditLog` model)

---

## Codebase Patterns & Conventions

This section documents the established patterns and conventions used throughout the codebase. **All developers must follow these patterns** to maintain consistency and code quality.

### 1. **Configuration Management Pattern**

**Rule**: Never use `process.env` directly. Always use `appConfig` from `@/config`.

**Pattern**:

```javascript
// ✅ CORRECT
const { appConfig } = require("@/config");
const apiKey = appConfig.brevo.apiKey;
const port = appConfig.server.port;

// ❌ WRONG
const apiKey = process.env.BREVO_API_KEY;
const port = process.env.PORT;
```

**Implementation**:

- All environment variables are validated using Joi schema in `src/config/index.js`
- Configuration object is frozen to prevent runtime modifications
- Configuration is organized by domain (database, server, google, brevo, asana, erp, llm, etc.)
- Access pattern: `appConfig.{domain}.{property}`

**Exceptions** (only in specific cases):

- `src/process-manager.js`: Uses `process.env` for child process environment setup
- `src/utils/logger.js`: Uses `process.env.NODE_ENV` in base logger config (once)
- `src/middleware/logging.js`: Uses `process.env.NODE_ENV` for development-only behavior

---

### 2. **Constants & Enums Pattern**

**Rule**: All constants, enums, and magic strings must come from `@/constants`.

**Pattern**:

```javascript
// ✅ CORRECT
const { DocumentType, DocumentStatus, ProjectPhase, TeamRole } = require("@/constants");
if (document.type === DocumentType.BRAND_ORIGIN) { ... }
if (document.status === DocumentStatus.PM_REVIEW) { ... }

// ❌ WRONG
if (document.type === "BRAND_ORIGIN") { ... }
if (document.status === "PM_REVIEW") { ... }
```

**Available Constants** (from `src/constants/index.js`):

- `ProjectPhase`: Project lifecycle phases
- `DocumentType`: Document types (BRAND_ORIGIN, QUOTE, QUOTE_VARIANT, WORKPLAN)
- `DocumentStatus`: Document workflow statuses
- `WorkplanServiceType`: Service types for workplan generation
- `SlideType`: Workplan slide types
- `EmailIntent`: Detected email intents
- `TeamRole`: Team member roles
- `AuditActions`: System audit log action types
- `ActionType`: JWT token action types
- `SystemEmails`: System email addresses
- `BrandAssets`: Brand asset file IDs and URLs
- `LEVITATE_BRAND_GUIDELINES`: Design system constants
- And many more...

**Benefits**:

- Type safety through IDE autocomplete
- Single source of truth for all constants
- Prevents typos and inconsistencies
- Easy refactoring

---

### 3. **Path Alias Pattern**

**Rule**: Always use `@/` prefix for absolute imports. Never use relative imports outside the same directory.

**Pattern**:

```javascript
// ✅ CORRECT
const { appConfig } = require("@/config");
const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError } = require("@/utils/errors");
const { brevoIntegration } = require("@/integrations");
const { ProjectService } = require("@/services/projectService");

// ❌ WRONG (relative imports)
const { appConfig } = require("../../config");
const { getPrismaClient } = require("../database");
```

**Configuration**: Path aliases are configured in `jsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

---

### 4. **Logging Pattern**

**Rule**: Every module must create its own logger using `createLogger` with a descriptive module name.

**Pattern**:

```javascript
// ✅ CORRECT
const { createLogger } = require("@/utils/logger");
const logger = createLogger("service:project"); // or "worker:documentGeneration", "route:actions", etc.

logger.info({ projectId, userId }, "Project created successfully");
logger.error({ error, projectId }, "Failed to create project");
logger.warn({ documentId }, "Document status is unusual");
logger.debug({ data }, "Processing document data");
```

**Logger Naming Convention**:

- Services: `"service:{serviceName}"` (e.g., `"service:project"`, `"service:email-inbound"`)
- Workers: `"worker:{workerName}"` (e.g., `"worker:documentGeneration"`, `"worker:emailIntent"`)
- Routes: `"route:{routeName}"` (e.g., `"route:actions"`, `"route:webhooks"`)
- Middleware: `"middleware:{middlewareName}"` (e.g., `"middleware:auth"`, `"middleware:errorHandler"`)
- Integrations: `"integration:{integrationName}"` (e.g., `"integration:brevo"`, `"integration:google"`)

**Structured Logging**:

- Always include context objects: `logger.info({ projectId, userId }, "message")`
- Use appropriate log levels: `error`, `warn`, `info`, `debug`
- Include correlation IDs when available: `logger.info({ correlationId, ... }, "message")`

**Special Logging Functions**:

- `logError(logger, error, context)`: For error logging with stack traces
- `logIntegrationCall(logger, integration, action, success, duration, error)`: For integration API calls
- `logJobStart/logJobComplete/logJobFailed`: For background job tracking

---

### 5. **Error Handling Pattern**

**Rule**: Use custom error classes from `@/utils/errors`. Services throw errors, middleware catches them.

**Pattern**:

```javascript
// ✅ CORRECT - In Services
const { ValidationError, NotFoundError, GoogleError } = require("@/utils/errors");

if (!documentId) {
  throw new ValidationError("Document ID is required");
}

const document = await prisma.document.findUnique({ where: { id: documentId } });
if (!document) {
  throw new NotFoundError("Document", documentId);
}

try {
  await googleIntegration.createDocument(...);
} catch (error) {
  throw new GoogleError("createDocument", error, { documentId });
}

// ✅ CORRECT - In Routes (errors automatically caught by asyncHandler)
router.post("/documents", asyncHandler(async (req, res) => {
  const result = await DocumentService.createDocument(req.body);
  res.json({ success: true, data: result });
}));
```

**Available Error Classes**:

- `BaseError`: Base class for all custom errors
- `ValidationError`: Input validation errors (400)
- `NotFoundError`: Resource not found (404)
- `UnauthorizedError`: Authentication errors (401)
- `ForbiddenError`: Authorization errors (403)
- `ConflictError`: Resource conflicts (409)
- `RateLimitError`: Rate limiting (429)
- `IntegrationError`: Base class for integration errors (502)
- `BrevoError`: Brevo API errors
- `GoogleError`: Google API errors
- `AsanaError`: Asana API errors
- `TavilyError`: Tavily API errors
- `LLMError`: LLM provider errors
- `DocumentError`: Document operation errors
- `JobProcessingError`: Background job errors

**Error Flow**:

1. Service throws custom error
2. Route handler wrapped in `asyncHandler` catches it
3. Error handler middleware (`src/middleware/errorHandler.js`) processes it
4. Structured error response sent to client
5. Error logged with context

---

### 6. **Database Access Pattern**

**Rule**: Always use `getPrismaClient()` and `withTransaction()` from `@/database`. Never create PrismaClient directly.

**Pattern**:

```javascript
// ✅ CORRECT
const { getPrismaClient, withTransaction } = require("@/database");
const prisma = getPrismaClient();

// Single query
const document = await prisma.document.findUnique({ where: { id: documentId } });

// Transaction
const result = await withTransaction(async (tx) => {
  const document = await tx.document.create({ data: {...} });
  await tx.documentRevision.create({ data: {...} });
  return document;
});

// ❌ WRONG
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient(); // Don't do this!
```

**Transaction Pattern**:

- Use `withTransaction` for atomic operations
- Pass callback function that receives transaction client `tx`
- All operations within callback use `tx` instead of `prisma`
- Automatic rollback on error, commit on success
- Configurable timeout (default: 5000ms)

**Benefits**:

- Singleton Prisma client (connection pooling)
- Centralized connection management
- Automatic query logging in development
- Graceful error handling

---

### 7. **Service Layer Pattern**

**Rule**: Services are stateless classes with static methods. They orchestrate integrations, LLM calls, and database operations.

**Pattern**:

```javascript
// ✅ CORRECT
class ProjectService {
  static async createProject(data) {
    // Validation
    if (!data.name) {
      throw new ValidationError("Project name is required");
    }

    // Database operations
    const project = await withTransaction(async (tx) => {
      return await tx.project.create({ data });
    });

    // Integration calls
    await asanaIntegration.createProject(...);

    // Logging
    logger.info({ projectId: project.id }, "Project created");

    return project;
  }
}

module.exports = { ProjectService };
```

**Service Responsibilities**:

- Business logic orchestration
- Input validation
- Database operations (via Prisma)
- Integration calls (via integration modules)
- LLM calls (via LLM client)
- Error handling (throw custom errors)
- Logging (via module logger)

**Service Rules**:

- No direct HTTP concerns (no `req`, `res`)
- No direct route handlers
- Stateless (no instance state)
- Static methods only
- Throw errors (don't catch unless re-throwing with context)

---

### 8. **Integration Pattern**

**Rule**: All external API integrations are singleton instances exported from `@/integrations`.

**Pattern**:

```javascript
// ✅ CORRECT
const { brevoIntegration, googleIntegration, asanaIntegration } = require("@/integrations");

// Use singleton instances directly
await brevoIntegration.sendTransactionalEmail({...});
await googleIntegration.createDocument({...});
await asanaIntegration.createProject({...});

// ❌ WRONG
const BrevoIntegration = require("@/integrations/brevo");
const brevo = new BrevoIntegration(); // Don't instantiate directly!
```

**Integration Structure**:

- Each integration is a class in `src/integrations/{name}.js`
- Singleton instance created and exported: `const brevoIntegration = new BrevoIntegration()`
- All integrations exported from `src/integrations/index.js`
- Integrations handle:
  - API authentication
  - Rate limiting and retries
  - Error wrapping (IntegrationError subclasses)
  - Request/response logging via `logIntegrationCall`

**Available Integrations**:

- `brevoIntegration`: Email sending and inbound processing
- `googleIntegration`: Google Workspace APIs (Docs, Drive, Forms)
- `asanaIntegration`: Asana project management
- `erpIntegration`: Levitate ERP API
- `tavilyIntegration`: Tavily research API

---

### 9. **Route Handler Pattern**

**Rule**: All async route handlers must be wrapped in `asyncHandler`. Routes delegate to services.

**Pattern**:

```javascript
// ✅ CORRECT
const { asyncHandler } = require("@/middleware/errorHandler");
const { ProjectService } = require("@/services/projectService");

router.post(
  "/projects",
  asyncHandler(async (req, res) => {
    const project = await ProjectService.createProject(req.body);
    res.json({ success: true, data: project });
  })
);

// ❌ WRONG
router.post("/projects", async (req, res) => {
  try {
    const project = await ProjectService.createProject(req.body);
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Route Structure**:

- Each route file exports a router
- Routes use `asyncHandler` wrapper (automatic error handling)
- Routes validate input (via validation middleware)
- Routes delegate business logic to services
- Routes return JSON responses: `{ success: true, data: ... }`

**Route Organization**:

- `src/routes/actions.js`: Action link handlers (JWT-protected)
- `src/routes/webhooks.js`: External webhook receivers
- `src/routes/admin.js`: Admin interface routes
- `src/routes/forms.js`: Form submission processing
- `src/routes/workplan.js`: Workplan-specific routes
- `src/routes/health.js`: Health check endpoints
- `src/routes/ui/`: UI-related routes

---

### 10. **Worker Pattern**

**Rule**: Workers are background job processors. Each worker exports a processor function.

**Pattern**:

```javascript
// ✅ CORRECT
const { createLogger } = require("@/utils/logger");
const { getPrismaClient } = require("@/database");
const { ProjectService } = require("@/services/projectService");

const logger = createLogger("worker:documentGeneration");
const prisma = getPrismaClient();

const documentGenerationProcessor = async (job) => {
  const { data } = job;
  const { documentId, projectId } = data;

  logger.info(
    { jobId: job.id, documentId },
    "Processing document generation job"
  );

  try {
    // Call services to perform work
    const result = await ProjectService.generateDocument(documentId);

    logger.info({ jobId: job.id, documentId }, "Document generation completed");
    return result;
  } catch (error) {
    logger.error(
      { jobId: job.id, error, documentId },
      "Document generation failed"
    );
    throw error; // Re-throw to trigger BullMQ retry
  }
};

module.exports = { documentGenerationProcessor };
```

**Worker Rules**:

- Export processor function: `{ processorName }`
- Receive job object with `data` property
- Log job start/complete/failure
- Call services (don't duplicate business logic)
- Throw errors for retry (BullMQ handles retries automatically)
- Return result object on success

**Worker Registration**:

- Workers registered in `src/workers/index.js`
- Each worker attached to corresponding queue
- Workers started via `npm run start:worker` or process manager

---

### 11. **Queue Service Pattern**

**Rule**: All background jobs are added via `QueueService` methods. Never add jobs directly to queues.

**Pattern**:

```javascript
// ✅ CORRECT
const { QueueService } = require("@/queues");

await QueueService.addDocumentGenerationJob({
  documentId,
  projectId,
  documentType: DocumentType.BRAND_ORIGIN,
}, {
  priority: 10, // Higher priority
  deduplicationKey: `doc-gen-${documentId}`,
});

// ❌ WRONG
const { docGenerationQueue } = require("@/queues");
await docGenerationQueue.add({...}); // Don't do this!
```

**QueueService Methods**:

- `addDocumentGenerationJob()`: Document generation
- `addBrandOriginGenerationJob()`: Brand origin with deduplication
- `addQuoteGenerationJob()`: Quote generation
- `addWorkplanGenerationJob()`: Workplan generation
- `addEmailParseJob()`: Email intent detection
- Plus queue management methods (pause, resume, stats, etc.)

**Job Options**:

- `priority`: Higher numbers = higher priority
- `deduplicationKey`: Prevents duplicate jobs
- `delay`: Delay job execution
- `attempts`: Number of retries

---

### 12. **Transaction Pattern**

**Rule**: Use `withTransaction` for all multi-step database operations that must be atomic.

**Pattern**:

```javascript
// ✅ CORRECT - Multiple related operations
const result = await withTransaction(async (tx) => {
  const document = await tx.document.create({ data: {...} });
  await tx.documentRevision.create({
    data: { documentId: document.id, ... }
  });
  await tx.auditLog.create({
    data: { action: "DOCUMENT_CREATED", ... }
  });
  return document;
});

// ✅ CORRECT - Single operation (transaction not strictly needed but OK)
const document = await withTransaction(async (tx) => {
  return await tx.document.create({ data: {...} });
});

// ❌ WRONG - Multiple operations without transaction
const document = await prisma.document.create({ data: {...} });
await prisma.documentRevision.create({ data: {...} }); // Could fail, leaving inconsistent state
```

**When to Use Transactions**:

- Creating related records (document + revision + audit log)
- Updating multiple records atomically
- Conditional updates based on current state
- Any operation where partial failure is unacceptable

**Transaction Timeout**:

- Default: 5000ms (5 seconds)
- Override: `withTransaction(callback, { timeout: 10000 })`

---

### 13. **Import Organization Pattern**

**Rule**: Organize imports in this order: external packages, path aliases (@/), relative imports.

**Pattern**:

```javascript
// ✅ CORRECT - Organized imports
// 1. External packages
const { Router } = require("express");
const Joi = require("joi");

// 2. Path aliases (config, constants, database, utils)
const { appConfig } = require("@/config");
const { DocumentType, DocumentStatus } = require("@/constants");
const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError } = require("@/utils/errors");

// 3. Integrations
const { brevoIntegration, googleIntegration } = require("@/integrations");

// 4. Services
const { ProjectService } = require("@/services/projectService");

// 5. Middleware
const { asyncHandler } = require("@/middleware/errorHandler");
```

---

### 14. **Validation Pattern**

**Rule**: Validate all inputs using Joi schemas. Use validation middleware in routes.

**Pattern**:

```javascript
// ✅ CORRECT - In validation file (src/utils/validation/...)
const Joi = require("joi");

const createProjectSchema = Joi.object({
  name: Joi.string().required(),
  clientId: Joi.number().integer().required(),
  phase: Joi.string()
    .valid(...Object.values(ProjectPhase))
    .required(),
});

// ✅ CORRECT - In route
const { validate } = require("@/middleware/validation");
const { createProjectSchema } = require("@/utils/validation/projectValidation");

router.post(
  "/projects",
  validate(createProjectSchema),
  asyncHandler(async (req, res) => {
    const project = await ProjectService.createProject(req.body);
    res.json({ success: true, data: project });
  })
);
```

**Validation Locations**:

- `src/utils/validation/commonValidation.js`: Common schemas
- `src/utils/validation/formValidation.js`: Form-specific schemas
- `src/utils/validation/webhookValidation.js`: Webhook validation schemas

---

### 15. **LLM Client Pattern**

**Rule**: Use LLM client from `@/llm/client.js`. Provider selection is automatic based on task type.

**Pattern**:

```javascript
// ✅ CORRECT
const { createLLMClient } = require("@/llm/client");

const llmClient = createLLMClient({
  taskType: LLMTaskType.GENERATION, // or CLASSIFICATION, EXTRACTION, PLANNING
  model: "gpt-4", // Optional, defaults based on task type
});

const result = await llmClient.generate({
  prompt: "...",
  schema: myZodSchema, // For structured outputs
});
```

**LLM Task Types**:

- `CLASSIFICATION`: Email intent detection, categorization
- `EXTRACTION`: Data extraction from text
- `GENERATION`: Document generation, content creation
- `PLANNING`: Workplan structure planning

**Provider Selection**:

- Automatic based on task type and cost/performance optimization
- Configurable via `appConfig.llm.*` settings
- Supports OpenAI, Anthropic, Groq

---

### 16. **File Naming Conventions**

**Services**: `*Service.js` (e.g., `projectService.js`, `emailInboundService.js`)
**Workers**: `*.js` in `workers/` (e.g., `documentGeneration.js`, `emailIntent.js`)
**Integrations**: `*.js` in `integrations/` (e.g., `brevo.js`, `google.js`)
**Routes**: `*.js` in `routes/` (e.g., `webhooks.js`, `actions.js`)
**Middleware**: `*.js` in `middleware/` (e.g., `auth.js`, `errorHandler.js`)
**Utils**: `*.js` in `utils/` (e.g., `logger.js`, `errors.js`)

---

### 17. **Code Style Patterns**

**Async/Await**: Always use async/await, never use callbacks or raw promises
**Error Handling**: Always throw errors, never return error objects
**Logging**: Always include context objects in log calls
**Comments**: Use JSDoc for public methods, inline comments for complex logic
**Constants**: Never use magic strings or numbers, always use constants
**Type Safety**: Use constants and validation to ensure type safety (no TypeScript)

---

### 18. **Testing Patterns**

**Test Structure**: Tests in `src/test/` directory
**Test Setup**: Use `src/test/setup.js` for test configuration
**Mocking**: Mock external integrations (Brevo, Google, Asana, etc.)
**Database**: Use test database (configured via `DATABASE_URL` in test env)

---

### Summary Checklist

When writing new code, ensure:

- [ ] Uses `appConfig` from `@/config`, not `process.env`
- [ ] Uses constants from `@/constants`, not magic strings
- [ ] Uses path aliases (`@/`) for all imports
- [ ] Creates module logger with `createLogger("module:name")`
- [ ] Uses custom error classes from `@/utils/errors`
- [ ] Uses `getPrismaClient()` and `withTransaction()` for database
- [ ] Services are stateless classes with static methods
- [ ] Routes use `asyncHandler` wrapper
- [ ] Workers export processor functions
- [ ] Jobs added via `QueueService` methods
- [ ] Transactions used for multi-step operations
- [ ] Imports organized (external → @/ → relative)
- [ ] Input validation using Joi schemas
- [ ] Follows file naming conventions

---

_This file tree documentation is maintained to help developers understand the codebase structure without reading individual files. Update this document when significant architectural changes are made._
