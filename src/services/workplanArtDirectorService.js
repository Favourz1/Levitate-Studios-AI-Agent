const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { llmClient } = require("@/llm/client");
const {
  SlideType,
  DocumentStatus,
  LEVITATE_BRAND_GUIDELINES,
  SystemActors,
  AuditActions,
  DesignLayout,
} = require("@/constants");
const { designDirectiveSchema } = require("@/llm/schemas/workplanSchemas");
const { imageSearchTool, iconSearchTool } = require("@/llm/tools/designTools");

const logger = createLogger("service:workplan-art-director");
const prisma = getPrismaClient();

/**
 * WorkplanArtDirectorService - Agent D: The Art Director
 * Generates actionable design directives for each slide, combining brand guidelines,
 * layout heuristics, and curated visual suggestions (icons/images).
 */
class WorkplanArtDirectorService {
  /**
   * Determine optimal layout based on slide type and optional content structure
   * @param {string} slideType
   * @param {Object} contentStructure
   * @returns {string} Layout type
   */
  static determineLayout(slideType, contentStructure = {}) {
    const layoutRules = {
      [SlideType.INDUSTRY_STRENGTHS]: DesignLayout.SPLIT_LEFT_RIGHT,
      [SlideType.OPPORTUNITY_IN_MARKET]: DesignLayout.SPLIT_LEFT_RIGHT,
      [SlideType.TARGET_AND_NEEDS]: DesignLayout.GRID_2COL,
      [SlideType.CURRENT_SOLUTION]: DesignLayout.SPLIT_TOP_BOTTOM,
      [SlideType.WHY_CURRENT_SOLUTION]: DesignLayout.SPLIT_TOP_BOTTOM,
      [SlideType.COMPETITIVE_LANDSCAPE]: DesignLayout.GRID_3COL,
      [SlideType.COMPETITOR_POSITIONING]: DesignLayout.GRID_2COL,
      [SlideType.INDUSTRY_SHIFT]: DesignLayout.TIMELINE,
      [SlideType.MARKET_GAPS]: DesignLayout.COMPARISON_TABLE,
      [SlideType.MARKET_GAPS_RESPONSE]: DesignLayout.COMPARISON_TABLE,
      [SlideType.ALL_TRUTHS_CONSIDERED]: DesignLayout.FULL_WIDTH,
      [SlideType.STRATEGIC_INTERPRETATION]: DesignLayout.SPLIT_TOP_BOTTOM,
      [SlideType.STRATEGY_TO_IDEA]: DesignLayout.SPLIT_LEFT_RIGHT,
      [SlideType.BIG_IDEA]: DesignLayout.CENTERED,
      [SlideType.VISUAL_RATIONALE]: DesignLayout.GRID_2COL,
      [SlideType.LOGO_OPTIONS]: DesignLayout.GRID_3COL,
    };

    // Simple heuristic: if we have heavy stats, prefer split layout
    if (
      contentStructure?.hasNumericalData &&
      !layoutRules[slideType] &&
      slideType !== SlideType.BIG_IDEA
    ) {
      return DesignLayout.SPLIT_LEFT_RIGHT;
    }

    return layoutRules[slideType] || DesignLayout.FULL_WIDTH;
  }

  /**
   * Generate design directives for a slide and persist them
   * @param {Object|number} slide - WorkplanSlide object or slide ID
   * @param {string} contentCopy - Strategic copy for the slide (optional)
   * @param {Object} context - Additional context (project, serviceType, regenerationFeedback, etc.)
   * @returns {Promise<Object>} Design directives object
   */
  static async generateDesignDirectives(slide, contentCopy, context = {}) {
    const slideId = slide?.id || slide;

    try {
      // Load slide if only ID provided
      let slideData = slide;
      if (typeof slide === "number" || (slide && !slide.id)) {
        slideData = await prisma.workplanSlide.findUnique({
          where: { id: slideId },
        });
        if (!slideData) {
          throw new Error(`Slide not found: ${slideId}`);
        }
      }

      const title = slideData.title || slideData.slideType;
      const normalizedContent =
        contentCopy || slideData.contentCopy || "[Content pending synthesis]";

      logger.info(
        {
          slideId: slideData.id,
          slideType: slideData.slideType,
          documentId: slideData.documentId,
        },
        "Starting design directives generation for slide"
      );

      // Update status to GENERATING
      await prisma.workplanSlide.update({
        where: { id: slideData.id },
        data: {
          designStatus: DocumentStatus.GENERATING,
          updatedAt: new Date(),
        },
      });

      // Basic content structure heuristic
      const contentStructure = {
        hasNumericalData: /\d+/.test(normalizedContent),
        length: normalizedContent.length,
      };

      const layoutType = this.determineLayout(
        slideData.slideType,
        contentStructure
      );

      // Fetch supporting visuals (non-blocking failures are tolerated)
      const searchQuery =
        title ||
        slideData.slideType.replace(/_/g, " ").toLowerCase() ||
        "brand";
      let imageResults = [];
      let iconResults = [];

      try {
        imageResults = await imageSearchTool.execute({
          query: searchQuery,
          imageType: "PHOTO",
          style: "professional",
        });
      } catch (error) {
        logger.warn(
          { slideId: slideData.id, error: error.message },
          "Image search failed, continuing without images"
        );
      }

      try {
        iconResults = await iconSearchTool.execute({
          query: searchQuery,
          imageType: "ICON",
          style: LEVITATE_BRAND_GUIDELINES.iconStyle || "professional",
        });
      } catch (error) {
        logger.warn(
          { slideId: slideData.id, error: error.message },
          "Icon search failed, continuing without icons"
        );
      }

      const fallbackVisuals = [
        ...imageResults.slice(0, 2).map((image) => ({
          type: "IMAGE",
          description: image.description || "Supporting image",
          url: image.url,
          placement: layoutType === "SPLIT_LEFT_RIGHT" ? "RIGHT" : "TOP",
          size: layoutType === "CENTERED" ? "MEDIUM" : "LARGE",
        })),
        ...iconResults.slice(0, 3).map((icon) => ({
          type: "ICON",
          description: icon.description || "Supporting icon",
          url: icon.url,
          placement: "LEFT",
          size: "SMALL",
        })),
      ];

      // Build prompt for LLM
      const brandGuidelines = LEVITATE_BRAND_GUIDELINES;
      const prompt = `
You are the Art Director for Levitate Studios. Produce production-ready, strictly schema-compliant design directives that let a designer execute the slide without guesswork.

Context:
- Slide Title: ${title}
- Slide Type: ${slideData.slideType}
- Recommended Layout: ${layoutType}
- Service Type: ${context.serviceType || "GENERAL"}
- Strategic Copy (place on slide): ${normalizedContent}
- Brand Guidelines:
  • Colors — primary ${brandGuidelines.colors.primary}, secondary ${
        brandGuidelines.colors.secondary
      }, accent ${brandGuidelines.colors.accent}, background ${
        brandGuidelines.colors.background
      }
  • Typography — heading ${
    brandGuidelines.typography.headingFont
  } (sizes ${brandGuidelines.typography.headingSizes.join("/")}), body ${
        brandGuidelines.typography.bodyFont
      } (${brandGuidelines.typography.bodySize}px)
  • Icon Style — ${brandGuidelines.iconStyle}
  • Image Style — ${brandGuidelines.imageStyle}

Available visual candidates (use only if helpful, otherwise ignore):
${fallbackVisuals
  .map((v) => `- ${v.type}: ${v.description || "Asset"} (${v.url || "no-url"})`)
  .join("\n")}

What to output (must validate against designDirectiveSchema):
- layoutType: choose the best layout for this slide from the provided layout enum.
- colorPalette: stay within brand colors; ensure readable text contrast (set text color explicitly).
- typography: pick heading/body sizes that reflect hierarchy and legibility; use provided fonts.
- visualElements: select concise set (max 5) of icons/images/charts/graphs that reinforce the message; include URLs only when provided; match placements to layout.
- contentPlacement: map 3-6 meaningful content sections from the strategic copy to specific positions; include statsPosition, imagePosition, textAlignment, and contentMapping with emphasis where needed.
- spacing: set sectionSpacing and elementSpacing for clean breathing room (use points).
- specialInstructions: only if critical (e.g., keep accent usage sparing, avoid clutter, chart suggestion).

Rules:
- Do NOT invent brand colors or fonts; use the ones given.
- Keep directives concise, explicit, and actionable—no fluff.
- If visual assets are weak or missing URLs, still provide directives but keep visualElements minimal.
- Ensure the JSON returned can be parsed by the schema with no extra fields.
`;

      const llmResult = await llmClient.generateStructured(
        designDirectiveSchema,
        prompt,
        {
          slideId: slideData.id,
          documentId: slideData.documentId,
          layoutType,
        },
        "generation"
      );

      const rawDirectives = llmResult.data || {};

      // Build final directives with safe fallbacks
      const colorPalette = rawDirectives.colorPalette || {
        ...brandGuidelines.colors,
        text: brandGuidelines.colors.primary,
      };

      const typography = rawDirectives.typography || {
        headingFont: brandGuidelines.typography.headingFont,
        bodyFont: brandGuidelines.typography.bodyFont,
        headingSize: brandGuidelines.typography.headingSizes[0],
        bodySize: brandGuidelines.typography.bodySize,
      };

      const visualElements =
        rawDirectives.visualElements && rawDirectives.visualElements.length > 0
          ? rawDirectives.visualElements
          : fallbackVisuals;

      const contentPlacement = rawDirectives.contentPlacement || {
        statsPosition:
          layoutType === DesignLayout.SPLIT_LEFT_RIGHT ? "LEFT" : "TOP",
        imagePosition:
          layoutType === DesignLayout.SPLIT_LEFT_RIGHT ? "RIGHT" : "RIGHT",
        textAlignment: layoutType === DesignLayout.CENTERED ? "CENTER" : "LEFT",
        contentMapping: [],
      };

      const spacing = rawDirectives.spacing || {
        sectionSpacing: 24,
        elementSpacing: 12,
      };

      const finalDirectives = {
        layoutType: rawDirectives.layoutType || layoutType,
        colorPalette: {
          ...colorPalette,
          text: colorPalette.text || brandGuidelines.colors.primary,
        },
        typography,
        visualElements,
        contentPlacement,
        spacing,
        specialInstructions:
          rawDirectives.specialInstructions ||
          "Maintain Levitate minimalist style with clear hierarchy and high contrast.",
      };

      // Validate final structure
      designDirectiveSchema.parse(finalDirectives);

      // Persist on slide
      await prisma.workplanSlide.update({
        where: { id: slideData.id },
        data: {
          designDirectives: finalDirectives,
          designStatus: DocumentStatus.COMPLETED,
          layoutType: finalDirectives.layoutType,
          visualElements,
          updatedAt: new Date(),
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          projectId: context.project?.id || null,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          action: AuditActions.WORKPLAN_SLIDE_DESIGN_COMPLETED,
          details: {
            slideId: slideData.id,
            slideType: slideData.slideType,
            layoutType: finalDirectives.layoutType,
            traceId: llmResult.traceId,
          },
        },
      });

      logger.info(
        {
          slideId: slideData.id,
          slideType: slideData.slideType,
          layoutType: finalDirectives.layoutType,
          traceId: llmResult.traceId,
        },
        "Design directives generated successfully"
      );

      return finalDirectives;
    } catch (error) {
      logger.error(
        {
          slideId,
          error: error.message,
          stack: error.stack,
        },
        "Failed to generate design directives"
      );

      try {
        await prisma.workplanSlide.update({
          where: { id: slideId },
          data: {
            designStatus: DocumentStatus.FAILED,
            updatedAt: new Date(),
          },
        });
      } catch (updateError) {
        logger.error(
          { slideId, error: updateError.message },
          "Failed to update design status to FAILED"
        );
      }

      throw error;
    }
  }
}

module.exports = { WorkplanArtDirectorService };
