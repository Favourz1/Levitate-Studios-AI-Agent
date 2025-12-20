const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const {
  WorkplanServiceType,
  WorkplanServiceTypeFallback,
  SlideType,
  DocumentType,
  DocumentStatus,
  SystemActors,
  AuditActions,
} = require("@/constants");
const { llmClient } = require("@/llm/client");
const { tocGenerationSchema } = require("@/llm/schemas/workplanSchemas");
const { z } = require("zod");

const logger = createLogger("service:workplan-planner");
const prisma = getPrismaClient();

/**
 * Slide Templates
 * Defines core slides, marketing slides, and logo/branding slides
 */
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

/**
 * Service Type to Slide Mapping
 * Maps each WorkplanServiceType to array of slide types
 */
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
    // Additional campaign execution slides can be added here
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

/**
 * Workplan Planner Service
 * Agent A: Determines Table of Contents (TOC) for workplan documents
 */
class WorkplanPlannerService {
  /**
   * Main entry point: Get service type for project (uses cache if available)
   * @param {number} projectId - Project ID
   * @param {boolean} forceRefresh - Optional, force re-determination
   * @returns {Promise<string>} Service type string (e.g., "MARKETING_CAMPAIGN", "GENERAL")
   */
  static async getServiceType(projectId, forceRefresh = false) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { serviceTypes: true },
      });

      if (!project) {
        logger.error({ projectId }, "Project not found");
        throw new Error(`Project not found: ${projectId}`);
      }

      // Check cache first (unless force refresh)
      if (
        !forceRefresh &&
        project?.serviceTypes &&
        Array.isArray(project.serviceTypes) &&
        project.serviceTypes.length > 0
      ) {
        logger.debug(
          { projectId, cacheHit: true },
          "Using cached service type"
        );
        return this.getHighestRatedServiceType(project.serviceTypes);
      }

      // Cache miss or force refresh: determine with LLM
      logger.info(
        { projectId, forceRefresh },
        "Determining service type with LLM"
      );
      const serviceMatches = await this._determineServiceTypeWithLLM(projectId);

      // Store full array in cache
      await prisma.project.update({
        where: { id: projectId },
        data: { serviceTypes: serviceMatches },
      });

      logger.info(
        { projectId, matchesCount: serviceMatches.length },
        "Service type determined and cached"
      );

      // Return highest rated
      return this.getHighestRatedServiceType(serviceMatches);
    } catch (error) {
      logger.error(
        { projectId, error: error.message, stack: error.stack },
        "Failed to get service type"
      );
      // Return fallback on error
      return WorkplanServiceTypeFallback.GENERAL;
    }
  }

  /**
   * Get highest-rated service type from matches array
   * @param {Array} serviceMatches - Array of {serviceType, rating, reasoning}
   * @returns {string} Service type with highest rating (or "GENERAL" if rating < 5)
   */
  static getHighestRatedServiceType(serviceMatches) {
    if (!Array.isArray(serviceMatches) || serviceMatches.length === 0) {
      logger.warn("Empty service matches array, returning GENERAL");
      return WorkplanServiceTypeFallback.GENERAL;
    }

    // Sort by rating descending
    const sorted = [...serviceMatches].sort((a, b) => b.rating - a.rating);
    const topMatch = sorted[0];

    // Return top match if rating >= 5, otherwise GENERAL
    if (topMatch.rating >= 5) {
      logger.debug(
        { serviceType: topMatch.serviceType, rating: topMatch.rating },
        "Selected highest-rated service type"
      );
      return topMatch.serviceType;
    }

    logger.warn(
      { topRating: topMatch.rating },
      "Top match rating < 5, returning GENERAL"
    );
    return WorkplanServiceTypeFallback.GENERAL;
  }

  /**
   * Get full array of service matches for inspection/debugging
   * @param {number} projectId - Project ID
   * @returns {Promise<Array>} Full array of {serviceType, rating, reasoning}
   */
  static async getServiceTypeMatches(projectId) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { serviceTypes: true },
      });

      return project?.serviceTypes || [];
    } catch (error) {
      logger.error(
        { projectId, error: error.message },
        "Failed to get service type matches"
      );
      return [];
    }
  }

  /**
   * Internal: Call LLM to determine service types (called only when cache is empty)
   * @param {number} projectId - Project ID
   * @returns {Promise<Array>} Array of {serviceType, rating, reasoning}
   */
  static async _determineServiceTypeWithLLM(projectId) {
    try {
      // Load project context
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: true,
          questionnaireResponses: {
            orderBy: { submittedAt: "desc" },
            take: 1,
          },
          documents: {
            where: {
              type: { in: [DocumentType.BRAND_ORIGIN, DocumentType.QUOTE] },
              status: DocumentStatus.ACCEPTED,
            },
            include: {
              revisions: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      });

      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      // Assemble context
      const questionnaire =
        project.questionnaireResponses?.[0]?.responses || {};

      // Extract brand origin from latest revision snapshotText
      const brandOriginDoc = project.documents.find(
        (d) => d.type === DocumentType.BRAND_ORIGIN
      );
      const brandOrigin = brandOriginDoc?.revisions?.[0]?.snapshotText || "";

      // Extract quote text from latest revision snapshotText or snapshotMd
      const quoteDoc = project.documents.find(
        (d) => d.type === DocumentType.QUOTE
      );
      let quoteText = "";
      if (quoteDoc?.revisions?.[0]) {
        const revision = quoteDoc.revisions[0];
        // Prefer snapshotMd.quoteItems if available, otherwise snapshotText
        if (revision.snapshotMd?.quoteItems) {
          quoteText = revision.snapshotMd.quoteItems
            .map((item) => `${item.item_code || ""}: ${item.description || ""}`)
            .join("\n");
        } else {
          quoteText = revision.snapshotText || "";
        }
      }

      const clientContext = project.client?.context || "";
      const projectContext = project.context || "";

      // Build prompt for LLM
      const prompt = `# Service Type Determination for Workplan Generation

## Your Role & Expertise
You are an expert project analyst and strategic consultant for Levitate Studios, a premium creative agency. Your task is to analyze project requirements and determine which service type(s) best match this project. This determination is critical as it drives the entire workplan structure and slide selection.

## Service Type Definitions

${Object.values(WorkplanServiceType)
  .map((st, idx) => {
    const descriptions = {
      LOGO_DESIGN: "Brand identity creation, logo design, visual brand marks",
      MARKETING_CAMPAIGN:
        "Comprehensive marketing strategy, multi-channel campaigns, brand awareness",
      GTM_STRATEGY:
        "Go-to-market planning, product launch strategy, market entry",
      GTM_360_CAMPAIGN:
        "Full 360-degree marketing campaigns across all channels and touchpoints",
      SOCIAL_MEDIA_STRATEGY:
        "Social media planning, content strategy, community management",
      BRAND_DESIGN:
        "Complete brand identity system, visual guidelines, brand architecture",
      WEB_DESIGN: "Website design, user experience, digital presence",
      PACKAGING_DESIGN:
        "Product packaging, retail design, physical product presentation",
      VIDEO_PRODUCTION: "Video content creation, commercials, brand films",
      MOTION_DESIGN: "Animated graphics, motion graphics, video animations",
      ADVERTISING:
        "Advertising campaigns, media planning, creative advertising",
    };
    return `${idx + 1}. **${st}**: ${
      descriptions[st] || "Creative service offering"
    }`;
  })
  .join("\n")}
${
  Object.values(WorkplanServiceType).length + 1
}. **GENERAL**: Fallback option for projects that don't clearly fit any specific service type or require a generic strategic approach

## Project Context

### Basic Information
- **Project Name:** ${project.name}
- **Client:** ${project.client?.name || "Unknown"}
${clientContext ? `- **Client Context:** ${clientContext}` : ""}
${projectContext ? `- **Project Context:** ${projectContext}` : ""}

### Questionnaire Responses
\`\`\`json
${JSON.stringify(questionnaire, null, 2)}
\`\`\`

${
  brandOrigin
    ? `### Brand Origin Document (Strategic Foundation)
${brandOrigin}

**Key Insights to Extract:**
- Brand positioning and target audience
- Strategic objectives and goals
- Service requirements mentioned
- Creative direction and deliverables
`
    : ""
}

${
  quoteText
    ? `### Quote Document - Services & Deliverables
${quoteText}

**Key Insights to Extract:**
- Specific services listed
- Deliverable types and scope
- Service combinations or packages
`
    : ""
}

## Analysis Methodology

### Step 1: Requirement Extraction
Carefully analyze the project context to identify:
- **Primary Services**: What is the main service being requested?
- **Service Combinations**: Are multiple services bundled together?
- **Strategic Focus**: Is this strategic planning, creative execution, or both?
- **Deliverable Types**: What specific outputs are needed (logos, campaigns, websites, etc.)?

### Step 2: Service Type Matching
For each service type, evaluate:

**Rating Scale (0-10):**
- **9-10 (Perfect Match)**: Project requirements align perfectly with this service type. All key indicators match.
  - Example: Questionnaire mentions "marketing campaign", quote includes "social media content", brand origin discusses "brand awareness goals"
- **7-8 (Strong Match)**: Project aligns well with this service type. Most requirements match, minor gaps acceptable.
  - Example: Primary focus is this service type, but includes some elements of another
- **5-6 (Moderate Match)**: Some elements align, but not the primary focus. May be secondary or supporting service.
  - Example: Service type is mentioned but not the main deliverable
- **3-4 (Weak Match)**: Minimal alignment. Only tangential connection.
  - Example: Service type mentioned briefly or indirectly
- **0-2 (No Match)**: No alignment. Project doesn't fit this service type at all.

### Step 3: Reasoning Development
For each service type with rating >= 3, provide:
- **Specific Evidence**: Quote exact phrases, deliverables, or requirements that support this match
- **Confidence Factors**: What makes you confident (or uncertain) about this match?
- **Gap Analysis**: What's missing that prevents a higher rating?

### Step 4: GENERAL Fallback Evaluation
- Use GENERAL if no specific service type scores >= 7
- Use GENERAL if project requirements are too vague or generic
- Use GENERAL if multiple service types score equally high (tie-breaker)
- Rate GENERAL appropriately based on how generic the project requirements are

## Output Requirements

Return an array of service matches with:
- **serviceType**: One of the available service types (including "GENERAL")
- **rating**: Number from 0-10 indicating match quality (be precise, use decimals if needed)
- **reasoning**: Detailed explanation (2-4 sentences) that includes:
  1. Specific evidence from project context
  2. Why this rating was assigned
  3. What would need to change for a higher/lower rating

**Critical Rules:**
1. Include ALL service types with rating >= 3 (helps provide context for selection)
2. Be honest and precise with ratings - don't inflate scores
3. If multiple service types score >= 7, include all of them (selection logic will choose highest)
4. Always include GENERAL with appropriate rating (even if rating is low)
5. Reasoning must reference specific evidence from questionnaire, brand origin, or quote

**Quality Checklist:**
- ✓ Each reasoning references specific project elements
- ✓ Ratings are justified and consistent
- ✓ At least one service type has rating >= 5 (or GENERAL is rated appropriately)
- ✓ Reasoning is clear and actionable`;

      // Create schema for LLM output
      const serviceTypeSchema = z.object({
        serviceMatches: z.array(
          z.object({
            serviceType: z.enum([
              ...Object.values(WorkplanServiceType),
              WorkplanServiceTypeFallback.GENERAL,
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

      // Call LLM with structured output
      const result = await llmClient.generateStructured(
        serviceTypeSchema,
        prompt,
        {
          projectId,
          clientName: project.client?.name,
          hasQuestionnaire:
            !!questionnaire && Object.keys(questionnaire).length > 0,
          hasBrandOrigin: !!brandOrigin,
          hasQuote: !!quoteText,
        },
        "classification"
      );

      const serviceMatches = result.data?.serviceMatches || [];

      if (serviceMatches.length === 0) {
        logger.warn(
          { projectId },
          "LLM returned empty service matches, using fallback"
        );
        return [
          {
            serviceType: WorkplanServiceTypeFallback.GENERAL,
            rating: 0,
            reasoning: "No service matches returned from LLM",
          },
        ];
      }

      logger.info(
        {
          projectId,
          matchesCount: serviceMatches.length,
          topMatch: serviceMatches[0]?.serviceType,
          topRating: serviceMatches[0]?.rating,
          traceId: result.traceId,
        },
        "Service type determination completed"
      );

      return serviceMatches;
    } catch (error) {
      logger.error(
        { projectId, error: error.message, stack: error.stack },
        "Failed to determine service type with LLM"
      );
      // Return fallback on error
      return [
        {
          serviceType: WorkplanServiceTypeFallback.GENERAL,
          rating: 0,
          reasoning: `Error: ${error.message}`,
        },
      ];
    }
  }

  /**
   * Generate Table of Contents (TOC) for workplan document
   * @param {number} projectId - Project ID
   * @param {string} serviceType - Service type (optional, will be determined if not provided)
   * @param {Object} context - Additional context (optional)
   * @returns {Promise<Array>} Array of slide definitions
   */
  static async generateTOC(projectId, serviceType, context = {}) {
    try {
      logger.info({ projectId, serviceType }, "Starting TOC generation");

      // If serviceType not provided, get it (checks cache first)
      if (!serviceType) {
        serviceType = await this.getServiceType(projectId);
        logger.info(
          { projectId, determinedServiceType: serviceType },
          "Service type determined"
        );
      }

      // Validate service type - use GENERAL fallback if not in SERVICE_TYPE_SLIDE_MAP
      const slideMap =
        SERVICE_TYPE_SLIDE_MAP[serviceType] || SERVICE_TYPE_SLIDE_MAP.GENERAL;
      if (!SERVICE_TYPE_SLIDE_MAP[serviceType]) {
        logger.warn(
          { projectId, serviceType },
          "Unknown service type, using GENERAL slide template"
        );
      }

      // Load project context (questionnaire, brand origin, client info)
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: true,
          questionnaireResponses: {
            orderBy: { submittedAt: "desc" },
            take: 1,
          },
          documents: {
            where: {
              type: { in: [DocumentType.BRAND_ORIGIN, DocumentType.QUOTE] },
              status: DocumentStatus.ACCEPTED,
            },
            include: {
              revisions: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      });

      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      // Assemble context for LLM
      const questionnaire =
        project.questionnaireResponses?.[0]?.responses || {};

      const brandOriginDoc = project.documents.find(
        (d) => d.type === DocumentType.BRAND_ORIGIN
      );
      const brandOrigin = brandOriginDoc?.revisions?.[0]?.snapshotText || "";

      const quoteDoc = project.documents.find(
        (d) => d.type === DocumentType.QUOTE
      );
      let quoteText = "";
      if (quoteDoc?.revisions?.[0]) {
        const revision = quoteDoc.revisions[0];
        if (revision.snapshotMd?.quoteItems) {
          quoteText = revision.snapshotMd.quoteItems
            .map((item) => `${item.item_code || ""}: ${item.description || ""}`)
            .join("\n");
        } else {
          quoteText = revision.snapshotText || "";
        }
      }

      const clientContext = project.client?.context || "";
      const projectContext = project.context || "";

      // Build prompt for LLM TOC generation
      const prompt = `# Workplan Table of Contents Generation

## Your Role & Mission
You are an expert Strategic Planner for Levitate Studios, responsible for creating the foundational structure of workplan documents. Your work enables designers to execute slides without thinking - you're building the strategic blueprint that guides all creative work.

## Service Type Context
**${serviceType}**

This service type determines the strategic approach and required slide types. Use this context to ensure slides align with the project's strategic goals.

## Slide Type Reference

${Object.values(SlideType)
  .map((st, idx) => {
    const descriptions = {
      INDUSTRY_STRENGTHS:
        "Market size, growth rates, population demographics, consumer behavior trends",
      OPPORTUNITY_IN_MARKET:
        "Market opportunities, gaps, emerging trends, untapped potential",
      TARGET_AND_NEEDS:
        "Target audience definition, demographics, psychographics, pain points, needs",
      CURRENT_SOLUTION:
        "Existing solutions in market, how target currently solves their problem",
      WHY_CURRENT_SOLUTION:
        "Reasons target uses current solution, motivations, barriers to change",
      COMPETITIVE_LANDSCAPE:
        "Competitor overview, market leaders, competitive positioning",
      COMPETITOR_POSITIONING:
        "How competitors position themselves, messaging, brand positioning",
      INDUSTRY_SHIFT:
        "Industry trends, disruptions, changes affecting the market",
      MARKET_GAPS: "Competitor weaknesses, unmet needs, market opportunities",
      MARKET_GAPS_RESPONSE:
        "How client addresses gaps, unique value proposition, competitive advantage",
      ALL_TRUTHS_CONSIDERED:
        "Product truth, market truth, industry truth, target truth synthesis",
      STRATEGIC_INTERPRETATION:
        "Strategic insights derived from all truths, key strategic directions",
      STRATEGY_TO_IDEA:
        "Translation of strategy into creative concepts, strategic bridge",
      BIG_IDEA:
        "The core creative idea that drives all messaging (generates 2 options)",
      VISUAL_RATIONALE:
        "Visual design reasoning, aesthetic direction, design principles",
      LOGO_OPTIONS: "Logo design options, visual identity variations",
    };
    return `${idx + 1}. **${st}**: ${descriptions[st] || "Strategic slide"}`;
  })
  .join("\n")}

## Required Slides (Business Rules - MANDATORY)
Based on the service type "${serviceType}", the following slides MUST be included in the workplan:
${slideMap.map((st, idx) => `${idx + 1}. ${st}`).join("\n")}

**CRITICAL**: Every slide listed above MUST appear in your output. Do not omit any required slides.

## Project Context

### Basic Information
- **Project Name:** ${project.name}
- **Client:** ${project.client?.name || "Unknown"}
${clientContext ? `- **Client Context:** ${clientContext}` : ""}
${projectContext ? `- **Project Context:** ${projectContext}` : ""}

### Questionnaire Responses
\`\`\`json
${JSON.stringify(questionnaire, null, 2)}
\`\`\`

**Key Information to Extract:**
- Industry/market focus
- Target audience details
- Competitor mentions
- Geographic region/market
- Strategic objectives

${
  brandOrigin
    ? `### Brand Origin Document (Strategic Foundation)
${brandOrigin}

**Key Insights:**
- Brand positioning and strategy
- Target audience definition
- Competitive landscape insights
- Strategic objectives and goals
`
    : ""
}

${
  quoteText
    ? `### Quote Document - Services & Deliverables
${quoteText}

**Key Insights:**
- Service scope and deliverables
- Project complexity and scale
- Strategic vs. execution focus
`
    : ""
}

## Strategic Slide Ordering Framework

Arrange slides following this logical strategic narrative flow:

**Phase 1: Market Understanding (Foundation)**
1. Industry Strengths - Establish market context and opportunity size
2. Opportunity in Market - Identify specific opportunities
3. Industry Shift - Show market dynamics and changes

**Phase 2: Audience & Solution Analysis**
4. Target and Their Needs - Define who we're targeting and why
5. Current Solution - Understand existing solutions
6. Why Current Solution - Understand motivations and barriers

**Phase 3: Competitive Intelligence**
7. Competitive Landscape - Overview of competitors
8. Competitor Positioning - How competitors position themselves

**Phase 4: Strategic Development (Marketing Campaigns & Generals)**
9. Market Gaps - Identify competitor weaknesses and opportunities
10. Market Gaps Response - How client addresses these gaps
11. All Truths Considered - Synthesize all insights
12. Strategic Interpretation - Derive strategic direction
13. Strategy to Idea - Bridge strategy to creative
14. Big Idea - The core creative concept (2 options)

**Phase 5: Creative Execution (Logo/Branding)**
- Visual Rationale - Design direction
- Logo Options - Visual identity options

## Title Generation Guidelines

Create compelling, strategic titles that:
- **Be Specific**: Reference the client, industry, or key insight
- **Be Actionable**: Use active language that suggests strategic direction
- **Be Memorable**: Make titles that stick and communicate value
- **Avoid Generic**: Don't use generic phrases like "Overview" or "Introduction"

**Good Title Examples:**
- "Nigeria's Fintech Market: 226M Population, 15% CAGR Growth"
- "The Opportunity: Untapped Millennial Market Seeking Authentic Brands"
- "Competitive Landscape: Three Giants (mention giants) Dominating 80% Market Share"
- "Market Gaps: Where Competitors Fail to Connect with Gen Z"

**Bad Title Examples:**
- "Industry Overview"
- "Market Analysis"
- "Competitors"
- "Strategy"

## Research Query Guidelines

For each slide, suggest 2-3 research queries that will help gather data. Queries should:
- **Be Specific**: Include industry, region, and specific data points
- **Include Placeholders**: Use {region} placeholder (will be replaced with actual region)
- **Target Data Types**: Focus on statistics, trends, market data, competitor info
- **Be Actionable**: Queries that will yield actionable insights

**Query Examples:**
- "{industry} market size {region} 2024 USD"
- "{industry} growth rate CAGR {region} 2025-2030"
- "{competitor} market share {industry} {region}"
- "{industry} consumer behavior trends {region} 2024"

## Special Slide Handling

### Big Idea Slide
- **requiresBigIdea**: MUST be set to true for BIG_IDEA slide type
- This slide will generate 2 distinct Big Idea options
- Title should reflect that multiple options will be presented

### Market Gaps (2-Page Structure)
- MARKET_GAPS: Page 1 - Competitor weaknesses
- MARKET_GAPS_RESPONSE: Page 2 - Client response
- These are two separate slides, ensure both are included

### Optional Slides
- **isOptional**: Set to true ONLY if a slide is truly optional based on project context
- Most required slides should be isOptional: false
- Only mark optional if project context clearly indicates the slide isn't needed

## Output Requirements

Return an array of slides with:
- **slideNumber**: Sequential number starting from 1 (1, 2, 3, ...)
- **slideType**: One of the SlideType enum values (MUST match exactly)
- **title**: Strategic, compelling title (3-8 words, specific and actionable)
- **isOptional**: Boolean (default: false, only true if truly optional)
- **requiresBigIdea**: Boolean (true ONLY for BIG_IDEA slide type)
- **researchQueries**: Array of 2-3 research query strings (include {region} placeholder)

**Critical Validation Checklist:**
✓ All required slides from "Required Slides" section are included
✓ No slides added that aren't in the required list
✓ Slide numbers are sequential (1, 2, 3, ...)
✓ Titles are specific, strategic, and compelling (not generic)
✓ Research queries include {region} placeholder
✓ requiresBigIdea is true ONLY for BIG_IDEA slide type
✓ Slide order follows strategic flow framework
✓ All slideType values match exactly with SlideType enum

**Output Format:**
Return a JSON object with:
- **slides**: Array of slide objects (as described above)
- **rationale**: Brief explanation (2-3 sentences) of why these slides were selected and ordered this way`;

      // Use LLM with structured output to determine slides
      const result = await llmClient.generateStructured(
        tocGenerationSchema,
        prompt,
        {
          projectId,
          serviceType,
          clientName: project.client?.name,
          hasQuestionnaire:
            !!questionnaire && Object.keys(questionnaire).length > 0,
          hasBrandOrigin: !!brandOrigin,
          hasQuote: !!quoteText,
        },
        "planning"
      );

      let slides = result.data?.slides || [];

      // Apply business rules: filter/enhance LLM output
      // Ensure all required slides from slideMap are present
      const requiredSlideTypes = new Set(slideMap);
      const presentSlideTypes = new Set(slides.map((s) => s.slideType));

      // Add missing required slides
      for (const requiredType of requiredSlideTypes) {
        if (!presentSlideTypes.has(requiredType)) {
          logger.warn(
            { projectId, missingSlideType: requiredType },
            "Adding missing required slide"
          );
          slides.push({
            slideNumber: slides.length + 1,
            slideType: requiredType,
            title: `${requiredType.replace(/_/g, " ")}`,
            isOptional: false,
            requiresBigIdea: requiredType === SlideType.BIG_IDEA,
            researchQueries: [],
          });
        }
      }

      // Remove slides not in required list (unless they're explicitly added by LLM for good reason)
      // But be lenient - if LLM added something strategic, keep it
      slides = slides.filter((slide) => {
        if (requiredSlideTypes.has(slide.slideType)) {
          return true; // Required slide, keep it
        }
        // Optional slide added by LLM - keep if it makes strategic sense
        logger.debug(
          { projectId, slideType: slide.slideType },
          "LLM added optional slide, keeping it"
        );
        return true; // Keep LLM-added slides for now
      });

      // Re-number slides sequentially
      slides = slides.map((slide, index) => ({
        ...slide,
        slideNumber: index + 1,
      }));

      // Sort by slide number
      slides.sort((a, b) => a.slideNumber - b.slideNumber);

      // Create document record with type=WORKPLAN and status=DRAFT
      // Note: Service type is stored in project.serviceTypes, not in metadataInfo
      const document = await prisma.document.create({
        data: {
          projectId,
          type: DocumentType.WORKPLAN,
          status: DocumentStatus.DRAFT,
          metadataInfo: {
            tableOfContents: slides,
            generatedAt: new Date().toISOString(),
          },
        },
      });

      // Create audit log for successful TOC generation
      await prisma.auditLog.create({
        data: {
          projectId,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          action: AuditActions.WORKPLAN_GENERATION_STARTED,
          details: {
            documentId: document.id,
            serviceType,
            slideCount: slides.length,
            traceId: result.traceId,
          },
          at: new Date(),
        },
      });

      logger.info(
        {
          projectId,
          documentId: document.id,
          serviceType,
          slideCount: slides.length,
          traceId: result.traceId,
        },
        "TOC generation completed successfully"
      );

      return slides;
    } catch (error) {
      logger.error(
        { projectId, serviceType, error: error.message, stack: error.stack },
        "Failed to generate TOC"
      );

      // Create audit log for failed TOC generation
      try {
        await prisma.auditLog.create({
          data: {
            projectId,
            actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
            action: AuditActions.WORKPLAN_GENERATION_FAILED,
            details: {
              serviceType,
              error: error.message,
              errorType: error.constructor.name,
              stage: "toc_generation",
            },
            at: new Date(),
          },
        });
      } catch (auditError) {
        logger.error(
          { projectId, error: auditError.message },
          "Failed to create audit log for TOC generation failure"
        );
      }

      throw error;
    }
  }
}

module.exports = { WorkplanPlannerService };
