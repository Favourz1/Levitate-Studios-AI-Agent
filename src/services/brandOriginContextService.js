const { createLogger } = require("@/utils/logger");
const path = require("path");
const fs = require("fs").promises;

const logger = createLogger("service:brand-origin-context");

/**
 * BrandOriginContextService manages example questionnaires and brand origin documents
 * to provide rich context for LLM-based brand origin document generation
 */
class BrandOriginContextService {
  /**
   * Example questionnaires with corresponding brand origin documents
   */
  static EXAMPLE_QUESTIONNAIRES = {
    serenara: {
      questionnaire: {
        companyName: "Serenara Hormone Clinic",
        industry: "Functional and Hormonal Wellness",
        socialMedia: {
          instagram: "@serene_midlifewellness",
          tiktok: "@yewande_hormone.peptides",
          note: "Nigeria-based pages coming soon",
        },
        mission:
          "We provide safe, effective, and affordable optimal wellness through the use of integrative and alternative therapies.",
        vision:
          "We are here to enable and allow the best healthiest self-care possible.",
        coreValues: "integrity, education, access, and healing",
        services: [
          "Hormone Testing & Optimization",
          "BHRT (Bioidentical Hormone Replacement Therapy)",
          "Lifestyle and Metabolic Health Coaching",
        ],
        timeline: "4-6 weeks",
        goals: {
          primary:
            "All of the above. The primary purpose of the website is to build brand awareness, generate leads through appointment requests and consultations, showcase a portfolio of wellness services, and provide informational content about treatments and the clinic's holistic approach.",
          keyActions:
            "Visitors to the site are encouraged to book an appointment, contact the clinic for more information, sign up for consultations or updates, explore the available services, and build trust by learning about the providers and their approach to care.",
          problemsToSolve:
            "The website should help attract new patients, simplify appointment booking, clearly explain services, build trust with potential clients, and reduce time spent answering common questions or frequently asked questions regarding clinic information and services.",
        },
        targetAudience: {
          demographics:
            "Women aged 30 to 60, Primarily based in Abuja, Lagos, and urban centers across Nigeria, Middle to upper income bracket, Educated professionals, entrepreneurs, or high-functioning caregivers (often balancing career, marriage, and motherhood)",
          psychographics:
            "Health-conscious but underserved by conventional care, Tired of feeling dismissed or misdiagnosed, Open to natural, evidence-based solutions, Seeking clarity, energy, symptom relief, and the ability to function at their best, Emotionally invested in self-improvement, longevity, and looking/feeling good",
        },
        desiredExperience:
          "We want visitors to have a seamless, luxurious, and informative experience, one that communicates comfort, trust, and professionalism from the start. It should feel like a personalized, high-end wellness journey with clear explanations of services, easy navigation, and straightforward calls to action.",
        competitors:
          "Referring to our current website Sereneiv.com, we like that it is clean, simple, and educational. However, we would like the new version to be more direct yet complete, with stronger emphasis on service sections, and a clearer visual flow. We admire competitor websites that are visually polished, make booking simple, clearly explain complex treatments in layman's terms, and reflect a premium brand.",
        content: "Yes we have existing content.",
        specialFeatures: [
          "Forms for intake and inquiries",
          "Booking system for scheduling appointments",
          "Live chat for quick questions or triage",
          "E-commerce for possible product or supplement purchases",
          "Multilingual support if needed in the future",
        ],
        additionalPages:
          "Yes, we'd like it to be like a blog to provide information on topics like hormone therapy, thyroid function, metabolic health, and weight loss. Services are currently laid out by condition or concern (e.g., hormone imbalance, thyroid, weight), and we'd like to keep that intuitive structure while enhancing it with more comprehensive and concise content.",
        brandGuidelines:
          "We are open to a full rebrand and would like a brand-new logo along with an updated color palette and typography that reflects our luxurious, holistic approach.",
        designStyle: "Modern, clean, feminine, slightly luxurious.",
        maintenance: "No, ongoing maintenance will not be needed at this time.",
        additionalInfo:
          "Yes—we want the website to reflect who we are and what we offer. It should express the comfort, expertise, and transformation we bring to our patients through personalized, integrative, and functional care. Our work goes beyond conventional medicine, we help people truly feel better in a way that's natural, modern, and deeply personal.",
      },
      brandOrigin: {
        whoAmI:
          "We are Serenara, your virtual partner in midlife vitality. We deliver compassionate, science-backed hormonal wellness for women (and men) navigating life transitions. Through integrative therapies, personal guidance, and full-circle convenience, we help you restore balance, energy, and the confidence to feel like yourself again. With roots in African culture and modern medicine, we make optimal health accessible and affirming.",
        whereDoIComeFrom:
          "Founded in Nigeria, Serenara emerged to serve the unmet needs of women aged 30–60 experiencing hormonal shifts. Frustrated by dismissive healthcare, they needed clarity and care that actually works. Serenara brings a new model: virtual, expert-led, deeply personal. Our cultural foundation embraces African aesthetics while reflecting global wellness sophistication.",
        brandPurpose:
          "Serenara provides personalized, virtual hormonal and metabolic wellness care that integrating science, empathy, and cultural relevance to help clients regain vitality and balance from the comfort of their homes.",
        targetAudience:
          "Serenara's core audience is composed of urban Nigerian women, 30–60 years old, mostly in Abuja and Lagos. They're educated professionals and caregivers balancing ambition and family. Psychographically, they're wellness-curious, often disillusioned by conventional care, and emotionally invested in self-betterment. These women are not just looking for treatment, they're seeking transformation.",
        vision:
          "To be the leading virtual wellness clinic in West Africa for hormone-based healing, trusted for its science, embraced for its heart.",
        keyInsights: {
          foundersperspective:
            "Driven by a desire to rewrite the midlife health story that empowers rather than dismisses.",
          businessPerspective:
            "A virtual-first, concierge-style model offers unmatched access, personalization, and scalability within underserved markets.",
        },
        singleMindedMessage: "Balance your hormones. Reclaim your life.",
        positioning: {
          keyPromise:
            "Serenara delivers expert, convenience, personal, precise, and empowering hormonal wellness",
          toneOfVoice:
            "Confident yet calming, educational without jargon, warm with a subtle clinical edge. It should feel like reassurance wrapped in expertise.",
        },
        brandRewards: {
          functional:
            "No-clinic appointments, shipped treatments, measurable relief",
          sensory: "Clean visuals, serene palettes, modern African elements",
          emotional: "Relief, hope, renewed confidence, inner calm",
        },
        brandPersonality: {
          adjectives: "Feminine, Grounded, Luxurious, Knowledgeable, Soothing",
          narrativeGuidance:
            "Speak with clarity and calm assurance. Avoid over-explaining. Affirm the user's wisdom in seeking help.",
        },
        mandatories: {
          musts: [
            "Use lotus/molecular/African motifs",
            "Keep tone warm yet intelligent",
            "Highlight digital ease, transformation",
          ],
          mustNots: [
            "Avoid clinical coldness or sterile design",
            "No overly playful or overly masculine aesthetics",
            "No cluttered or confusing UX",
          ],
        },
      },
    },

    fhemfel: {
      questionnaire: {
        companyName: "Fhemfel Homes",
        industry: "Real Estate",
        website: "Fhemfelhomes.com",
        mission:
          "To be a global real estate development company, distinctive for superior value delivery to our stakeholders: customers - private, corporate and institutional, investors and employees.",
        competitors: "Homes: Mshel, Paradise, Promiseland etc",
        vision:
          "To redefine the real estate landscape with modern property solutions for contemporary lifestyles",
        primaryGoals: "We have for the next three Months:2Billion naira",
        currentPositioning: "No idea",
        targetAudience: "21 - 70years",
        painPoints: "Trust",
        idealCustomer: "House buyers, Pensioners, or Investors",
        currentBrandIdentity: "Easily Spotted and Unique",
        brandStrategy: "There's some sort of content calendar",
        differentiation: "We deliver as promised",
        valueProposition: "Guaranteed impressive ROI",
        hasValueProposition: "No",
        wantsValueProposition: "Yes",
        strengths: [
          "Physical and virtual presence",
          "Customer Loyalty",
          "Varieties of Product",
          "Trustworthiness",
          "Dedicated Staffs",
        ],
        weaknesses: [
          "Low Turnaround time for some department",
          "Insufficient Staffing",
          "Low level of experience in certain cases",
        ],
        opportunities:
          "Construction of major and minor infrastructures(roads) in Abuja",
        threats:
          "Inconsistent Government Policies, Non flexible work mode, semi-skilled/experienced workers",
        marketingChannels:
          "Traditional and social media marketing, Social Medial Influencer, Live Appearance on Radio",
        bestContent: "Audio-visuals",
        audienceEngagement: "Interactive Videos, DMs, Q&A etc",
        creativeChallenges: "Typos in designs, Lack of team leadership",
        campaignProject: "No",
        expectedOutcomes:
          "Increased social media engagement, brand visibility and lead generation that leads to sales",
        decisionMakers: "Management team",
        additionalStakeholders: "None",
        timeline: "Yearly Financial Projection",
        additionalInfo: "None that I can think of",
      },
    },

    olode: {
      questionnaire: {
        companyName: "Olode & Thread",
        industry: "Fashion",
        mission:
          "To elevate African artistry and show that Africa can craft global luxury brands",
        vision:
          "To be the foremost African luxury house that licenses our ideology globally, opening concept stores in fashion capitals",
        coreValues:
          "Minimalist yet rooted in culture, intentional and enigmatic, shaping new narratives where Africa stands at the forefront of high fashion",
        targetAudience:
          "Culturally curious global citizens, tastemakers and aspirants aged 25-45, who value understated luxury and deeper stories behind what they wear",
      },
      brandOrigin: {
        whoAmI:
          "I am more than a fashion label. I am born from a passion to elevate African artistry, I exist to show that Africa can craft global luxury brands. I am minimalist yet rooted in culture, I am intentional and enigmatic, shaping a new narratives where Africa stands at the forefront of high fashion.",
        whereDoIComeFrom:
          "Olode & Thread was founded on a dream to prove that Africa can create world-class fashion houses. Inspired by the belief that no one can tell Africa's story better than Africans themselves, the brand set out to redefine perceptions. Drawing from rich traditions and blending them with global design sensibilities, we aim to embed Africa's voice deeply into the luxury conversation.",
        brandPurpose:
          "We exist to elevate authentic African clothing into the global luxury arena, crafting an ideology people want to belong to while owning our narrative through intentional, timeless design.",
        targetAudience:
          "We speak to culturally curious global citizens, tastemakers and aspirants aged 25-45, who value understated luxury and deeper stories behind what they wear. They seek brands that represent more than products and brands with philosophy and vision. They appreciate thoughtful design, are selective in their consumption, and are drawn to unique narratives that allow them to express identity and individuality.",
        vision:
          "To be the foremost African luxury house that licenses our ideology globally, opening concept stores in fashion capitals, and becoming the definitive collaborator for authentic African luxury.",
        keyInsights: {
          foundersperspective:
            "Success isn't fleeting fame but creating an ideology people are compelled to belong to.",
          businessPerspective:
            "Build a brand powerful enough to license globally and stand alongside the world's iconic maisons.",
        },
        singleMindedMessage:
          "Defining Africa's place in global luxury fashion. We are the meeting point of African heritage and timeless luxury",
        positioning: {
          keyPromise:
            "A new African style language - minimalist, authentic, aspirational.",
          toneOfVoice:
            "Confident, poetic, curated, occasionally enigmatic to spark intrigue.",
        },
        brandRewards: {
          functional:
            "Quality garments rooted in African heritage yet designed for global tastes.",
          sensory:
            "Textural richness, subtle nods to culture, minimalist elegance.",
          emotional:
            "Pride, belonging, being part of an ideology that redefines Africa's place in luxury.",
        },
        brandPersonality: {
          adjectives: "Refined, intentional, cultured, enigmatic, visionary",
          narrativeGuidance:
            "Speak with confidence and calm authority. Let visuals and words carry poetic weight. Invite curiosity rather than over explain.",
        },
        mandatories: {
          musts: [
            "Editorial, timeless imagery; avoid catalogue-style shots",
            "Subtle African cues over obvious symbols",
          ],
          mustNots: [
            "Be minimalist yet layered in meaning",
            "Never loud or gimmicky",
            "Avoid trend-chasing language",
          ],
        },
      },
    },
  };

  /**
   * Levitate Studios business insights for context
   */
  static LEVITATE_CONTEXT = {
    successMetrics: {
      timeReduction:
        "80–90% reduction in time from brief submission to workflow deployment",
      approvalRate: "80% increase in first-draft creative approval rate",
      revisions: "Reduced project revisions due to clearer interpretation",
      velocity:
        "Enhanced creative velocity across creative and/or embedded teams",
      satisfaction:
        "Improved stakeholder satisfaction on clarity and turnaround",
    },
    designPhilosophy: {
      approach:
        "Levitate believe in creative execution as a differentiator. Levitate doesn't just ideate; we deliver momentum through contextualized, strategic, and visually distinct executions that translate brand essence into market-relevant expressions.",
      methodology: "BRICS - BRIEF, RESEARCH, INSPIRATION, CREATE and SHARE",
    },
    desiredCapabilities: [
      "NLP for unstructured brief parsing",
      "Predictive suggestion of deliverables and timelines",
      "Context-aware ideation (e.g., headlines, visual prompts)",
      "Learning from past projects to improve outputs",
    ],
    complianceStandards: [
      "NDPR-compliant data handling and client confidentiality",
      "Basic audit trail for interactions and outputs",
      "Compliance with Nigeria's NDPR and EU GDPR where applicable",
    ],
    services: [
      "Logo design",
      "Web design",
      "Digital marketing",
      "Brand design",
      "Publications",
      "Video Production",
      "Motion Design",
      "Packaging design",
      "Advertising",
    ],
  };

  /**
   * Brand origin document structure template
   */
  static BRAND_ORIGIN_TEMPLATE = {
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
  };

  /**
   * Get all example questionnaires and brand origins for LLM context
   * @returns {Object} Comprehensive context for brand origin generation
   */
  static getExampleContext() {
    return {
      examples: this.EXAMPLE_QUESTIONNAIRES,
      levitateContext: this.LEVITATE_CONTEXT,
      template: this.BRAND_ORIGIN_TEMPLATE,
      guidelines: {
        structure: "Follow the 12-section brand origin structure",
        tone: "Professional, insightful, and brand-focused",
        approach:
          "Use questionnaire responses as primary input, supplement with industry knowledge",
        quality:
          "Ensure high-quality, actionable brand guidance that translates to creative execution",
      },
    };
  }

  /**
   * Get specific example based on industry or company type
   * @param {string} industry - Industry type to match
   * @param {string} companyType - Type of company (e.g., 'healthcare', 'real-estate', 'fashion')
   * @returns {Object|null} Most relevant example or null if no match
   */
  static getRelevantExample(industry, companyType) {
    const examples = this.EXAMPLE_QUESTIONNAIRES;

    // Map industries/types to examples
    const industryMapping = {
      healthcare: "serenara",
      wellness: "serenara",
      hormone: "serenara",
      medical: "serenara",
      clinic: "serenara",
      "real estate": "fhemfel",
      property: "fhemfel",
      "real-estate": "fhemfel",
      fashion: "olode",
      clothing: "olode",
      luxury: "olode",
      design: "olode",
    };

    const key =
      industryMapping[industry?.toLowerCase()] ||
      industryMapping[companyType?.toLowerCase()];

    if (key && examples[key]) {
      return examples[key];
    }

    // Return Serenara as default example (most comprehensive)
    return examples.serenara;
  }

  /**
   * Format questionnaire responses for LLM processing
   * @param {Object} questionnaireData - Raw questionnaire responses
   * @returns {Object} Formatted questionnaire data
   */
  static formatQuestionnaireForLLM(questionnaireData) {
    const responses = questionnaireData.responses || {};

    return {
      raw: responses,
      structured: {
        companyName: this.extractCompanyName(responses),
        industry: this.extractIndustry(responses),
        mission: this.extractMission(responses),
        services: this.extractServices(responses),
        targetAudience: this.extractTargetAudience(responses),
        goals: this.extractGoals(responses),
        brandAttributes: this.extractBrandAttributes(responses),
        challenges: this.extractChallenges(responses),
        timeline: this.extractTimeline(responses),
        additionalContext: this.extractAdditionalContext(responses),
      },
    };
  }

  /**
   * Helper methods to extract specific information from questionnaire responses
   */
  static extractCompanyName(responses) {
    const keys = [
      "What is your company name?",
      "Company name",
      "Company Name",
      "Business name",
      "Organization name",
    ];
    return this.findResponseByKeys(responses, keys);
  }

  static extractIndustry(responses) {
    const keys = ["Industry", "What industry are you in?", "Business sector"];
    return this.findResponseByKeys(responses, keys);
  }

  static extractMission(responses) {
    const keys = [
      "Mission",
      "company's mission",
      "mission statement",
      "What is your mission?",
    ];
    return this.findResponseByKeys(responses, keys);
  }

  static extractServices(responses) {
    const keys = ["services", "products", "What do you offer?", "key services"];
    const result = this.findResponseByKeys(responses, keys);
    if (typeof result === "string") {
      return result
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s);
    }
    return result;
  }

  static extractTargetAudience(responses) {
    const keys = [
      "target audience",
      "Who is your primary audience?",
      "customer demographics",
      "ideal customer",
    ];
    return this.findResponseByKeys(responses, keys);
  }

  static extractGoals(responses) {
    const keys = [
      "goals",
      "objectives",
      "What do you want to achieve?",
      "primary goals",
    ];
    return this.findResponseByKeys(responses, keys);
  }

  static extractBrandAttributes(responses) {
    const keys = [
      "brand identity",
      "brand personality",
      "How would you describe your brand?",
      "brand attributes",
    ];
    return this.findResponseByKeys(responses, keys);
  }

  static extractChallenges(responses) {
    const keys = [
      "challenges",
      "problems",
      "pain points",
      "What challenges do you face?",
    ];
    return this.findResponseByKeys(responses, keys);
  }

  static extractTimeline(responses) {
    const keys = [
      "timeline",
      "deadline",
      "When do you need this?",
      "completion timeline",
    ];
    return this.findResponseByKeys(responses, keys);
  }

  static extractAdditionalContext(responses) {
    const keys = [
      "additional information",
      "anything else",
      "other details",
      "additional context",
    ];
    return this.findResponseByKeys(responses, keys);
  }

  static findResponseByKeys(responses, keys) {
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
   * Get brand origin generation context for a specific project
   * @param {Object} projectData - Project and client data
   * @param {Object} questionnaireData - Questionnaire responses
   * @returns {Object} Complete context for brand origin generation
   */
  static getBrandOriginContext(projectData, questionnaireData) {
    const formattedQuestionnaire =
      this.formatQuestionnaireForLLM(questionnaireData);
    const relevantExample = this.getRelevantExample(
      formattedQuestionnaire.structured.industry,
      projectData.client?.name
    );

    return {
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
      questionnaire: formattedQuestionnaire,
      relevantExample,
      allExamples: this.getExampleContext(),
      levitateContext: this.LEVITATE_CONTEXT,
      template: this.BRAND_ORIGIN_TEMPLATE,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Store example documents in the AI-Context directory structure
   * This method ensures the examples are persisted and accessible
   */
  static async storeExampleDocuments() {
    // TODO: Do not store in codebase rather in db or somewhere else
    try {
      const contextDir = path.join(
        process.cwd(),
        "AI-Context",
        "questionaire and brand origin docs"
      );

      // Check if directory exists
      try {
        await fs.access(contextDir);
        logger.info({ contextDir }, "Example documents directory exists");
      } catch (error) {
        logger.info("Example documents already exist in AI-Context directory");
      }

      return true;
    } catch (error) {
      logger.error(
        { error: error.message },
        "Failed to store example documents"
      );
      return false;
    }
  }
}

module.exports = {
  BrandOriginContextService,
};
