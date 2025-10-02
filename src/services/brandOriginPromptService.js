const { createLogger } = require("@/utils/logger");
const {
  BrandOriginContextService,
} = require("@/services/brandOriginContextService");

const logger = createLogger("service:brand-origin-prompt");

/**
 * BrandOriginPromptService handles sophisticated prompt engineering for brand origin document generation
 * Following best practices from Anthropic's agent building guide and example system prompts
 */
class BrandOriginPromptService {
  /**
   * Generate comprehensive system prompt for brand origin document creation
   * Following the Anthropic pattern: role → capabilities → guidelines → examples → constraints
   * @param {Object} context - Complete context for brand origin generation
   * @returns {string} Comprehensive system prompt
   */
  static generateSystemPrompt(context) {
    const currentDate = new Date().toISOString().split("T")[0];

    return `# Brand Origin Document Generation Agent

## Role & Identity
You are an expert Brand Strategist and Creative Director for Levitate Studios, a premium creative agency based in Nigeria. You specialize in transforming client questionnaires into comprehensive, actionable brand origin documents that serve as the foundation for all creative work.

## Current Context
- Date: ${currentDate}
- Agency: Levitate Studios (Logo Design, Web Design, Digital Marketing, Brand Design, Publications, Video Production, Motion Design, Packaging, Advertising)
- Project: ${context.project?.name || "Brand Origin Development"}
- Client: ${context.project?.client?.name || "Client"}
- Phase: Brand Origin Document Creation

## Core Methodology: BRICS Framework
Levitate Studios follows the BRICS methodology: **BRIEF, RESEARCH, INSPIRATION, CREATE, SHARE**
- BRIEF: Extract and understand client requirements
- RESEARCH: Analyze industry, audience, and competitive landscape  
- INSPIRATION: Draw from relevant examples and creative references
- CREATE: Synthesize insights into actionable brand strategy
- SHARE: Present findings in clear, implementable format

## Success Metrics & Quality Standards
Your work must achieve:
- 80-90% reduction in creative brief-to-execution time
- 80% increase in first-draft approval rates
- Minimal revision cycles through clarity and precision
- Enhanced creative velocity for implementation teams
- Superior client satisfaction through strategic insight

## Brand Origin Document Structure
Create a comprehensive document following this exact 12-section structure:

### I. WHO AM I?
Define the brand's core identity and essence in 2-3 sentences. This is the brand's fundamental nature.

### II. WHERE DO I COME FROM?
Establish the brand's origin story, founding motivation, and cultural/market context.

### III. WHAT DO I DO – BRAND PURPOSE
Articulate the brand's reason for existence and value delivery in one clear statement.

### IV. WHO AM I FOR – TARGET AUDIENCE
Define primary and secondary audiences with demographics, psychographics, and behavioral insights.

### V. WHAT DO I WANT TO BECOME – VISION
Paint the aspirational future state and long-term positioning goals.

### VI. KEY INSIGHTS
Capture founder's perspective and business perspective that drive strategic decisions.

### VII. SINGLE-MINDED MESSAGE
Distill the brand into one powerful, memorable tagline or core message.

### VIII. POSITIONING / COPY STRATEGY
Detail the key promise and tone of voice for all communications.

### IX. BRAND REWARDS
Define functional, sensory, and emotional benefits the brand delivers.

### X. BRAND PERSONALITY & DELIVERY TONE
Specify personality traits and narrative guidance for content creation.

### XI. MANDATORIES / MUST-NOT'S
List essential brand requirements and explicit restrictions.

### XII. DELIVERABLES
Outline specific creative outputs and their strategic rationale.

## Industry Expertise & Cultural Context
- Deep understanding of Nigerian and West African market dynamics
- Expertise across healthcare, real estate, fashion, technology, and service industries
- Cultural sensitivity and authentic African brand development
- Global market awareness with local relevance
- Premium positioning and luxury brand development experience

## Quality Assurance Requirements
Every brand origin document must:
1. **Be strategically sound**: Grounded in market reality and competitive analysis
2. **Be culturally authentic**: Reflect genuine Nigerian/African values when relevant
3. **Be actionable**: Provide clear guidance for creative execution
4. **Be differentiated**: Establish unique positioning in the market
5. **Be commercially viable**: Support business objectives and growth
6. **Be emotionally resonant**: Connect with target audience values and aspirations

## Compliance & Standards
- NDPR-compliant data handling
- Maintain client confidentiality
- Provide audit trail of reasoning
- Meet international brand strategy standards
- Ensure cultural appropriateness and sensitivity

## Working with Questionnaire Data
Transform questionnaire responses into strategic insights by:
1. **Extracting core business information**: Company, industry, services, goals
2. **Identifying audience insights**: Demographics, psychographics, pain points
3. **Understanding brand aspirations**: Vision, values, positioning goals
4. **Recognizing market context**: Competition, opportunities, challenges
5. **Synthesizing strategic direction**: Unique value proposition and positioning

## Creative Excellence Standards
Your brand strategy must enable creative teams to:
- Develop distinctive visual identity systems
- Create compelling content strategies
- Design user experiences that convert
- Build cohesive brand communications
- Execute campaigns that deliver measurable results

Remember: You are not just creating a document—you are laying the strategic foundation for a brand that will compete in global markets while remaining authentically rooted in its origins.`;
  }

  /**
   * Generate the main planning prompt for brand origin creation
   * Following structured planning → execution → validation workflow
   * @param {Object} context - Complete project and questionnaire context
   * @returns {string} Main prompt for brand origin generation
   */
  static generateBrandOriginPrompt(context) {
    const questionnaire = context.questionnaire?.structured || {};
    const rawResponses = context.questionnaire?.raw || {};
    const relevantExample = context.relevantExample;

    return `# Brand Origin Document Generation Task

## Project Context
**Client:** ${context.project?.client?.name || "Client Name"}
**Project:** ${context.project?.name || "Brand Development Project"}
**Industry:** ${questionnaire.industry || "Not specified"}

## Primary Input: Client Questionnaire Responses
${this.formatQuestionnaireForPrompt(rawResponses)}

## Structured Analysis
- **Company Name:** ${questionnaire.companyName || "Not provided"}
- **Industry:** ${questionnaire.industry || "Not provided"}
- **Services/Products:** ${
      Array.isArray(questionnaire.services)
        ? questionnaire.services.join(", ")
        : questionnaire.services || "Not provided"
    }
- **Target Audience:** ${questionnaire.targetAudience || "Not provided"}
- **Mission/Goals:** ${
      questionnaire.mission || questionnaire.goals || "Not provided"
    }

## Additional Client Context
${
  context.project?.client?.context
    ? `Client Background: ${context.project?.client?.context}`
    : "No additional client context provided"
}

## Reference Example (Similar Industry/Type)
${
  relevantExample
    ? this.formatExampleForPrompt(relevantExample)
    : "No specific industry example available"
}

## Your Task: Create a Comprehensive Brand Origin Document

Follow this structured approach:

### Phase 1: Strategic Analysis (Plan)
1. **Market Positioning Analysis**
   - Analyze the client's industry landscape
   - Identify competitive positioning opportunities
   - Determine unique value propositions

2. **Audience Profiling**
   - Define primary and secondary audiences
   - Develop psychographic profiles
   - Identify emotional and functional needs

3. **Brand Architecture Planning**
   - Core brand essence and personality
   - Brand promise and positioning
   - Key differentiators and advantages

### Phase 2: Brand Origin Creation (Execute)
Create each of the 12 sections with:
- Strategic depth and insight
- Cultural and market relevance
- Clear, actionable guidance
- Professional tone and clarity

### Phase 3: Quality Validation (Verify)
Ensure the document:
- Addresses all questionnaire inputs
- Provides actionable creative direction
- Maintains strategic coherence
- Delivers commercial viability

## Deliverable Requirements
Generate a complete Brand Origin Document that:
1. **Starts with client name and document title**
2. **Follows the exact 12-section structure**
3. **Incorporates all relevant questionnaire insights**
4. **Provides specific, actionable guidance for creative teams**
5. **Maintains professional brand strategy standards**
6. **Reflects cultural authenticity where appropriate**

## Quality Standards
- Minimum 2,000 words total length
- Each section substantively developed (not placeholder text)
- Strategic depth appropriate for premium creative agency
- Clear connection between questionnaire inputs and brand strategy
- Professional formatting and presentation

## Output Format
Present as a properly formatted brand origin document with:
- Clear section headers (I., II., III., etc.)
- Professional table formatting where appropriate
- Detailed deliverables section with specific creative outputs
- Next steps for implementation

Begin with: "| Client: [Client Name] | Doc: **Brand Origins / Creative Brief** |"

Generate the complete brand origin document now.`;
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
   * Format example for prompt inclusion
   * @param {Object} example - Example questionnaire and brand origin
   * @returns {string} Formatted example content
   */
  static formatExampleForPrompt(example) {
    if (!example) return "No example available.";

    let formatted = "### Reference Example\n\n";

    if (example.questionnaire) {
      formatted += "**Example Questionnaire Insights:**\n";
      formatted += `- Company: ${example.questionnaire.companyName}\n`;
      formatted += `- Industry: ${example.questionnaire.industry}\n`;
      formatted += `- Mission: ${example.questionnaire.mission}\n`;
      formatted += `- Target Audience: ${JSON.stringify(
        example.questionnaire.targetAudience
      )}\n\n`;
    }

    if (example.brandOrigin) {
      formatted += "**Example Brand Origin Structure:**\n";
      formatted += `- Who Am I: ${example.brandOrigin.whoAmI?.substring(
        0,
        200
      )}...\n`;
      formatted += `- Brand Purpose: ${example.brandOrigin.brandPurpose}\n`;
      formatted += `- Vision: ${example.brandOrigin.vision}\n`;
      formatted += `- Single-Minded Message: ${example.brandOrigin.singleMindedMessage}\n\n`;
    }

    return formatted;
  }

  /**
   * Generate follow-up validation prompt for quality checking
   * @param {string} generatedDocument - The generated brand origin document
   * @param {Object} context - Original context
   * @returns {string} Validation prompt
   */
  static generateValidationPrompt(generatedDocument, context) {
    return `# Brand Origin Document Quality Validation

## Your Task
Review the following brand origin document for quality, completeness, and strategic soundness.

## Document to Review
${generatedDocument}

## Original Questionnaire Context
${this.formatQuestionnaireForPrompt(context.questionnaire?.raw || {})}

## Validation Criteria
Rate and provide feedback on:

1. **Strategic Coherence (1-10)**
   - Does the strategy make business sense?
   - Are all sections aligned and consistent?
   - Is positioning differentiated and defensible?

2. **Questionnaire Integration (1-10)**
   - Are client inputs properly reflected?
   - Have key requirements been addressed?
   - Are client goals and vision captured?

3. **Creative Actionability (1-10)**
   - Can creative teams execute from this brief?
   - Are guidelines specific enough?
   - Is visual direction clear?

4. **Market Relevance (1-10)**
   - Is positioning market-appropriate?
   - Does it reflect industry understanding?
   - Are competitive advantages realistic?

5. **Cultural Authenticity (1-10)**
   - Is cultural context appropriate?
   - Does it respect local market dynamics?
   - Is tone and approach suitable?

## Required Output Format
\`\`\`json
{
  "overallScore": 0-10,
  "scores": {
    "strategicCoherence": 0-10,
    "questionnaireIntegration": 0-10,
    "creativeActionability": 0-10,
    "marketRelevance": 0-10,
    "culturalAuthenticity": 0-10
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
   * Generate complete LLM context for brand origin generation
   * @param {Object} projectData - Project information
   * @param {Object} questionnaireData - Questionnaire responses
   * @returns {Object} Complete context for LLM processing
   */
  static generateLLMContext(projectData, questionnaireData) {
    const context = BrandOriginContextService.getBrandOriginContext(
      projectData,
      questionnaireData
    );

    return {
      systemPrompt: this.generateSystemPrompt(context),
      userPrompt: this.generateBrandOriginPrompt(context),
      context,
      metadata: {
        projectId: projectData.id,
        clientName: projectData.client?.name,
        industry: context.questionnaire?.structured?.industry,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Generate refinement prompt for iterative improvement
   * @param {string} currentDocument - Current brand origin document
   * @param {Array} feedback - Feedback points for improvement
   * @param {Object} context - Original context
   * @returns {string} Refinement prompt
   */
  static generateRefinementPrompt(currentDocument, feedback, context) {
    return `# Brand Origin Document Refinement

## Current Document
${currentDocument}

## Feedback for Improvement
${feedback.map((item, index) => `${index + 1}. ${item}`).join("\n")}

## Original Context (for reference)
${this.formatQuestionnaireForPrompt(context.questionnaire?.raw || {})}

## Your Task
Refine the brand origin document based on the feedback provided. Maintain the overall structure and quality while addressing specific improvement points.

## Requirements
- Keep the 12-section structure intact
- Address each feedback point specifically
- Maintain strategic coherence
- Improve clarity and actionability
- Preserve approved elements

Generate the refined brand origin document now.`;
  }
}

module.exports = {
  BrandOriginPromptService,
};
