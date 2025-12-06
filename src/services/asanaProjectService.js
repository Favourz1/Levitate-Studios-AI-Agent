const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError } = require("@/utils/errors");
const { llmClient } = require("@/llm/client");
const {
  DocumentType,
  ProcessingStatus,
  DocumentStatus,
  LLMTaskType,
} = require("@/constants");
const { googleIntegration } = require("@/integrations/google");

const logger = createLogger("service:asana-project");
const prisma = getPrismaClient();

/**
 * AsanaProjectService handles business logic for Asana project operations
 * Specifically for actual project boards (not the Pending Projects board)
 */
class AsanaProjectService {
  /**
   * Generate comprehensive project description for Asana project (excludes financials)
   * Assembles context from client, questionnaire, brand origin, and conversations
   * Includes brand origin document Google Drive link
   * @param {number} projectId - Project ID
   * @returns {Promise<string>} Generated project description with brand origin link
   */
  static async generateProjectDescription(projectId) {
    try {
      if (!projectId || typeof projectId !== "number") {
        throw new ValidationError(
          "Project ID is required and must be a number"
        );
      }

      // Get project with all related data
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: true,
          questionnaireResponses: {
            where: {
              processingStatus: ProcessingStatus.PROCESSED,
            },
            orderBy: {
              submittedAt: "desc",
            },
            take: 1,
          },
          documents: {
            where: {
              type: DocumentType.BRAND_ORIGIN,
              status: DocumentStatus.ACCEPTED,
            },
            include: {
              currentRevision: true,
            },
            orderBy: {
              updatedAt: "desc",
            },
            take: 1,
          },
          emailThreads: {
            include: {
              emails: {
                orderBy: {
                  receivedAt: "asc",
                },
                take: 50, // Get conversation history
              },
            },
            take: 1,
          },
        },
      });

      if (!project) {
        throw new ValidationError(`Project not found: ${projectId}`);
      }

      // Assemble context for description generation
      const clientContext = project.client?.context || "";
      const questionnaire = project.questionnaireResponses[0]?.responses || {};
      const brandOriginDocument = project.documents[0] || null;
      const brandOriginText =
        brandOriginDocument?.currentRevision?.snapshotText || "";
      const conversations = project.emailThreads[0]?.emails || [];

      // Get brand origin document Google Drive link
      let brandOriginDriveLink = null;
      if (brandOriginDocument?.driveFileId) {
        try {
          // Get file metadata from Google Drive
          const fileMetadata = await googleIntegration.getDocumentMetadata(
            brandOriginDocument.driveFileId
          );

          if (fileMetadata?.webViewLink) {
            brandOriginDriveLink = fileMetadata.webViewLink;
          }
        } catch (driveError) {
          logger.warn(
            {
              projectId,
              driveFileId: brandOriginDocument.driveFileId,
              error: driveError.message,
            },
            "Failed to get brand origin document Drive link"
          );
        }
      }

      // Format conversations - extract key insights
      const conversationText = conversations
        .map((email) => {
          const direction =
            email.direction === EmailDirection.INBOUND ? "Client" : "Levitate";
          const date = new Date(email.receivedAt).toLocaleDateString();
          const content = email.textBody || email.subject || "";
          return `[${date}] ${direction}: ${content}`;
        })
        .join("\n\n");

      // Extract structured information from questionnaire
      const questionnaireSummary =
        this.extractQuestionnaireSummary(questionnaire);

      // Build comprehensive prompt for LLM
      const prompt = `You are a project documentation specialist creating a comprehensive project description for a creative agency team working in Asana. Your goal is to create a clear, actionable, and inspiring project description that helps team members understand the project context, requirements, and creative direction.

CRITICAL REQUIREMENT: DO NOT include any financial information, pricing, quotes, invoices, monetary details, budgets, or cost-related information. This description is for the creative team only.

## PROJECT CONTEXT

**Client:** ${project.client?.name || "Client Name"}
**Project:** ${project.name || "Project Name"}
**Industry:** ${questionnaireSummary.industry || "Not specified"}

## CLIENT BACKGROUND & CONTEXT
${clientContext || "No additional client context provided"}

## PROJECT REQUIREMENTS (from Client Questionnaire)

**Company/Organization:** ${questionnaireSummary.companyName || "Not provided"}
**Industry:** ${questionnaireSummary.industry || "Not provided"}
**Services/Products:** ${questionnaireSummary.services || "Not provided"}
**Target Audience:** ${questionnaireSummary.targetAudience || "Not provided"}
**Project Goals:** ${questionnaireSummary.goals || "Not provided"}
**Mission/Vision:** ${questionnaireSummary.mission || "Not provided"}
**Key Requirements:** ${
        questionnaireSummary.requirements || "See questionnaire details below"
      }

**Full Questionnaire Responses:**
${JSON.stringify(questionnaire, null, 2)}

## BRAND GUIDELINES (from Accepted Brand Origin Document)

${brandOriginText ? brandOriginText : "Brand origin document not available"}

## CLIENT CONVERSATIONS & FEEDBACK

${conversationText || "No conversation history available"}

## YOUR TASK: CREATE A COMPREHENSIVE PROJECT DESCRIPTION

Generate a well-structured, professional project description that will be used in Asana to help the creative team understand and execute this project effectively. The description should be:

1. **Clear and Actionable**: Team members should immediately understand what needs to be done
2. **Inspiring**: Help the team connect with the client's vision and goals
3. **Comprehensive**: Include all relevant context without overwhelming detail
4. **Professional**: Maintain a professional tone suitable for a creative agency

## REQUIRED SECTIONS (use clear headings):

### 1. PROJECT OVERVIEW
- Brief summary of what this project is about
- What the client wants to achieve
- Why this project matters to the client

### 2. CLIENT BACKGROUND
- Key information about the client and their business
- Their industry, market position, and unique characteristics
- Any relevant business context that informs creative decisions

### 3. PROJECT REQUIREMENTS & DELIVERABLES
- What needs to be delivered based on the questionnaire
- Specific services or deliverables mentioned
- Any technical requirements or constraints
- Timeline expectations (if mentioned in conversations)

### 4. BRAND GUIDELINES & CREATIVE DIRECTION
- Key brand elements, personality, and style from the brand origin document
- Visual identity guidelines (colors, typography, imagery style)
- Brand voice and tone
- Creative direction and aesthetic preferences
- What makes this brand unique

### 5. TARGET AUDIENCE
- Who the client wants to reach
- Audience demographics and psychographics
- Audience needs and preferences

### 6. IMPORTANT NOTES & CONSIDERATIONS
- Any special requirements or considerations from conversations
- Client preferences or feedback
- Cultural or market-specific considerations
- Any constraints or limitations to be aware of

## FORMATTING GUIDELINES:

- Use clear section headings (*<Heading>* for main sections to bold it - one asterisk on each side)
- Use bullet points for lists
- Use bold text for important terms or concepts (wrap it around on both sides with * - one asterisk on each side)
- Keep paragraphs concise and scannable
- Use line breaks between sections for readability
- Make it easy to scan quickly while still being comprehensive

## EXCLUSIONS (DO NOT INCLUDE):

- Pricing information
- Quote details or amounts
- Invoice information
- Financial terms or budgets
- Payment information
- Cost breakdowns
- Any monetary values

## OUTPUT FORMAT:

Generate the complete project description now, formatted for Asana project notes. Make it professional, clear, and actionable for the creative team.`;

      // Call LLM to generate description
      const result = await llmClient.generateText(
        prompt,
        {
          projectId,
          task: "project_description_generation",
        },
        LLMTaskType.GENERATION,
        4000
      );

      let description = result.text || result;

      if (!description || description.trim().length === 0) {
        throw new Error("Generated project description is empty");
      }

      // Append brand origin document link if available
      if (brandOriginDriveLink) {
        description += `\n\n---\n\n**📄 Brand Origin Document:**\n${brandOriginDriveLink}\n\n*Reference the brand origin document above for detailed brand guidelines, creative direction, and brand strategy.*`;
      }

      logger.info(
        {
          projectId,
          descriptionLength: description.length,
          hasBrandOriginLink: !!brandOriginDriveLink,
        },
        "Project description generated successfully"
      );

      return description;
    } catch (error) {
      logger.error(
        {
          projectId,
          error: error.message,
          stack: error.stack,
        },
        "Failed to generate project description"
      );
      throw error;
    }
  }

  /**
   * Extract structured summary from questionnaire responses
   * @private
   * @param {Object} questionnaire - Questionnaire responses object
   * @returns {Object} Structured summary
   */
  static extractQuestionnaireSummary(questionnaire) {
    if (!questionnaire || typeof questionnaire !== "object") {
      return {};
    }

    // Common questionnaire field names (case-insensitive matching)
    const fields = {
      companyName: [
        "company_name",
        "company name",
        "company",
        "organization",
        "organization_name",
        "business_name",
      ],
      industry: ["industry", "sector", "business_type", "category"],
      services: [
        "services",
        "products",
        "what_do_you_offer",
        "offerings",
        "service_offerings",
      ],
      targetAudience: [
        "target_audience",
        "target audience",
        "audience",
        "target_market",
        "customer_base",
      ],
      goals: [
        "goals",
        "objectives",
        "project_goals",
        "what_do_you_want_to_achieve",
        "aims",
      ],
      mission: [
        "mission",
        "vision",
        "mission_statement",
        "vision_statement",
        "purpose",
      ],
      requirements: [
        "requirements",
        "needs",
        "what_do_you_need",
        "deliverables",
        "project_requirements",
      ],
    };

    const summary = {};

    // Helper to find value by multiple possible keys
    const findValue = (possibleKeys) => {
      for (const key of possibleKeys) {
        // Try exact match
        if (questionnaire[key]) {
          return Array.isArray(questionnaire[key])
            ? questionnaire[key].join(", ")
            : String(questionnaire[key]);
        }

        // Try case-insensitive match
        const lowerKey = key.toLowerCase();
        for (const qKey of Object.keys(questionnaire)) {
          if (qKey.toLowerCase() === lowerKey) {
            const value = questionnaire[qKey];
            return Array.isArray(value) ? value.join(", ") : String(value);
          }
        }
      }
      return null;
    };

    // Extract each field
    for (const [fieldName, possibleKeys] of Object.entries(fields)) {
      const value = findValue(possibleKeys);
      if (value) {
        summary[fieldName] = value;
      }
    }

    return summary;
  }
}

module.exports = {
  AsanaProjectService,
};
