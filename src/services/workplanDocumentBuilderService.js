const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { googleIntegration } = require("@/integrations/google");
const {
  DocumentType,
  DocumentStatus,
  CreatedBy,
  BrandAssets,
  SlideType,
  SystemActors,
  AuditActions,
} = require("@/constants");
const { retry, isFinancialDocument } = require("@/utils");
const { appConfig } = require("@/config");

const logger = createLogger("service:workplan-document-builder");
const prisma = getPrismaClient();

class WorkplanDocumentBuilderService {
  /**
   * Convert a slide record into an ordered array of blocks understood by
   * googleIntegration.createFormattedDocument.
   * @param {Object} slide
   * @returns {Array}
   */
  static convertSlideToBlocks(slide) {
    const blocks = [];
    const researchSources = slide?.metadataInfo?.researchSources || [];
    const designDirectives = slide?.designDirectives || {};

    // Slide Title (Heading 1)
    blocks.push({
      type: "heading",
      level: 1,
      text: slide?.title || slide?.slideType || `Slide ${slide?.slideNumber}`,
    });

    // Slide Type (Heading 2 - smaller heading below title)
    if (slide?.slideType) {
      blocks.push({
        type: "heading",
        level: 3,
        text: `Type of slide: ${this.formatSlideType(slide.slideType)}`,
      });
    }

    blocks.push({ type: "spacer", height: 24 });

    // Content (moved to top)
    blocks.push({ type: "heading", level: 2, text: "Content" });
    blocks.push({
      type: "paragraph",
      text: slide?.contentCopy || "[Content to be generated]",
    });

    blocks.push({ type: "spacer", height: 24 });

    // Design Directives (moved to middle)
    blocks.push({ type: "heading", level: 2, text: "Design Directives" });
    blocks.push({
      type: "paragraph",
      text:
        this.formatDesignDirectives(designDirectives) ||
        "[Design directives pending]",
    });

    // Content placement instructions
    if (designDirectives?.contentPlacement?.contentMapping) {
      blocks.push({
        type: "heading",
        level: 3,
        text: "Content Placement Instructions",
      });
      blocks.push({
        type: "bullets",
        items: designDirectives.contentPlacement.contentMapping.map(
          (mapping) => {
            let line = `${mapping.contentSection || "Content"} → ${
              mapping.placement || "TOP"
            }`;
            if (mapping.visualElement) {
              line += `, with ${mapping.visualElement}`;
            }
            if (mapping.emphasis && mapping.emphasis !== "NORMAL") {
              line += ` (${mapping.emphasis} emphasis)`;
            }
            return line;
          }
        ),
      });
    }

    // Visual elements (insert images if URLs exist)
    if (Array.isArray(designDirectives?.visualElements)) {
      const images = designDirectives.visualElements.filter((v) => v.url);
      if (images.length > 0) {
        blocks.push({ type: "heading", level: 3, text: "Visual Elements" });
        images.forEach((element) => {
          blocks.push({
            type: "image",
            url: element.url,
            width: element.size === "SMALL" ? 180 : 280,
          });
          // Add link block below each image/icon/visual element
          if (element.url) {
            blocks.push({
              type: "link",
              text: element.url,
              url: element.url,
            });
          }
        });
      }
    }

    // Big Idea options (if present)
    if (
      slide?.slideType === SlideType.BIG_IDEA &&
      Array.isArray(slide?.metadataInfo?.bigIdeaOptions) &&
      slide.metadataInfo.bigIdeaOptions.length > 0
    ) {
      blocks.push({ type: "heading", level: 3, text: "Big Idea Options" });
      blocks.push({
        type: "bullets",
        items: slide.metadataInfo.bigIdeaOptions.map((option) => {
          const label = `Option ${
            option.option_number || option.optionNumber || ""
          }`.trim();
          const rationale =
            option.rationale ||
            option.reason ||
            option.reasoning ||
            "Rationale not provided";
          return `${label}: ${
            option.big_idea_text || option.bigIdeaText || ""
          } — ${rationale}`;
        }),
      });
    }

    blocks.push({ type: "spacer", height: 24 });

    // Research Data (moved to bottom)
    blocks.push({ type: "heading", level: 2, text: "Research Data" });

    // Only show bullet points list, no JSON dump
    if (researchSources.length > 0) {
      blocks.push({
        type: "bullets",
        items: researchSources.map((source) =>
          [
            source.source_title || source.title || "Source",
            source.source_url || source.url || "",
          ]
            .filter(Boolean)
            .join(": ")
        ),
      });
    } else {
      blocks.push({
        type: "paragraph",
        text: "[Research data not available]",
      });
    }

    return blocks;
  }

  /**
   * Format research data into human-readable text.
   * @param {Object|string|null} researchData
   * @returns {string}
   */
  static formatResearchData(researchData) {
    if (!researchData) return "";
    if (typeof researchData === "string") return researchData.trim();

    const entries = Object.entries(researchData || {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(
        ([key, value]) =>
          `${this.toTitleCase(key)}: ${
            typeof value === "object" ? JSON.stringify(value) : value
          }`
      );

    return entries.join("\n");
  }

  /**
   * Format design directives into readable guidance.
   * @param {Object|string|null} directives
   * @returns {string}
   */
  static formatDesignDirectives(directives) {
    if (!directives) return "";
    if (typeof directives === "string") return directives.trim();

    const {
      layoutType,
      colorPalette,
      typography,
      spacing,
      specialInstructions,
    } = directives;

    const lines = [];
    if (layoutType) lines.push(`Layout: ${layoutType}`);
    if (colorPalette) {
      lines.push(
        `Colors: primary ${colorPalette.primary}, secondary ${colorPalette.secondary}, accent ${colorPalette.accent}, background ${colorPalette.background}, text ${colorPalette.text}`
      );
    }
    if (typography) {
      lines.push(
        `Typography: heading ${typography.headingFont} (${
          typography.headingSize || typography.headingSizes || ""
        }), body ${typography.bodyFont} (${typography.bodySize || ""})`
      );
    }
    if (spacing) {
      lines.push(
        `Spacing: section ${spacing.sectionSpacing || "-"}pt, element ${
          spacing.elementSpacing || "-"
        }pt`
      );
    }
    if (specialInstructions) {
      lines.push(`Notes: ${specialInstructions}`);
    }

    return lines.join("\n");
  }

  /**
   * Build the workplan Google Doc, persist metadata and revision, and return URLs.
   * @param {number} documentId
   * @returns {Promise<{documentId:number, googleDocUrl:string, driveFileId:string}>}
   */
  static async buildGoogleDoc(documentId) {
    if (!documentId) {
      throw new Error("documentId is required to build a workplan");
    }

    const workplanDoc = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        project: { include: { client: true } },
        workplanSlides: { orderBy: { slideNumber: "asc" } },
      },
    });

    if (!workplanDoc) {
      throw new Error(`Workplan document not found: ${documentId}`);
    }
    if (workplanDoc.type !== DocumentType.WORKPLAN) {
      throw new Error(
        `Document ${documentId} is not a workplan (type=${workplanDoc.type})`
      );
    }
    if (
      !workplanDoc.workplanSlides ||
      workplanDoc.workplanSlides.length === 0
    ) {
      throw new Error("Cannot build workplan without slides");
    }

    logger.info(
      {
        documentId,
        projectId: workplanDoc.projectId,
        slideCount: workplanDoc.workplanSlides.length,
      },
      "Starting workplan document build"
    );

    const coverBlocks = [
      {
        type: "image",
        fileId: BrandAssets.LEVITATE_LOGO_FILE_ID,
        url: BrandAssets.LEVITATE_LOGO_URL,
        width: BrandAssets.LOGO_DIMENSIONS.WIDTH,
        height: BrandAssets.LOGO_DIMENSIONS.HEIGHT,
      },
      {
        type: "heading",
        level: 1,
        text: workplanDoc.project?.name || "Workplan",
      },
      {
        type: "paragraph",
        text: `Client: ${
          workplanDoc.project?.client?.name || "Unknown Client"
        }`,
      },
      {
        type: "paragraph",
        text: `Generated: ${new Date().toISOString()}`,
      },
      { type: "spacer", height: 24 },
    ];

    const tocBlocks = [
      { type: "heading", level: 1, text: "Table of Contents" },
      {
        type: "bullets",
        items: workplanDoc.workplanSlides.map((slide) => {
          const title = slide.title || slide.slideType || "Slide";
          const slideType = slide.slideType
            ? ` (${this.formatSlideType(slide.slideType)})`
            : "";
          return `${slide.slideNumber || ""}. ${title}${slideType}`;
        }),
      },
      { type: "spacer", height: 18 },
    ];

    const slideBlocks = [];
    workplanDoc.workplanSlides.forEach((slide, index) => {
      if (index > 0) {
        // Use adequate spacer instead of horizontalRule
        slideBlocks.push({ type: "spacer", height: 18 });
        slideBlocks.push({ type: "spacer", height: 12 });
      }
      slideBlocks.push(...this.convertSlideToBlocks(slide));
    });

    const allBlocks = [...coverBlocks, ...tocBlocks, ...slideBlocks];
    const docTitle = `Workplan - ${
      workplanDoc.project?.name || workplanDoc.id
    }`;

    // Prepare sharing emails - include general team gmail for non-financial documents
    const shareEmails = [];
    if (
      appConfig.generalTeamGmail &&
      !isFinancialDocument(DocumentType.WORKPLAN)
    ) {
      shareEmails.push({
        email: appConfig.generalTeamGmail,
        role: "reader",
        options: { sendNotification: false },
      });
    }

    const docResult = await retry(
      () =>
        googleIntegration.createFormattedDocument(docTitle, allBlocks, {
          shareWithEmails: shareEmails,
        }),
      3,
      1500
    );

    const completedAt = new Date().toISOString();
    const snapshotText = this.buildSnapshotText(
      workplanDoc,
      workplanDoc.workplanSlides
    );

    let revision;
    await prisma.$transaction(async (tx) => {
      revision = await tx.documentRevision.create({
        data: {
          documentId,
          snapshotText,
          createdBy: CreatedBy.AGENT,
        },
      });

      await tx.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.COMPLETED,
          driveFileId: docResult.id,
          currentRevisionId: revision.id,
          metadataInfo: {
            ...(workplanDoc.metadataInfo || {}),
            completedAt,
            googleDocUrl: docResult.webViewLink,
          },
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        projectId: workplanDoc.projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: AuditActions.WORKPLAN_GENERATION_COMPLETED,
        details: {
          documentId,
          googleDocUrl: docResult.webViewLink,
        },
        at: new Date(),
      },
    });

    logger.info(
      {
        documentId,
        driveFileId: docResult.id,
        googleDocUrl: docResult.webViewLink,
      },
      "Workplan document built successfully"
    );

    return {
      documentId,
      googleDocUrl: docResult.webViewLink,
      driveFileId: docResult.id,
    };
  }

  /**
   * Produce a lightweight textual snapshot for revisions.
   * @private
   */
  static buildSnapshotText(workplanDoc, slides) {
    const header = `Workplan: ${workplanDoc.project?.name || workplanDoc.id}
Client: ${workplanDoc.project?.client?.name || "Unknown"}
Generated: ${new Date().toLocaleDateString("en-NG", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })}`;

    const slideTexts = slides
      .map((slide) => {
        return [
          `Slide ${slide.slideNumber}: ${slide.title || slide.slideType}`,
          `Research: ${this.formatResearchData(slide.researchData) || "N/A"}`,
          `Content: ${slide.contentCopy || "N/A"}`,
          `Design: ${
            this.formatDesignDirectives(slide.designDirectives) || "N/A"
          }`,
        ].join("\n");
      })
      .join("\n\n");

    return `${header}\n\n${slideTexts}`;
  }

  /**
   * Format slide type enum value to human-readable text.
   * @param {string} slideType - Slide type enum value
   * @returns {string} Formatted slide type
   * @private
   */
  static formatSlideType(slideType) {
    if (!slideType) return "";

    // Convert enum value to readable format
    // e.g., "INDUSTRY_STRENGTHS" -> "Industry Strengths"
    return this.toTitleCase(slideType);
  }

  /**
   * Utility to title-case a key.
   * @private
   */
  static toTitleCase(str) {
    return (str || "")
      .replace(/[_-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
}

module.exports = { WorkplanDocumentBuilderService };
