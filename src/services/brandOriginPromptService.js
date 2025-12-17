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
- Clear section headers using Roman numerals (I., II., III., etc.) in ALL CAPS
- Each section header on its own line followed by content
- Use bullet points (- or •) for lists within sections
- Use numbered lists (1., 2., 3.) for deliverables and next steps
- Professional and clean structure throughout
- No markdown formatting (**, *, etc.) - use plain text

## Document Structure Requirements
1. **Do NOT include** the header table (Client: | Doc:) - this will be added automatically
2. **Start directly** with the first section: "I. WHO AM I?"
3. **Section headers** must be exactly: "I. WHO AM I?", "II. WHERE DO I COME FROM?", etc.
4. **Use consistent formatting** throughout all sections
5. **End with** a "Next Steps" section using numbered lists

## Example Section Format:

I. WHO AM I?

[Content paragraph describing the brand identity...]

II. WHERE DO I COME FROM?

[Content paragraph describing brand origins...]

VI. KEY INSIGHTS

- Founders' Perspective: [insight text]
- Business Perspective: [insight text]

XII. DELIVERABLES

1. Social Media Strategy
2. Campaign Concept Playbook
3. Engagement Guidelines

Next Steps

1. Review and approve this Brand Origins document
2. Confirm deliverables and timelines
3. Sign off. Paymoney!

Generate the complete brand origin document now following this exact format.`;
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
      formatted += `- Who Am I: ${example.brandOrigin.whoAmI}...\n`;
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
   * @param {Object} feedbackContext - Optional feedback context for regeneration
   * @returns {Object} Complete context for LLM processing
   */
  static generateLLMContext(
    projectData,
    questionnaireData,
    feedbackContext = null
  ) {
    const context = BrandOriginContextService.getBrandOriginContext(
      projectData,
      questionnaireData
    );

    // Add feedback context if this is a regeneration
    if (feedbackContext) {
      context.feedbackContext = feedbackContext;
    }

    return {
      systemPrompt: this.generateSystemPrompt(context),
      userPrompt: feedbackContext
        ? this.generateBrandOriginRegenerationPrompt(context, feedbackContext)
        : this.generateBrandOriginPrompt(context),
      context,
      metadata: {
        projectId: projectData.id,
        clientName: projectData.client?.name,
        industry: context.questionnaire?.structured?.industry,
        isRegeneration: !!feedbackContext,
        feedbackEmailId: feedbackContext?.emailId,
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

  /**
   * Generate brand origin regeneration prompt incorporating client feedback
   * @param {Object} context - Complete project context
   * @param {Object} feedbackContext - Client feedback context from intent detection
   * @returns {string} Regeneration prompt with feedback integration
   */
  static generateBrandOriginRegenerationPrompt(context, feedbackContext) {
    const questionnaire = context.questionnaire?.structured || {};
    const rawResponses = context.questionnaire?.raw || {};
    const relevantExample = context.relevantExample;
    const intentResult = feedbackContext.intentResult || {};
    // Handle both email intent detection (has intentResult) and UI regeneration (only feedbackContext.feedback)
    const feedbackSummary = intentResult.summary || feedbackContext.feedback || "No summary available";

    return `# Brand Origin Document Regeneration Task

## Project Context
**Client:** ${context.project?.client?.name || "Client Name"}
**Project:** ${context.project?.name || "Brand Development Project"}
**Industry:** ${questionnaire.industry || "Not specified"}
**Task Type:** Document Regeneration Based on Client Feedback

## Client Feedback Analysis
**Email Received:** ${new Date(
      feedbackContext.emailInfo?.receivedAt || Date.now()
    ).toLocaleDateString()}
**Client Sentiment:** ${intentResult.clientSentiment || "Not analyzed"}
**Feedback Urgency:** ${intentResult.urgency || "Not specified"}
**Confidence Level:** ${Math.round((intentResult.confidence || 0) * 100)}%

### Client's Feedback Summary
${feedbackSummary}

### Specific Requested Changes
${
  intentResult.requestedChanges && intentResult.requestedChanges.length > 0
    ? intentResult.requestedChanges
        .map(
          (change, index) =>
            `${index + 1}. **${
              change.section ? `[${change.section}]` : "[General]"
            }** ${change.change}
   - Priority: ${change.priority || "Not specified"}
   - Complexity: ${change.feasibility || "Not specified"}`
        )
        .join("\n")
    : "No specific changes requested"
}

### Document Type Analysis
${
  intentResult.documentTypeAnalysis
    ? `
**Structural Impact:** ${
        intentResult.documentTypeAnalysis.structuralImpact || "Not analyzed"
      }
**Sections Referenced:** ${
        intentResult.documentTypeAnalysis.sectionReferences?.join(", ") ||
        "None specified"
      }
**Compliance Check:** ${
        intentResult.documentTypeAnalysis.complianceCheck
          ? "Passed"
          : "Needs attention"
      }
**Implementation Notes:** ${
        intentResult.documentTypeAnalysis.implementationNotes || "None provided"
      }
`
    : "No document-specific analysis available"
}

## Original Document Content (Sent to Client)
${feedbackContext.originalDocumentContent || "Original content not available"}

## Primary Input: Client Questionnaire Responses (Reference)
${this.formatQuestionnaireForPrompt(rawResponses)}

## Structured Analysis (Reference)
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

## Additional Client Context (Reference)
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

## Your Task: Regenerate Brand Origin Document with Client Feedback

### Regeneration Approach

#### Phase 1: Feedback Integration Analysis
1. **Understand Client Intent**
   - Analyze the specific feedback and requested changes
   - Identify which sections need modification
   - Understand the underlying concerns or preferences

2. **Preserve Strategic Foundation**
   - Maintain the core brand strategy that works
   - Keep questionnaire-derived insights intact
   - Preserve successful elements from original document

3. **Strategic Modification Planning**
   - Plan how to incorporate feedback without compromising brand coherence
   - Identify dependencies between sections that need coordinated updates
   - Ensure modifications align with business objectives

#### Phase 2: Document Regeneration (Execute)
Create an enhanced Brand Origin Document that:
- **Addresses all specific client feedback points**
- **Maintains the 12-section structure integrity**
- **Preserves successful elements from the original**
- **Incorporates client preferences and concerns**
- **Enhances clarity and strategic direction**

#### Phase 3: Quality Validation (Verify)
Ensure the regenerated document:
- Successfully addresses all client feedback
- Maintains strategic coherence across all sections
- Provides clearer, more actionable guidance
- Delivers enhanced commercial viability
- Preserves cultural authenticity and market relevance

   ## Regeneration Requirements
   
   ### Feedback Integration Standards
   1. **Address Every Feedback Point**: Each requested change must be thoughtfully incorporated or explained
   2. **Maintain Brand Coherence**: Changes in one section must harmonize with all other sections
   3. **Enhance Clarity**: Use client feedback to improve overall document clarity and actionability
   4. **Preserve Strengths**: Keep successful elements that weren't criticized
   5. **Cultural Sensitivity**: Ensure modifications respect cultural context and market dynamics
   
   ### Document Enhancement Goals
   - **Improved Client Alignment**: Better reflect client vision and preferences
   - **Enhanced Actionability**: Provide clearer guidance for creative execution
   - **Stronger Strategic Foundation**: Build on feedback to create more robust strategy
   - **Better Market Positioning**: Incorporate client insights for stronger market relevance
   
   ### Levitate Studios Standards Compliance
   
   #### BRICS Methodology Integration
   Ensure the regenerated document maintains alignment with Levitate's BRICS framework:
   - **BRIEF**: Client feedback has been properly analyzed and understood
   - **RESEARCH**: Market insights and competitive analysis remain current and relevant
   - **INSPIRATION**: Creative references and examples support the updated strategy
   - **CREATE**: Strategic synthesis reflects both original insights and client feedback
   - **SHARE**: Final presentation is clear, implementable, and client-approved
   
   #### Success Metrics Alignment
   The regenerated document must support Levitate's success metrics:
   - **80-90% reduction** in creative brief-to-execution time through enhanced clarity
   - **80% increase** in first-draft approval rates by addressing client concerns upfront
   - **Minimal revision cycles** through comprehensive feedback integration
   - **Enhanced creative velocity** for implementation teams
   - **Superior client satisfaction** through responsive strategic refinement
   
   #### Compliance & Data Handling
   Maintain strict compliance standards:
   - **NDPR/GDPR Compliance**: Ensure all client data handling meets Nigerian Data Protection Regulation and GDPR standards
   - **Client Confidentiality**: Protect sensitive business information and strategic insights
   - **Audit Trail**: Provide clear reasoning for all strategic modifications
   - **Cultural Appropriateness**: Respect Nigerian/African cultural context and market dynamics
   
   #### Creative Execution Alignment
   Ensure recommendations align with Levitate's design philosophy:
   - **Premium Positioning**: Maintain high-end brand development standards
   - **Cultural Authenticity**: Preserve genuine African brand identity where relevant
   - **Global Competitiveness**: Enable brands to compete in international markets
   - **Commercial Viability**: Support measurable business growth and market success
   - **Creative Excellence**: Enable distinctive visual identity and compelling content strategies

## Output Format & Structure
Present as a complete, regenerated Brand Origin Document with:
- Clear section headers using Roman numerals (I., II., III., etc.) in ALL CAPS
- Each section header on its own line followed by enhanced content
- Integration of client feedback throughout relevant sections
- Professional formatting and clean structure
- No markdown formatting (**, *, etc.) - use plain text
- Improved clarity and strategic depth based on feedback

## Document Structure Requirements
1. **Do NOT include** the header table (Client: | Doc:) - this will be added automatically
2. **Start directly** with the first section: "I. WHO AM I?"
3. **Section headers** must be exactly:
   "I. WHO AM I?"
   "II. WHERE DO I COME FROM?"
   "III. BRAND PURPOSE"
   "IV. TARGET AUDIENCE"
   "V. BRAND VISION"
   "VI. KEY INSIGHTS"
   "VII. SINGLE-MINDED MESSAGE"
   "VIII. POSITIONING"
   "IX. BRAND VALUES"
   "X. BRAND PERSONALITY"
   "XI. BRAND VOICE"
   "XII. DELIVERABLES"
4. **Incorporate feedback** naturally within the appropriate sections
5. **End with** a "Next Steps" section reflecting the regeneration

## Quality Standards for Regeneration
- Minimum 2,500 words total length (enhanced from original)
- Each section substantively improved based on feedback
- Clear evidence of client feedback integration
- Enhanced strategic depth and market relevance
- Professional brand strategy standards maintained
- Improved actionability for creative teams

## Feedback Integration Examples:

If client requested "Make it more professional":
- Adjust tone throughout all sections
- Enhance business language and strategic depth
- Strengthen commercial positioning

If client requested "Focus more on B2B market":
- Revise Section IV (Target Audience) with B2B focus
- Adjust Section III (Brand Purpose) for B2B value delivery
- Update Section VIII (Positioning) for B2B messaging

If client requested "Add more detail to brand personality":
- Expand Section X with comprehensive personality traits
- Add specific behavioral guidelines
- Include tone of voice examples and applications

Generate the complete, enhanced Brand Origin Document now, thoughtfully incorporating all client feedback while maintaining strategic excellence.`;
  }
}

module.exports = {
  BrandOriginPromptService,
};
