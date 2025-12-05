const { z } = require("zod");
const { SlideType } = require("@/constants");

/**
 * Schema for TOC (Table of Contents) generation
 * Used by Agent A (The Planner) to determine which slides are required
 */
const tocGenerationSchema = z.object({
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

/**
 * Schema for region extraction
 * Used by Agent B (The Researcher) to determine target region
 */
const regionExtractionSchema = z.object({
  region: z
    .string()
    .describe(
      "The primary target region/market for this project (e.g., 'Nigeria', 'Ghana', 'West Africa', 'Kenya', 'South Africa', 'East Africa', 'Africa', 'Global', 'United States', 'United Kingdom', 'Brazil', 'India', 'Germany', 'France', 'Japan', 'China', 'Canada', 'Australia', 'Middle East', 'Europe', 'Asia', 'North America', 'South America', 'Oceania'). Use the most specific region, country, or continent mentioned."
    ),
  confidence: z
    .number()
    .min(0)
    .max(10)
    .describe("Confidence level 0-10 for the extracted region"),
  source: z
    .enum(["questionnaire", "clientContext", "brandOrigin", "inferred"])
    .describe("Where the region information was found"),
  reasoning: z
    .string()
    .describe("Brief explanation of how the region was determined"),
});

/**
 * Schema for industry extraction
 * Used by Agent B (The Researcher) to determine industry/sector
 */
const industryExtractionSchema = z.object({
  industry: z
    .string()
    .describe(
      "The primary industry or sector this project operates in (e.g., 'Fintech', 'E-commerce', 'Healthcare', 'Education', 'Real Estate'). Use specific industry terminology."
    ),
  confidence: z
    .number()
    .min(0)
    .max(10)
    .describe("Confidence level 0-10 for the extracted industry"),
  source: z
    .enum(["questionnaire", "clientContext", "brandOrigin", "inferred"])
    .describe("Where the industry information was found"),
  reasoning: z
    .string()
    .describe("Brief explanation of how the industry was determined"),
});

/**
 * Schema for target audience extraction
 * Used by Agent B (The Researcher) to determine target audience
 */
const targetAudienceExtractionSchema = z.object({
  targetAudience: z
    .string()
    .describe(
      "The primary target audience or customer segment (e.g., 'Young professionals aged 25-35', 'Small business owners', 'Tech-savvy millennials', 'Urban families'). Be specific and descriptive."
    ),
  confidence: z
    .number()
    .min(0)
    .max(10)
    .describe("Confidence level 0-10 for the extracted target audience"),
  source: z
    .enum(["questionnaire", "clientContext", "brandOrigin", "inferred"])
    .describe("Where the target audience information was found"),
  reasoning: z
    .string()
    .describe("Brief explanation of how the target audience was determined"),
});

/**
 * Schema for competitor list extraction
 * Used by Agent B (The Researcher) to determine competitor names
 */
const competitorListExtractionSchema = z.object({
  competitors: z
    .array(z.string())
    .describe(
      "Array of competitor company names. Extract actual company/brand names, not generic descriptions. Limit to maximum 10 competitors."
    ),
  confidence: z
    .number()
    .min(0)
    .max(10)
    .describe("Confidence level 0-10 for the extracted competitor list"),
  source: z
    .enum(["questionnaire", "clientContext", "brandOrigin", "inferred"])
    .describe("Where the competitor information was found"),
  reasoning: z
    .string()
    .describe("Brief explanation of how the competitors were determined"),
});

/**
 * Schema for slide content synthesis
 * Used by Agent C (The Strategist) to generate strategic slide copy
 */
const slideContentSchema = z.object({
  contentCopy: z
    .string()
    .min(100)
    .describe(
      "The complete synthesized strategic copy for the slide. This is the final content that will be placed on the slide, ready for design execution. Must be comprehensive, strategic, and actionable."
    ),
  keyPoints: z
    .array(z.string())
    .describe(
      "Array of key strategic points or takeaways from the content. These serve as highlights or bullet points."
    ),
  dataPoints: z
    .object({})
    .passthrough()
    .optional()
    .describe(
      "Structured data points extracted from research (e.g., statistics, numbers, metrics). Format is flexible based on slide type."
    ),
  sourceCitations: z
    .array(z.string())
    .describe(
      "Array of source citations or references from the research data. Format: ['Source Title - URL', ...]"
    ),
  qualityScore: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Overall quality score for the synthesized content (0-10). Consider strategic coherence, research integration, clarity, and actionability."
    ),
});

/**
 * Schema for Big Idea options generation
 * Used by Agent C (The Strategist) for BIG_IDEA slide
 */
const bigIdeaOptionsSchema = z.object({
  options: z
    .array(
      z.object({
        optionNumber: z
          .number()
          .int()
          .positive()
          .describe("Option number (1 or 2)"),
        bigIdeaText: z
          .string()
          .describe(
            "The Big Idea statement - a memorable, actionable pillar for all marketing messages"
          ),
        rationale: z
          .string()
          .describe(
            "Strategic rationale explaining why this Big Idea is strong and how it addresses the strategic context"
          ),
        strategicFitScore: z
          .number()
          .min(0)
          .max(10)
          .describe(
            "Strategic fit score (0-10) indicating how well this Big Idea aligns with the brand, market, and objectives"
          ),
      })
    )
    .length(2)
    .describe("Exactly 2 distinct Big Idea options"),
});

module.exports = {
  tocGenerationSchema,
  regionExtractionSchema,
  industryExtractionSchema,
  targetAudienceExtractionSchema,
  competitorListExtractionSchema,
  slideContentSchema,
  bigIdeaOptionsSchema,
};
