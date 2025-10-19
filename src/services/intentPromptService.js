const { createLogger } = require("@/utils/logger");
const { DocumentType } = require("@/constants");

const logger = createLogger("service:intent-prompt");

/**
 * IntentPromptService provides context-aware prompt generation for intent detection
 * Supports different intent types including document-type aware analysis
 * Follows separation of concerns by delegating to specific prompt services
 * Enables accurate intent analysis based on type-specific structure and requirements
 */
class IntentPromptService {
  /**
   * Generate unified intent detection prompt with type-specific context
   * @param {string} basePrompt - Base intent detection prompt with client context
   * @param {string} intentType - Type of intent analysis (document type or other)
   * @param {Object} context - Complete context including client, email, document data
   * @returns {Promise<string>} Unified prompt with type-specific context
   */
  static async generateIntentPrompt(basePrompt, intentType, context = {}) {
    try {
      if (!basePrompt || typeof basePrompt !== "string") {
        throw new Error("Base prompt is required and must be a string");
      }

      if (!intentType) {
        logger.warn("No intent type provided, using base prompt only");
        return basePrompt;
      }

      logger.info(
        {
          intentType,
          hasContext: !!context,
          basePromptLength: basePrompt.length,
        },
        "Generating unified intent prompt with type-specific context"
      );

      // Get type-specific context
      const typeContext = await this.getIntentTypeContext(intentType);

      if (!typeContext) {
        logger.warn(
          {
            intentType,
          },
          "No type-specific context available, using base prompt only"
        );
        return basePrompt;
      }

      // Build unified prompt that preserves client context and adds type-specific guidelines
      const unifiedPrompt = this.buildUnifiedPrompt(
        basePrompt,
        typeContext,
        context
      );

      logger.info(
        {
          intentType,
          hasTypeContext: !!typeContext,
          unifiedPromptLength: unifiedPrompt.length,
          contextKeys: Object.keys(context),
        },
        "Generated unified intent detection prompt"
      );

      return unifiedPrompt;
    } catch (error) {
      logger.error(
        {
          intentType,
          error: error.message,
        },
        "Failed to generate intent prompt, using base prompt"
      );
      return basePrompt;
    }
  }

  /**
   * Get intent type-specific context
   * @param {string} intentType - Type of intent analysis
   * @returns {Promise<Object>} Type-specific context including rules, structure, and guidelines
   */
  static async getIntentTypeContext(intentType) {
    try {
      if (!intentType) {
        logger.warn("No intent type provided for context generation");
        return null;
      }

      logger.debug(
        {
          intentType,
        },
        "Getting intent type context"
      );

      // Handle document types (current use case)
      switch (intentType) {
        case DocumentType.BRAND_ORIGIN:
          return this.getBrandOriginContext();

        case DocumentType.BUDGET_TIMELINE:
          return this.getBudgetTimelineContext();

        case DocumentType.BUDGET_TIMELINE_VARIANT:
          return this.getBudgetTimelineVariantContext();

        default:
          // Check if it's a known document type but not implemented
          const validDocumentTypes = Object.values(DocumentType);

          if (validDocumentTypes.includes(intentType?.toUpperCase())) {
            logger.warn(
              {
                intentType,
              },
              "Known document type but context not implemented, using generic"
            );
            return this.getGenericDocumentContext();
          }

          // Future: Add other intent types here (e.g., SUPPORT_TICKET, SALES_INQUIRY, etc.)
          logger.warn(
            {
              intentType,
            },
            "Unknown intent type, returning generic context"
          );
          return this.getGenericContext();
      }
    } catch (error) {
      logger.error(
        {
          intentType,
          error: error.message,
        },
        "Failed to get intent type context"
      );
      return null;
    }
  }

  /**
   * Build unified prompt that preserves client context and adds type-specific guidelines
   * @param {string} basePrompt - Base prompt with client context
   * @param {Object} typeContext - Type-specific context
   * @param {Object} context - Complete context object
   * @returns {string} Unified prompt
   */
  static buildUnifiedPrompt(basePrompt, typeContext, context) {
    try {
      // Extract client and document info from context for additional context
      const clientInfo = context.project?.client || {};
      const documentInfo = context.currentDocument || {};
      const emailInfo = context.email || {};

      const unifiedPrompt = `${basePrompt}

## ${typeContext.documentType || typeContext.intentType} Analysis Context

${typeContext.contextPrompt}

## Enhanced Analysis Guidelines

When analyzing the client's feedback, consider these type-specific factors:

### 1. Structural Awareness
- Does the feedback reference specific sections or elements?
- Are requested changes compatible with the required structure?
- How do the changes impact the core requirements?

### 2. Content Validation
- Are requested changes aligned with type-specific best practices?
- Do the changes maintain strategic coherence?
- Will the modifications enhance or compromise effectiveness?

### 3. Feasibility Assessment
- Are the requested changes technically feasible within the framework?
- Do the changes require structural modifications or just content updates?
- What is the complexity level of implementing the requested changes?

### 4. Impact Analysis
- How will the changes affect other sections or elements?
- Are there dependencies or relationships that need to be considered?
- What are the potential risks or benefits of the requested modifications?

### Context Summary for Analysis:
- **Type**: ${typeContext.documentType || typeContext.intentType}
- **Available Sections**: ${
        typeContext.structure?.sections?.join(", ") || "Varies by type"
      }
- **Key Requirements**: ${
        typeContext.structure?.requiredElements?.join(", ") ||
        "Type-specific requirements"
      }
- **Client**: ${clientInfo.name || "Not specified"}
- **Document Status**: ${documentInfo.status || "Not specified"}
- **Email From**: ${emailInfo.from || "Not specified"}

Use this comprehensive context to provide accurate intent classification and detailed analysis that considers both the client's specific situation and the type-specific requirements.`;

      return unifiedPrompt;
    } catch (error) {
      logger.error(
        {
          error: error.message,
        },
        "Failed to build unified prompt, returning base prompt"
      );
      return basePrompt;
    }
  }

  /**
   * Get Brand Origin specific context for intent analysis
   * @returns {Object} Brand Origin context
   */
  static getBrandOriginContext() {
    return {
      intentType: "DOCUMENT_ANALYSIS",
      documentType: DocumentType.BRAND_ORIGIN,
      structure: {
        sections: [
          "I. WHO AM I?",
          "II. WHERE DO I COME FROM?",
          "III. WHAT DO I DO – BRAND PURPOSE",
          "IV. WHO AM I FOR – TARGET AUDIENCE",
          "V. WHAT DO I WANT TO BECOME – VISION",
          "VI. KEY INSIGHTS",
          "VII. SINGLE-MINDED MESSAGE",
          "VIII. POSITIONING / COPY STRATEGY",
          "IX. BRAND REWARDS",
          "X. BRAND PERSONALITY & DELIVERY TONE",
          "XI. MANDATORIES / MUST-NOT'S",
          "XII. DELIVERABLES",
        ],
        requiredElements: [
          "Brand identity and essence",
          "Origin story and founding motivation",
          "Brand purpose and value delivery",
          "Target audience definition",
          "Vision and positioning goals",
          "Key insights from founder and business perspective",
          "Single-minded message or tagline",
          "Positioning and copy strategy",
          "Functional, sensory, and emotional benefits",
          "Brand personality and narrative guidance",
          "Brand requirements and restrictions",
          "Specific deliverables and creative outputs",
        ],
      },
      analysisGuidelines: {
        feedbackTypes: [
          "Section-specific changes (e.g., 'Change the target audience section')",
          "Content modifications (e.g., 'Make the tone more professional')",
          "Strategic adjustments (e.g., 'Focus more on B2B market')",
          "Structural requests (e.g., 'Add more detail to brand personality')",
          "Deliverable changes (e.g., 'Include social media strategy')",
        ],
        commonRequests: [
          "Tone and voice adjustments",
          "Target audience refinements",
          "Brand positioning changes",
          "Deliverable modifications",
          "Cultural or market context updates",
        ],
        validationCriteria: [
          "Strategic coherence across all sections",
          "Alignment with brand development best practices",
          "Cultural authenticity and market relevance",
          "Actionable guidance for creative teams",
          "Commercial viability and differentiation",
        ],
      },
      contextPrompt: `### Brand Origin Document Structure & Requirements

The Brand Origin document follows a specific 12-section structure designed to provide comprehensive brand strategy:

**Required Sections:**
1. **WHO AM I?** - Core brand identity and essence
2. **WHERE DO I COME FROM?** - Origin story and founding motivation
3. **WHAT DO I DO – BRAND PURPOSE** - Brand's reason for existence
4. **WHO AM I FOR – TARGET AUDIENCE** - Primary and secondary audiences
5. **WHAT DO I WANT TO BECOME – VISION** - Aspirational future state
6. **KEY INSIGHTS** - Founder's and business perspectives
7. **SINGLE-MINDED MESSAGE** - Core tagline or message
8. **POSITIONING / COPY STRATEGY** - Key promise and tone of voice
9. **BRAND REWARDS** - Functional, sensory, and emotional benefits
10. **BRAND PERSONALITY & DELIVERY TONE** - Personality traits and narrative guidance
11. **MANDATORIES / MUST-NOT'S** - Brand requirements and restrictions
12. **DELIVERABLES** - Specific creative outputs and rationale

**Quality Standards:**
- Strategic coherence across all sections
- Cultural authenticity and market relevance
- Actionable guidance for creative execution
- Commercial viability and differentiation
- Professional brand strategy standards

**Common Feedback Areas:**
- Tone and voice adjustments
- Target audience refinements
- Brand positioning changes
- Deliverable modifications
- Cultural or market context updates`,
    };
  }

  /**
   * Get Budget Timeline specific context for intent analysis
   * @returns {Object} Budget Timeline context
   */
  static getBudgetTimelineContext() {
    return {
      intentType: "DOCUMENT_ANALYSIS",
      documentType: DocumentType.BUDGET_TIMELINE,
      structure: {
        sections: [
          "Project Overview",
          "Scope of Work",
          "Timeline Breakdown",
          "Budget Breakdown",
          "Payment Schedule",
          "Deliverables",
          "Terms and Conditions",
        ],
        requiredElements: [
          "Clear project scope definition",
          "Detailed timeline with milestones",
          "Comprehensive budget breakdown",
          "Payment terms and schedule",
          "Specific deliverables list",
          "Terms, conditions, and assumptions",
        ],
      },
      analysisGuidelines: {
        feedbackTypes: [
          "Budget adjustments (e.g., 'Reduce the cost for logo design')",
          "Timeline modifications (e.g., 'Need faster delivery')",
          "Scope changes (e.g., 'Add social media management')",
          "Payment terms (e.g., 'Change payment schedule')",
          "Deliverable modifications (e.g., 'Include additional revisions')",
        ],
        commonRequests: [
          "Budget reductions or adjustments",
          "Timeline acceleration or extension",
          "Scope additions or removals",
          "Payment schedule modifications",
          "Deliverable quantity changes",
        ],
        validationCriteria: [
          "Realistic timeline and budget alignment",
          "Clear scope definition and boundaries",
          "Fair payment terms for both parties",
          "Achievable deliverables within constraints",
          "Professional service standards",
        ],
      },
      contextPrompt: `### Budget Timeline Document Structure & Requirements

The Budget Timeline document provides comprehensive project planning and financial breakdown:

**Required Elements:**
- **Project Overview** - Clear description of project goals and objectives
- **Scope of Work** - Detailed breakdown of services and deliverables
- **Timeline Breakdown** - Phase-by-phase schedule with milestones
- **Budget Breakdown** - Itemized costs for each service component
- **Payment Schedule** - Payment terms, milestones, and due dates
- **Deliverables** - Specific outputs and quality standards
- **Terms and Conditions** - Project assumptions, limitations, and policies

**Quality Standards:**
- Realistic timeline and budget alignment
- Clear scope boundaries and expectations
- Fair and professional payment terms
- Achievable deliverables within constraints
- Transparent cost breakdown and rationale

**Common Feedback Areas:**
- Budget adjustments or cost concerns
- Timeline modifications (faster/slower delivery)
- Scope additions or reductions
- Payment schedule preferences
- Deliverable quantity or quality changes`,
    };
  }

  /**
   * Get Budget Timeline Variant specific context for intent analysis
   * @returns {Object} Budget Timeline Variant context
   */
  static getBudgetTimelineVariantContext() {
    const baseContext = this.getBudgetTimelineContext();
    return {
      ...baseContext,
      documentType: DocumentType.BUDGET_TIMELINE_VARIANT,
      analysisGuidelines: {
        ...baseContext.analysisGuidelines,
        feedbackTypes: [
          ...baseContext.analysisGuidelines.feedbackTypes,
          "Variant comparison (e.g., 'Prefer option 2 over option 1')",
          "Hybrid requests (e.g., 'Combine elements from different variants')",
        ],
        commonRequests: [
          ...baseContext.analysisGuidelines.commonRequests,
          "Variant selection preferences",
          "Hybrid solution requests",
        ],
      },
      contextPrompt:
        baseContext.contextPrompt +
        `

**Variant-Specific Considerations:**
- Client may compare multiple options
- Feedback may reference specific variant numbers
- Requests for hybrid solutions combining variants
- Preference expressions between different approaches`,
    };
  }

  /**
   * Get generic document context for unknown document types
   * @returns {Object} Generic document context
   */
  static getGenericDocumentContext() {
    return {
      intentType: "DOCUMENT_ANALYSIS",
      documentType: "GENERIC_DOCUMENT",
      structure: {
        sections: ["Content sections vary by document type"],
        requiredElements: ["Document-specific requirements"],
      },
      analysisGuidelines: {
        feedbackTypes: [
          "Content modifications",
          "Structural changes",
          "Tone adjustments",
          "Addition or removal of sections",
        ],
        commonRequests: [
          "Content clarity improvements",
          "Tone and style adjustments",
          "Information additions or removals",
          "Format or structure changes",
        ],
        validationCriteria: [
          "Content accuracy and relevance",
          "Professional presentation standards",
          "Clear communication of key points",
          "Appropriate tone and style",
        ],
      },
      contextPrompt: `### Generic Document Analysis

This document requires general content analysis:

**Analysis Approach:**
- Focus on content clarity and accuracy
- Assess tone and professional presentation
- Evaluate structure and organization
- Consider audience appropriateness

**Common Feedback Areas:**
- Content modifications and improvements
- Tone and style adjustments
- Structural or format changes
- Information additions or clarifications`,
    };
  }

  /**
   * Get generic context for non-document intent types
   * @returns {Object} Generic context
   */
  static getGenericContext() {
    return {
      intentType: "GENERAL_ANALYSIS",
      structure: {
        sections: ["Context-dependent sections"],
        requiredElements: ["Type-specific requirements"],
      },
      analysisGuidelines: {
        feedbackTypes: [
          "Content requests",
          "Process modifications",
          "Service adjustments",
          "General inquiries",
        ],
        commonRequests: [
          "Information requests",
          "Process clarifications",
          "Service modifications",
          "General support",
        ],
        validationCriteria: [
          "Request clarity and specificity",
          "Appropriate response scope",
          "Professional communication",
          "Actionable outcomes",
        ],
      },
      contextPrompt: `### General Intent Analysis

This requires general intent analysis:

**Analysis Approach:**
- Focus on understanding the core request
- Assess urgency and importance
- Evaluate required actions
- Consider appropriate response

**Common Areas:**
- Information requests
- Process clarifications
- Service modifications
- General support needs`,
    };
  }

  /**
   * Validate intent type and return normalized type
   * @param {string} intentType - Intent type to validate
   * @returns {string|null} Validated intent type or null if invalid
   */
  static validateIntentType(intentType) {
    if (!intentType || typeof intentType !== "string") {
      return null;
    }

    // Known document types
    const validDocumentTypes = Object.values(DocumentType);

    const normalizedType = intentType.toUpperCase();

    // Return normalized type if valid, otherwise return the original for future extensibility
    return validDocumentTypes.includes(normalizedType)
      ? normalizedType
      : intentType;
  }
}

module.exports = {
  IntentPromptService,
};
