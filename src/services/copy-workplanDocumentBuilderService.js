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
  static SAFE_TEXT_LIMIT = 5000;
  static MAX_SOURCES_DISPLAY = 20; // Limit sources to prevent oversized payloads
  static MAX_RESEARCH_DATA_LENGTH = 3000; // Limit research data text

  /**
   * Normalize text to a safe length for Docs.
   * @private
   */
  static safeText(text, fallback = "") {
    if (!text) return fallback;
    const str = String(text).trim();
    if (str.length <= this.SAFE_TEXT_LIMIT) return str;
    return `${str.slice(0, this.SAFE_TEXT_LIMIT - 3)}...`;
  }
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

    blocks.push({
      type: "heading",
      level: 1,
      text: this.safeText(
        slide?.title || slide?.slideType || `Slide ${slide?.slideNumber}`
      ),
    });

    // Research Data
    blocks.push({ type: "heading", level: 2, text: "Research Data" });
    blocks.push({
      type: "paragraph",
      text: this.safeText(
        this.formatResearchData(slide?.researchData) ||
          "[Research data not available]"
      ),
    });

    if (researchSources.length > 0) {
      // Deduplicate sources by URL and limit count to prevent oversized payloads
      const seenUrls = new Set();
      const uniqueSources = researchSources
        .filter((source) => {
          const url = source.source_url || source.url || "";
          if (!url || seenUrls.has(url)) return false;
          seenUrls.add(url);
          return true;
        })
        .slice(0, this.MAX_SOURCES_DISPLAY); // Limit to MAX_SOURCES_DISPLAY

      const sourceItems = uniqueSources
        .map((source) => {
          const title = source.source_title || source.title || "Source";
          const url = source.source_url || source.url || "";
          if (!title && !url) return null;
          return title && url ? `${title}: ${url}` : title || url;
        })
        .filter((item) => item && item.trim().length > 0)
        .map((item) => this.safeText(item, ""))
        .filter((item) => item && item.trim().length > 0);

      if (sourceItems.length > 0) {
        // If we truncated sources, add a note
        if (researchSources.length > this.MAX_SOURCES_DISPLAY) {
          sourceItems.push(
            `... and ${
              researchSources.length - this.MAX_SOURCES_DISPLAY
            } more sources (truncated for display)`
          );
        }
        blocks.push({
          type: "bullets",
          items: sourceItems,
        });
      }
    }

    blocks.push({ type: "spacer", height: 24 });

    // Content
    blocks.push({ type: "heading", level: 2, text: "Content" });
    blocks.push({
      type: "paragraph",
      text: this.safeText(slide?.contentCopy || "[Content to be generated]"),
    });

    blocks.push({ type: "spacer", height: 24 });

    // Design Directives
    blocks.push({ type: "heading", level: 2, text: "Design Directives" });
    blocks.push({
      type: "paragraph",
      text: this.safeText(
        this.formatDesignDirectives(designDirectives) ||
          "[Design directives pending]"
      ),
    });

    // Content placement instructions
    if (designDirectives?.contentPlacement?.contentMapping) {
      blocks.push({
        type: "heading",
        level: 3,
        text: "Content Placement Instructions",
      });
      const mappingItems = designDirectives.contentPlacement.contentMapping
        .map((mapping) => {
          let line = `${mapping.contentSection || "Content"} → ${
            mapping.placement || "TOP"
          }`;
          if (mapping.visualElement) {
            line += `, with ${mapping.visualElement}`;
          }
          if (mapping.emphasis && mapping.emphasis !== "NORMAL") {
            line += ` (${mapping.emphasis} emphasis)`;
          }
          return this.safeText(line);
        })
        .filter((item) => item && item.trim().length > 0);

      if (mappingItems.length > 0) {
        blocks.push({
          type: "bullets",
          items: mappingItems,
        });
      }
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
          return this.safeText(
            `${label}: ${
              option.big_idea_text || option.bigIdeaText || ""
            } — ${rationale}`
          );
        }),
      });
    }

    return blocks;
  }

  /**
   * Format research data into human-readable text.
   * Truncates large objects and limits output to prevent Google Docs API errors.
   * @param {Object|string|null} researchData
   * @returns {string}
   */
  static formatResearchData(researchData) {
    if (!researchData) return "";
    if (typeof researchData === "string") {
      return this.safeText(
        researchData.substring(0, this.MAX_RESEARCH_DATA_LENGTH)
      );
    }

    // Handle nested research data structure (data.sources pattern)
    let dataToFormat = researchData;
    if (researchData.data && typeof researchData.data === "object") {
      dataToFormat = researchData.data;
    }

    const entries = Object.entries(dataToFormat || {})
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 20) // Limit to 20 top-level entries
      .map(([key, value]) => {
        let formattedValue;

        if (typeof value === "object") {
          // For objects, extract key information instead of full JSON dump
          if (Array.isArray(value)) {
            formattedValue = `[${value.length} items]`;
          } else if (value.value !== undefined) {
            // Market data structure: {value, unit, region, sources}
            formattedValue = `${value.value} ${value.unit || ""} (${
              value.region || ""
            })`;
          } else if (value.content) {
            // Research content structure
            formattedValue = this.safeText(
              String(value.content).substring(0, 200)
            );
          } else {
            // Generic object - limit JSON stringification
            const jsonStr = JSON.stringify(value);
            formattedValue = this.safeText(jsonStr.substring(0, 300));
            if (jsonStr.length > 300) {
              formattedValue += "... (truncated)";
            }
          }
        } else {
          formattedValue = this.safeText(String(value).substring(0, 500));
        }

        return `${this.toTitleCase(key)}: ${formattedValue}`;
      });

    const formatted = entries.join("\n");

    // Final truncation to prevent oversized blocks
    if (formatted.length > this.MAX_RESEARCH_DATA_LENGTH) {
      return `${formatted.substring(0, this.MAX_RESEARCH_DATA_LENGTH - 3)}...`;
    }

    return formatted;
  }

  /**
   * Format design directives into readable guidance.
   * @param {Object|string|null} directives
   * @returns {string}
   */
  static formatDesignDirectives(directives) {
    if (!directives) return "";
    if (typeof directives === "string") return this.safeText(directives);

    const {
      layoutType,
      colorPalette,
      typography,
      spacing,
      specialInstructions,
    } = directives;

    const lines = [];
    if (layoutType) lines.push(`Layout: ${this.safeText(layoutType)}`);
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
      lines.push(`Notes: ${this.safeText(specialInstructions)}`);
    }

    return this.safeText(lines.join("\n"));
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
        items: workplanDoc.workplanSlides.map(
          (slide) =>
            `${slide.slideNumber || ""}. ${
              slide.title || slide.slideType || "Slide"
            }`
        ),
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
Generated: ${new Date().toISOString()}`;

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
