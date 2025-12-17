const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { llmClient } = require("@/llm/client");
const {
  SlideType,
  SlideStatus,
  WorkplanServiceTypeFallback,
  SystemActors,
  AuditActions,
} = require("@/constants");
const {
  slideContentSchema,
  bigIdeaOptionsSchema,
} = require("@/llm/schemas/workplanSchemas");

const logger = createLogger("service:workplan-strategist");
const prisma = getPrismaClient();

/**
 * WorkplanStrategistService - Agent C: The Strategist
 * Synthesizes research data + questionnaire + brand origin into strategic slide copy
 * Follows the Levitate Studios BRICS Framework: BRIEF, RESEARCH, INSPIRATION, CREATE, SHARE
 */
class WorkplanStrategistService {
  /**
   * Synthesize slide content from research data using BRICS framework
   * @param {Object} slide - WorkplanSlide object with research data
   * @param {Object} researchData - Research data from Agent B (optional, can use slide.researchData)
   * @param {Object} context - Complete context including questionnaire, brand origin, project, client, regenerationFeedback
   * @returns {Promise<Object>} Synthesized content stored in database
   */
  static async synthesizeSlideContent(slide, researchData, context) {
    const slideId = slide.id || slide;
    const documentId = slide.documentId || context.documentId;

    try {
      // Get slide from database if only ID provided
      let slideData = slide;
      if (typeof slide === "number" || (slide && !slide.id)) {
        slideData = await prisma.workplanSlide.findUnique({
          where: { id: slideId },
        });
        if (!slideData) {
          throw new Error(`Slide not found: ${slideId}`);
        }
      }

      logger.info(
        {
          slideId: slideData.id,
          slideType: slideData.slideType,
          documentId: slideData.documentId,
        },
        "Starting content synthesis for slide"
      );

      // Use research data from parameter or slide
      const researchDataToUse = researchData || slideData.researchData || {};

      // Update slide status to GENERATING
      await prisma.workplanSlide.update({
        where: { id: slideData.id },
        data: {
          contentStatus: SlideStatus.GENERATING,
          updatedAt: new Date(),
        },
      });

      // Get slide-specific prompt
      const prompt = this.buildSlidePrompt(
        slideData,
        researchDataToUse,
        context
      );

      // Ensure service type is in context (should be passed from pipeline)
      if (!context.serviceType && context.project?.id) {
        logger.debug(
          { projectId: context.project.id },
          "Service type not in context, using default"
        );
        context.serviceType = WorkplanServiceTypeFallback.GENERAL;
      }

      // Generate system prompt following BRICS framework
      const systemPrompt = this.generateSystemPrompt(context);

      // Generate structured content using LLM
      const result = await llmClient.generateStructured(
        slideContentSchema,
        prompt,
        {
          systemPrompt,
          projectId: context.project?.id,
          clientName: context.project?.client?.name,
          slideType: slideData.slideType,
        },
        "generation"
      );

      const synthesizedContent = result.data;

      // Run lightweight quality checks (numbers, sources, actionability)
      const qualityCheck = this.evaluateContentQuality(
        synthesizedContent,
        researchDataToUse
      );

      const computedQualityScore =
        synthesizedContent.qualityScore ?? qualityCheck.score;
      const finalQualityScore =
        typeof computedQualityScore === "number"
          ? Math.max(0, Math.min(10, computedQualityScore))
          : null;

      // Store synthesized content in database
      await prisma.workplanSlide.update({
        where: { id: slideData.id },
        data: {
          contentCopy: synthesizedContent.contentCopy,
          dataPoints: synthesizedContent.dataPoints || null,
          contentStatus: SlideStatus.COMPLETED,
          qualityScore:
            finalQualityScore !== null
              ? parseFloat(finalQualityScore.toFixed(2))
              : null,
          metadataInfo: {
            ...(slideData.metadataInfo || {}),
            keyPoints: synthesizedContent.keyPoints || [],
            sourceCitations: synthesizedContent.sourceCitations || [],
            contentQuality: {
              hasSpecificNumbers: qualityCheck.hasNumbers,
              hasSources: qualityCheck.hasSources,
              hasActionableInsights: qualityCheck.hasActionableInsights,
              strategicDepthScore: qualityCheck.strategicDepthScore,
              issues: qualityCheck.issues,
            },
          },
          updatedAt: new Date(),
        },
      });

      // Create audit log
      await prisma.auditLog.create({
        data: {
          projectId: context.project?.id,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          action: AuditActions.WORKPLAN_SLIDE_CONTENT_COMPLETED,
          details: {
            slideId: slideData.id,
            slideType: slideData.slideType,
            qualityScore: finalQualityScore,
            traceId: result.traceId,
          },
        },
      });

      logger.info(
        {
          slideId: slideData.id,
          slideType: slideData.slideType,
          qualityScore: synthesizedContent.qualityScore,
          traceId: result.traceId,
        },
        "Content synthesis completed successfully"
      );

      return {
        slideId: slideData.id,
        contentCopy: synthesizedContent.contentCopy,
        keyPoints: synthesizedContent.keyPoints,
        dataPoints: synthesizedContent.dataPoints,
        qualityScore: synthesizedContent.qualityScore,
        sourceCitations: synthesizedContent.sourceCitations,
      };
    } catch (error) {
      logger.error(
        {
          slideId,
          slideType: slide?.slideType,
          error: error.message,
          stack: error.stack,
        },
        "Failed to synthesize slide content"
      );

      // Update slide status to FAILED
      try {
        await prisma.workplanSlide.update({
          where: { id: slideId },
          data: {
            contentStatus: SlideStatus.FAILED,
            updatedAt: new Date(),
          },
        });
      } catch (updateError) {
        logger.error(
          { slideId, error: updateError.message },
          "Failed to update slide status to FAILED"
        );
      }

      throw error;
    }
  }

  /**
   * Lightweight quality validation to ensure outputs aren't fluffy
   * @param {Object} content - LLM structured response
   * @param {Object} researchData - Research data for reference
   * @returns {Object} quality signals and computed score
   */
  static evaluateContentQuality(content, researchData) {
    const text = content?.contentCopy || "";
    const citations = content?.sourceCitations || [];
    const hasNumbers = /\d/.test(text);
    const hasSources = Array.isArray(citations) && citations.length > 0;
    const hasActionableInsights =
      /should|must|recommend|plan|strategy|next steps|action/i.test(text);
    const strategicDepthScore = Math.min(
      10,
      2.5 * Number(hasActionableInsights) +
        2 * Number(hasSources) +
        2 * Number(hasNumbers)
    );

    const issues = [];
    if (!hasNumbers) issues.push("No specific numbers found");
    if (!hasSources) issues.push("Missing source citations");
    if (!hasActionableInsights) issues.push("Lacks actionable guidance");

    const baseScore = content?.qualityScore;
    const heuristicScore =
      6 +
      (hasNumbers ? 1.5 : -1) +
      (hasSources ? 1.5 : -1) +
      (hasActionableInsights ? 1 : -0.5);
    const score =
      typeof baseScore === "number"
        ? baseScore
        : Math.max(0, Math.min(10, heuristicScore));

    return {
      hasNumbers,
      hasSources,
      hasActionableInsights,
      strategicDepthScore: Number(strategicDepthScore.toFixed(2)),
      issues,
      score,
      researchData,
    };
  }

  /**
   * Build slide-specific prompt following BRICS framework
   * @param {Object} slide - Slide data
   * @param {Object} researchData - Research data
   * @param {Object} context - Complete context
   * @returns {string} Formatted prompt
   */
  static buildSlidePrompt(slide, researchData, context) {
    const slideType = slide.slideType;
    const regenerationFeedback = context.regenerationFeedback;

    // Base BRICS structure
    let prompt = `# Content Synthesis for ${slide.title || slideType}

## BRIEF: Slide Requirements`;

    // Add regeneration feedback if present
    // Supports both raw string (backward compatible) and structured object (enhanced)
    if (regenerationFeedback) {
      if (typeof regenerationFeedback === "string") {
        // Backward compatible: raw text feedback
        prompt += `

**Regeneration Feedback:**
${regenerationFeedback}

Please address the following feedback while maintaining strategic coherence:`;
      } else if (regenerationFeedback.formattedFeedback) {
        // Enhanced: structured feedback with intent detection
        prompt += `

${regenerationFeedback.formattedFeedback}

Please address the following feedback while maintaining strategic coherence:`;

        // Add slide-specific targeting if this slide is mentioned
        const slideReferences = regenerationFeedback.slideReferences || [];
        const slideTitle = slide.title || slide.slideType || "";
        const slideTypeLower = slideType.toLowerCase();
        const slideTitleLower = slideTitle.toLowerCase();

        // Check if this slide is specifically targeted
        const isTargeted =
          slideReferences.length === 0 ||
          slideReferences.some(
            (ref) =>
              slideTitleLower.includes(ref.toLowerCase()) ||
              slideTypeLower.includes(ref.toLowerCase()) ||
              ref.toLowerCase().includes(slideTypeLower) ||
              ref.toLowerCase().includes(slideTitleLower)
          );

        if (isTargeted && regenerationFeedback.requestedChanges?.length > 0) {
          // Filter changes relevant to this slide
          const relevantChanges = regenerationFeedback.requestedChanges.filter(
            (change) => {
              if (!change.section) return true; // General change applies to all slides
              const changeSectionLower = change.section.toLowerCase();
              return (
                slideTitleLower.includes(changeSectionLower) ||
                slideTypeLower.includes(changeSectionLower) ||
                changeSectionLower.includes(slideTypeLower) ||
                changeSectionLower.includes(slideTitleLower)
              );
            }
          );

          if (relevantChanges.length > 0) {
            prompt += `\n\n**Specific Changes for This Slide:**\n`;
            relevantChanges.forEach((change, idx) => {
              prompt += `${idx + 1}. ${change.change}`;
              if (change.priority)
                prompt += ` (Priority: ${change.priority})`;
              if (change.feasibility)
                prompt += ` (Complexity: ${change.feasibility})`;
              prompt += `\n`;
            });
          }
        } else if (
          slideReferences.length > 0 &&
          !isTargeted
        ) {
          // This slide is not specifically targeted - apply general feedback only
          prompt += `\n\n**Note:** This feedback may not directly apply to this slide, but maintain strategic coherence with the overall workplan narrative.`;
        }
      } else {
        // Fallback: stringify object if structure is unexpected
        prompt += `

**Regeneration Feedback:**
${JSON.stringify(regenerationFeedback, null, 2)}

Please address the following feedback while maintaining strategic coherence:`;
      }
    }

    // Slide-specific requirements - ALL slide types must have specific rules
    switch (slideType) {
      case SlideType.INDUSTRY_STRENGTHS:
        prompt += this.buildIndustryStrengthsPrompt(
          slide,
          researchData,
          context
        );
        break;
      case SlideType.OPPORTUNITY_IN_MARKET:
        prompt += this.buildOpportunityInMarketPrompt(
          slide,
          researchData,
          context
        );
        break;
      case SlideType.TARGET_AND_NEEDS:
        prompt += this.buildTargetAndNeedsPrompt(slide, researchData, context);
        break;
      case SlideType.CURRENT_SOLUTION:
        prompt += this.buildCurrentSolutionPrompt(slide, researchData, context);
        break;
      case SlideType.WHY_CURRENT_SOLUTION:
        prompt += this.buildWhyCurrentSolutionPrompt(
          slide,
          researchData,
          context
        );
        break;
      case SlideType.COMPETITIVE_LANDSCAPE:
        prompt += this.buildCompetitiveLandscapePrompt(
          slide,
          researchData,
          context
        );
        break;
      case SlideType.COMPETITOR_POSITIONING:
        prompt += this.buildCompetitorPositioningPrompt(
          slide,
          researchData,
          context
        );
        break;
      case SlideType.INDUSTRY_SHIFT:
        prompt += this.buildIndustryShiftPrompt(slide, researchData, context);
        break;
      case SlideType.MARKET_GAPS:
        prompt += this.buildMarketGapsPrompt(slide, researchData, context);
        break;
      case SlideType.MARKET_GAPS_RESPONSE:
        prompt += this.buildMarketGapsResponsePrompt(
          slide,
          researchData,
          context
        );
        break;
      case SlideType.ALL_TRUTHS_CONSIDERED:
        prompt += this.buildAllTruthsConsideredPrompt(
          slide,
          researchData,
          context
        );
        break;
      case SlideType.STRATEGIC_INTERPRETATION:
        prompt += this.buildStrategicInterpretationPrompt(
          slide,
          researchData,
          context
        );
        break;
      case SlideType.STRATEGY_TO_IDEA:
        prompt += this.buildStrategyToIdeaPrompt(slide, researchData, context);
        break;
      case SlideType.BIG_IDEA:
        prompt += this.buildBigIdeaContentPrompt(slide, researchData, context);
        break;
      case SlideType.VISUAL_RATIONALE:
        prompt += this.buildVisualRationalePrompt(slide, researchData, context);
        break;
      case SlideType.LOGO_OPTIONS:
        prompt += this.buildLogoOptionsPrompt(slide, researchData, context);
        break;
      default:
        prompt += this.buildGenericSlidePrompt(slide, researchData, context);
    }

    // RESEARCH section (explicit available data + current year)
    const currentYear = new Date().getFullYear();
    prompt += `

## RESEARCH: Research Data from Agent B - The Researcher (Data Sourcing)

**Current Year (for time-based reasoning):** ${currentYear}

**Available Data (MUST stay within this scope – do NOT invent or guess):**
- Slide research data (primary): ${JSON.stringify(researchData, null, 2)}
- Slide stored research data (fallback): ${JSON.stringify(
      slide.researchData || {},
      null,
      2
    )}
- Slide metadata (sources, prior computed fields): ${JSON.stringify(
      slide.metadataInfo || {},
      null,
      2
    )}
- Brand origin snapshot (accepted): ${
      context.brandOrigin?.snapshotText || "Not available"
    }
- Questionnaire (structured): ${JSON.stringify(
      context.questionnaire?.structured || {},
      null,
      2
    )}
- Questionnaire (raw/responses): ${JSON.stringify(
      context.questionnaire?.responses || context.questionnaire?.raw || {},
      null,
      2
    )}
- Client context: ${context.project?.client?.context || "Not provided"}
- Project context: ${context.project?.context || "Not provided"}
- Service type (cached): ${context.serviceType || "Not provided"}

**Research Findings (primary):**
${JSON.stringify(researchData, null, 2)}

**Research Sources:**
${this.formatResearchSources(slide, context)}

**RULES:**
- Use ONLY the data listed above—never hallucinate or fabricate numbers.
- If a needed value is missing, explicitly state what is missing; do NOT make it up.
- Cite sources inline for every statistic or claim.
- Keep outputs design-ready and concise.`;

    // INSPIRATION section
    prompt += `

## INSPIRATION: Brand Context & Creative References

**Brand Origin Document:**
${context.brandOrigin?.snapshotText || "Not available"}

**Client Context:**
${context.project?.client?.context || "Not provided"}

**Questionnaire Insights:**
${this.formatQuestionnaire(context)}`;

    // CREATE section
    prompt += `

## CREATE: Synthesize Strategic Copy

Transform the BRIEF, RESEARCH, and INSPIRATION above into world-class strategic slide copy that demonstrates expert-level strategic thinking.

**Synthesis Requirements:**

1. **Data Integration**
   - Integrate ALL relevant research data seamlessly into your narrative
   - Use ONLY real, verified numbers from research—NEVER hallucinate or estimate
   - Cite sources inline for every statistic (e.g., "According to [Source], 75% of consumers...")
   - Cross-reference data points to validate insights

2. **Strategic Interpretation**
   - Go beyond data reporting—provide strategic interpretation
   - Connect industry/market data directly to ${
     context.project?.client?.name || "Client"
   }'s business opportunity
   - Show how research insights create strategic advantage
   - Reveal patterns and implications that aren't immediately obvious

3. **Brand Alignment**
   - Ensure content aligns with brand positioning and values
   - Connect insights to brand strategy from the brand origin document
   - Maintain strategic coherence with overall workplan narrative
   - Reflect brand personality and tone appropriately

4. **Actionability & Impact**
   - Create insights that inform decision-making and execution
   - Make strategic implications clear and actionable
   - Connect strategy to creative and business outcomes
   - Provide direction that enables next steps

5. **Content Quality**
   - Write with clarity, precision, and strategic sophistication
   - Avoid generic marketing language—be specific and insightful
   - Create compelling narratives that engage and persuade
   - Balance comprehensive coverage with conciseness

${
  regenerationFeedback
    ? `6. **Regeneration Feedback Integration (CRITICAL)**
   - Directly address each point in the regeneration feedback
   - Make specific changes requested while maintaining strategic coherence
   - Explain how feedback has been incorporated
   - Ensure the revised content resolves all feedback concerns`
    : ""
}

**Slide Context:**
- Slide Type: ${slideType}
- Slide Title: ${slide.title || "Untitled"}

**Quality Checklist:**
✅ Every number has a source citation
✅ All insights connect to client opportunity
✅ Content is strategic, not generic
✅ Copy is ready for direct slide use
✅ Strategic coherence maintained${
      regenerationFeedback ? "\n✅ All feedback points addressed" : ""
    }`;

    // SHARE section
    prompt += `

## SHARE: Output Format for Design Execution

Generate structured content that designers can immediately use without any interpretation or additional thinking.

**Output Structure:**

1. **Content Copy** (Minimum 150 words, comprehensive strategic copy)
   - Complete, polished strategic copy ready for direct placement on slide
   - Organized in logical sections with clear hierarchy
   - Includes all key insights, data points, and strategic interpretations
   - Written for immediate use—designers copy and paste, no editing needed

2. **Key Points** (Array of 3-7 strategic highlights)
   - Most important strategic takeaways from the content
   - Bullet points or short statements ready for visual emphasis
   - Each point should be impactful and memorable
   - Suitable for callout boxes, sidebars, or visual highlights

3. **Data Points** (Structured object with statistics and metrics)
   - All numbers, percentages, and statistics in organized format
   - Include: metric name, value, unit, source reference
   - Format ready for chart/graph creation
   - Example: {population: {value: 226000000, unit: "people", source: "Source URL"}}

4. **Source Citations** (Array of formatted citations)
   - Format: "Source Title - URL"
   - Include all sources referenced in content copy
   - Ready for slide footer or reference section
   - Minimum 3 sources, more if applicable

5. **Quality Score** (0-10 with justification)
   - Self-assess the quality of your synthesis
   - Consider: strategic depth, data accuracy, brand alignment, actionability, design readiness
   - Aim for 8-10 for excellent work
   - Justify your score briefly

**Design Readiness Checklist:**
✅ Content is complete—no missing information
✅ Structure is clear—designer understands hierarchy
✅ Data is formatted—ready for visualization
✅ Sources are cited—all claims are verifiable
✅ Copy is polished—no editing needed before placement
✅ Context is clear—designer understands strategic intent

Generate the synthesized strategic content now with excellence and precision.`;

    return prompt;
  }

  /**
   * Build prompt for Industry Strengths slide
   * @param {Object} slide - Slide data
   * @param {Object} researchData - Research data
   * @param {Object} context - Context
   * @returns {string} Prompt section
   */
  static buildIndustryStrengthsPrompt(slide, researchData, context) {
    const serviceType = context.serviceType || "General Service";
    const industry =
      context.questionnaire?.structured?.industry || "the industry";
    const region = context.questionnaire?.structured?.region || "Nigeria";
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Industry Strengths" slide for a ${serviceType} project for ${clientName}.

**Strategic Purpose:**
This foundational slide builds a compelling case by demonstrating deep understanding of ${clientName}'s business ecosystem. You must show industry trends, market dynamics, consumer behavior, and growth opportunities using REAL, VERIFIED data. This establishes credibility and sets the stage for all subsequent strategic recommendations.

**Required Content Elements (ALL MUST BE INCLUDED):**

1. **Population & Demographics Data**
   - Total addressable market population: ${
     researchData.population || "Extract from research data"
   }
   - Key demographic segments relevant to ${industry}
   - Geographic distribution and concentration
   - Growth trends in target demographics
   - Data source citations for all population figures

2. **Current Consumer Behavior Patterns**
   - How target consumers currently engage with ${industry}
   - Existing habits, preferences, and usage patterns: ${
     researchData.behaviorTrends || "Extract from research"
   }
   - Adoption rates and penetration levels
   - Behavioral shifts and emerging trends
   - Real examples and scenarios of current behavior

3. **Market Size & Economic Indicators**
   - Total market size (in local currency or USD): ${
     researchData.marketSize || "Extract from research"
   }
   - Market value and revenue projections
   - Economic indicators relevant to ${industry} in ${region}
   - Market maturity stage (emerging, growing, mature, declining)

4. **Growth Rate Analysis (INCLUDE GRAPH DATA)**
   - CAGR (Compound Annual Growth Rate): ${
     researchData.growthRate || "Extract from research"
   }
   - Year-over-year growth percentages
   - Historical growth trajectory (minimum 3-5 years)
   - Projected growth for next 3-5 years
   - Growth drivers and catalysts
   - **Graph Data Requirements:**
     * Provide data points for line/bar chart showing growth over time
     * Include: Year labels, Growth percentages, Trend indicators
     * Format: [{year: "2024", value: 15}, {year: "2025", value: 18}, ...]

5. **Industry Opportunity Statement**
   - Clear articulation of how the industry is positioned for growth
   - Key growth drivers and market forces
   - Emerging opportunities and white space
   - Industry momentum and positive indicators
   - Why this is a favorable time for market entry/expansion

6. **"What This Means" Strategic Interpretation Section (CRITICAL)**
   - Connect ALL data points to ${clientName}'s specific opportunity
   - Interpret market data through the lens of business strategy
   - Explain implications for ${clientName}'s positioning
   - Translate statistics into strategic insights
   - Create clear connection between industry data and client opportunity
   - Make the strategic case compelling and actionable

**Content Structure & Flow:**
- Start with a strong opening that sets context for ${industry} in ${region}
- Present data in logical sequence: Population → Behavior → Market Size → Growth
- Use data visualization descriptions (charts, graphs, infographics)
- End with powerful "What This Means" interpretation that ties everything to ${clientName}
- Create narrative flow, not just data dump

**Quality Standards (NON-NEGOTIABLE):**
- ✅ Use ONLY real numbers from research—NEVER hallucinate or estimate data
- ✅ Cite sources inline for every statistic (e.g., "According to [Source], 75% of...")
- ✅ Every number must have a verifiable source in research data
- ✅ Connect each data point to strategic implications for ${clientName}
- ✅ Make strategic interpretation specific and actionable, not generic
- ✅ Ensure content is concise yet comprehensive (ready for slide design)
- ✅ Write copy that designers can directly use without interpretation

**Common Pitfalls to Avoid:**
- ❌ Generic statements like "the industry is growing" without specific numbers
- ❌ Unsupported claims or assumptions
- ❌ Vague interpretations that don't connect to client opportunity
- ❌ Data without strategic context or meaning
- ❌ Missing source citations

**Example Structure:**
"The ${industry} market in ${region} represents a significant opportunity, with a total addressable market of [X million] people. Current research shows [specific behavior trend] with [X%] of consumers [specific behavior]. The market size of [amount] is projected to grow at [X%] CAGR through 2027, driven by [specific drivers]. What this means for ${clientName}: [strategic interpretation connecting data to client opportunity]."`;
  }

  /**
   * Build prompt for Market Gaps slide (2 pages)
   * @param {Object} slide - Slide data
   * @param {Object} researchData - Research data
   * @param {Object} context - Context
   * @returns {string} Prompt section
   */
  static buildMarketGapsPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";
    const industry =
      context.questionnaire?.structured?.industry || "the industry";

    return `

You are creating the "Market Gaps" slide for ${clientName} (Page 1: Competitor Weaknesses).

**Strategic Purpose:**
This slide identifies what competitors are doing in ${industry} and, more importantly, what they're NOT doing well. This reveals specific pain points, unmet needs, and market gaps that ${clientName} can strategically address. This is competitive intelligence turned into strategic opportunity.

**Page 1 Content Requirements: Competitor Weaknesses Analysis**

1. **Competitor Activities Overview**
   - What major competitors are currently doing in the market
   - Their current strategies, campaigns, and positioning
   - Market activities and initiatives
   - Recent moves and developments

2. **Competitor Weaknesses & Shortcomings (CRITICAL FOCUS)**
   - What competitors are NOT doing well
   - Specific pain points customers experience with current solutions
   - Service gaps and inadequacies
   - Product limitations and shortcomings
   - Communication gaps and missed opportunities
   - Examples: "Users experience withdrawal delays with Competitor X", "Competitor Y lacks inverter compatibility", "Competitor Z's app has frequent glitches"

3. **Unmet Needs & Market Gaps**
   - Needs that current solutions fail to address
   - Customer frustrations and pain points
   - Service gaps in the market
   - Communication gaps (white space)
   - Features or benefits that are missing

4. **Competitive Pain Points (Be Specific)**
   - Actual customer complaints or issues
   - Product/service inadequacies
   - Poor user experiences
   - Missing features or capabilities
   - Weaknesses in competitor positioning

**Content Structure:**
- Start with overview of competitive landscape
- Focus heavily on weaknesses and gaps (this is the opportunity)
- Use specific examples and pain points from research
- Show clear patterns of unmet needs
- Set up the case for ${clientName}'s response

**Guidelines:**
- Use research data on competitor analysis and customer feedback
- Be specific about weaknesses, not generic
- Focus on REAL pain points and gaps, not assumptions
- Connect weaknesses to customer needs and frustrations
- Show patterns and trends, not just isolated issues
- Cite sources for competitor information`;
  }

  /**
   * Build prompt for Big Idea slide content (introductory/contextual content)
   * Note: The 2 distinct Big Idea options are generated separately via generateBigIdeaOptions()
   * @param {Object} slide - Slide data
   * @param {Object} researchData - Research data
   * @param {Object} context - Context
   * @returns {string} Prompt section
   */
  static buildBigIdeaContentPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";
    const industry =
      context.questionnaire?.structured?.industry || "the industry";
    const priorTruths =
      researchData.allTruthsConsidered ||
      researchData.priorTruths ||
      slide.metadataInfo?.allTruthsConsidered ||
      "Not provided";
    const priorStrategicInterpretation =
      researchData.strategicInterpretation ||
      researchData.priorStrategicInterpretation ||
      slide.metadataInfo?.strategicInterpretation ||
      "Not provided";
    const priorOpportunities =
      researchData.opportunities || researchData.marketGaps || "Not provided";
    const priorSlides =
      researchData.priorSlides ||
      context.priorSlides ||
      slide.metadataInfo?.priorSlides ||
      {};

    return `

You are creating the "Big Idea" slide introductory content for ${clientName}.

**Critical Context:**
This slide serves as the culmination of all previous strategic work. The Big Idea is the central pillar that will guide ALL marketing messages and communications for this campaign. This is where strategy transforms into a memorable, actionable concept.

**Use these prior outputs (only what is provided):**
- All Truths Considered: ${priorTruths}
- Strategic Interpretation outputs: ${priorStrategicInterpretation}
- Market/Opportunity insights (e.g., Market Gaps, Opportunity in Market): ${priorOpportunities}
- Prior slide outputs (if provided): ${JSON.stringify(priorSlides, null, 2)}
- Do NOT invent missing prior outputs; if absent, clearly state what is missing.

**Content Requirements:**
1. **Strategic Introduction**: Explain what a "Big Idea" means in the context of marketing campaigns or project service type as the case may be and why it's critical for ${clientName}
2. **Building on Previous Work**: Reference how this Big Idea is built upon:
   - The "All Truths Considered" findings (product truth, market truth, industry truth, target truth)
   - Strategic interpretations identified
   - Market gaps and opportunities
3. **Purpose Statement**: Clearly articulate that this Big Idea will serve as the foundation for all marketing messages, ensuring consistency and strategic coherence across all channels
4. **Expectation Setting**: Prepare the reader that they will see 2 distinct Big Idea options, each with strategic rationale

**Strategic Tone:**
- Convey the significance and transformative power of a strong Big Idea
- Connect the strategic journey (from research → insights → truths → interpretation → idea)
- Build anticipation for the Big Idea options to follow
- Emphasize how this will unify all marketing communications

**Guidelines:**
- Use real insights from research and "All Truths Considered" slide
- Connect to the client's brand positioning and market opportunity
- Be strategic, not generic - show deep understanding of the strategic process
- Create copy that positions the Big Idea as the strategic culmination of all previous work
- Make it clear why having a strong Big Idea is essential for campaign success`;
  }

  /**
   * Build prompt for Opportunity in Market slide
   */
  static buildOpportunityInMarketPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";
    const industry =
      researchData.industry ||
      context.questionnaire?.structured?.industry ||
      "the industry";
    const region =
      researchData.region ||
      context.questionnaire?.structured?.region ||
      "Nigeria";

    return `

You are creating the "Opportunity in Market" slide for ${clientName}.

**Strategic Purpose:**
This slide builds directly on the Industry Strengths slide. You've shown what's happening in the industry—now demonstrate HOW ${clientName} can leverage these trends and opportunities for business growth. This is where industry data transforms into actionable business opportunity.

**Required Content Elements:**
1. **Market Opportunity Statement**: A clear, compelling statement about the specific opportunity in ${industry}
2. **Data Validation**: Use research data (market size, growth projections, consumer behavior shifts) to validate the opportunity. Available fields you can use (if present in researchData): marketSize=${String(
      researchData.marketSize || "n/a"
    )}, growthRate=${String(
      researchData.growthRate || "n/a"
    )}, behaviorTrends=${String(
      researchData.behaviorTrends || "n/a"
    )}, opportunitySignals=${String(
      researchData.opportunitySignals || "n/a"
    )}. If a needed value is missing, state that it is missing—do NOT invent it.
3. **Business Leverage Points**: Explain how ${clientName} can capitalize on:
   - Market trends and shifts
   - Consumer behavior changes
   - Industry growth patterns
   - Emerging needs or gaps
4. **Strategic Timing**: Why NOW is the right time for this opportunity
5. **Competitive Advantage**: How this opportunity aligns with ${clientName}'s unique positioning

**Content Structure:**
- Start with the opportunity statement (bold, clear)
- Support with real numbers from research (market size, growth rates, consumer data)
- Connect to client's business objectives and brand positioning
- Show how industry trends create a window of opportunity
- End with actionable insight about seizing this opportunity

**Guidelines:**
- Use ONLY real numbers from research (never hallucinate)
- Make the opportunity tangible and specific, not generic
- Connect industry trends to specific business outcomes
- Show urgency and relevance (why this matters NOW, in ${region})
- Cite sources for all data points`;
  }

  /**
   * Build prompt for Target and Their Needs slide
   */
  static buildTargetAndNeedsPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Target and Their Needs" slide for ${clientName}.

**Strategic Purpose:**
Define who ${clientName} is serving and what specific problem, need, or desire the brand/product addresses. This establishes the foundation for all messaging and positioning decisions.

**Required Content Elements:**
1. **Target Audience Definition**: Clear demographic, psychographic, and behavioral profile
   - Who they are (age, location, lifestyle, values)
   - What they care about
   - How they think and behave
2. **The Core Need/Problem**: The specific problem, pain point, or unmet need this target faces
   - Be specific, not generic ("health-conscious consumers seeking sugar alternatives" not "people want healthier options")
   - Connect to real behaviors and motivations
3. **Current State**: How the target currently addresses this need (what they're doing now)
4. **The Gap**: What's missing or inadequate in current solutions
5. **Why This Matters**: The emotional and functional significance of addressing this need

**Content Structure:**
- Define the target audience with specificity and depth
- Articulate the core need/problem clearly
- Show how this need manifests in real behavior
- Connect to brand/product solution (establish the problem-solution fit)
- Create empathy and understanding for the target's situation

**Guidelines:**
- Be specific about the target—avoid generic descriptions
- Focus on REAL needs, not assumed ones—use research data
- Connect needs to observable behaviors and motivations
- Show understanding of the target's perspective
- Make it clear why addressing this need creates business opportunity`;
  }

  /**
   * Build prompt for Current Solution slide
   */
  static buildCurrentSolutionPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Current Solution & How Target Uses It" slide for ${clientName}.

**Strategic Purpose:**
Show what solutions the target audience is currently using to address their needs. This establishes the competitive context and shows how people are solving the problem today before your solution.

**Required Content Elements:**
1. **Current Solutions Overview**: What solutions/options exist in the market right now
   - Products, services, or approaches people currently use
   - Include both direct competitors and alternative solutions
2. **Usage Patterns**: How the target audience currently uses these solutions
   - Specific behaviors, habits, or practices
   - Frequency, context, and motivation for use
3. **Market Landscape**: The ecosystem of current solutions
   - Who the main players are
   - What approaches are most common
   - Market share or adoption patterns (if available)
4. **Behavioral Insights**: Real examples of how people interact with current solutions
   - Use research data on consumer behavior
   - Show specific scenarios or use cases

**Content Structure:**
- Identify current solutions clearly
- Show how target audience uses them (with real behavioral data)
- Highlight patterns and common practices
- Establish the baseline against which your solution will be positioned

**Guidelines:**
- Use research data on current market solutions and usage
- Be specific about behaviors, not generic
- Show real examples of how people use current solutions
- Create understanding of the status quo before positioning the new solution`;
  }

  /**
   * Build prompt for Why Current Solution slide
   */
  static buildWhyCurrentSolutionPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Why Target Uses Current Solution" slide (also called "Ambitions and Inspirations") for ${clientName}.

**Strategic Purpose:**
Understand the motivations, aspirations, and desires that drive the target audience to use current solutions. This reveals the emotional and functional drivers behind behavior, creating insights for how to position your solution.

**Required Content Elements:**
1. **Core Motivations**: Why people choose current solutions
   - Emotional drivers (security, status, belonging, enjoyment)
   - Functional drivers (convenience, cost, reliability)
   - Aspirational drivers (growth, success, freedom)
2. **Desires and Ambitions**: What the target audience wants to achieve or experience
   - Life goals and aspirations
   - Values and priorities
   - Dreams and motivations
3. **Current Reality vs. Desires**: The gap between what they have and what they want
   - What's working about current solutions
   - What's missing or inadequate
   - The tensions and contradictions
4. **Behavioral Drivers**: The deeper motivations behind current usage
   - Fear-based decisions (avoiding loss, security concerns)
   - Aspiration-based decisions (growth, improvement, achievement)
   - Social drivers (status, belonging, approval)

**Content Structure:**
- Identify core motivations and aspirations
- Connect motivations to specific behaviors
- Show the emotional and functional drivers
- Reveal opportunities for how your solution can better address these desires
- Link to creative territories (ways to speak to these motivations)

**Guidelines:**
- Use research data on consumer motivations and aspirations
- Be specific about desires, not generic
- Connect motivations to observable behaviors
- Reveal emotional drivers, not just functional ones
- Show understanding of the target's deeper motivations`;
  }

  /**
   * Build prompt for Competitive Landscape slide (Page 1)
   */
  static buildCompetitiveLandscapePrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Competitive Landscape" slide (Page 1: Competitors) for ${clientName}.

**Strategic Purpose:**
Show who the main competitors are in the market, establishing the competitive context and identifying market leaders.

**Required Content Elements:**
1. **Competitor Identification**: List the main competitors in the market
   - Direct competitors (same product/service category)
   - Indirect competitors (alternative solutions)
   - Market leaders and key players
2. **Market Position Overview**: How competitors are positioned in the market
   - Market share data (if available)
   - Market leadership hierarchy
   - Competitive tiers (leaders, challengers, niche players)
3. **Competitive Ecosystem**: Visual representation of the competitive landscape
   - Who holds what market position
   - Market concentration and fragmentation
   - Key players to watch

**Content Structure:**
- Identify all relevant competitors clearly
- Show market positions and hierarchy
- Include market share data if available
- Create clear understanding of competitive landscape
- Set up for deeper positioning analysis on next slide

**Guidelines:**
- Use research data on competitors and market share
- Be comprehensive but focused (not exhaustive list)
- Include market leaders even if not direct competitors
- Show market dynamics, not just a list
- Provide context for competitive positioning`;
  }

  /**
   * Build prompt for Competitor Positioning slide (Page 2)
   */
  static buildCompetitorPositioningPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Competitor Positioning" slide (Page 2) for ${clientName}.

**Strategic Purpose:**
Deep dive into HOW competitors position themselves—their strategies, messaging, target audiences, and recent activities. This reveals positioning gaps and opportunities.

**Required Content Elements:**
1. **Positioning Analysis**: How each major competitor positions themselves
   - Their brand positioning and messaging
   - Target audience focus
   - Unique value propositions
   - Brand personality and tone
2. **Recent Activities**: What competitors have been doing
   - Recent campaigns or marketing initiatives
   - Product launches or innovations
   - Strategic moves or partnerships
3. **Market Strategies**: Different approaches competitors are taking
   - Market penetration strategies
   - Audience targeting approaches
   - Communication strategies
4. **Positioning Gaps**: Opportunities where competitors aren't playing
   - Underserved audiences
   - Unclaimed positioning territories
   - Strategic white space

**Content Structure:**
- Analyze each competitor's positioning strategy
- Show what they're doing and saying
- Identify patterns and differences in approaches
- Reveal gaps and opportunities
- Set up for positioning your solution uniquely

**Guidelines:**
- Use research data on competitor positioning and campaigns
- Be specific about positioning, not generic
- Show real examples of competitor strategies
- Identify clear opportunities for differentiation
- Connect to your client's positioning opportunity`;
  }

  /**
   * Build prompt for Industry Shift slide
   */
  static buildIndustryShiftPrompt(slide, researchData, context) {
    const industry =
      context.questionnaire?.structured?.industry || "the industry";
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Industry Shift" slide for ${clientName}.

**Strategic Purpose:**
Show how consumer behavior and solution usage in ${industry} has evolved over time. This demonstrates industry trends and behavioral shifts that create opportunities.

**Required Content Elements:**
1. **Historical Behavior**: How consumers used to address their needs
   - Previous solutions, methods, or approaches
   - Past behaviors and habits
   - Traditional ways of doing things
2. **Current Behavior**: How consumers behave today
   - Modern solutions and approaches
   - Current trends and preferences
   - Present-day behaviors
3. **The Shift**: What changed and why
   - Technology adoption
   - Changing preferences
   - Market evolution
   - Behavioral shifts
4. **Future Implications**: What this shift means for the industry
   - Emerging opportunities
   - New consumer expectations
   - Market evolution trends

**Content Structure:**
- Show the "before" state (historical behavior)
- Show the "after" state (current behavior)
- Articulate the shift clearly with examples
- Explain drivers of change
- Connect to opportunity for ${clientName}

**Examples of Shifts:**
- Music: Buying CDs → Streaming services
- Movies: Physical copies → Digital streaming (Netflix, Amazon)
- Banking: Traditional banks → Fintech apps
- Content: TV schedules → On-demand streaming

**Guidelines:**
- Use research data on behavioral trends and shifts
- Show clear before/after with specific examples
- Explain why the shift happened
- Connect shifts to opportunities
- Make it relevant to ${clientName}'s positioning`;
  }

  /**
   * Build prompt for Market Gaps Response slide (Page 2)
   */
  static buildMarketGapsResponsePrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Market Gaps Response" slide (Page 2: Client Response) for ${clientName}.

**Strategic Purpose:**
Show how ${clientName} strategically addresses the market gaps and competitor weaknesses identified on Page 1. This is where you demonstrate the client's unique value proposition and competitive advantage.

**Required Content Elements:**
1. **Strategic Response**: How ${clientName} addresses each identified gap
   - Direct responses to competitor weaknesses
   - Solutions to unmet needs
   - Improvements over current market offerings
2. **Unique Value Proposition**: What makes ${clientName} different and better
   - Distinctive features or benefits
   - Unique positioning
   - Competitive advantages
3. **White Space Ownership**: Areas of communication or positioning ${clientName} can own
   - Underserved positioning territories
   - Unclaimed brand spaces
   - Unique brand territories
4. **Strategic Advantage**: Why this positioning matters
   - Market opportunity
   - Competitive differentiation
   - Brand strength

**Content Structure:**
- Directly respond to gaps identified on Page 1
- Show ${clientName}'s unique approach and advantages
- Identify white space opportunities
- Demonstrate clear competitive differentiation
- Connect to strategic positioning

**Guidelines:**
- Directly address gaps from competitor analysis
- Show clear, specific advantages, not generic claims
- Use research data to validate positioning
- Identify real white space opportunities
- Create compelling case for ${clientName}'s positioning`;
  }

  /**
   * Build prompt for All Truths Considered slide
   */
  static buildAllTruthsConsideredPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "All Truths Considered" slide for ${clientName}.

**Strategic Purpose:**
This is the strategic synthesis slide that distills all research, insights, and analysis into four core "truths" that will inform the Big Idea. This is where all strategic work culminates before ideation.

**Required Content Elements:**
1. **Product Truth**: What is true about ${clientName}'s product/service/brand
   - Core capabilities and strengths
   - Unique features and benefits
   - Brand essence and identity
   - What makes it distinct
2. **Market Truth**: What is true about the market
   - Market dynamics and trends
   - Consumer behavior patterns
   - Market opportunities and challenges
   - Industry realities
3. **Industry Truth**: What is true about the industry
   - Industry trends and evolution
   - Competitive landscape realities
   - Industry challenges and opportunities
   - Macro trends affecting the industry
4. **Target Truth**: What is true about the target audience
   - Core needs and motivations
   - Behavioral patterns
   - Aspirations and desires
   - Realities and tensions

**Content Structure:**
- Clearly state each truth with supporting evidence
- Show how truths intersect and create strategic insights
- Identify the strategic implications
- Set up for Big Idea generation

**Guidelines:**
- Base truths on research data and analysis
- Be specific and actionable, not generic
- Show connections between different truths
- Identify strategic implications
- Create foundation for Big Idea development`;
  }

  /**
   * Build prompt for Strategic Interpretation slide
   */
  static buildStrategicInterpretationPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";
    const priorTruths =
      researchData.allTruthsConsidered ||
      researchData.priorTruths ||
      slide.metadataInfo?.allTruthsConsidered ||
      "Not provided (if missing, state what you need; do NOT invent).";

    return `

You are creating the "Strategic Interpretation" slide for ${clientName}.

**Strategic Purpose:**
Break down the key strategic facts and insights from "All Truths Considered" into actionable strategic points. This interprets the truths and sets up for idea generation.

**Use these prior outputs (only what is provided):**
- All Truths Considered content: ${priorTruths}
- Prior slide outputs (if provided in researchData.priorSlides, context.priorSlides, or slide.metadataInfo.priorSlides): ${JSON.stringify(
      researchData.priorSlides ||
        context.priorSlides ||
        slide.metadataInfo?.priorSlides ||
        {},
      null,
      2
    )}
- Do NOT invent missing prior outputs; if absent, explicitly state what is missing.

**Required Content Elements:**
1. **Key Strategic Facts**: The most important insights from all truths considered
   - Critical facts across product, market, industry, and target
   - Strategic implications
   - Key insights and observations
2. **Strategic Connections**: How different truths relate and intersect
   - Where truths align or create opportunities
   - Strategic tensions or contradictions
   - Emerging strategic patterns
3. **Actionable Insights**: What these facts mean for strategy
   - Strategic implications
   - Opportunities for positioning
   - Direction for creative development

**Content Structure:**
- Extract key facts from "All Truths Considered"
- Show strategic connections and patterns
- Interpret implications for strategy
- Set direction for idea generation

**Guidelines:**
- Build directly on "All Truths Considered" findings
- Focus on actionable insights, not repetition
- Show strategic thinking and interpretation
- Create clear direction for next steps
- Make connections that inform Big Idea`;
  }

  /**
   * Build prompt for Strategy to Idea slide
   */
  static buildStrategyToIdeaPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";
    const priorTruths =
      researchData.allTruthsConsidered ||
      researchData.priorTruths ||
      slide.metadataInfo?.allTruthsConsidered ||
      "Not provided";
    const priorStrategicInterpretation =
      researchData.strategicInterpretation ||
      researchData.priorStrategicInterpretation ||
      slide.metadataInfo?.strategicInterpretation ||
      "Not provided";
    const priorOpportunities =
      researchData.opportunities || researchData.marketGaps || "Not provided";

    return `

You are creating the "Strategy to Idea" slide for ${clientName}.

**Strategic Purpose:**
Translate strategic findings into actionable brand ideas and creative territories. This bridges strategy and creative execution, showing how strategic insights become creative concepts.

**Use these prior outputs (only what is provided):**
- All Truths Considered: ${priorTruths}
- Strategic Interpretation outputs: ${priorStrategicInterpretation}
- Market/Opportunity insights (e.g., Market Gaps, Opportunity in Market): ${priorOpportunities}
- Prior slide outputs (if provided in researchData.priorSlides, context.priorSlides, or slide.metadataInfo.priorSlides): ${JSON.stringify(
      researchData.priorSlides ||
        context.priorSlides ||
        slide.metadataInfo?.priorSlides ||
        {},
      null,
      2
    )}
- Do NOT invent missing prior outputs; if absent, state what is missing.

**Required Content Elements:**
1. **Strategic Foundation Recap**: Key strategic insights that inform ideas
   - Product truth, market truth, industry truth, target truth
   - Strategic interpretations
   - Key opportunities identified
2. **Creative Territories**: Areas where ${clientName} can play creatively
   - Emotional territories
   - Functional territories
   - Positioning territories
3. **Idea Direction**: How strategy translates to ideas
   - Strategic themes that can become ideas
   - Creative platforms or territories
   - Direction for Big Idea development

**Content Structure:**
- Connect strategy to creative possibilities
- Identify creative territories
- Show how strategy informs ideas
- Set up for Big Idea generation

**Guidelines:**
- Build on all previous strategic work
- Translate strategy into creative direction
- Identify actionable creative territories
- Show clear path from strategy to ideas
- Create foundation for Big Idea options`;
  }

  /**
   * Build prompt for Visual Rationale slide (Logo/Branding projects)
   */
  static buildVisualRationalePrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Visual Rationale" slide for ${clientName}'s logo/branding project.

**Strategic Purpose:**
Explain the strategic thinking and creative rationale behind the visual identity design decisions. This connects brand strategy to visual execution.

**Required Content Elements:**
1. **Strategic Foundation**: How brand strategy informs visual decisions
   - Brand positioning and personality
   - Target audience considerations
   - Competitive differentiation needs
2. **Design Rationale**: Why specific visual choices were made
   - Color psychology and meaning
   - Typography selection and reasoning
   - Symbolism and iconography
   - Form and composition decisions
3. **Brand Alignment**: How visuals reflect brand essence
   - Connection to brand values
   - Alignment with brand personality
   - Target audience appeal
4. **Strategic Impact**: How visuals support business objectives
   - Differentiation from competitors
   - Target audience connection
   - Brand recognition and memorability

**Content Structure:**
- Connect strategy to visual decisions
- Explain design rationale clearly
- Show brand alignment
- Demonstrate strategic thinking

**Guidelines:**
- Base rationale on brand strategy and research
- Connect visual choices to strategic goals
- Show understanding of design principles
- Make strategic case for visual decisions`;
  }

  /**
   * Build prompt for Logo Options slide (Logo/Branding projects)
   */
  static buildLogoOptionsPrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";

    return `

You are creating the "Logo Options" slide for ${clientName}'s logo/branding project.

**Strategic Purpose:**
Present multiple logo design options with clear differentiation and strategic reasoning for each. This gives the client distinct choices while maintaining strategic alignment.

**Required Content Elements:**
1. **Option Overview**: Clear presentation of each logo option
   - Distinct design approaches
   - Visual variations
   - Different strategic directions
2. **Design Rationale per Option**: Why each option works strategically
   - Alignment with brand strategy
   - Target audience appeal
   - Competitive differentiation
   - Brand personality expression
3. **Option Comparison**: How options differ and when each is appropriate
   - Different use cases or contexts
   - Strategic trade-offs
   - Audience considerations
4. **Recommendation**: Strategic guidance on option selection
   - Which option best serves objectives
   - Contextual considerations
   - Strategic advantages

**Content Structure:**
- Present each option clearly
- Provide strategic rationale for each
- Show differentiation between options
- Offer strategic guidance

**Guidelines:**
- Base options on brand strategy
- Show clear differentiation between options
- Provide strategic reasoning for each
- Connect options to business objectives
- Give actionable guidance on selection`;
  }

  /**
   * Build generic prompt for other slide types
   * @param {Object} slide - Slide data
   * @param {Object} researchData - Research data
   * @param {Object} context - Context
   * @returns {string} Prompt section
   */
  static buildGenericSlidePrompt(slide, researchData, context) {
    const clientName = context.project?.client?.name || "Client";
    const slideTitle = slide.title || slide.slideType;
    const slideType = slide.slideType;

    return `

You are creating the "${slideTitle}" slide for ${clientName} (Type: ${slideType}).

**Strategic Purpose:**
This slide contributes to the overall strategic narrative of ${clientName}'s workplan. Your task is to synthesize research data, brand context, and strategic insights into compelling copy that advances the strategic story and supports client objectives.

**Content Requirements:**

1. **Research Synthesis**
   - Extract key insights from the provided research data
   - Identify patterns, trends, and strategic implications
   - Use real numbers and statistics from research (never hallucinate)
   - Cite sources for all data points and claims

2. **Strategic Interpretation**
   - Connect research findings to ${clientName}'s business objectives
   - Interpret data through the lens of brand strategy
   - Identify strategic opportunities and implications
   - Show deep understanding of the strategic context

3. **Brand Alignment**
   - Ensure content aligns with ${clientName}'s brand positioning
   - Connect insights to brand values and personality
   - Maintain strategic coherence with overall workplan narrative
   - Reflect brand's unique positioning and differentiation

4. **Actionable Insights**
   - Provide strategic insights that inform decision-making
   - Connect findings to actionable recommendations
   - Show how insights can be leveraged strategically
   - Create value that supports client objectives

**Content Structure:**
- Start with clear strategic context or opening statement
- Present key insights with supporting data
- Provide strategic interpretation and implications
- Connect to client opportunity and brand strategy
- End with actionable takeaways or next steps

**Guidelines:**
- Use ONLY real data from research—never hallucinate
- Cite sources for all statistics and claims
- Connect all insights to ${clientName}'s specific context
- Maintain strategic coherence with other workplan slides
- Write copy that designers can directly use on slides
- Ensure content is comprehensive yet concise`;
  }

  /**
   * Generate system prompt following BRICS framework
   * @param {Object} context - Context
   * @returns {string} System prompt
   */
  static generateSystemPrompt(context) {
    const currentDate = new Date().toISOString().split("T")[0];
    const serviceType = context.serviceType || "General Service";
    const clientName = context.project?.client?.name || "Client";
    const projectName = context.project?.name || "Workplan Generation";

    return `# Role & Identity: Expert Brand Strategist & Content Synthesist

You are a senior Brand Strategist and Creative Director with 30+ years of experience working at Levitate Studios, a premium creative agency based in Nigeria. You specialize in transforming complex research data, client insights, and market intelligence into compelling strategic slide copy that serves as the foundation for award-winning creative work.

Your expertise spans:
- Strategic brand positioning and messaging
- Consumer behavior analysis and insight generation
- Competitive intelligence and market gap identification
- Creative brief development and strategic synthesis
- Cross-industry strategic thinking (Fintech, E-commerce, Healthcare, Education, FMCG, Real Estate, etc.)

## Current Context
- Date: ${currentDate}
- Agency: Levitate Studios (Logo Design, Web Design, Digital Marketing, Brand Design, Publications, Video Production, Motion Design, Packaging, Advertising etc.)
- Project: ${projectName}
- Client: ${clientName}
- Service Type: ${serviceType}
- Phase: Content Synthesis (Agent C: The Strategist)

## Core Methodology: BRICS Framework

You strictly adhere to Levitate Studios' proven BRICS methodology for all content synthesis:

### 1. BRIEF: Understand & Extract Requirements
- Extract and deeply understand the specific slide requirements and objectives
- Identify what this slide must accomplish strategically
- Understand how this slide fits into the broader workplan narrative
- Recognize the target audience for this slide (client, internal team, stakeholders)
- If regeneration feedback exists, incorporate it directly into requirements

### 2. RESEARCH: Analyze & Validate Data
- Carefully analyze all research data provided by Agent B (The Researcher)
- Verify data accuracy and source credibility
- Extract key insights, statistics, and findings from research
- Identify patterns, trends, and anomalies in the data
- Cross-reference multiple sources to ensure reliability
- NEVER hallucinate or fabricate data—only use verified research data

### 3. INSPIRATION: Draw from Brand Context
- Synthesize insights from the accepted brand origin document
- Incorporate questionnaire responses and client context
- Consider creative references and industry best practices
- Align with client's brand personality, values, and positioning
- Connect to broader brand strategy and objectives
- Draw from relevant creative and strategic precedents

### 4. CREATE: Synthesize Strategic Copy
- Transform research + brand context + requirements into strategic copy
- Create content that is both insightful and actionable
- Ensure strategic coherence across all workplan slides
- Make connections that aren't obvious but are strategically sound
- Balance data-driven insights with brand-aligned creative thinking
- If regeneration feedback exists, address specific concerns directly

### 5. SHARE: Format for Design Execution
- Present content in a format that designers can immediately use
- Structure content so designers understand visual hierarchy
- Include data points and statistics in a format ready for visualization
- Provide source citations for all claims and data
- Ensure content is complete and requires no additional interpretation
- Make it "copy and paste ready" for slide design

## Quality Standards & Excellence Criteria

### Data Integrity (NON-NEGOTIABLE)
- ✅ Use ONLY real, verified numbers from research data—NEVER hallucinate
- ✅ Cite sources inline for every statistic, claim, or data point
- ✅ If data is missing, clearly state what data is needed rather than inventing
- ✅ Cross-validate numbers across multiple sources when possible
- ✅ Use specific numbers, percentages, and metrics—avoid vague statements

### Strategic Depth
- ✅ Connect all insights to client business objectives and opportunities
- ✅ Show strategic thinking, not just data reporting
- ✅ Create actionable insights that inform decision-making
- ✅ Demonstrate deep understanding of industry dynamics and trends
- ✅ Make strategic interpretations that reveal opportunities

### Content Quality
- ✅ Write with clarity, precision, and strategic sophistication
- ✅ Avoid generic statements and marketing fluff
- ✅ Use specific, concrete examples and evidence
- ✅ Create compelling narratives that engage and persuade
- ✅ Balance comprehensive coverage with conciseness

### Design Readiness
- ✅ Structure content for immediate slide design use
- ✅ Organize information in a logical, visual hierarchy
- ✅ Provide data in formats ready for charts, graphs, and infographics
- ✅ Include clear headings, bullet points, and visual breaks
- ✅ Ensure designers can execute without asking clarifying questions

## Output Requirements

Your synthesized content must be:

1. **Strategic, Not Generic**
   - Avoid clichés and generic marketing language
   - Use specific insights tied to research and client context
   - Create unique strategic perspectives, not recycled ideas

2. **Data-Driven, Not Assumption-Based**
   - Base all claims on research data or brand context
   - Support strategic interpretations with evidence
   - Show your strategic reasoning process

3. **Actionable, Not Abstract**
   - Provide insights that inform creative and business decisions
   - Connect strategy to execution possibilities
   - Give clear direction, not just observations

4. **Client-Focused, Not Industry-General**
   - Always connect insights back to ${clientName}'s specific opportunity
   - Tailor content to client's brand, positioning, and objectives
   - Make it relevant to this specific project and context

5. **Design-Ready, Not Design-Needs-Thinking**
   - Format content so designers can directly place it on slides
   - Structure information for visual presentation
   - Include all necessary data, sources, and context upfront

## Critical Success Factors

### What Makes Your Content Excellent:
- **Specificity**: Use real numbers, specific examples, and concrete insights
- **Strategic Coherence**: Connect all elements to client objectives and brand strategy
- **Research Integration**: Seamlessly weave research data into strategic narrative
- **Brand Alignment**: Ensure content reflects and supports brand positioning
- **Actionability**: Provide insights that enable decision-making and execution
- **Completeness**: Include all necessary context so designers need nothing more

### What Makes Content Fail:
- ❌ Generic statements without specific data or examples
- ❌ Hallucinated or unsourced numbers and statistics
- ❌ Disconnected insights that don't relate to client opportunity
- ❌ Vague strategic interpretations without actionable implications
- ❌ Missing context that requires designer interpretation
- ❌ Generic marketing language instead of strategic insights

## Remember: Your Mission

You are not just writing slide copy. You are creating strategic content that:
- Replaces the work of a senior human Brand Strategist
- Enables designers to execute slides without thinking about content
- Builds client confidence through data-driven strategic insights
- Serves as the foundation for award-winning creative work
- Reflects Levitate Studios' reputation for strategic excellence

**The designer should be able to open your content and design the slide immediately—NO THINKING REQUIRED. Just copy, paste, and design.**

Generate strategic, data-driven, actionable content that demonstrates world-class strategic thinking and enables flawless design execution.`;
  }

  /**
   * Format research sources for prompt
   * @param {Object} slide - Slide data
   * @param {Object} context - Context
   * @returns {string} Formatted sources
   */
  static formatResearchSources(slide, context) {
    const sources = slide.metadataInfo?.researchSources || [];

    if (sources.length === 0) {
      return "No sources available";
    }

    return sources
      .map(
        (source, index) =>
          `${index + 1}. ${source.source_title || source.title || "Source"}: ${
            source.source_url || source.url || "No URL"
          } (Relevance: ${source.relevance_score || "N/A"})`
      )
      .join("\n");
  }

  /**
   * Format questionnaire for prompt
   * @param {Object} context - Context
   * @returns {string} Formatted questionnaire
   */
  static formatQuestionnaire(context) {
    const questionnaire = context.questionnaire;
    if (!questionnaire) {
      return "Questionnaire data not available";
    }

    const responses = questionnaire.responses || questionnaire.raw || {};

    return Object.entries(responses)
      .map(
        ([key, value]) =>
          `- ${key}: ${
            typeof value === "object" ? JSON.stringify(value) : value
          }`
      )
      .join("\n");
  }

  /**
   * Generate Big Idea options (2 distinct options)
   * @param {number} documentId - Document ID
   * @param {number} slideId - Slide ID for BIG_IDEA slide
   * @param {Object} context - Complete context
   * @returns {Promise<Object>} Big Idea options stored in metadata
   */
  static async generateBigIdeaOptions(documentId, slideId, context) {
    try {
      logger.info(
        { documentId, slideId },
        "Starting Big Idea options generation"
      );

      // Get "All Truths Considered" slide data
      const allTruthsSlide = await prisma.workplanSlide.findFirst({
        where: {
          documentId,
          slideType: SlideType.ALL_TRUTHS_CONSIDERED,
        },
      });

      if (!allTruthsSlide) {
        logger.warn(
          { documentId },
          "All Truths Considered slide not found, proceeding without it"
        );
      }

      // Get Big Idea slide
      const bigIdeaSlide = await prisma.workplanSlide.findUnique({
        where: { id: slideId },
      });

      if (!bigIdeaSlide) {
        throw new Error(`Big Idea slide not found: ${slideId}`);
      }

      if (bigIdeaSlide.slideType !== SlideType.BIG_IDEA) {
        throw new Error(`Slide ${slideId} is not a BIG_IDEA slide`);
      }

      const clientName = context.project?.client?.name || "Client";
      const brandOrigin = context.brandOrigin?.snapshotText || "";

      // Build prompt for Big Idea generation
      const prompt = `# Big Idea Options Generation

Generate 2 distinct Big Idea options for ${clientName}.

**Context:**
- Client: ${clientName}
- Industry: ${context.questionnaire?.structured?.industry || "Not specified"}
- Target Audience: ${
        context.questionnaire?.structured?.targetAudience || "Not specified"
      }

**Brand Origin:**
${brandOrigin || "Not available"}

**All Truths Considered Findings:**
${allTruthsSlide?.contentCopy || "Not available"}

**Requirements:**
Each Big Idea option must:
1. Be rooted in "All Truths Considered" findings
2. Serve as a pillar for all marketing messages
3. Be memorable and actionable
4. Be different from competitors
5. Be distinct from each other (the two options should be meaningfully different)

**Output:**
Generate exactly 2 distinct Big Idea options with:
- Big Idea Text: The memorable, actionable statement
- Rationale: Strategic reasoning for why this Big Idea is strong
- Strategic Fit Score: Score (0-10) indicating alignment with brand, market, and objectives

Generate the 2 Big Idea options now.`;

      const systemPrompt = this.generateSystemPrompt(context);

      // Generate structured options using LLM
      const result = await llmClient.generateStructured(
        bigIdeaOptionsSchema,
        prompt,
        {
          systemPrompt,
          projectId: context.project?.id,
          clientName,
          taskType: "big-idea-generation",
        },
        "generation"
      );

      const options = result.data.options;

      // Transform to match metadata format
      const bigIdeaOptions = options.map((opt) => ({
        option_number: opt.optionNumber,
        big_idea_text: opt.bigIdeaText,
        rationale: opt.rationale,
        strategic_fit_score: parseFloat(opt.strategicFitScore.toFixed(2)),
      }));

      // Store in slide metadata
      const metadataInfo = bigIdeaSlide.metadataInfo || {};
      metadataInfo.bigIdeaOptions = bigIdeaOptions;

      await prisma.workplanSlide.update({
        where: { id: slideId },
        data: {
          metadataInfo,
          updatedAt: new Date(),
        },
      });

      // Create audit log
      await prisma.auditLog.create({
        data: {
          projectId: context.project?.id,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          action: AuditActions.WORKPLAN_SLIDE_CONTENT_COMPLETED,
          details: {
            slideId,
            slideType: SlideType.BIG_IDEA,
            bigIdeaOptionsCount: bigIdeaOptions.length,
            traceId: result.traceId,
          },
        },
      });

      logger.info(
        {
          slideId,
          optionCount: bigIdeaOptions.length,
          traceId: result.traceId,
        },
        "Big Idea options generated successfully"
      );

      return {
        slideId,
        options: bigIdeaOptions,
      };
    } catch (error) {
      logger.error(
        {
          documentId,
          slideId,
          error: error.message,
          stack: error.stack,
        },
        "Failed to generate Big Idea options"
      );
      throw error;
    }
  }
}

module.exports = { WorkplanStrategistService };
