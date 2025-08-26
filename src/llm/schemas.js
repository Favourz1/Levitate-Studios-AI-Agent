const { z } = require("zod");
const {
  emailIntentSchema,
  documentTypeSchema,
  documentStatusSchema,
} = require("@/utils/validation");

// Email intent classification schema
const emailIntentClassificationSchema = z.object({
  intent: emailIntentSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string().max(500),
  requestedChanges: z.array(z.string()).optional(),
  reasoning: z.string().max(1000),
});

// Document outline schema
const documentOutlineSchema = z.object({
  title: z.string().max(200),
  sections: z.array(
    z.object({
      heading: z.string().max(100),
      content: z.string().max(2000),
      subsections: z
        .array(
          z.object({
            heading: z.string().max(100),
            content: z.string().max(1000),
          })
        )
        .optional(),
    })
  ),
  metadata: z.object({
    wordCount: z.number().positive(),
    estimatedReadingTime: z.number().positive(),
    keyPoints: z.array(z.string().max(200)),
  }),
});

// Brand origin document schema
const brandOriginDocumentSchema = z.object({
  executiveSummary: z.string().max(1000),
  brandStory: z.string().max(2000),
  targetAudience: z.object({
    primary: z.string().max(500),
    secondary: z.string().max(500),
    demographics: z.string().max(500),
    psychographics: z.string().max(500),
  }),
  brandPersonality: z.object({
    traits: z.array(z.string().max(50)),
    tone: z.string().max(300),
    voice: z.string().max(300),
  }),
  brandValues: z.array(
    z.object({
      value: z.string().max(50),
      description: z.string().max(200),
    })
  ),
  competitiveAnalysis: z.object({
    competitors: z.array(z.string().max(100)),
    positioning: z.string().max(500),
    differentiators: z.array(z.string().max(200)),
  }),
  visualIdentity: z.object({
    colorPalette: z.string().max(300),
    typography: z.string().max(300),
    imagery: z.string().max(300),
    style: z.string().max(300),
  }),
  recommendations: z.array(z.string().max(300)),
});

// Budget and timeline document schema
const budgetTimelineDocumentSchema = z.object({
  projectOverview: z.string().max(1000),
  scope: z.object({
    deliverables: z.array(
      z.object({
        name: z.string().max(100),
        description: z.string().max(500),
        quantity: z.number().positive(),
      })
    ),
    inclusions: z.array(z.string().max(200)),
    exclusions: z.array(z.string().max(200)),
  }),
  timeline: z.object({
    totalDuration: z.string().max(50), // e.g., "8-12 weeks"
    phases: z.array(
      z.object({
        name: z.string().max(100),
        duration: z.string().max(50), // e.g., "2 weeks"
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        deliverables: z.array(z.string().max(200)),
        dependencies: z.array(z.string().max(200)).optional(),
      })
    ),
    milestones: z.array(
      z.object({
        name: z.string().max(100),
        date: z.string(),
        description: z.string().max(300),
      })
    ),
  }),
  budget: z.object({
    totalAmount: z.number().positive(),
    currency: z.string().default("USD"),
    breakdown: z.array(
      z.object({
        category: z.string().max(100),
        amount: z.number().positive(),
        description: z.string().max(300),
      })
    ),
    paymentSchedule: z.array(
      z.object({
        milestone: z.string().max(100),
        percentage: z.number().min(0).max(100),
        amount: z.number().positive(),
        dueDate: z.string(),
      })
    ),
  }),
  terms: z.object({
    revisions: z.string().max(300),
    ownership: z.string().max(300),
    cancellation: z.string().max(300),
    liability: z.string().max(300),
  }),
  nextSteps: z.array(z.string().max(200)),
});

// Task guidance schema
const taskGuidanceSchema = z.object({
  taskName: z.string().max(100),
  briefDescription: z.string().max(300),
  detailedGuidance: z.array(z.string().max(500)),
  keyRequirements: z.array(z.string().max(200)),
  designConsiderations: z.array(z.string().max(300)),
  clientPreferences: z.array(z.string().max(200)),
  technicalSpecs: z.array(z.string().max(300)).optional(),
  deliverables: z.array(
    z.object({
      name: z.string().max(100),
      format: z.string().max(50),
      specifications: z.string().max(300),
    })
  ),
  references: z
    .array(
      z.object({
        type: z.string().max(50), // 'inspiration', 'style', 'competitor', etc.
        description: z.string().max(200),
        url: z.string().url().optional(),
      })
    )
    .optional(),
  estimatedHours: z.number().positive().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

// Project analysis schema
const projectAnalysisSchema = z.object({
  complexity: z.enum(["simple", "moderate", "complex", "very_complex"]),
  estimatedDuration: z.object({
    min: z.number().positive(), // in weeks
    max: z.number().positive(),
    confidence: z.number().min(0).max(1),
  }),
  requiredRoles: z.array(
    z.object({
      role: z.string().max(100),
      hoursPerWeek: z.number().positive(),
      isLead: z.boolean().default(false),
    })
  ),
  risks: z.array(
    z.object({
      risk: z.string().max(200),
      impact: z.enum(["low", "medium", "high"]),
      likelihood: z.enum(["low", "medium", "high"]),
      mitigation: z.string().max(300),
    })
  ),
  dependencies: z.array(
    z.object({
      dependency: z.string().max(200),
      type: z.enum(["client", "external", "internal", "technical"]),
      criticality: z.enum(["low", "medium", "high"]),
    })
  ),
  recommendations: z.array(z.string().max(300)),
});

// Content generation schema (for general content)
const contentGenerationSchema = z.object({
  content: z.string().max(10000),
  tone: z.enum(["professional", "friendly", "formal", "casual", "creative"]),
  wordCount: z.number().positive(),
  keyMessages: z.array(z.string().max(200)),
  callToAction: z.string().max(200).optional(),
  seoKeywords: z.array(z.string().max(50)).optional(),
});

// Planning schema for complex workflows
const workflowPlanSchema = z.object({
  objective: z.string().max(300),
  approach: z.string().max(1000),
  steps: z.array(
    z.object({
      stepNumber: z.number().positive(),
      action: z.string().max(200),
      description: z.string().max(500),
      estimatedTime: z.string().max(50),
      dependencies: z.array(z.number()).optional(),
      tools: z.array(z.string().max(50)).optional(),
    })
  ),
  successCriteria: z.array(z.string().max(200)),
  potentialChallenges: z.array(
    z.object({
      challenge: z.string().max(200),
      solution: z.string().max(300),
    })
  ),
  estimatedCompletion: z.string().max(100),
});

// Quality check schema
const qualityCheckSchema = z.object({
  overallScore: z.number().min(0).max(10),
  criteria: z.array(
    z.object({
      criterion: z.string().max(100),
      score: z.number().min(0).max(10),
      feedback: z.string().max(300),
      suggestions: z.array(z.string().max(200)).optional(),
    })
  ),
  strengths: z.array(z.string().max(200)),
  improvements: z.array(z.string().max(200)),
  approved: z.boolean(),
  revisionsRequired: z.array(z.string().max(300)).optional(),
});

// Feedback processing schema
const feedbackProcessingSchema = z.object({
  summary: z.string().max(500),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  actionItems: z.array(
    z.object({
      action: z.string().max(200),
      priority: z.enum(["low", "medium", "high"]),
      category: z.enum([
        "content",
        "design",
        "functionality",
        "timeline",
        "budget",
        "other",
      ]),
      description: z.string().max(300),
    })
  ),
  clientSatisfaction: z.number().min(1).max(5),
  responseRequired: z.boolean(),
  suggestedResponse: z.string().max(1000).optional(),
});

// Error analysis schema
const errorAnalysisSchema = z.object({
  errorType: z.enum([
    "technical",
    "process",
    "communication",
    "resource",
    "external",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().max(500),
  rootCause: z.string().max(300),
  impact: z.object({
    timeline: z.string().max(200),
    budget: z.string().max(200),
    quality: z.string().max(200),
    clientSatisfaction: z.string().max(200),
  }),
  resolution: z.array(z.string().max(300)),
  prevention: z.array(z.string().max(300)),
  lessonsLearned: z.array(z.string().max(300)),
});

module.exports = {
  emailIntentClassificationSchema,
  documentOutlineSchema,
  brandOriginDocumentSchema,
  budgetTimelineDocumentSchema,
  taskGuidanceSchema,
  projectAnalysisSchema,
  contentGenerationSchema,
  workflowPlanSchema,
  qualityCheckSchema,
  feedbackProcessingSchema,
  errorAnalysisSchema,
};
