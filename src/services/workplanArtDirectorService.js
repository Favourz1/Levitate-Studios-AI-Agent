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
      const sanitizedContent = this.truncateContent(normalizedContent, 4000);

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
      const rawSearchQuery =
        title ||
        slideData.slideType.replace(/_/g, " ").toLowerCase() ||
        "brand";
      const searchQuery =
        rawSearchQuery.length > 50
          ? `${rawSearchQuery.slice(0, 47)}...`
          : rawSearchQuery;
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

      let fallbackVisuals = [
        ...imageResults.slice(0, 2).map((image) => ({
          type: "IMAGE",
          description: image.description || "Supporting image",
          url: image.url,
          placement:
            layoutType === DesignLayout.SPLIT_LEFT_RIGHT ? "RIGHT" : "TOP",
          size: layoutType === DesignLayout.CENTERED ? "MEDIUM" : "LARGE",
        })),
        ...iconResults.slice(0, 3).map((icon) => ({
          type: "ICON",
          description: icon.description || "Supporting icon",
          url: icon.url,
          placement: "LEFT",
          size: "SMALL",
        })),
      ];

      // Ensure at least one placeholder visual element if nothing was retrieved
      if (fallbackVisuals.length === 0) {
        fallbackVisuals = [
          {
            type: "ICON",
            description: "Placeholder icon – add a relevant graphic",
            placement: "LEFT",
            size: "SMALL",
          },
        ];
      }

      // Build prompt for LLM - optimized for schema compliance
      const brandGuidelines = LEVITATE_BRAND_GUIDELINES;

      // Truncate visual candidates list to prevent prompt bloat
      const visualCandidatesText = fallbackVisuals
        .slice(0, 5) // Limit to 5 visuals max
        .map((v) => `${v.type}:${v.description || "Asset"}:${v.url || "none"}`)
        .join("|");

      const prompt = `You are the Art Director for Levitate Studios. Produce production-ready, strictly schema-compliant design directives that let a designer execute the slide without guesswork. Generate design directives matching designDirectiveSchema exactly.

Slide: ${title} (${slideData.slideType})
Layout: ${layoutType}
Service: ${context.serviceType || "GENERAL"}

Brand Colors: primary=${brandGuidelines.colors.primary}, secondary=${
        brandGuidelines.colors.secondary
      }, accent=${brandGuidelines.colors.accent}, background=${
        brandGuidelines.colors.background
      }
Brand Fonts: heading=${
        brandGuidelines.typography.headingFont
      } (${brandGuidelines.typography.headingSizes.join("/")}), body=${
        brandGuidelines.typography.bodyFont
      } (${brandGuidelines.typography.bodySize}px)
Style: icons=${brandGuidelines.iconStyle}, images=${brandGuidelines.imageStyle}

Content: ${sanitizedContent.substring(0, 3000)}

Visuals: ${visualCandidatesText || "none"}

Output JSON with these exact keys:
- layoutType: enum from DesignLayout
- colorPalette: {primary,secondary,accent,background,text} - use brand colors, set text for contrast
- typography: {headingFont,bodyFont,headingSize,bodySize} - use brand fonts
- visualElements: array max 5 of {type,description,url?,placement,size} - use provided visuals or minimal placeholder
- contentPlacement: {statsPosition,imagePosition,textAlignment,contentMapping[]} - map content sections
- spacing: {sectionSpacing,elementSpacing} - numbers in points
- specialInstructions: optional string

CRITICAL: Return ONLY valid JSON matching schema. No extra fields. No commentary.`;

      // What to output (must validate against designDirectiveSchema):
      // - layoutType: choose the best layout for this slide from the provided layout enum.
      // - colorPalette: stay within brand colors; ensure readable text contrast (set text color explicitly).
      // - typography: pick heading/body sizes that reflect hierarchy and legibility; use provided fonts.
      // - visualElements: select concise set (max 5) of icons/images/charts/graphs that reinforce the message; include URLs only when provided; match placements to layout.
      // - If you suggest search queries for icons/images, keep each query concise (<=50 characters) using 3-5 keywords.
      // - contentPlacement: map 3-6 meaningful content sections from the strategic copy to specific positions; include statsPosition, imagePosition, textAlignment, and contentMapping with emphasis where needed.
      // - spacing: set sectionSpacing and elementSpacing for clean breathing room (use points).
      // - specialInstructions: only if critical (e.g., keep accent usage sparing, avoid clutter, chart suggestion).
      let llmResult;
      try {
        logger.info(
          {
            slideId: slideData.id,
            slideType: slideData.slideType,
            layoutType,
            documentId: slideData.documentId,
            promptPreview:
              prompt.slice(0, 200) + (prompt.length > 200 ? "..." : ""),
          },
          "Invoking LLM to generate design directives"
        );
        llmResult = await llmClient.generateStructured(
          designDirectiveSchema,
          prompt,
          {
            slideId: slideData.id,
            documentId: slideData.documentId,
            layoutType,
          },
          "generation"
        );
      } catch (primaryError) {
        // Log why the primary attempt failed before retrying
        logger.warn(
          {
            slideId: slideData.id,
            slideType: slideData.slideType,
            layoutType,
            documentId: slideData.documentId,
            error: primaryError?.message,
          },
          "Primary LLM attempt failed, retrying with minimal prompt"
        );

        // Retry with a tighter, minimal prompt to enforce schema compliance
        const minimalVisuals = fallbackVisuals.slice(0, 3).map((v) => ({
          t: v.type,
          d: (v.description || "").substring(0, 50),
          u: v.url || null,
        }));

        const minimalPrompt = `You are the Art Director for Levitate Studios. Produce production-ready, strictly schema-compliant design directives that let a designer execute the slide without guesswork. Generate design directives JSON matching designDirectiveSchema exactly.

Title: ${title.substring(0, 100)}
Type: ${slideData.slideType}
Layout: ${layoutType}

Brand: colors=${brandGuidelines.colors.primary},${
          brandGuidelines.colors.secondary
        },${brandGuidelines.colors.accent}|fonts=${
          brandGuidelines.typography.headingFont
        },${brandGuidelines.typography.bodyFont}

Content: ${sanitizedContent.substring(0, 1000)}
Visuals: ${JSON.stringify(minimalVisuals)}

Required JSON structure:
{
  "layoutType": "enum value",
  "colorPalette": {"primary":"#hex","secondary":"#hex","accent":"#hex","background":"#hex","text":"#hex"},
  "typography": {"headingFont":"string","bodyFont":"string","headingSize":number,"bodySize":number},
  "visualElements": [{"type":"ICON|IMAGE","description":"string","placement":"LEFT|RIGHT|TOP|BOTTOM|CENTER","size":"SMALL|MEDIUM|LARGE","url":"optional"}],
  "contentPlacement": {"statsPosition":"LEFT|RIGHT|TOP|BOTTOM","imagePosition":"LEFT|RIGHT|TOP|BOTTOM|BACKGROUND","textAlignment":"LEFT|CENTER|RIGHT|JUSTIFY","contentMapping":[]},
  "spacing": {"sectionSpacing":number,"elementSpacing":number},
  "specialInstructions": "optional string"
}

Return ONLY valid JSON. No extra fields.`;

        llmResult = await llmClient.generateStructured(
          designDirectiveSchema,
          minimalPrompt,
          {
            slideId: slideData.id,
            documentId: slideData.documentId,
            layoutType,
            retry: true,
          },
          "generation"
        );
      }

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

  /**
   * Safely truncate text for prompts
   * @private
   */
  static truncateContent(text, maxLen = 4000) {
    if (!text) return "";
    const str = String(text).replace(/\s+/g, " ").trim();
    return str.length > maxLen ? `${str.slice(0, maxLen - 3)}...` : str;
  }
}

module.exports = { WorkplanArtDirectorService };
