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

module.exports = {
  tocGenerationSchema,
  regionExtractionSchema,
  industryExtractionSchema,
  targetAudienceExtractionSchema,
  competitorListExtractionSchema,
};
