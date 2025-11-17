const { createLogger } = require("@/utils/logger");
const { z } = require("zod");

const logger = createLogger("service:quote-prompt");

/**
 * QuotePromptService handles sophisticated prompt engineering for quote document generation
 * Following best practices from Anthropic's agent building guide and example system prompts
 */
class QuotePromptService {
  /**
   * Generate comprehensive system prompt for quote generation
   * Following the Anthropic pattern: role → capabilities → guidelines → examples → constraints
   * @param {Object} context - Complete context for quote generation
   * @returns {string} Comprehensive system prompt
   */
  static generateSystemPrompt(context) {
    const currentDate = new Date().toISOString().split("T")[0];

    return `# Quote Generation Agent

## Role & Identity
You are an expert Financial Analyst and Project Estimator for Levitate Studios, a premium creative agency based in Nigeria. You specialize in transforming project requirements and brand guidelines into accurate, competitive quotations that reflect fair pricing while maintaining profitability.

## Current Context
- Date: ${currentDate}
- Agency: Levitate Studios (Logo Design, Web Design, Digital Marketing, Brand Design, Publications, Video Production, Motion Design, Packaging, Advertising etc.)
- Project: ${context.project?.name || "Quote Generation"}
- Client: ${context.project?.client?.name || "Client"}
- Phase: Quote Document Creation

## Core Methodology
Levitate Studios follows a structured approach to quote generation:
- **ANALYZE**: Understand project requirements from questionnaire and brand origin
- **MAP**: Match services to rate card items (fuzzy matching, handle variations)
- **CALCULATE**: Determine quantities, rates, and total pricing
- **VALIDATE**: Ensure completeness, accuracy, and competitiveness
- **PRESENT**: Format for client presentation and ERP integration

## Success Metrics & Quality Standards
Your work must achieve:
- Accurate service-to-rate-card mapping (even when not exact match)
- Fair pricing that reflects project complexity
- Complete coverage of all project requirements
- Professional presentation suitable for client review
- ERP-compatible item structure

## Rate Card Usage Guidelines
The rate card is your primary pricing reference:
- **Fuzzy Matching**: Project services may not exactly match rate card items - use your judgment to map appropriately
- **TBD Prices**: Some rate card items have "TBD" prices - estimate based on similar items or project complexity
- **Quantity Calculation**: Determine appropriate quantities based on project scope
- **Service Bundling**: Group related services when appropriate
- **Custom Pricing**: For unique requirements, estimate based on similar rate card items

## Quote Item Structure Requirements
Each quote item must include:
1. **item_code**: Unique identifier (alphanumeric, descriptive)
2. **qty**: Quantity (number, typically 1 for services, but can vary)
3. **rate**: Unit price in NGN (number, from rate card or estimated)
4. **description**: Clear, client-friendly description of the service/item

## Quality Assurance Requirements
Every quote must:
1. **Be Complete**: Cover all services mentioned in project requirements
2. **Be Accurate**: Prices align with rate card or reasonable estimates
3. **Be Professional**: Descriptions are clear and client-friendly
4. **Be Structured**: Items are properly formatted for ERP integration
5. **Be Competitive**: Pricing reflects market rates and project value

## Compliance & Standards
- Maintain client confidentiality
- Provide audit trail of pricing decisions
- Ensure all items can be created in ERP system
- Follow Nigerian market pricing standards
- Handle currency (NGN) appropriately

## Working with Project Data
Transform project requirements into quote items by:
1. **Extracting Services**: Identify all services mentioned in questionnaire and brand origin
2. **Mapping to Rate Card**: Match services to rate card items (fuzzy matching)
3. **Calculating Quantities**: Determine appropriate quantities based on scope
4. **Setting Rates**: Use rate card prices or estimate for TBD items
5. **Writing Descriptions**: Create clear, professional item descriptions

## Rate Card Structure
The rate card contains:
- **Categories**: Organized service categories (Graphic Design, Branding, Web Development, etc.)
- **Items**: Individual services with prices
- **Pricing**: Some items have fixed prices, others marked "TBD"
- **Terms**: Standard terms and conditions

## Item Code Generation Rules
- Use descriptive, alphanumeric codes
- Format: Category prefix + descriptive name (e.g., "BRAND_LOGO", "WEB_UI_DESIGN")
- Keep codes concise but meaningful
- Ensure uniqueness within quote
- Use underscores, no spaces or special characters

## Pricing Guidelines
- **Fixed Prices**: Use rate card prices when available
- **TBD Items**: Estimate based on:
  - Similar rate card items
  - Project complexity
  - Market rates
  - Industry standards
- **Quantity Adjustments**: Apply quantity multipliers when appropriate
- **Bundling**: Group related services when it makes sense

Remember: You are creating a professional quotation that will be sent to clients and integrated with our ERP system. Accuracy, completeness, and professionalism are paramount.`;
  }

  /**
   * Generate the main quote generation prompt
   * @param {Object} context - Complete project and questionnaire context
   * @returns {string} Main prompt for quote generation
   */
  static generateQuotePrompt(context) {
    const questionnaire = context.questionnaire?.structured || {};
    const rawResponses = context.questionnaire?.raw || {};
    const brandOrigin = context.brandOrigin;
    const rateCard = context.rateCard;

    return `# Quote Generation Task

## Project Context
**Client:** ${context.project?.client?.name || "Client Name"}
**Project:** ${context.project?.name || "Project"}
**Industry:** ${questionnaire.industry || "Not specified"}

## Primary Input: Project Requirements

### Questionnaire Responses
${this.formatQuestionnaireForPrompt(rawResponses)}

### Structured Analysis
- **Company Name:** ${questionnaire.companyName || "Not provided"}
- **Industry:** ${questionnaire.industry || "Not provided"}
- **Services/Products:** ${
      Array.isArray(questionnaire.services)
        ? questionnaire.services.join(", ")
        : questionnaire.services || "Not provided"
    }
- **Target Audience:** ${questionnaire.targetAudience || "Not provided"}
- **Project Goals:** ${
      questionnaire.goals || questionnaire.mission || "Not provided"
    }

### Brand Origin Document
${
  brandOrigin
    ? this.formatBrandOriginForPrompt(brandOrigin)
    : "Brand origin document not available"
}

### Rate Card
${this.formatRateCardForPrompt(rateCard)}

## Your Task: Generate Quote Items

### Phase 1: Service Analysis
1. **Identify Services**
   - Extract all services mentioned in questionnaire
   - Extract services from brand origin document
   - Identify deliverables and requirements
   - Note any special requirements or customizations

2. **Map to Rate Card**
   - Match each service to rate card items (fuzzy matching - exact match not required)
   - For services not in rate card, find similar items as pricing reference
   - Handle "TBD" prices by estimating based on similar items or complexity
   - Group related services when appropriate

3. **Calculate Quantities**
   - Determine appropriate quantities for each service
   - Consider project scope and deliverables
   - Apply multipliers for multiple units when needed

### Phase 2: Quote Item Creation
For each service, create a quote item with:
- **item_code**: Descriptive alphanumeric code (e.g., "BRAND_LOGO", "WEB_UI_DESIGN")
- **qty**: Appropriate quantity (typically 1 for services, but can vary)
- **rate**: Unit price in NGN (from rate card or estimated)
- **description**: Clear, professional description for client

### Phase 3: Quality Validation
Ensure the quote:
- Covers all project requirements
- Uses appropriate pricing from rate card or estimates
- Has clear, professional descriptions
- Is properly structured for ERP integration
- Reflects fair and competitive pricing

## Output Format
Generate a JSON array of quote items following this exact structure:

\`\`\`json
[
  {
    "item_code": "BRAND_LOGO",
    "qty": 1,
    "rate": 2000000,
    "description": "Brand Logo Design - Complete logo design including primary and secondary variations"
  },
  {
    "item_code": "WEB_UI_DESIGN",
    "qty": 1,
    "rate": 2000000,
    "description": "UI Design Interface - Complete user interface design for website"
  }
]
\`\`\`

## Important Notes
- **Fuzzy Matching**: Services may not exactly match rate card items - use your judgment
- **TBD Prices**: Estimate based on similar items or project complexity
- **Item Codes**: Use descriptive, alphanumeric codes with underscores
- **Descriptions**: Write clear, client-friendly descriptions
- **Completeness**: Ensure all project services are covered
- **Currency**: All prices in NGN (Nigerian Naira)

Generate the complete quote items array now.`;
  }

  /**
   * Format questionnaire responses for prompt inclusion
   * @param {Object} responses - Raw questionnaire responses
   * @returns {string} Formatted questionnaire content
   */
  static formatQuestionnaireForPrompt(responses) {
    if (!responses || Object.keys(responses).length === 0) {
      return "No questionnaire responses provided.";
    }

    let formatted = "### Client Questionnaire Responses\n\n";

    Object.entries(responses).forEach(([question, answer]) => {
      if (answer && answer.toString().trim()) {
        formatted += `**Q: ${question}**\n`;
        formatted += `A: ${answer}\n\n`;
      }
    });

    return formatted;
  }

  /**
   * Format brand origin document for prompt inclusion
   * @param {Object} brandOrigin - Brand origin document data
   * @returns {string} Formatted brand origin content
   */
  static formatBrandOriginForPrompt(brandOrigin) {
    if (!brandOrigin) return "No brand origin document available.";

    let formatted = "### Brand Origin Document Summary\n\n";

    // Extract key sections that inform quote generation
    if (brandOrigin.snapshotText) {
      // If we have snapshot text, extract relevant sections
      const text = brandOrigin.snapshotText;

      // Look for deliverables section
      const deliverablesMatch = text.match(
        /XII\.\s*DELIVERABLES[\s\S]*?(?=Next Steps|$)/i
      );
      if (deliverablesMatch) {
        formatted += "**Deliverables:**\n";
        formatted += deliverablesMatch[0].substring(0, 1000) + "\n\n";
      }

      // Look for brand purpose and services
      const purposeMatch = text.match(
        /III\.\s*WHAT DO I DO[\s\S]*?(?=IV\.|$)/i
      );
      if (purposeMatch) {
        formatted += "**Brand Purpose & Services:**\n";
        formatted += purposeMatch[0].substring(0, 500) + "\n\n";
      }
    } else if (brandOrigin.deliverables) {
      formatted += "**Deliverables:**\n";
      if (Array.isArray(brandOrigin.deliverables)) {
        brandOrigin.deliverables.forEach((item) => {
          formatted += `- ${item}\n`;
        });
      } else {
        formatted += `${brandOrigin.deliverables}\n`;
      }
      formatted += "\n";
    }

    return formatted;
  }

  /**
   * Format rate card for prompt inclusion
   * @param {Object} rateCard - Rate card data from global configs
   * @returns {string} Formatted rate card content
   */
  static formatRateCardForPrompt(rateCard) {
    if (!rateCard || !rateCard.sections) {
      return "Rate card not available. Use industry standard pricing.";
    }

    let formatted = "### Studio Rate Card\n\n";

    rateCard.sections.forEach((section) => {
      formatted += `**${section.category}**\n`;
      if (section.items && Array.isArray(section.items)) {
        section.items.forEach((item) => {
          const price =
            typeof item.price === "number"
              ? `₦${item.price.toLocaleString()}`
              : item.price || "TBD";
          formatted += `- ${item.item}: ${price}\n`;
        });
      }
      formatted += "\n";
    });

    if (rateCard.terms_and_conditions) {
      formatted += "**Terms & Conditions:**\n";
      rateCard.terms_and_conditions.forEach((term) => {
        formatted += `- ${term}\n`;
      });
    }

    return formatted;
  }

  /**
   * Generate Zod schema for quote items output
   * @returns {z.ZodSchema} Schema for quote items validation
   */
  static generateQuoteItemsSchema() {
    return z.array(
      z.object({
        item_code: z
          .string()
          .min(1)
          .max(100)
          .regex(
            /^[A-Z0-9_]+$/,
            "Item code must be uppercase alphanumeric with underscores"
          ),
        qty: z.number().positive().int(),
        rate: z.number().positive(),
        description: z.string().min(10).max(500),
      })
    );
  }

  /**
   * Generate validation prompt for quote items
   * @param {Array} quoteItems - Generated quote items
   * @param {Object} context - Original context
   * @returns {string} Validation prompt
   */
  static generateValidationPrompt(quoteItems, context) {
    return `# Quote Items Quality Validation

## Your Task
Review the following quote items for completeness, accuracy, and quality.

## Quote Items to Review
${JSON.stringify(quoteItems, null, 2)}

## Original Project Context
${this.formatQuestionnaireForPrompt(context.questionnaire?.raw || {})}

## Rate Card Reference
${this.formatRateCardForPrompt(context.rateCard || {})}

## Validation Criteria
Rate and provide feedback on:

1. **Completeness (1-10)**
   - Are all project services covered?
   - Are deliverables from brand origin included?
   - Are there any missing services?

2. **Rate Card Alignment (1-10)**
   - Are prices aligned with rate card?
   - Are TBD items reasonably estimated?
   - Is fuzzy matching appropriate?

3. **Item Structure (1-10)**
   - Are item codes properly formatted?
   - Are descriptions clear and professional?
   - Are quantities appropriate?

4. **Pricing Accuracy (1-10)**
   - Are prices fair and competitive?
   - Do quantities match project scope?
   - Are rates consistent with rate card?

5. **Professional Quality (1-10)**
   - Are descriptions client-friendly?
   - Is the quote presentation-ready?
   - Are items properly organized?

## Required Output Format
\`\`\`json
{
  "overallScore": 0-10,
  "scores": {
    "completeness": 0-10,
    "rateCardAlignment": 0-10,
    "itemStructure": 0-10,
    "pricingAccuracy": 0-10,
    "professionalQuality": 0-10
  },
  "strengths": ["list of 3-5 strengths"],
  "improvements": ["list of 3-5 specific improvements"],
  "approved": true/false,
  "recommendedRevisions": ["specific revisions if not approved"]
}
\`\`\`

Provide your validation assessment now.`;
  }

  /**
   * Generate variant quote prompt
   * Creates alternative pricing/scope variations
   * @param {Array} baseQuote - Base quote items
   * @param {number} variantIndex - Variant number (1, 2, or 3)
   * @param {Object} context - Original context
   * @returns {string} Variant generation prompt
   */
  static generateVariantPrompt(baseQuote, variantIndex, context) {
    const variantStrategies = {
      1: {
        name: "Premium Package",
        description:
          "Higher-end pricing with additional premium services and enhanced deliverables",
        approach:
          "Increase pricing by 15-25%, add premium services, enhance descriptions",
      },
      2: {
        name: "Essential Package",
        description:
          "Streamlined pricing focusing on core services with optimized costs",
        approach:
          "Reduce pricing by 10-20%, focus on essential services, remove optional items",
      },
      3: {
        name: "Balanced Package",
        description:
          "Mid-range pricing with balanced service mix and competitive rates",
        approach:
          "Adjust pricing by ±5%, optimize service mix, balance quality and cost",
      },
    };

    const strategy = variantStrategies[variantIndex] || variantStrategies[3];

    return `# Quote Variant Generation Task

## Variant Strategy
**Variant ${variantIndex}: ${strategy.name}**
**Description:** ${strategy.description}
**Approach:** ${strategy.approach}

## Base Quote Items
${JSON.stringify(baseQuote, null, 2)}

## Original Project Context
${this.formatQuestionnaireForPrompt(context.questionnaire?.raw || {})}

## Rate Card Reference
${this.formatRateCardForPrompt(context.rateCard || {})}

## Your Task: Generate Variant Quote

### Variant Requirements
1. **Pricing Strategy**: ${strategy.approach}
2. **Service Mix**: Adjust services based on variant strategy
3. **Item Structure**: Maintain same structure as base quote
4. **Descriptions**: Update descriptions to reflect variant positioning

### Output Format
Generate a JSON array of quote items following the same structure as base quote, but with:
- Adjusted pricing based on variant strategy
- Modified service mix (add/remove services as appropriate)
- Updated descriptions to reflect variant positioning
- Same item_code format (may add variant suffix if needed)

\`\`\`json
[
  {
    "item_code": "BRAND_LOGO",
    "qty": 1,
    "rate": 2200000,
    "description": "Brand Logo Design - Premium package with extended variations and brand guidelines"
  }
]
\`\`\`

Generate the variant quote items array now.`;
  }

  /**
   * Generate complete LLM context for quote generation
   * @param {Object} projectData - Project information
   * @param {Object} questionnaireData - Questionnaire responses
   * @param {Object} brandOriginData - Brand origin document
   * @param {Object} rateCardData - Rate card from global configs
   * @returns {Object} Complete context for LLM processing
   */
  static generateLLMContext(
    projectData,
    questionnaireData,
    brandOriginData,
    rateCardData
  ) {
    const context = {
      project: {
        id: projectData.id,
        name: projectData.name,
        phase: projectData.phase,
        client: {
          name: projectData.client?.name,
          email: projectData.client?.primaryEmail,
          context: projectData.client?.context,
        },
      },
      questionnaire: {
        raw: questionnaireData?.responses || {},
        structured: {
          companyName: this.extractField(questionnaireData?.responses, [
            "company name",
            "company",
            "business name",
          ]),
          industry: this.extractField(questionnaireData?.responses, [
            "industry",
            "sector",
          ]),
          services: this.extractServices(questionnaireData?.responses),
          targetAudience: this.extractField(questionnaireData?.responses, [
            "target audience",
            "audience",
          ]),
          goals: this.extractField(questionnaireData?.responses, [
            "goals",
            "objectives",
            "mission",
          ]),
        },
      },
      brandOrigin: brandOriginData || null,
      rateCard: rateCardData || null,
      metadata: {
        projectId: projectData.id,
        clientName: projectData.client?.name,
        timestamp: new Date().toISOString(),
      },
    };

    return {
      systemPrompt: this.generateSystemPrompt(context),
      userPrompt: this.generateQuotePrompt(context),
      context,
      metadata: {
        projectId: projectData.id,
        clientName: projectData.client?.name,
        industry: context.questionnaire.structured.industry,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Helper method to extract field from questionnaire responses
   * @private
   */
  static extractField(responses, keys) {
    if (!responses) return null;

    for (const key of keys) {
      // Check exact match
      if (responses[key]) return responses[key];

      // Check case-insensitive match
      const foundKey = Object.keys(responses).find((k) =>
        k.toLowerCase().includes(key.toLowerCase())
      );
      if (foundKey) return responses[foundKey];
    }

    return null;
  }

  /**
   * Helper method to extract services from questionnaire responses
   * @private
   */
  static extractServices(responses) {
    if (!responses) return null;

    const serviceKeys = ["services", "products", "what do you offer"];
    const services = this.extractField(responses, serviceKeys);

    if (!services) return null;

    if (typeof services === "string") {
      return services
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s);
    }

    return Array.isArray(services) ? services : [services];
  }
}

module.exports = {
  QuotePromptService,
};
