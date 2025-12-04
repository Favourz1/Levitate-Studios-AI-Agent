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

module.exports = {
  tocGenerationSchema,
};

