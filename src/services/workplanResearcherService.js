const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { tavilyIntegration } = require("@/integrations/tavily");
const {
  SlideType,
  ResearchStatus,
  DocumentType,
  DocumentStatus,
} = require("@/constants");
const {
  competitorAnalysisTool,
  marketDataTool,
} = require("@/llm/tools/researchTools");
const { llmClient } = require("@/llm/client");
const { z } = require("zod");
const {
  regionExtractionSchema,
  industryExtractionSchema,
  targetAudienceExtractionSchema,
  competitorListExtractionSchema,
} = require("@/llm/schemas/workplanSchemas");

const logger = createLogger("service:workplan-researcher");
const prisma = getPrismaClient();

/**
 * Research Strategies Per Slide Type
 * Defines queries and data points for each slide type
 */
// Get current year for dynamic query generation
const getCurrentYear = () => new Date().getFullYear();

const RESEARCH_STRATEGIES = {
  [SlideType.INDUSTRY_STRENGTHS]: {
    queries: [
      "{industry} market size {region} {year}",
      "{industry} growth rate {region}",
      "{industry} population demographics {region}",
      "{industry} consumer behavior trends {region}",
    ],
    dataPoints: ["marketSize", "growthRate", "population", "behaviorTrends"],
    requiresCompetitorList: false,
  },

  [SlideType.OPPORTUNITY_IN_MARKET]: {
    queries: [
      "{industry} market opportunities {region} {year}",
      "{industry} emerging trends {region}",
      "{industry} market gaps {region}",
      "{targetAudience} needs {industry} {region}",
    ],
    dataPoints: ["opportunities", "trends", "marketGaps", "targetNeeds"],
    requiresCompetitorList: false,
  },

  [SlideType.TARGET_AND_NEEDS]: {
    queries: [
      "{targetAudience} demographics {region}",
      "{targetAudience} behavior patterns {region}",
      "{targetAudience} needs {industry} {region}",
      "{targetAudience} preferences {industry}",
    ],
    dataPoints: ["demographics", "behaviorPatterns", "needs", "preferences"],
    requiresCompetitorList: false,
  },

  [SlideType.CURRENT_SOLUTION]: {
    queries: [
      "{industry} current solutions {region}",
      "{industry} existing products {region}",
      "how {targetAudience} uses {industry} products {region}",
    ],
    dataPoints: ["currentSolutions", "existingProducts", "usagePatterns"],
    requiresCompetitorList: false,
  },

  [SlideType.WHY_CURRENT_SOLUTION]: {
    queries: [
      "why {targetAudience} chooses {industry} products {region}",
      "{industry} customer motivations {region}",
      "{industry} purchase drivers {region}",
    ],
    dataPoints: ["motivations", "purchaseDrivers", "decisionFactors"],
    requiresCompetitorList: false,
  },

  [SlideType.COMPETITIVE_LANDSCAPE]: {
    queries: [
      "{industry} market leaders {region}",
      "{industry} top companies {region} market share",
      "{competitor1} {competitor2} {competitor3} market share {industry} {region}",
    ],
    dataPoints: ["marketShare", "leaders", "competitorList"],
    requiresCompetitorList: true,
  },

  [SlideType.COMPETITOR_POSITIONING]: {
    queries: [
      "{competitor} positioning strategy {industry} {region}",
      "{competitor} brand messaging {region}",
      "{competitor} recent campaigns {region}",
    ],
    dataPoints: ["positioning", "messaging", "campaigns"],
    requiresCompetitorList: true,
  },

  [SlideType.INDUSTRY_SHIFT]: {
    queries: [
      "{industry} trends {region} {year}",
      "{industry} disruptions {region}",
      "{industry} changes {region}",
    ],
    dataPoints: ["trends", "disruptions", "changes"],
    requiresCompetitorList: false,
  },

  [SlideType.MARKET_GAPS]: {
    queries: [
      "{competitor} weaknesses {industry} {region}",
      "{industry} unmet needs {region}",
      "{product} vs competitors comparison {region}",
    ],
    dataPoints: ["competitorWeaknesses", "unmetNeeds", "comparison"],
    requiresCompetitorList: true,
  },

  [SlideType.MARKET_GAPS_RESPONSE]: {
    queries: [
      "{industry} competitive advantages {region}",
      "{industry} unique value propositions {region}",
    ],
    dataPoints: ["competitiveAdvantages", "valuePropositions"],
    requiresCompetitorList: false,
  },

  [SlideType.ALL_TRUTHS_CONSIDERED]: {
    queries: [
      "{industry} market truth {region}",
      "{industry} product truth {region}",
      "{targetAudience} truth {industry} {region}",
    ],
    dataPoints: ["marketTruth", "productTruth", "targetTruth"],
    requiresCompetitorList: false,
  },

  [SlideType.STRATEGIC_INTERPRETATION]: {
    queries: [
      "{industry} strategic insights {region}",
      "{industry} strategic direction {region}",
    ],
    dataPoints: ["strategicInsights", "strategicDirection"],
    requiresCompetitorList: false,
  },

  [SlideType.STRATEGY_TO_IDEA]: {
    queries: [
      "{industry} creative concepts {region}",
      "{industry} campaign ideas {region}",
    ],
    dataPoints: ["creativeConcepts", "campaignIdeas"],
    requiresCompetitorList: false,
  },

  [SlideType.BIG_IDEA]: {
    queries: [
      "{industry} creative campaigns {region}",
      "{targetAudience} messaging trends {region}",
      "{brand} positioning opportunities {region}",
    ],
    dataPoints: ["campaignExamples", "messagingTrends", "opportunities"],
    requiresCompetitorList: false,
  },

  [SlideType.VISUAL_RATIONALE]: {
    queries: [
      "{industry} visual design trends {region}",
      "{industry} design aesthetics {region}",
    ],
    dataPoints: ["designTrends", "aesthetics"],
    requiresCompetitorList: false,
  },

  [SlideType.LOGO_OPTIONS]: {
    queries: [
      "{industry} logo design trends {region}",
      "{industry} brand identity examples {region}",
    ],
    dataPoints: ["logoTrends", "identityExamples"],
    requiresCompetitorList: false,
  },
};

/**
 * Workplan Researcher Service
 * Agent B: Performs web research for each slide
 */
class WorkplanResearcherService {
  /**
   * Determine target region from context using LLM structured output
   * Extracts region from questionnaire, client context, and brand origin document
   * @param {Object} context - Context object with project, questionnaire, brandOrigin, etc.
   * @returns {Promise<string>} Determined region or "Nigeria" as fallback
   */
  static async determineTargetRegion(context) {
    try {
      const questionnaire =
        context.questionnaire?.responses || context.questionnaire?.raw || {};
      const clientContext =
        context.project?.client?.context || context.clientContext || "";
      const brandOrigin =
        context.brandOrigin?.snapshotText || context.brandOrigin || "";
      const clientName = context.project?.client?.name || "";

      // Build comprehensive prompt for region extraction
      const prompt = `You are an expert market researcher analyzing project context to determine the target geographic region/market.

**Project Context:**
- Client Name: ${clientName || "Not specified"}
- Questionnaire Responses: ${JSON.stringify(questionnaire, null, 2)}
- Client Context: ${
        typeof clientContext === "string"
          ? clientContext
          : JSON.stringify(clientContext, null, 2)
      }
- Brand Origin Document: ${brandOrigin ? brandOrigin : "Not available"}

**Task:**
Extract the PRIMARY target region/market for this project. Look for:
1. Geographic focus, target market, target region, target countries in questionnaire
2. Market focus, geographic scope in client context
3. Regional mentions in brand origin document
4. Any country or region names mentioned (Nigeria, Ghana, Kenya, South Africa, West Africa, East Africa, Africa, Global, etc.)

**Guidelines:**
- Use the MOST SPECIFIC region mentioned (e.g., "Nigeria" is more specific than "West Africa")
- If multiple regions mentioned, select the PRIMARY one
- If no clear region found, use "Nigeria" as default fallback
- Return region name in standard format (e.g., "Nigeria", "Ghana", "West Africa", "South Africa")
- Confidence should reflect how clearly the region is stated (10 = explicitly stated, 5 = inferred, 0 = default fallback)

Extract the target region now.`;

      const result = await llmClient.generateStructured(
        regionExtractionSchema,
        prompt,
        {
          projectId: context.project?.id,
          clientName,
          taskType: "region-extraction",
        },
        "extraction"
      );

      const extractedRegion = result.data?.region || "Nigeria";
      const confidence = result.data?.confidence || 0;

      logger.info(
        {
          region: extractedRegion,
          confidence,
          source: result.data?.source,
          reasoning: result.data?.reasoning,
        },
        "Target region determined using LLM"
      );

      // Fallback to Nigeria if confidence is very low
      if (confidence < 3) {
        logger.warn(
          { confidence, extractedRegion },
          "Low confidence in region extraction, using Nigeria fallback"
        );
        return "Nigeria";
      }

      return extractedRegion;
    } catch (error) {
      logger.error(
        { error: error.message, stack: error.stack },
        "Error determining target region with LLM, defaulting to Nigeria"
      );
      return "Nigeria";
    }
  }

  /**
   * Determine industry from context using LLM structured output
   * @param {Object} context - Context object with project, questionnaire, brandOrigin, etc.
   * @returns {Promise<string>} Determined industry or "general" as fallback
   */
  static async determineIndustry(context) {
    try {
      const questionnaire =
        context.questionnaire?.responses || context.questionnaire?.raw || {};
      const clientContext =
        context.project?.client?.context || context.clientContext || "";
      const brandOrigin =
        context.brandOrigin?.snapshotText || context.brandOrigin || "";
      const clientName = context.project?.client?.name || "";

      const prompt = `You are an expert business analyst extracting the primary industry or sector from project context.

**Project Context:**
- Client Name: ${clientName || "Not specified"}
- Questionnaire Responses: ${JSON.stringify(questionnaire, null, 2)}
- Client Context: ${
        typeof clientContext === "string"
          ? clientContext
          : JSON.stringify(clientContext, null, 2)
      }
- Brand Origin Document: ${
        brandOrigin ? brandOrigin.substring(0, 2000) : "Not available"
      }

**Task:**
Extract the PRIMARY industry or sector this project operates in. Look for:
1. Industry, sector, business type in questionnaire
2. Industry mentions in client context
3. Industry context in brand origin document

**Guidelines:**
- Use specific industry terminology (e.g., "Fintech", "E-commerce", "Healthcare", "Education", "Real Estate", "FMCG")
- Avoid generic terms like "business" or "services" - be specific
- If no clear industry found, use "general" as fallback
- Confidence should reflect how clearly the industry is stated (10 = explicitly stated, 5 = inferred, 0 = default fallback)

Extract the industry now.`;

      const result = await llmClient.generateStructured(
        industryExtractionSchema,
        prompt,
        {
          projectId: context.project?.id,
          clientName,
          taskType: "industry-extraction",
        },
        "extraction"
      );

      const extractedIndustry = result.data?.industry || "general";
      const confidence = result.data?.confidence || 0;

      logger.info(
        {
          industry: extractedIndustry,
          confidence,
          source: result.data?.source,
          reasoning: result.data?.reasoning,
        },
        "Industry determined using LLM"
      );

      return extractedIndustry;
    } catch (error) {
      logger.error(
        { error: error.message },
        "Error determining industry with LLM, defaulting to general"
      );
      return "general";
    }
  }

  /**
   * Determine target audience from context using LLM structured output
   * @param {Object} context - Context object with project, questionnaire, brandOrigin, etc.
   * @returns {Promise<string>} Determined target audience or "consumers" as fallback
   */
  static async determineTargetAudience(context) {
    try {
      const questionnaire =
        context.questionnaire?.responses || context.questionnaire?.raw || {};
      const clientContext =
        context.project?.client?.context || context.clientContext || "";
      const brandOrigin =
        context.brandOrigin?.snapshotText || context.brandOrigin || "";
      const clientName = context.project?.client?.name || "";

      const prompt = `You are an expert market researcher extracting the target audience from project context.

**Project Context:**
- Client Name: ${clientName || "Not specified"}
- Questionnaire Responses: ${JSON.stringify(questionnaire, null, 2)}
- Client Context: ${
        typeof clientContext === "string"
          ? clientContext
          : JSON.stringify(clientContext, null, 2)
      }
- Brand Origin Document: ${
        brandOrigin ? brandOrigin.substring(0, 2000) : "Not available"
      }

**Task:**
Extract the PRIMARY target audience or customer segment. Look for:
1. Target audience, target market, customer segment, demographics in questionnaire
2. Audience mentions in client context
3. Target customer descriptions in brand origin document

**Guidelines:**
- Be specific and descriptive (e.g., "Young professionals aged 25-35", "Small business owners", "Tech-savvy millennials", "Urban families")
- Include relevant demographics, psychographics, or behavioral characteristics if mentioned
- If no clear audience found, use "consumers" as fallback
- Confidence should reflect how clearly the audience is stated (10 = explicitly stated, 5 = inferred, 0 = default fallback)

Extract the target audience now.`;

      const result = await llmClient.generateStructured(
        targetAudienceExtractionSchema,
        prompt,
        {
          projectId: context.project?.id,
          clientName,
          taskType: "target-audience-extraction",
        },
        "extraction"
      );

      const extractedAudience = result.data?.targetAudience || "consumers";
      const confidence = result.data?.confidence || 0;

      logger.info(
        {
          targetAudience: extractedAudience,
          confidence,
          source: result.data?.source,
          reasoning: result.data?.reasoning,
        },
        "Target audience determined using LLM"
      );

      return extractedAudience;
    } catch (error) {
      logger.error(
        { error: error.message },
        "Error determining target audience with LLM, defaulting to consumers"
      );
      return "consumers";
    }
  }

  /**
   * Determine competitor list from context using LLM structured output
   * @param {Object} context - Context object with project, questionnaire, brandOrigin, etc.
   * @returns {Promise<Array<string>>} Array of competitor names (max 10)
   */
  static async determineCompetitorList(context) {
    try {
      const questionnaire =
        context.questionnaire?.responses || context.questionnaire?.raw || {};
      const clientContext =
        context.project?.client?.context || context.clientContext || "";
      const brandOrigin =
        context.brandOrigin?.snapshotText || context.brandOrigin || "";
      const clientName = context.project?.client?.name || "";

      const prompt = `You are an expert competitive analyst extracting competitor company names from project context.

**Project Context:**
- Client Name: ${clientName || "Not specified"}
- Questionnaire Responses: ${JSON.stringify(questionnaire, null, 2)}
- Client Context: ${
        typeof clientContext === "string"
          ? clientContext
          : JSON.stringify(clientContext, null, 2)
      }
- Brand Origin Document: ${
        brandOrigin ? brandOrigin.substring(0, 2000) : "Not available"
      }

**Task:**
Extract competitor company/brand names. Look for:
1. Competitors, competition, competitor names in questionnaire
2. Competitive landscape mentions in client context
3. Competitor references in brand origin document

**Guidelines:**
- Extract ACTUAL company/brand names (e.g., "MTN", "Dangote", "Flutterwave", "Jumia")
- Do NOT include generic descriptions like "telecom companies" or "e-commerce platforms"
- Limit to maximum 10 competitors
- If no competitors found, return empty array
- Confidence should reflect how clearly competitors are stated (10 = explicitly listed, 5 = inferred, 0 = none found)

Extract the competitor list now.`;

      const result = await llmClient.generateStructured(
        competitorListExtractionSchema,
        prompt,
        {
          projectId: context.project?.id,
          clientName,
          taskType: "competitor-extraction",
        },
        "extraction"
      );

      const competitors = result.data?.competitors || [];
      const confidence = result.data?.confidence || 0;

      // Limit to 10 competitors
      const limitedCompetitors = competitors.slice(0, 10);

      logger.info(
        {
          competitorCount: limitedCompetitors.length,
          competitors: limitedCompetitors,
          confidence,
          source: result.data?.source,
          reasoning: result.data?.reasoning,
        },
        "Competitor list determined using LLM"
      );

      return limitedCompetitors;
    } catch (error) {
      logger.error(
        { error: error.message },
        "Error determining competitor list with LLM, returning empty array"
      );
      return [];
    }
  }

  /**
   * Research a single slide
   * @param {Object} slide - WorkplanSlide object from database
   * @param {Object} context - Context object with project, questionnaire, brandOrigin, etc.
   * @returns {Promise<Object>} Research data JSON
   */
  static async researchSlide(slide, context) {
    const slideId = slide.id || slide.slideId;
    const documentId = slide.documentId || slide.document?.id;

    try {
      logger.info(
        {
          slideId,
          documentId,
          slideType: slide.slideType,
          slideNumber: slide.slideNumber,
        },
        "Starting research for slide"
      );

      // Update slide status to RESEARCHING
      await prisma.workplanSlide.update({
        where: { id: slideId },
        data: {
          researchStatus: ResearchStatus.RESEARCHING,
          updatedAt: new Date(),
        },
      });

      // Determine target region
      const region = await this.determineTargetRegion(context);
      logger.info(
        { region, slideType: slide.slideType },
        "Target region determined"
      );

      // Get research strategy for this slide type
      const strategy = RESEARCH_STRATEGIES[slide.slideType];
      if (!strategy) {
        logger.warn(
          { slideType: slide.slideType },
          "No research strategy found for slide type, using generic queries"
        );
        // Use generic strategy
        const genericStrategy = {
          queries: [
            `{industry} ${slide.slideType
              .toLowerCase()
              .replace(/_/g, " ")} {region}`,
          ],
          dataPoints: ["generalData"],
          requiresCompetitorList: false,
        };
        return await this._executeResearch(
          slide,
          genericStrategy,
          region,
          context
        );
      }

      // Execute research
      const researchData = await this._executeResearch(
        slide,
        strategy,
        region,
        context
      );

      // Validate research quality
      const qualityValid = this.validateResearchQuality(researchData);
      if (!qualityValid) {
        logger.warn(
          { slideId, slideType: slide.slideType },
          "Research quality validation failed, but continuing with available data"
        );
      }

      // Store research data and sources in database
      const metadataInfo = slide.metadataInfo || {};
      metadataInfo.researchSources = researchData.sources || [];

      await prisma.workplanSlide.update({
        where: { id: slideId },
        data: {
          researchData: researchData.data || researchData,
          researchStatus: qualityValid
            ? ResearchStatus.COMPLETED
            : ResearchStatus.COMPLETED, // Still mark as completed even if quality is low
          metadataInfo,
          updatedAt: new Date(),
        },
      });

      logger.info(
        {
          slideId,
          slideType: slide.slideType,
          sourceCount: researchData.sources?.length || 0,
          qualityValid,
        },
        "Research completed for slide"
      );

      return researchData.data || researchData;
    } catch (error) {
      logger.error(
        {
          slideId,
          slideType: slide.slideType,
          error: error.message,
          stack: error.stack,
        },
        "Failed to research slide"
      );

      // Update slide status to FAILED
      try {
        await prisma.workplanSlide.update({
          where: { id: slideId },
          data: {
            researchStatus: ResearchStatus.FAILED,
            updatedAt: new Date(),
          },
        });
      } catch (updateError) {
        logger.error(
          { slideId, error: updateError.message },
          "Failed to update slide status to FAILED"
        );
      }

      // Return minimal fallback data
      return {
        error: error.message,
        sources: [],
        data: {},
      };
    }
  }

  /**
   * Execute research queries for a slide
   * @private
   * @param {Object} slide - Slide object
   * @param {Object} strategy - Research strategy
   * @param {string} region - Target region
   * @param {Object} context - Context object
   * @returns {Promise<Object>} Research data with sources
   */
  static async _executeResearch(slide, strategy, region, context) {
    const questionnaire =
      context.questionnaire?.responses || context.questionnaire?.raw || {};

    // Use LLM-based extraction methods
    const industry = await this.determineIndustry(context);
    const targetAudience = await this.determineTargetAudience(context);

    // Extract product/service from questionnaire (simpler extraction for this)
    const productField =
      questionnaire?.product ||
      questionnaire?.service ||
      questionnaire?.offering;
    const product = productField || industry;
    const brand = context.project?.client?.name || "brand";

    // Get competitor list if needed
    let competitorList = [];
    if (strategy.requiresCompetitorList) {
      competitorList = await this.determineCompetitorList(context);
    }

    // Get current year for dynamic query generation
    const currentYear = getCurrentYear();

    // Replace placeholders in queries
    const queries = strategy.queries.map((query) => {
      let processedQuery = query
        .replace(/{region}/g, region)
        .replace(/{industry}/g, industry)
        .replace(/{targetAudience}/g, targetAudience)
        .replace(/{product}/g, product)
        .replace(/{brand}/g, brand)
        .replace(/{year}/g, currentYear.toString());

      // Replace competitor placeholders
      if (competitorList.length > 0) {
        processedQuery = processedQuery
          .replace(/{competitor1}/g, competitorList[0] || "")
          .replace(/{competitor2}/g, competitorList[1] || "")
          .replace(/{competitor3}/g, competitorList[2] || "")
          .replace(/{competitor}/g, competitorList[0] || "");
      }

      return processedQuery;
    });

    logger.info(
      {
        slideType: slide.slideType,
        queryCount: queries.length,
        region,
        industry,
      },
      "Executing research queries"
    );

    // Execute parallel searches
    const searchPromises = queries.map((query) =>
      tavilyIntegration.search(query, {
        search_depth: "advanced",
        max_results: 5,
      })
    );

    const searchResults = await Promise.all(searchPromises);

    // Extract structured data from search results
    const researchData = {
      slideType: slide.slideType,
      region,
      industry,
      data: {},
      sources: [],
    };

    // Process each search result
    searchResults.forEach((result, index) => {
      if (result?.results?.length > 0) {
        // Extract data points based on strategy
        const dataPoint = strategy.dataPoints[index] || `dataPoint${index}`;
        const content = result.results.map((r) => r.content).join(" ");

        // Store extracted data
        researchData.data[dataPoint] = {
          content: content.substring(0, 2000), // Limit content length
          sources: result.results.map((r) => ({
            title: r.title,
            url: r.url,
            score: r.score || 0,
          })),
        };

        // Add sources to main sources array
        researchData.sources.push(
          ...result.results.map((r) => ({
            source_type: "web",
            source_url: r.url,
            source_title: r.title,
            extracted_data: {
              query: queries[index],
              dataPoint,
              content: r.content?.substring(0, 500),
            },
            relevance_score: r.score || 0,
            verified: r.score > 0.5,
          }))
        );
      }
    });

    // Use competitor analysis tool if competitors are needed
    if (strategy.requiresCompetitorList && competitorList.length > 0) {
      try {
        const competitorAnalysis = await competitorAnalysisTool.execute({
          competitorNames: competitorList.slice(0, 5), // Limit to 5 competitors
          industry,
          slideType: slide.slideType,
          region,
        });

        if (competitorAnalysis?.competitors) {
          researchData.data.competitorAnalysis = competitorAnalysis;
          // Add competitor analysis sources
          competitorAnalysis.competitors.forEach((comp) => {
            if (comp.sources) {
              researchData.sources.push(...comp.sources);
            }
          });
        }
      } catch (error) {
        logger.warn(
          { error: error.message, competitorList },
          "Failed to execute competitor analysis tool"
        );
      }
    }

    // Use market data tool for specific data types
    if (slide.slideType === SlideType.INDUSTRY_STRENGTHS) {
      try {
        const marketSizeData = await marketDataTool.execute({
          industry,
          region,
          dataType: "MARKET_SIZE",
        });
        if (marketSizeData?.value) {
          researchData.data.marketSize = marketSizeData;
          if (marketSizeData.sources) {
            researchData.sources.push(...marketSizeData.sources);
          }
        }

        const growthRateData = await marketDataTool.execute({
          industry,
          region,
          dataType: "GROWTH_RATE",
        });
        if (growthRateData?.value) {
          researchData.data.growthRate = growthRateData;
          if (growthRateData.sources) {
            researchData.sources.push(...growthRateData.sources);
          }
        }
      } catch (error) {
        logger.warn(
          { error: error.message },
          "Failed to execute market data tool"
        );
      }
    }

    return researchData;
  }

  /**
   * Validate research quality
   * @param {Object} researchData - Research data object
   * @returns {boolean} True if quality is sufficient
   */
  static validateResearchQuality(researchData) {
    try {
      const sources = researchData.sources || [];
      const data = researchData.data || researchData;

      // Check for at least 3 sources per slide
      if (sources.length < 3) {
        logger.warn(
          { sourceCount: sources.length },
          "Research quality check failed: insufficient sources"
        );
        return false;
      }

      // Check source URLs are valid
      const validUrls = sources.filter(
        (s) => s.source_url && s.source_url.startsWith("http")
      );
      if (validUrls.length < 3) {
        logger.warn(
          { validUrlCount: validUrls.length },
          "Research quality check failed: insufficient valid URLs"
        );
        return false;
      }

      // Check relevance scores > 7.0 (if using 0-10 scale) or > 0.7 (if using 0-1 scale)
      const highRelevanceSources = sources.filter(
        (s) => s.relevance_score > 7.0 || s.relevance_score > 0.7
      );
      if (highRelevanceSources.length < 2) {
        logger.warn(
          { highRelevanceCount: highRelevanceSources.length },
          "Research quality check failed: insufficient high-relevance sources"
        );
        return false;
      }

      // Check for numbers/statistics (where required)
      const dataString = JSON.stringify(data).toLowerCase();
      const hasNumbers = /\d+/.test(dataString);
      if (!hasNumbers && Object.keys(data).length > 0) {
        logger.warn({}, "Research quality check: no numbers found in data");
        // Don't fail on this, as some slides may not require numbers
      }

      logger.info(
        {
          sourceCount: sources.length,
          validUrlCount: validUrls.length,
          highRelevanceCount: highRelevanceSources.length,
          hasNumbers,
        },
        "Research quality validation passed"
      );

      return true;
    } catch (error) {
      logger.error(
        { error: error.message },
        "Error validating research quality"
      );
      return false;
    }
  }

  /**
   * Research slide with fallback strategy
   * @param {Object} slide - WorkplanSlide object
   * @param {Object} context - Context object
   * @returns {Promise<Object>} Research data (even if minimal)
   */
  static async researchWithFallback(slide, context) {
    try {
      // Try primary research first
      const researchData = await this.researchSlide(slide, context);

      // Validate research quality
      if (this.validateResearchQuality(researchData)) {
        logger.info(
          { slideId: slide.id, slideType: slide.slideType },
          "Research quality sufficient, using primary research data"
        );
        return researchData;
      }

      // Quality insufficient - try to use cached industry data or fallback
      logger.warn(
        {
          slideId: slide.id,
          slideType: slide.slideType,
        },
        "Research quality insufficient, attempting fallback"
      );

      // Use fallback industry data if available
      const fallbackData = await this._getFallbackIndustryData(
        slide.slideType,
        context
      );

      if (fallbackData && Object.keys(fallbackData).length > 0) {
        logger.info({ slideId: slide.id }, "Using fallback industry data");
        return fallbackData;
      }

      // Last resort: flag for manual review but return minimal data
      logger.warn(
        {
          slideId: slide.id,
          slideType: slide.slideType,
        },
        "Research failed completely, flagging for manual review"
      );

      await this._flagSlideForManualReview(
        slide.id,
        "Research quality insufficient and fallback unavailable"
      );

      return {
        data: {},
        sources: [],
        flaggedForReview: true,
        error: "Research quality insufficient, flagged for manual review",
      };
    } catch (error) {
      logger.error(
        {
          slideId: slide.id,
          slideType: slide.slideType,
          error: error.message,
        },
        "Research with fallback failed completely"
      );

      // Flag for manual review
      await this._flagSlideForManualReview(slide.id, error.message);

      // Return minimal research data
      return {
        data: {},
        sources: [],
        flaggedForReview: true,
        error: error.message,
      };
    }
  }

  /**
   * Get fallback industry data from cache or generic sources
   * Attempts to use broader industry trends when specific research fails
   * @private
   * @param {string} slideType - Slide type
   * @param {Object} context - Context object
   * @returns {Promise<Object>} Fallback research data
   */
  static async _getFallbackIndustryData(slideType, context) {
    try {
      logger.debug({ slideType }, "Getting fallback industry data");

      // Determine industry and region for broader search
      const industry = await this.determineIndustry(context);
      const region = await this.determineTargetRegion(context);
      const currentYear = getCurrentYear();

      // Use broader, more generic queries that are more likely to return results
      const fallbackQueries = [
        `${industry} industry overview ${region} ${currentYear}`,
        `${industry} market trends ${region}`,
        `${industry} statistics ${region}`,
      ];

      logger.info(
        { industry, region, queryCount: fallbackQueries.length },
        "Executing fallback research queries"
      );

      // Execute fallback searches with basic depth (faster, more likely to succeed)
      const searchPromises = fallbackQueries.map((query) =>
        tavilyIntegration.search(query, {
          search_depth: "basic", // Use basic depth for fallback (faster)
          max_results: 3, // Fewer results for fallback
        })
      );

      const searchResults = await Promise.all(searchPromises);

      // Extract minimal structured data from fallback results
      const fallbackData = {
        slideType,
        region,
        industry,
        data: {},
        sources: [],
        fallback: true,
      };

      // Process fallback search results
      searchResults.forEach((result, index) => {
        if (result?.results?.length > 0) {
          const content = result.results.map((r) => r.content).join(" ");
          const dataPoint = `fallbackData${index + 1}`;

          fallbackData.data[dataPoint] = {
            content: content.substring(0, 1000), // Shorter content for fallback
            sources: result.results.map((r) => ({
              title: r.title,
              url: r.url,
              score: r.score || 0,
            })),
          };

          // Add sources
          fallbackData.sources.push(
            ...result.results.map((r) => ({
              source_type: "web",
              source_url: r.url,
              source_title: r.title,
              extracted_data: {
                query: fallbackQueries[index],
                dataPoint,
                content: r.content?.substring(0, 300),
              },
              relevance_score: r.score || 0,
              verified: r.score > 0.3, // Lower threshold for fallback
            }))
          );
        }
      });

      if (fallbackData.sources.length > 0) {
        logger.info(
          {
            slideType,
            sourceCount: fallbackData.sources.length,
            industry,
            region,
          },
          "Fallback industry data retrieved successfully"
        );
        return fallbackData;
      }

      // If fallback search also fails, return minimal structure
      logger.warn(
        { slideType, industry, region },
        "Fallback research queries returned no results"
      );
      return {
        data: {},
        sources: [],
        fallback: true,
        note: "No fallback data available - requires manual research",
      };
    } catch (error) {
      logger.error(
        { slideType, error: error.message },
        "Error retrieving fallback industry data"
      );
      return {
        data: {},
        sources: [],
        fallback: true,
        error: error.message,
      };
    }
  }

  /**
   * Flag slide for manual review
   * @private
   * @param {number} slideId - Slide ID
   * @param {string} reason - Reason for flagging
   */
  static async _flagSlideForManualReview(slideId, reason) {
    try {
      const slide = await prisma.workplanSlide.findUnique({
        where: { id: slideId },
      });

      if (slide) {
        const metadataInfo = slide.metadataInfo || {};
        metadataInfo.flaggedForReview = true;
        metadataInfo.reviewReason = reason;
        metadataInfo.flaggedAt = new Date().toISOString();

        await prisma.workplanSlide.update({
          where: { id: slideId },
          data: {
            metadataInfo,
            updatedAt: new Date(),
          },
        });

        logger.info({ slideId, reason }, "Slide flagged for manual review");
      }
    } catch (error) {
      logger.error(
        { slideId, error: error.message },
        "Failed to flag slide for manual review"
      );
    }
  }
}

module.exports = { WorkplanResearcherService };
