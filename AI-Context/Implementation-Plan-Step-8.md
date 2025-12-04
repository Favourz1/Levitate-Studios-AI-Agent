# Implementation Plan: Step 8 - Workplan Generation

## Executive Summary

This document outlines the architectural blueprint for automating workplan creation at Levitate Studios. The workplan is a strategic document that replaces the work of a human Strategist and Researcher. The output is not just text, but a **Design Spec Sheet** in Google Docs that enables designers to execute slides without thinking about content, layout, or visual direction.

**Key Innovation**: The system generates both **research data** (what to say) and **design directives** (how to present it) for each slide, reducing designer cognitive load by 100%.

---

## 1. Database Schema Design

### 1.1 New Tables

#### `workplan_slides`

Stores individual slide content, research data, and design directives.

```sql
CREATE TABLE workplan_slides (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  slide_number INTEGER NOT NULL,
  slide_type TEXT NOT NULL, -- INDUSTRY_STRENGTHS, OPPORTUNITY, TARGET_NEEDS, etc.
  title TEXT NOT NULL,

  -- Research Data (what to say)
  research_data JSONB, -- Structured research findings with sources
  content_copy TEXT, -- Final synthesized copy for the slide
  data_points JSONB, -- Key statistics, numbers, graphs data

  -- Design Directives (how to present it)
  design_directives JSONB, -- Layout, colors, icons, images, typography, content placement
  layout_type TEXT, -- SPLIT_LEFT_RIGHT, FULL_WIDTH, GRID_3COL, etc.
  visual_elements JSONB, -- Icons, images (with URLs), color palette

  -- Quality Control
  research_status TEXT DEFAULT 'PENDING', -- PENDING, RESEARCHING, COMPLETED, FAILED
  content_status TEXT DEFAULT 'PENDING', -- PENDING, GENERATING, COMPLETED, FAILED
  design_status TEXT DEFAULT 'PENDING', -- PENDING, GENERATING, COMPLETED, FAILED
  quality_score NUMERIC(3,2), -- 0.00 to 10.00

  -- Metadata (stores research sources, big idea options, etc.)
  metadata_info JSONB, -- Flexible storage for slide-specific metadata
  -- For research sources: metadata_info.researchSources = [{source_type, url, title, extracted_data, relevance_score, verified}]
  -- For Big Idea slide: metadata_info.bigIdeaOptions = [{option_number, big_idea_text, rationale, strategic_fit_score}]

  -- Metadata
  requires_big_idea BOOLEAN DEFAULT FALSE, -- For "Big Idea" slide
  is_optional BOOLEAN DEFAULT FALSE, -- Some slides are optional per project type
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(document_id, slide_number)
);

CREATE INDEX idx_workplan_slides_document_id ON workplan_slides(document_id);
CREATE INDEX idx_workplan_slides_type ON workplan_slides(slide_type);
CREATE INDEX idx_workplan_slides_research_status ON workplan_slides(research_status);
```

### 1.2 Enums (Backend-Level)

```javascript
// src/constants/index.js

const WorkplanServiceType = {
  LOGO_DESIGN: "LOGO_DESIGN",
  MARKETING_CAMPAIGN: "MARKETING_CAMPAIGN",
  GTM_STRATEGY: "GTM_STRATEGY",
  GTM_360_CAMPAIGN: "GTM_360_CAMPAIGN",
  SOCIAL_MEDIA_STRATEGY: "SOCIAL_MEDIA_STRATEGY",
  BRAND_DESIGN: "BRAND_DESIGN",
  WEB_DESIGN: "WEB_DESIGN",
  PACKAGING_DESIGN: "PACKAGING_DESIGN",
  VIDEO_PRODUCTION: "VIDEO_PRODUCTION",
  MOTION_DESIGN: "MOTION_DESIGN",
  ADVERTISING: "ADVERTISING",
};

// Note: Workplan status is stored in Document.status field using DocumentStatus enum
// The following constants are kept for reference but should use DocumentStatus instead:
// So do not use this
const WorkplanStatus = {
  DRAFT: "DRAFT", // Use DocumentStatus.DRAFT
  RESEARCHING: "RESEARCHING", // Use DocumentStatus.RESEARCHING
  GENERATING: "GENERATING", // Use DocumentStatus.GENERATING
  COMPLETED: "COMPLETED", // Use DocumentStatus.COMPLETED
  FAILED: "FAILED", // Use DocumentStatus.FAILED
};

const SlideType = {
  // Core slides (always present)
  INDUSTRY_STRENGTHS: "INDUSTRY_STRENGTHS",
  OPPORTUNITY_IN_MARKET: "OPPORTUNITY_IN_MARKET",
  TARGET_AND_NEEDS: "TARGET_AND_NEEDS",
  CURRENT_SOLUTION: "CURRENT_SOLUTION",
  WHY_CURRENT_SOLUTION: "WHY_CURRENT_SOLUTION",
  COMPETITIVE_LANDSCAPE: "COMPETITIVE_LANDSCAPE",
  COMPETITOR_POSITIONING: "COMPETITOR_POSITIONING",
  INDUSTRY_SHIFT: "INDUSTRY_SHIFT", // Core slide - present in all services

  // Marketing-specific slides
  MARKET_GAPS: "MARKET_GAPS",
  MARKET_GAPS_RESPONSE: "MARKET_GAPS_RESPONSE", // Second page of market gaps
  ALL_TRUTHS_CONSIDERED: "ALL_TRUTHS_CONSIDERED",
  STRATEGIC_INTERPRETATION: "STRATEGIC_INTERPRETATION",
  STRATEGY_TO_IDEA: "STRATEGY_TO_IDEA",
  BIG_IDEA: "BIG_IDEA",

  // Logo/Branding-specific slides
  VISUAL_RATIONALE: "VISUAL_RATIONALE",
  LOGO_OPTIONS: "LOGO_OPTIONS",
};

const ResearchStatus = {
  PENDING: "PENDING",
  RESEARCHING: "RESEARCHING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
};
```

### 1.3 Extend Existing Tables

#### `documents` table

The `documents` table already exists and includes a `metadataInfo` JSONB field. For workplan documents:

- `type` = `DocumentType.WORKPLAN` (new enum value)
- `status` = `DocumentStatus.DRAFT` (or `RESEARCHING`, `GENERATING`, `COMPLETED`, `FAILED` for workplan-specific statuses)
- `metadataInfo` stores workplan-specific metadata:
  ```json
  {
    "serviceType": "MARKETING_CAMPAIGN", // Reference copy (primary source is project.serviceTypes)
    "tableOfContents": [...], // Array of slide definitions with order
    "generatedAt": "2024-01-15T10:00:00Z",
    "completedAt": "2024-01-15T12:00:00Z"
  }
  ```

**No schema changes needed** - workplan metadata is stored in `metadataInfo` JSONB field.

#### `projects` table

The `projects` table already includes a `serviceTypes` JSONB field (see `prisma/schema.prisma` line 36). This field stores the full LLM output for service type determination: - ADD IF NOT ALREADY THERE

- `serviceTypes` (JSONB): Array of service matches with ratings:
  ```json
  [
    {
      "serviceType": "MARKETING_CAMPAIGN",
      "rating": 9.5,
      "reasoning": "Client needs comprehensive marketing strategy..."
    },
    {
      "serviceType": "GTM_STRATEGY",
      "rating": 7.2,
      "reasoning": "Some elements align with go-to-market..."
    },
    {
      "serviceType": "GENERAL",
      "rating": 3.0,
      "reasoning": "Fallback option..."
    }
  ]
  ```

**Key Points:**

- Service type is determined **once** using LLM and cached in `project.serviceTypes`
- Full array of matches is stored (not just the selected one)
- Highest-rated match is selected when service type is needed
- Cache is checked before calling LLM (avoids redundant calls)
- Provides consistency across all agents in the pipeline

---

## 2. The Pipeline of Agents Architecture

### 2.1 BullMQ Queue Structure

```javascript
// src/queues/index.js

const QUEUE_NAMES = {
  // ... existing queues
  WORKPLAN_GENERATION: "workplan-generation",
};

// New queue
workplanGeneration: new Queue(QUEUE_NAMES.WORKPLAN_GENERATION, {
  connection: redis,
}),
```

### 2.2 Multi-Agent Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    WORKPLAN_GENERATION Job                   │
│                    (projectId, serviceType)                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENT A: The Planner (Determines TOC)                     │
│  - Analyzes service type                                    │
│  - Determines required slides                               │
│  - Creates workplan record with TOC                         │
│  - Output: Array of slide definitions                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENT B: The Researcher (Per-Slide Research)              │
│  - Iterates through TOC                                    │
│  - For each slide:                                          │
│    • Determines research queries                            │
│    • Calls web search tools (Tavily)                        │
│    • Extracts structured data                              │
│    • Validates data quality                                 │
│    • Stores sources in workplan_slides.metadata_info      │
│  - Output: Research data per slide                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENT C: The Strategist (Synthesizes Content)              │
│  - For each slide:                                          │
│    • Combines research + questionnaire + brand origin      │
│    • Generates strategic copy                               │
│    • Validates against slide requirements                   │
│    • Stores in workplan_slides.content_copy               │
│  - Special handling for "Big Idea" (generates 2 options)   │
│  - Output: Final slide copy                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENT D: The Art Director (Design Directives)             │
│  - For each slide:                                          │
│    • Determines optimal layout                             │
│    • Specifies colors (from Levitate brand guidelines)     │
│    • Suggests icons/images (with URLs)                     │
│    • Defines typography hierarchy                          │
│    • Stores in workplan_slides.design_directives           │
│  - Output: Complete design spec per slide                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENT E: The Document Builder (Google Docs Renderer)      │
│  - Assembles all slides into formatted Google Doc           │
│  - Uses fixed/rebuilt createFormattedDocument (as the current createFormattedDocument isn't working )               │
│  - Creates document record                                  │
│  - Output: Google Doc URL                                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Implementation Files

```
src/
├── workers/
│   └── workplanGeneration.js          # Main orchestrator
├── services/
│   ├── workplanService.js              # Business logic
│   ├── workplanPlannerService.js       # Agent A: TOC generation
│   ├── workplanResearcherService.js    # Agent B: Research
│   ├── workplanStrategistService.js    # Agent C: Content synthesis
│   ├── workplanArtDirectorService.js   # Agent D: Design directives
│   └── workplanDocumentBuilderService.js # Agent E: Doc assembly
├── llm/
│   ├── tools/
│   │   ├── researchTools.js            # Web search, competitor analysis
│   │   └── designTools.js               # Image search, icon suggestions
│   └── schemas/
│       └── workplanSchemas.js          # Zod schemas for structured outputs
└── integrations/
    └── tavily.js                       # Tavily search integration (new)
```

---

## 3. Agent A: The Planner (TOC Generation)

### 3.1 Purpose

Determines which slides are required based on service type and creates the Table of Contents.

### 3.2 Slide Taxonomy Rules

```javascript
// src/services/workplanPlannerService.js

const SLIDE_TEMPLATES = {
  // Core slides (always present)
  CORE_SLIDES: [
    SlideType.INDUSTRY_STRENGTHS,
    SlideType.OPPORTUNITY_IN_MARKET,
    SlideType.TARGET_AND_NEEDS,
    SlideType.CURRENT_SOLUTION,
    SlideType.WHY_CURRENT_SOLUTION,
    SlideType.COMPETITIVE_LANDSCAPE,
    SlideType.COMPETITOR_POSITIONING,
    SlideType.INDUSTRY_SHIFT, // Core slide - present in all services
  ],

  // Marketing campaign slides
  MARKETING_SLIDES: [
    SlideType.MARKET_GAPS,
    SlideType.MARKET_GAPS_RESPONSE,
    SlideType.ALL_TRUTHS_CONSIDERED,
    SlideType.STRATEGIC_INTERPRETATION,
    SlideType.STRATEGY_TO_IDEA,
    SlideType.BIG_IDEA,
  ],

  // Logo/Branding slides
  LOGO_SLIDES: [SlideType.VISUAL_RATIONALE, SlideType.LOGO_OPTIONS],
};

const SERVICE_TYPE_SLIDE_MAP = {
  [WorkplanServiceType.MARKETING_CAMPAIGN]: [
    ...SLIDE_TEMPLATES.CORE_SLIDES,
    ...SLIDE_TEMPLATES.MARKETING_SLIDES,
  ],
  [WorkplanServiceType.GTM_STRATEGY]: [
    ...SLIDE_TEMPLATES.CORE_SLIDES,
    ...SLIDE_TEMPLATES.MARKETING_SLIDES,
  ],
  [WorkplanServiceType.GTM_360_CAMPAIGN]: [
    ...SLIDE_TEMPLATES.CORE_SLIDES,
    ...SLIDE_TEMPLATES.MARKETING_SLIDES,
    // Additional campaign execution slides
  ],
  [WorkplanServiceType.LOGO_DESIGN]: [
    SlideType.INDUSTRY_STRENGTHS,
    SlideType.OPPORTUNITY_IN_MARKET,
    SlideType.TARGET_AND_NEEDS,
    SlideType.INDUSTRY_SHIFT,
    ...SLIDE_TEMPLATES.LOGO_SLIDES,
  ],
  [WorkplanServiceType.SOCIAL_MEDIA_STRATEGY]: [
    ...SLIDE_TEMPLATES.CORE_SLIDES,
    // No Big Idea (as per meeting notes)
  ],
  // Edge case: Unknown/General service type
  // Falls back to core slides + marketing slides (without campaign-specific execution)
  GENERAL: [
    ...SLIDE_TEMPLATES.CORE_SLIDES,
    SlideType.ALL_TRUTHS_CONSIDERED,
    SlideType.STRATEGIC_INTERPRETATION,
    SlideType.STRATEGY_TO_IDEA,
    SlideType.BIG_IDEA,
  ],
};
```

### 3.3 LLM Schema for TOC Generation

```javascript
// src/llm/schemas/workplanSchemas.js

const tocGenerationSchema = z.object({
  slides: z.array(
    z.object({
      slideNumber: z.number().int().positive(),
      slideType: z.enum(Object.values(SlideType)),
      title: z.string(),
      isOptional: z.boolean().default(false),
      requiresBigIdea: z.boolean().default(false),
      researchQueries: z.array(z.string()).optional(), // Suggested queries for Agent B
    })
  ),
  rationale: z.string().describe("Why these slides were selected"),
});
```

### 3.4 Implementation Pattern

```javascript
// src/services/workplanPlannerService.js

class WorkplanPlannerService {
  static async generateTOC(projectId, serviceType, context) {
    // 1. Load project context (questionnaire, brand origin, client info)
    // 2. Validate service type - if not in SERVICE_TYPE_SLIDE_MAP, use GENERAL fallback
    // 3. Use LLM with structured output to determine slides
    // 4. Apply business rules (service type mapping)
    // 5. Create document record with type=WORKPLAN and metadataInfo containing TOC
    // 6. Return slide definitions array

    // Edge case handling for unknown service types:
    const slideMap =
      SERVICE_TYPE_SLIDE_MAP[serviceType] || SERVICE_TYPE_SLIDE_MAP.GENERAL;
    if (!SERVICE_TYPE_SLIDE_MAP[serviceType]) {
      logger.warn(
        { projectId, serviceType },
        "Unknown service type, using GENERAL slide template"
      );
    }
  }
}
```

---

## 4. Agent B: The Researcher (Data Sourcing)

### 4.1 Purpose

Performs web research for each slide, sourcing real data (not hallucinated) with traceable sources.

### 4.2 Research Tools

#### Tool 1: Web Search (Tavily API)

```javascript
// src/integrations/tavily.js

class TavilyIntegration {
  async search(query, options = {}) {
    // Tavily API call
    // Returns: { results: [{ title, url, content, score }], query }
  }

  async searchWithFilters(query, filters) {
    // Advanced search with date ranges, domains, etc.
  }
}
```

#### Tool 2: Competitor Analysis

```javascript
// src/llm/tools/researchTools.js

const competitorAnalysisTool = tool({
  description: "Research competitor positioning, market share, and activities",
  parameters: z.object({
    competitorNames: z.array(z.string()),
    industry: z.string(),
    slideType: z.enum(Object.values(SlideType)),
  }),
  execute: async ({ competitorNames, industry, slideType }) => {
    // Multi-query search for each competitor
    // Extract: positioning, market share, recent campaigns, slogans
    // Return structured data
  },
});
```

#### Tool 3: Market Data Extraction

```javascript
const marketDataTool = tool({
  description: "Extract market statistics, growth rates, population data",
  parameters: z.object({
    industry: z.string(),
    region: z.string().optional(), // Determined from questionnaire/client context
    dataType: z.enum(["GROWTH_RATE", "MARKET_SIZE", "POPULATION", "BEHAVIOR"]),
  }),
  execute: async ({ industry, region, dataType }) => {
    // Determine target region from questionnaire/client context
    // If not specified, default to "Nigeria" as fallback
    // Search for specific data types in the determined region
    // Extract numbers, percentages, dates
    // Validate data quality
    // Return structured JSON
  },
});
```

### 4.3 Research Strategy Per Slide Type

```javascript
// src/services/workplanResearcherService.js

const RESEARCH_STRATEGIES = {
  [SlideType.INDUSTRY_STRENGTHS]: {
    queries: [
      "{industry} market size {region} 2024",
      "{industry} growth rate {region}",
      "{industry} population demographics {region}",
      "{industry} consumer behavior trends {region}",
    ],
    dataPoints: ["marketSize", "growthRate", "population", "behaviorTrends"],
    // Region is determined from questionnaire, accepted brand origin doc and client context, defaults to "Nigeria" if not specified
  },

  [SlideType.COMPETITIVE_LANDSCAPE]: {
    queries: [
      "{competitor1} market share {industry} {region}",
      "{competitor2} positioning strategy {region}",
      "{industry} market leaders {region}",
    ],
    dataPoints: ["marketShare", "positioning", "leaders"],
    requiresCompetitorList: true,
  },

  [SlideType.MARKET_GAPS]: {
    queries: [
      "{competitor} weaknesses {industry} {region}",
      "{industry} unmet needs {region}",
      "{product} vs competitors comparison {region}",
    ],
    dataPoints: ["competitorWeaknesses", "unmetNeeds", "comparison"],
  },

  [SlideType.BIG_IDEA]: {
    queries: [
      "{industry} creative campaigns {region}",
      "{targetAudience} messaging trends {region}",
      "{brand} positioning opportunities {region}",
    ],
    dataPoints: ["campaignExamples", "messagingTrends", "opportunities"],
  },
};
```

### 4.4 Quality Control for Research

```javascript
class WorkplanResearcherService {
  static async researchSlide(slide, context) {
    // 1. Determine target region from questionnaire/client context
    //    - Check questionnaire and accepted brand origin doc for target market/region
    //    - Check client context for geographic focus
    //    - Default to "Nigeria" if not specified
    // 2. Generate research queries based on slide type (with {region} placeholder)
    // 3. Replace {region} placeholder with determined region
    // 4. Execute parallel searches
    // 5. Extract structured data
    // 6. Validate data quality:
    //    - Check for numbers (not just text)
    //    - Verify source credibility
    //    - Cross-reference multiple sources
    // 7. Store sources with relevance scores in slide.metadata_info.researchSources
    // 8. Return research data JSON
  }

  static determineTargetRegion(context) {
    // Extract from questionnaire: targetMarket, targetRegion, geographicFocus
    // Extract from client context: marketFocus, targetCountries
    // Return determined region or "Nigeria" as fallback
  }

  static validateResearchQuality(researchData) {
    // Check for:
    // - At least 3 sources per slide
    // - Numbers/statistics present (where required)
    // - Source URLs valid
    // - Relevance score > 7.0
  }
}
```

### 4.5 Fallback Strategy

If research fails or returns insufficient data:

1. Use general industry trends (cached data)
2. Flag slide for manual review
3. Continue with available data (don't block pipeline)
4. Log warning for admin review

---

## 5. Agent C: The Strategist (Content Synthesis)

### 5.1 Purpose

Combines research data + questionnaire + brand origin into strategic slide copy using the Levitate Studios BRICS Framework.

### 5.2 BRICS Framework Integration

The Strategist follows Levitate Studios' BRICS methodology: **BRIEF, RESEARCH, INSPIRATION, CREATE, SHARE**

- **BRIEF**: Extract and understand client requirements from questionnaire
- **RESEARCH**: Analyze industry, audience, and competitive landscape (using Agent B's research data)
- **INSPIRATION**: Draw from relevant examples and creative references
- **CREATE**: Synthesize insights into actionable brand strategy
- **SHARE**: Present findings in clear, implementable format for designers

### 5.3 Context Assembly

```javascript
// src/services/workplanStrategistService.js

class WorkplanStrategistService {
  static async synthesizeSlideContent(slide, researchData, context) {
    // Context includes:
    // - researchData (from Agent B)
    // - questionnaire responses
    // - accepted brand origin document
    // - client context
    // - project context
    // - regenerationFeedback (if regenerating) - optional feedback/reason for regeneration

    // LLM prompt structure following BRICS:
    // 1. BRIEF: Slide requirements (what this slide must cover)
    //    - If regenerationFeedback present, incorporate feedback into requirements
    // 2. RESEARCH: Research data (with sources) from Agent B
    // 3. INSPIRATION: Brand context (from brand origin) + creative references
    // 4. CREATE: Synthesize into strategic copy
    //    - If regenerationFeedback present, address feedback points specifically
    // 5. SHARE: Output format (structured copy ready for design)

    // If regenerating with feedback:
    if (context.regenerationFeedback) {
      // Incorporate feedback into prompt:
      // - Add feedback section to prompt
      // - Instruct LLM to address specific concerns
      // - Maintain strategic coherence while addressing feedback
    }
  }
}
```

### 5.3 Slide-Specific Synthesis Rules

#### Industry Strengths Slide

```javascript
const INDUSTRY_STRENGTHS_PROMPT = `
You are creating the "Industry Strengths" slide for a {serviceType} project.

Required Content:
1. Population data: {researchData.population}
2. Current behavior: {researchData.behaviorTrends}
3. Market size: {researchData.marketSize}
4. Growth rate: {researchData.growthRate} (include graph data)
5. Opportunity: How the industry is positioned for growth
6. "What this means" section: Strategic interpretation

Research Sources:
{researchSources}

Brand Context:
{brandOrigin}

Generate slide copy that:
- Uses real numbers from research (never hallucinate)
- Cites sources inline
- Connects industry data to client opportunity
- Is concise but comprehensive
`;
```

#### Market Gaps Slide (2 Pages)

```javascript
const MARKET_GAPS_PROMPT = `
Page 1: Competitor Weaknesses
- What competitors are doing
- What they're not doing well
- Specific pain points

Page 2: Client Response
- How {clientName} can address gaps
- Unique value proposition
- Competitive advantage

Research Data:
{competitorAnalysis}
{marketGaps}
`;
```

#### Big Idea Slide (2 options)

```javascript
const BIG_IDEA_PROMPT = `
Generate 2 distinct Big Idea options for {clientName}.

Each option must:
1. Be rooted in "All Truths Considered" findings
2. Serve as a pillar for all marketing messages
3. Be memorable and actionable
4. Different from competitors

Context:
- Product Truth: {productTruth}
- Market Truth: {marketTruth}
- Industry Truth: {industryTruth}
- Target Truth: {targetTruth}

Generate 2 options with rationale for each.
`;
```

### 5.4 Validation & Quality Scoring

```javascript
const contentValidationSchema = z.object({
  qualityScore: z.number().min(0).max(10),
  hasRequiredData: z.boolean(),
  sourceCitations: z.array(z.string()),
  strategicCoherence: z.number().min(0).max(10),
  actionability: z.number().min(0).max(10),
  approved: z.boolean(),
});
```

---

## 6. Agent D: The Art Director (Design Directives)

### 6.1 Purpose

Generates design specifications so designers can execute without thinking.

### 6.2 Design Directive Schema

```javascript
// src/llm/schemas/workplanSchemas.js

const designDirectiveSchema = z.object({
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
    primary: z.string(), // Hex code
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
      url: z.string().url().optional(), // For images/icons
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
    // Specific content placement instructions
    contentMapping: z
      .array(
        z.object({
          contentSection: z.string(), // e.g., "Population stat", "Growth rate", "What this means"
          placement: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM", "CENTER"]),
          visualElement: z.string().optional(), // Associated icon/image
          emphasis: z.enum(["NORMAL", "HIGH", "LOW"]).default("NORMAL"),
        })
      )
      .optional(),
  }),

  spacing: z.object({
    sectionSpacing: z.number(), // In points
    elementSpacing: z.number(),
  }),

  specialInstructions: z.string().optional(),
});
```

### 6.3 Levitate Brand Guidelines Integration

```javascript
// src\constants\index.js

const LEVITATE_BRAND_GUIDELINES = {
  colors: {
    primary: "#1A1A1A", // Dark
    secondary: "#FFFFFF", // White
    accent: "#FF6B35", // Orange (example)
    background: "#F5F5F5", // Light gray
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

### 6.4 Layout Selection Logic

```javascript
// src/services/workplanArtDirectorService.js

class WorkplanArtDirectorService {
  static determineLayout(slideType, contentStructure) {
    const layoutRules = {
      [SlideType.INDUSTRY_STRENGTHS]: "SPLIT_LEFT_RIGHT", // Stats left, image right
      [SlideType.COMPETITIVE_LANDSCAPE]: "GRID_3COL", // 3 competitors side-by-side
      [SlideType.MARKET_GAPS]: "COMPARISON_TABLE", // Client vs Competitors
      [SlideType.BIG_IDEA]: "CENTERED", // Big idea centered, supporting text below
    };

    return layoutRules[slideType] || "FULL_WIDTH";
  }

  static async generateDesignDirectives(slide, contentCopy) {
    // 1. Analyze content structure (stats, images, text)
    // 2. Determine optimal layout
    // 3. Select colors from brand guidelines
    // 4. Suggest icons/images (with search)
    // 5. Define typography hierarchy
    // 6. Return complete design directive JSON
  }
}
```

### 6.5 Image/Icon Sourcing

```javascript
// src/llm/tools/designTools.js

const imageSearchTool = tool({
  description: "Search for relevant images/icons for slide design",
  parameters: z.object({
    query: z.string(),
    imageType: z.enum(["PHOTO", "ICON", "ILLUSTRATION"]),
    style: z.string().default("professional"),
  }),
  execute: async ({ query, imageType, style }) => {
    // Use Unsplash API or similar can be multiple to get various results
    // Return: [{ url, description, license }]
  },
});
```

---

## 7. Agent E: The Document Builder (Google Docs Renderer)

### 7.1 Google Docs API Fix/Rebuild

**Current Issue**: `createFormattedDocument` in `src/integrations/google.js` doesn't work reliably.

**Solution Options**:

#### Option A: Fix Existing Implementation

- Debug `processDocumentBlocks` method
- Fix index tracking issues
- Improve error handling

#### Option B: Rebuild with Simpler Approach

- Use sequential `batchUpdate` calls (one per slide)
- Simplify block processing
- Add better error recovery

**Recommendation**: Option B (rebuild) for reliability, even if it causes breaking changes.

### 7.2 Document Structure

```
Google Doc Structure:
├── Cover Page
│   ├── Levitate Logo
│   ├── Project Name
│   └── Client Name
│
├── Table of Contents (Auto-generated)
│
├── Slide 1: Industry Strengths
│   ├── [RESEARCH DATA SECTION]
│   │   ├── Population: 226M
│   │   ├── Growth Rate: 15% CAGR
│   │   └── Sources: [URL1, URL2, URL3]
│   │
│   ├── [CONTENT SECTION]
│   │   ├── Selected Content/Writings:
│   │   ├── [The actual strategic copy to be placed in the slide]
│   │   ├── [Formatted and ready for design]
│   │   └── [Includes all key points, statistics, and insights]
│   │
│   └── [DESIGN DIRECTIVES SECTION]
│       ├── Layout: Split Left-Right
│       ├── Colors: Primary #1A1A1A, Accent #FF6B35
│       ├── Icons: [Icon URL 1, Icon URL 2]
│       ├── Images: [Image URL 1]
│       └── Content Placement:
│           ├── Population stat → LEFT, with icon [Icon URL 1]
│           ├── Growth rate → LEFT, with chart
│           ├── "What this means" → RIGHT, emphasis HIGH
│           └── Supporting image → RIGHT, size LARGE
│
├── Slide 2: Opportunity in Market
│   └── [Same structure: Research Data → Content → Design Directives]
│
└── ... (all slides)
```

### 7.3 Block Generation Logic

```javascript
// src/services/workplanDocumentBuilderService.js

class WorkplanDocumentBuilderService {
  static convertSlideToBlocks(slide) {
    const blocks = [];

    // Slide Title (Heading 1)
    blocks.push({
      type: "heading",
      text: slide.title,
      level: 1,
    });

    // Research Data Section (Heading 2)
    blocks.push({
      type: "heading",
      text: "Research Data",
      level: 2,
    });

    // Research content (formatted)
    blocks.push({
      type: "paragraph",
      text: this.formatResearchData(slide.researchData),
    });

    // Sources (bullets) - from metadata_info.researchSources
    const researchSources = slide.metadataInfo?.researchSources || [];
    if (researchSources.length > 0) {
      blocks.push({
        type: "bullets",
        items: researchSources.map((s) => `${s.source_title}: ${s.source_url}`),
      });
    }

    // Spacer
    blocks.push({ type: "spacer", height: 24 });

    // Content Section (Heading 2) - THE ACTUAL CONTENT FOR THE SLIDE
    blocks.push({
      type: "heading",
      text: "Content",
      level: 2,
    });

    // The selected strategic copy (formatted)
    blocks.push({
      type: "paragraph",
      text: slide.content_copy || "[Content to be generated]",
    });

    // Spacer
    blocks.push({ type: "spacer", height: 24 });

    // Design Directives Section (Heading 2)
    blocks.push({
      type: "heading",
      text: "Design Directives",
      level: 2,
    });

    // Design spec (formatted) - includes layout, colors, typography
    blocks.push({
      type: "paragraph",
      text: this.formatDesignDirectives(slide.designDirectives),
    });

    // Content Placement Instructions (Heading 3)
    if (slide.designDirectives.contentPlacement?.contentMapping) {
      blocks.push({
        type: "heading",
        text: "Content Placement Instructions",
        level: 3,
      });

      const placementItems =
        slide.designDirectives.contentPlacement.contentMapping.map(
          (mapping) => {
            let item = `• ${mapping.contentSection} → Place ${mapping.placement}`;
            if (mapping.visualElement) {
              item += `, with ${mapping.visualElement}`;
            }
            if (mapping.emphasis !== "NORMAL") {
              item += ` (${mapping.emphasis} emphasis)`;
            }
            return item;
          }
        );

      blocks.push({
        type: "bullets",
        items: placementItems,
      });
    }

    // Visual elements (if any)
    if (slide.designDirectives.visualElements?.length > 0) {
      blocks.push({
        type: "heading",
        text: "Visual Elements",
        level: 3,
      });

      slide.designDirectives.visualElements.forEach((element) => {
        if (element.url) {
          blocks.push({
            type: "image",
            url: element.url,
            width: this.getImageWidth(element.size),
          });
        }
      });
    }

    return blocks;
  }
}
```

### 7.4 Implementation

```javascript
// src/services/workplanDocumentBuilderService.js

class WorkplanDocumentBuilderService {
  static async buildGoogleDoc(documentId) {
    // 1. Fetch workplan document from documents table (type=WORKPLAN)
    // 2. Fetch all slides with research and design data (where document_id = documentId)
    // 3. Generate cover page blocks
    // 4. Generate TOC blocks
    // 5. For each slide: convert to blocks (Research Data → Content → Design Directives)
    // 6. Assemble all blocks
    // 7. Call googleIntegration.createFormattedDocument (fixed/rebuilt)
    // 8. Update document.status to COMPLETED
    // 9. Return Google Doc URL
  }
}
```

---

## 8. Handling "Hard" Slides (Edge Case Logic)

### 8.1 Big Idea Slide (2 options)

```javascript
// src/services/workplanStrategistService.js

static async generateBigIdeaOptions(documentId, slideId, context) {
  // 1. Get "All Truths Considered" slide data
  // 2. Generate 2 distinct options via LLM
  // 3. Store in workplan_slides.metadata_info.bigIdeaOptions:
  //    [{option_number: 1, big_idea_text: "...", rationale: "...", strategic_fit_score: 8.5},
  //     {option_number: 2, big_idea_text: "...", rationale: "...", strategic_fit_score: 8.2}]
  // 4. In Google Doc, render all 2 options with:
  //    - Option 1: [Big Idea Text]
  //      Rationale: [Why this works]
  //    - Option 2: [Big Idea Text]
  //      Rationale: [Why this works]
  // 5. Creative Director selects one (manual process for now)
}
```

### 8.2 Market Gaps Slide (2 Pages)

```javascript
static async generateMarketGapsSlide(workplanId, context) {
  // Page 1: Competitor Weaknesses
  // - Research what competitors are doing
  // - Identify weaknesses/pain points
  // - Format as comparison table

  // Page 2: Client Response
  // - How client addresses gaps
  // - Unique value proposition
  // - Competitive advantage

  // Store as 2 separate slide records:
  // - slide_number: N, slide_type: MARKET_GAPS
  // - slide_number: N+1, slide_type: MARKET_GAPS_RESPONSE
}
```

### 8.3 Competitive Landscape (2 Pages)

```javascript
static async generateCompetitiveLandscape(workplanId, context) {
  // Page 1: Competitor List
  // - Show all competitors
  // - Market share (if available)
  // - Visual: Grid layout with logos

  // Page 2: Competitor Positioning
  // - How each competitor positions themselves
  // - Target audience per competitor
  // - Recent campaigns/activities

  // Store as 2 slides:
  // - COMPETITIVE_LANDSCAPE
  // - COMPETITOR_POSITIONING
}
```

---

## 9. Failure Proofing & Quality Control

### 9.1 Empty Search Results Handling

```javascript
// src/services/workplanResearcherService.js

static async researchWithFallback(slide, context) {
  try {
    const researchData = await this.researchSlide(slide, context);

    // Validate research quality
    if (this.validateResearchQuality(researchData)) {
      return researchData;
    }

    // Fallback: Use cached industry data
    logger.warn(
      { slideType: slide.slideType, documentId: slide.documentId },
      "Research quality insufficient, using fallback data"
    );

    return await this.getFallbackIndustryData(slide.slideType, context.industry, context.region);
  } catch (error) {
    // Last resort: Flag for manual review
    await this.flagSlideForManualReview(slide.id, error.message);
    return this.getMinimalResearchData(slide.slideType);
  }
}
```

### 9.2 Preventing Generic "Fluff"

```javascript
// Quality validation schema

const contentQualitySchema = z.object({
  hasSpecificNumbers: z.boolean(),
  hasSources: z.boolean(),
  hasActionableInsights: z.boolean(),
  avoidsGenericPhrases: z.boolean(), // Check for "innovative", "cutting-edge" without context
  strategicDepth: z.number().min(0).max(10),
});

// Validation prompt
const QUALITY_CHECK_PROMPT = `
Analyze this slide content for quality:

Content: {contentCopy}

Check for:
1. Specific numbers/statistics (not vague statements)
2. Source citations
3. Actionable insights (not generic fluff)
4. Strategic depth (connects to brand strategy)
5. Avoids clichés without context

Return quality score and improvement suggestions.
`;
```

### 9.3 Slide Regeneration Flow

**Note**: There is no admin accept/reject flow for workplan documents. Workplans are generated automatically and sent directly to the Creative Director for review.

If a specific slide needs regeneration:

```javascript
// src/routes/admin.js

// Endpoint: POST /admin/workplan/:documentId/slide/:slideId/regenerate
router.post(
  "/workplan/:documentId/slide/:slideId/regenerate",
  async (req, res) => {
    const { documentId, slideId } = req.params;
    const { reason } = req.body; // Optional feedback/reason for regeneration

    try {
      // 1. Fetch slide and validate
      const slide = await prisma.workplanSlide.findUnique({
        where: { id: parseInt(slideId) },
        include: { document: true },
      });

      if (!slide || slide.documentId !== parseInt(documentId)) {
        return res.status(StatusCodes.NOT_FOUND).json({
          status: false,
          message: "Slide not found",
          statuscode: StatusCodes.NOT_FOUND,
          data: null,
          errors: ["Invalid slide ID or document ID mismatch"],
        });
      }

      // 2. Update slide statuses to PENDING
      await prisma.workplanSlide.update({
        where: { id: parseInt(slideId) },
        data: {
          researchStatus: "PENDING",
          contentStatus: "PENDING",
          designStatus: "PENDING",
          metadataInfo: {
            ...(slide.metadataInfo || {}),
            regenerationReason: reason || null,
            regeneratedAt: new Date().toISOString(),
          },
        },
      });

      // 3. Enqueue slide regeneration job
      await QueueService.addSlideRegenerationJob({
        documentId: parseInt(documentId),
        slideId: parseInt(slideId),
        regenerationReason: reason || null,
      });

      // 4. Create audit log
      await prisma.auditLog.create({
        data: {
          projectId: slide.document.projectId,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          action: "WORKPLAN_SLIDE_REGENERATION_REQUESTED",
          details: {
            documentId: parseInt(documentId),
            slideId: parseInt(slideId),
            slideType: slide.slideType,
            reason: reason || "No reason provided",
            requestedAt: new Date().toISOString(),
          },
          at: new Date(),
        },
      });

      return res.status(StatusCodes.OK).json({
        status: true,
        message: "Slide regeneration queued successfully",
        statuscode: StatusCodes.OK,
        data: {
          slideId: parseInt(slideId),
          documentId: parseInt(documentId),
          regenerationReason: reason || null,
        },
        errors: [],
      });
    } catch (error) {
      logger.error(
        {
          documentId,
          slideId,
          error: error.message,
          stack: error.stack,
        },
        "Failed to queue slide regeneration"
      );

      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Failed to queue slide regeneration",
        statuscode: StatusCodes.INTERNAL_SERVER_ERROR,
        data: null,
        errors: [error.message],
      });
    }
  }
);
```

### 9.4 Full Workplan Regeneration Flow

If the entire workplan needs to be regenerated:

```javascript
// src/routes/admin.js

// Endpoint: POST /admin/workplan/:documentId/regenerate
router.post("/workplan/:documentId/regenerate", async (req, res) => {
  const { documentId } = req.params;
  const { reason } = req.body; // Optional feedback/reason for regeneration

  try {
    // 1. Fetch workplan document and project
    const workplanDoc = await prisma.document.findUnique({
      where: { id: parseInt(documentId) },
      include: { project: { include: { client: true } } },
    });

    if (!workplanDoc || workplanDoc.type !== DocumentType.WORKPLAN) {
      return res.status(StatusCodes.NOT_FOUND).json({
        status: false,
        message: "Workplan document not found",
        statuscode: StatusCodes.NOT_FOUND,
        data: null,
        errors: ["Invalid document ID or document is not a workplan"],
      });
    }

    // 2. Update document status to DRAFT
    await prisma.document.update({
      where: { id: parseInt(documentId) },
      data: {
        status: "DRAFT",
        metadataInfo: {
          ...(workplanDoc.metadataInfo || {}),
          regenerationReason: reason || null,
          regeneratedAt: new Date().toISOString(),
        },
      },
    });

    // 3. Update all slides statuses to PENDING
    await prisma.workplanSlide.updateMany({
      where: { documentId: parseInt(documentId) },
      data: {
        researchStatus: "PENDING",
        contentStatus: "PENDING",
        designStatus: "PENDING",
      },
    });

    // 4. Get service type (uses cache if available)
    const serviceType = await WorkplanPlannerService.getServiceType(
      workplanDoc.projectId
    );

    // 5. Enqueue workplan generation job with regeneration flag
    await QueueService.addWorkplanGenerationJob(
      {
        projectId: workplanDoc.projectId,
        serviceType,
        documentId: parseInt(documentId),
        isRegeneration: true,
        regenerationReason: reason || null,
      },
      {
        priority: 5, // High priority
      }
    );

    // 6. Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: workplanDoc.projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: "WORKPLAN_REGENERATION_REQUESTED",
        details: {
          documentId: parseInt(documentId),
          reason: reason || "No reason provided",
          requestedAt: new Date().toISOString(),
        },
        at: new Date(),
      },
    });

    return res.status(StatusCodes.OK).json({
      status: true,
      message: "Workplan regeneration queued successfully",
      statuscode: StatusCodes.OK,
      data: {
        documentId: parseInt(documentId),
        status: "DRAFT",
        regenerationReason: reason || null,
      },
      errors: [],
    });
  } catch (error) {
    logger.error(
      {
        documentId,
        error: error.message,
        stack: error.stack,
      },
      "Failed to queue workplan regeneration"
    );

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: false,
      message: "Failed to queue workplan regeneration",
      statuscode: StatusCodes.INTERNAL_SERVER_ERROR,
      data: null,
      errors: [error.message],
    });
  }
});
```

**Worker Implementation Update:**

```javascript
// src/workers/workplanGeneration.js

const workplanGenerationProcessor = async (job) => {
  const {
    projectId,
    serviceType: providedServiceType,
    documentId, // Optional - if present, this is a regeneration
    isRegeneration = false,
    regenerationReason = null,
    retryCount = 0,
  } = job.data;

  try {
    // Get service type ONCE at start (checks project.serviceTypes cache)
    let serviceType = providedServiceType;
    if (!serviceType) {
      serviceType = await WorkplanPlannerService.getServiceType(projectId);
    }

    // Pass through context - all agents use this, don't call getServiceType() again
    const context = { projectId, serviceType, ... };

    // If regeneration, load existing document and incorporate feedback
    if (isRegeneration && documentId) {
      const existingDoc = await prisma.document.findUnique({
        where: { id: documentId },
        include: { project: { include: { client: true } } },
      });

      // Incorporate regeneration reason as feedback context
      if (regenerationReason) {
        context.regenerationFeedback = regenerationReason;
        // Pass feedback to Agent C (Strategist) for content synthesis
      }
    }

    // Execute pipeline (Agent A → B → C → D → E)
    // All agents use serviceType from context (consistent across pipeline)
    // Agent C should incorporate regenerationReason if present
    // ...
  } catch (error) {
    // Error handling...
  }
};
```

### 9.5 Retry Logic

```javascript
// src/workers/workplanGeneration.js

const workplanGenerationProcessor = async (job) => {
  const { projectId, serviceType: providedServiceType, retryCount = 0 } = job.data;

  try {
    // Get service type ONCE at start (checks project.serviceTypes cache)
    let serviceType = providedServiceType;
    if (!serviceType) {
      serviceType = await WorkplanPlannerService.getServiceType(projectId);
    }

    // Pass through context - all agents use this, don't call getServiceType() again
    const context = { projectId, serviceType, ... };

    // Execute pipeline (all agents use serviceType from context)
  } catch (error) {
    // Retry logic:
    // - Research failures: Retry up to 3 times
    // - LLM failures: Retry with exponential backoff
    // - Google Docs failures: Retry once, then flag for manual review

    if (retryCount < MAX_RETRIES && isRetryableError(error)) {
      await QueueService.addWorkplanGenerationJob(
        {
          projectId,
          serviceType: providedServiceType, // Preserve original if provided
          retryCount: retryCount + 1,
        },
        {
          delay: calculateBackoff(retryCount),
        }
      );
    } else {
      // Mark workplan as FAILED
      // Notify admin
    }
  }
};
```

---

## 10. Integration Points

### 10.1 Service Type Determination & Caching Architecture

**CRITICAL**: Service type is determined **once** per project using LLM and cached in `project.serviceTypes` JSONB field to ensure consistency across all agents.

#### Architecture Overview

1. **Database Storage**: `project.serviceTypes` stores full LLM output as JSONB array:

   ```json
   [
     {
       "serviceType": "MARKETING_CAMPAIGN",
       "rating": 9.5,
       "reasoning": "Client needs comprehensive marketing strategy..."
     },
     {
       "serviceType": "GTM_STRATEGY",
       "rating": 7.2,
       "reasoning": "Some elements align with go-to-market..."
     }
   ]
   ```

2. **Main Entry Point**: `WorkplanPlannerService.getServiceType(projectId, forceRefresh)`

   - Checks `project.serviceTypes` cache first
   - If cache exists and not empty → returns highest-rated from cache
   - If cache missing/empty or `forceRefresh=true` → calls LLM, stores result, returns highest-rated

3. **Helper Methods**:

   - `getHighestRatedServiceType(serviceMatches)` - Extracts highest-rated (rating >= 5) or "GENERAL"
   - `getServiceTypeMatches(projectId)` - Returns full array for inspection/debugging
   - `_determineServiceTypeWithLLM(projectId)` - Internal LLM call (only when cache empty)

4. **Usage Pattern**:

   ```javascript
   // ✅ CORRECT: Get once at start, use everywhere
   const serviceType = await WorkplanPlannerService.getServiceType(projectId);
   const context = { projectId, serviceType, ... };
   // All agents use serviceType from context

   // ❌ WRONG: Don't call multiple times
   const st1 = await WorkplanPlannerService.getServiceType(projectId);
   const st2 = await WorkplanPlannerService.getServiceType(projectId); // Redundant!
   ```

5. **Flow**:
   ```
   Workplan Generation Starts
       ↓
   getServiceType(projectId) called
       ↓
   Check project.serviceTypes array
       ├─→ EXISTS & NOT EMPTY → Get highest rated → Return
       └─→ MISSING/EMPTY → Call LLM → Store array → Get highest rated → Return
       ↓
   Service type passed through pipeline context
       ├─→ Agent A (Planner) uses it
       ├─→ Agent B (Researcher) uses it
       ├─→ Agent C (Strategist) uses it
       ├─→ Agent D (Art Director) uses it
       └─→ Agent E (Document Builder) uses it
   ```

**Key Benefits:**

- Single LLM determination per project (cached)
- Full reasoning preserved (all matches with ratings)
- Consistent usage across all agents
- Flexible selection (can inspect or change logic)
- Fallback to "GENERAL" if rating < 5

### 10.2 Trigger from Step 7 (Asana Project Init)

```javascript
// src/workers/asanaProjectInit.js

// After project initialization, enqueue workplan generation
// NOTE: Completion email (currently at line 413 in `src\workers\asanaProjectInit.js`) will be moved to after workplan generation completes

// Get service type (uses cache if available, calls LLM if needed)
const serviceType = await WorkplanPlannerService.getServiceType(project.id);

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

**Service Type Determination Logic (Cached LLM-Based Approach):**

The service type is determined once per project using LLM and cached in `project.serviceTypes` JSONB field to ensure consistency across all agents.

```javascript
// src/services/workplanPlannerService.js

class WorkplanPlannerService {
  /**
   * Main entry point: Get service type for project (uses cache if available)
   * @param {number} projectId - Project ID
   * @param {boolean} forceRefresh - Optional, force re-determination
   * @returns {Promise<string>} Service type string (e.g., "MARKETING_CAMPAIGN", "GENERAL")
   */
  static async getServiceType(projectId, forceRefresh = false) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { serviceTypes: true },
    });

    // Check cache first (unless force refresh)
    if (
      !forceRefresh &&
      project?.serviceTypes &&
      Array.isArray(project.serviceTypes) &&
      project.serviceTypes.length > 0
    ) {
      return this.getHighestRatedServiceType(project.serviceTypes);
    }

    // Cache miss or force refresh: determine with LLM
    const serviceMatches = await this._determineServiceTypeWithLLM(projectId);

    // Store full array in cache
    await prisma.project.update({
      where: { id: projectId },
      data: { serviceTypes: serviceMatches },
    });

    // Return highest rated
    return this.getHighestRatedServiceType(serviceMatches);
  }

  /**
   * Get highest-rated service type from matches array
   * @param {Array} serviceMatches - Array of {serviceType, rating, reasoning}
   * @returns {string} Service type with highest rating (or "GENERAL" if rating < 5)
   */
  static getHighestRatedServiceType(serviceMatches) {
    if (!Array.isArray(serviceMatches) || serviceMatches.length === 0) {
      return "GENERAL";
    }

    // Sort by rating descending
    const sorted = [...serviceMatches].sort((a, b) => b.rating - a.rating);
    const topMatch = sorted[0];

    // Return top match if rating >= 5, otherwise GENERAL
    return topMatch.rating >= 5 ? topMatch.serviceType : "GENERAL";
  }

  /**
   * Get full array of service matches for inspection/debugging
   * @param {number} projectId - Project ID
   * @returns {Promise<Array>} Full array of {serviceType, rating, reasoning}
   */
  static async getServiceTypeMatches(projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { serviceTypes: true },
    });

    return project?.serviceTypes || [];
  }

  /**
   * Internal: Call LLM to determine service types (called only when cache is empty)
   * @param {number} projectId - Project ID
   * @returns {Promise<Array>} Array of {serviceType, rating, reasoning}
   */
  static async _determineServiceTypeWithLLM(projectId) {
    // Load project context
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        questionnaireResponses: { orderBy: { submittedAt: "desc" }, take: 1 },
        documents: {
          where: {
            type: { in: [DocumentType.BRAND_ORIGIN, DocumentType.QUOTE] },
            status: DocumentStatus.ACCEPTED,
          },
          include: {
            revisions: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });

    // Assemble context
    const context = {
      questionnaire: project.questionnaireResponses?.[0]?.responses || {},
      brandOrigin: project.documents.find(
        (d) => d.type === DocumentType.BRAND_ORIGIN
      )?.revisions?.[0]?.snapshotText,
      quoteText: project.documents.find((d) => d.type === DocumentType.QUOTE)
        ?.revisions?.[0]?.snapshotText,
      clientContext: project.client.context,
      projectContext: project.context,
    };

    // Call LLM with structured output
    const schema = z.object({
      serviceMatches: z.array(
        z.object({
          serviceType: z.enum([
            ...Object.values(WorkplanServiceType),
            "GENERAL",
          ]),
          rating: z.number().min(0).max(10),
          reasoning: z.string(),
        })
      ),
    });

    try {
      const result = await llmClient.generateStructured(
        schema,
        buildServiceTypePrompt(context, Object.values(WorkplanServiceType)),
        context,
        "service-type-determination"
      );

      return result.serviceMatches || [];
    } catch (error) {
      logger.error(
        { projectId, error },
        "Failed to determine service type with LLM"
      );
      // Return fallback
      return [
        {
          serviceType: "GENERAL",
          rating: 0,
          reasoning: `Error: ${error.message}`,
        },
      ];
    }
  }
}
```

**Key Points:**

- Service type is determined **once** at workplan generation start
- Full LLM output (all matches with ratings) is stored in `project.serviceTypes` JSONB array
- Subsequent calls read from cache (no redundant LLM calls)
- Highest-rated match is selected when service type is needed
- Falls back to "GENERAL" if rating < 5 or on error
- Provides `getServiceTypeMatches()` for inspection/debugging

### 10.2 Asana Task Creation

```javascript
// After workplan completion
await asanaIntegration.createTask({
  projectGid: project.asanaProjectGid,
  name: "Review Workplan Document",
  assignee: creativeDirectorGid, // Or lead creative director from team_members list
  notes: `Workplan document generated: ${googleDocUrl}`,
  dueOn: addBusinessDays(new Date(), 3),
});
```

### 10.3 Email Notification & Completion

```javascript
// src/workers/workplanGeneration.js

// After workplan generation completes successfully:
// 1. Create Asana task for Creative Director
// 2. Send completion email (moved from asanaProjectInit.js line 413)

async function sendWorkplanCompletionNotifications(
  documentId,
  project,
  googleDocUrl
) {
  // Get Creative Director from team members (lead creative director)
  const creativeDirector = await getLeadCreativeDirector(project.id);

  // Create Asana task
  await asanaIntegration.createTask({
    projectGid: project.asanaProjectGid,
    name: "Review Workplan Document",
    assignee: creativeDirector.asanaUserGid,
    notes: `Workplan document generated: ${googleDocUrl}`,
    dueOn: addBusinessDays(new Date(), 3),
  });

  // Send email to Creative Director
  await emailService.sendEmail({
    to: creativeDirector.email,
    template: "workplan-completed",
    params: {
      projectName: project.name,
      clientName: project.client.name,
      workplanUrl: googleDocUrl,
      slideCount: workplan.slides.length,
    },
  });

  // Send completion email to Admin, Manager, and PM (moved from asanaProjectInit.js)
  await sendProjectInitializationCompletionEmail(
    project,
    project.asanaProjectGid
  );
}
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

```javascript
// tests/services/workplanPlannerService.test.js
describe("WorkplanPlannerService", () => {
  it("should generate correct TOC for marketing campaign", async () => {
    const toc = await WorkplanPlannerService.generateTOC(
      projectId,
      WorkplanServiceType.MARKETING_CAMPAIGN,
      context
    );

    expect(toc.slides).toContainEqual(
      expect.objectContaining({ slideType: SlideType.BIG_IDEA })
    );
  });

  it("should NOT include Big Idea for logo design", async () => {
    const toc = await WorkplanPlannerService.generateTOC(
      projectId,
      WorkplanServiceType.LOGO_DESIGN,
      context
    );

    expect(toc.slides).not.toContainEqual(
      expect.objectContaining({ slideType: SlideType.BIG_IDEA })
    );
  });
});
```

### 11.2 Integration Tests

```javascript
// tests/integrations/workplanGeneration.test.js
describe("Workplan Generation Pipeline", () => {
  it("should complete full pipeline for marketing campaign", async () => {
    // 1. Create test project
    // 2. Enqueue workplan generation
    // 3. Wait for completion
    // 4. Verify:
    //    - Workplan record created
    //    - All slides have research data
    //    - All slides have design directives
    //    - Google Doc created
    //    - Asana task created
  });
});
```

### 11.3 Quality Assurance Tests

```javascript
describe("Research Quality", () => {
  it("should have at least 3 sources per slide", async () => {
    const researchData = await WorkplanResearcherService.researchSlide(
      slide,
      context
    );
    expect(researchData.sources.length).toBeGreaterThanOrEqual(3);
  });

  it("should not hallucinate numbers", async () => {
    // Verify all numbers have source citations
  });
});
```

---

## 12. Rollout Plan

### Phase 1: Foundation (Week 1-2)

- [ ] Database migrations
- [ ] Basic pipeline structure
- [ ] Agent A (Planner) implementation
- [ ] Unit tests

### Phase 2: Research & Strategy (Week 3-4)

- [ ] Agent B (Researcher) with Tavily integration
- [ ] Agent C (Strategist) implementation
- [ ] Research quality validation
- [ ] Integration tests

### Phase 3: Design & Document Building (Week 5-6)

- [ ] Agent D (Art Director) implementation
- [ ] Fix/rebuild Google Docs integration
- [ ] Agent E (Document Builder) implementation
- [ ] End-to-end tests

### Phase 4: Edge Cases & Polish (Week 7)

- [ ] Big Idea 2-option generation
- [ ] Market Gaps 2-page handling
- [ ] Unknown service type handling (GENERAL fallback)
- [ ] Region detection and dynamic query generation
- [ ] Slide regeneration flow
- [ ] Error handling & retries

### Phase 5: Production (Week 8)

- [ ] Load testing
- [ ] Documentation
- [ ] Training for Creative Director
- [ ] Gradual rollout (1 project, then 5, then all)

---

## 13. Success Metrics

1. **Time Savings**: 90% reduction in workplan creation time
2. **Quality**: 90% of slides pass quality validation on first generation
3. **Research Accuracy**: 100% of numbers have traceable sources
4. **Designer Satisfaction**: Designers can execute slides without asking questions
5. **Revision Rate**: <10% of slides require regeneration

---

## 14. Future Enhancements

1. **Automated Image Generation**: Use DALL-E/Midjourney for custom illustrations
2. **Competitor Monitoring**: Continuous competitor tracking (not just one-time research)
3. **A/B Testing**: Generate multiple design options per slide
4. **Client Feedback Loop**: Integrate client feedback into workplan updates
5. **Template Library**: Learn from successful workplans to improve templates

---

## Appendix A: Slide Type Reference

Based on meeting notes and example documents:

### Always Present (Core Slides)

1. Industry Strengths (2N, 4S, 3C)
2. Opportunity in Market (3N, 5S, 4C)
3. Target and Their Needs (5C, 6N)
4. Current Solution & How Target Uses It (7N, 6N)
5. Why Target Uses Current Solution (8N, 8S)
6. Competitive Landscape - Page 1: Competitors (9N, 9S)
7. Competitive Landscape - Page 2: Competitor Positioning (10N, 10S)

### Marketing Campaign Specific

8. Market Gaps - Page 1: Competitor Weaknesses (12N)
9. Market Gaps - Page 2: Client Response (13N)
10. All Truths Considered (14N)
11. Strategic Interpretation (15N)
12. Strategy to Idea (16N)
13. The Big Idea (17N) - **CRITICAL** (generates 2 options)

### Logo/Branding Specific

- Visual Rationale
- Logo Options

---

## Appendix B: Research Query Templates

```javascript
const RESEARCH_QUERIES = {
  INDUSTRY_STRENGTHS: {
    population: "{industry} population {region} 2025",
    behavior: "{industry} consumer behavior trends {region}",
    marketSize: "{industry} market size {region} USD",
    growthRate: "{industry} CAGR growth rate {region} 2025-2030",
    // {region} is replaced with determined region (from questionnaire/client context)
    // Falls back to "Nigeria" if region cannot be determined
  },

  COMPETITIVE_LANDSCAPE: {
    competitors: "top {industry} companies {region} market share",
    positioning: "{competitor} brand positioning strategy {region}",
    campaigns: "{competitor} recent marketing campaigns {region}",
  },

  MARKET_GAPS: {
    weaknesses: "{competitor} weaknesses {industry} {region}",
    unmetNeeds: "{industry} unmet customer needs {region}",
    opportunities: "{industry} market opportunities {region} 2025",
  },
};
```

---

**END OF IMPLEMENTATION PLAN**
