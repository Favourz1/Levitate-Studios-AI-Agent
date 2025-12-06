// Enums as constants for type safety and runtime validation
const ProjectPhase = {
  QUESTIONNAIRE: "QUESTIONNAIRE",
  BRAND_ORIGIN: "BRAND_ORIGIN",
  QUOTE_DOCUMENT: "QUOTE_DOCUMENT", // Internal phase name (was BUDGET_TIMELINE)
  FINALIZED: "FINALIZED",
  REJECTED: "REJECTED",
};

const DocumentType = {
  BRAND_ORIGIN: "BRAND_ORIGIN",
  QUOTE: "QUOTE",
  QUOTE_VARIANT: "QUOTE_VARIANT",
  WORKPLAN: "WORKPLAN",
};

const WorkplanServiceType = {
  LOGO_DESIGN: "LOGO_DESIGN",
  MARKETING_CAMPAIGN: "MARKETING_CAMPAIGN",
  GTM_STRATEGY: "GTM_STRATEGY",
  GTM_360_CAMPAIGN: "GTM_360_CAMPAIGN",
  SOCIAL_MEDIA_STRATEGY: "SOCIAL_MEDIA_STRATEGY",
  BRAND_DESIGN: "BRAND_DESIGN",
  WEB_DESIGN: "WEB_DESIGN",
  PACKAGING_DESIGN: "PACKAGING_DESIGN",
  VIDEO_PRODUCTION: "VIDEO_PRODUCTION",
  MOTION_DESIGN: "MOTION_DESIGN",
  ADVERTISING: "ADVERTISING",
};

const SlideType = {
  // Core slides (always present)
  INDUSTRY_STRENGTHS: "INDUSTRY_STRENGTHS",
  OPPORTUNITY_IN_MARKET: "OPPORTUNITY_IN_MARKET",
  TARGET_AND_NEEDS: "TARGET_AND_NEEDS",
  CURRENT_SOLUTION: "CURRENT_SOLUTION",
  WHY_CURRENT_SOLUTION: "WHY_CURRENT_SOLUTION",
  COMPETITIVE_LANDSCAPE: "COMPETITIVE_LANDSCAPE",
  COMPETITOR_POSITIONING: "COMPETITOR_POSITIONING",
  INDUSTRY_SHIFT: "INDUSTRY_SHIFT",
  // Marketing-specific slides
  MARKET_GAPS: "MARKET_GAPS",
  MARKET_GAPS_RESPONSE: "MARKET_GAPS_RESPONSE",
  ALL_TRUTHS_CONSIDERED: "ALL_TRUTHS_CONSIDERED",
  STRATEGIC_INTERPRETATION: "STRATEGIC_INTERPRETATION",
  STRATEGY_TO_IDEA: "STRATEGY_TO_IDEA",
  BIG_IDEA: "BIG_IDEA",
  // Logo/Branding-specific slides
  VISUAL_RATIONALE: "VISUAL_RATIONALE",
  LOGO_OPTIONS: "LOGO_OPTIONS",
};

const ResearchStatus = {
  PENDING: "PENDING",
  RESEARCHING: "RESEARCHING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
};

const DocumentStatus = {
  DRAFT: "DRAFT",
  PM_REVIEW: "PM_REVIEW",
  FINANCE_MANAGER_REVIEW: "FINANCE_MANAGER_REVIEW",
  SENT_TO_CLIENT: "SENT_TO_CLIENT",
  CLIENT_FEEDBACK: "CLIENT_FEEDBACK",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  // Workplan-specific statuses
  RESEARCHING: "RESEARCHING",
  GENERATING: "GENERATING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
};

const EmailDirection = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
};

const EmailIntent = {
  NONE: "NONE",
  DOC_FEEDBACK: "DOC_FEEDBACK",
  ACCEPT: "ACCEPT",
  REJECT: "REJECT",
  OFFTOPIC: "OFFTOPIC",
  OTHER: "OTHER",
};

const Actor = {
  SYSTEM: "SYSTEM",
  USER: "USER",
  LLM: "LLM",
};

const CreatedBy = {
  AGENT: "AGENT",
  PM: "PM",
  FINANCE: "FINANCE",
  CLIENT: "CLIENT",
};

const JobStatus = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

const WebhookProvider = {
  ASANA: "ASANA",
  BREVO: "BREVO",
  APPS_SCRIPT: "APPS_SCRIPT",
};

const TeamRole = {
  ADMIN: "ADMIN",
  PROJECT_MANAGER: "PROJECT_MANAGER",
  FINANCE_MANAGER: "FINANCE_MANAGER",
  HR_MANAGER: "HR_MANAGER",
  ART_DIRECTOR: "ART_DIRECTOR",
  CREATIVE_DIRECTOR: "CREATIVE_DIRECTOR",
  DIGITAL_MARKETER: "DIGITAL_MARKETER",
  MOTION_GRAPHICS_DESIGNER: "MOTION_GRAPHICS_DESIGNER",
  CLIENT_SERVICE: "CLIENT_SERVICE",
  // Extra
  MANAGER: "MANAGER",
  WEB_DESIGNER: "WEB_DESIGNER",
  GRAPHICS_DESIGNER: "GRAPHICS_DESIGNER",
  UI_DESIGNER: "UI_DESIGNER",
  COPY_WRITER: "COPY_WRITER",
};

// Brand Assets
const BrandAssets = {
  LEVITATE_LOGO_FILE_ID: "1_QMmI4uJVrmOISru8027mE0hOaGuYI6O", // Google Drive file ID for logo
  LEVITATE_LOGO_URL:
    "https://res.cloudinary.com/dpksx8hse/image/upload/Levitate_Logo_xotdzc.png", // Fallback URL Note: Svg doesnt work only png, jpg and jpeg
  LOGO_DIMENSIONS: {
    WIDTH: 125, // pixels
    HEIGHT: 32, // pixels
  },
};

// Levitate brand guidelines for design directives
const LEVITATE_BRAND_GUIDELINES = {
  colors: {
    primary: "#1A1A1A",
    secondary: "#FFFFFF",
    accent: "#FF6B35",
    background: "#F5F5F5",
  },
  typography: {
    headingFont: "Inter Bold",
    bodyFont: "Inter Regular",
    headingSizes: [32, 24, 18],
    bodySize: 14,
  },
  iconStyle: "Minimalist, line-based",
  imageStyle: "High-quality, professional, authentic",
};

// Design layout types for workplan slides
const DesignLayout = {
  SPLIT_LEFT_RIGHT: "SPLIT_LEFT_RIGHT",
  SPLIT_TOP_BOTTOM: "SPLIT_TOP_BOTTOM",
  FULL_WIDTH: "FULL_WIDTH",
  GRID_2COL: "GRID_2COL",
  GRID_3COL: "GRID_3COL",
  CENTERED: "CENTERED",
  TIMELINE: "TIMELINE",
  COMPARISON_TABLE: "COMPARISON_TABLE",
};

// Action Types for JWT tokens and email buttons
const ActionType = {
  SEND_TO_CLIENT: "SEND_TO_CLIENT",
  GENERATE_SEND_LINK: "GENERATE_SEND_LINK",
  CONFIRM_ACCEPTED: "CONFIRM_ACCEPTED",
  CONFIRM_REJECTION: "CONFIRM_REJECTION",
  REVIEW_DOCUMENT: "REVIEW_DOCUMENT",
};

// Asana Section Names for Pending Projects Board
const AsanaPendingProjectsBoardSections = {
  FILLED_QUESTIONNAIRE: "Filled Questionnaire",
  BRAND_ORIGIN_DOC_PHASE: "Brand Origin Doc Phase",
  QUOTE_DOCUMENT_PHASE: "Quote Document Phase",
  FINALIZED: "Finalized",
  REJECTED: "Rejected",
};

// Asana Section Names for Actual Project Boards
const AsanaProjectBoardSections = {
  TO_DO: "To Do",
  IN_PROGRESS: "In Progress",
  IN_REVIEW: "In Review",
  COMPLETED: "Completed",
};

// Processing Status for questionnaire responses and other entities
const ProcessingStatus = {
  PENDING: "PENDING",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
};

// System Project Names and Descriptions
const SystemProjects = {
  PENDING_PROJECTS_NAME: "Pending Projects",
  PENDING_PROJECTS_DESCRIPTION:
    "AI Agent managed project for pending client submissions",
};

// System Actor Names for audit logs
const SystemActors = {
  BRAND_ORIGIN_GENERATOR: "SYSTEM (Brand Origin Generator)",
  QUOTE_GENERATOR: "SYSTEM (Quote Generator)",
  LEVITATE_AI_AGENT_SYSTEM: "LEVITATE AI AGENT SYSTEM",
};

// Audit Log Actions
const AuditActions = {
  BRAND_ORIGIN_CREATED: "BRAND_ORIGIN_CREATED",
  BRAND_ORIGIN_REGENERATED: "BRAND_ORIGIN_REGENERATED",
  BRAND_ORIGIN_FAILED: "BRAND_ORIGIN_FAILED",
  QUOTE_CREATED: "QUOTE_CREATED",
  QUOTE_REGENERATED: "QUOTE_REGENERATED",
  QUOTE_GENERATION_FAILED: "QUOTE_GENERATION_FAILED",
  QUOTE_ACCEPTED: "QUOTE_ACCEPTED",
  INVOICE_CREATED: "INVOICE_CREATED",
  ASANA_WORKFLOW_FAILED: "ASANA_WORKFLOW_FAILED",
  PM_ADMIN_NOTIFICATION_FAILED: "PM_ADMIN_NOTIFICATION_FAILED",
  EMAIL_INTENT_DETECTED: "EMAIL_INTENT_DETECTED",
  DOCUMENT_FEEDBACK_RECEIVED: "DOCUMENT_FEEDBACK_RECEIVED",
  DOCUMENT_REGENERATION_TRIGGERED: "DOCUMENT_REGENERATION_TRIGGERED",
  DOCUMENT_REJECTED: "DOCUMENT_REJECTED",
  PROJECT_REJECTED: "PROJECT_REJECTED",
  REJECTION_CONFIRMED: "REJECTION_CONFIRMED",
  ASANA_PROJECT_INITIALIZED: "ASANA_PROJECT_INITIALIZED",
  // Workplan audit actions
  WORKPLAN_GENERATION_STARTED: "WORKPLAN_GENERATION_STARTED",
  WORKPLAN_GENERATION_COMPLETED: "WORKPLAN_GENERATION_COMPLETED",
  WORKPLAN_GENERATION_FAILED: "WORKPLAN_GENERATION_FAILED",
  WORKPLAN_REGENERATION_REQUESTED: "WORKPLAN_REGENERATION_REQUESTED",
  WORKPLAN_SLIDE_REGENERATION_REQUESTED:
    "WORKPLAN_SLIDE_REGENERATION_REQUESTED",
  WORKPLAN_SLIDE_RESEARCH_COMPLETED: "WORKPLAN_SLIDE_RESEARCH_COMPLETED",
  WORKPLAN_SLIDE_CONTENT_COMPLETED: "WORKPLAN_SLIDE_CONTENT_COMPLETED",
  WORKPLAN_SLIDE_DESIGN_COMPLETED: "WORKPLAN_SLIDE_DESIGN_COMPLETED",
  WORKPLAN_GENERATION_COMPLETED_EMAIL_SEND_ATTEMPTED:
    "WORKPLAN_GENERATION_COMPLETED_EMAIL_SEND_ATTEMPTED",
};

// System Email Addresses
const SystemEmails = {
  AI_AGENT: "ai-agent@levitate.ng",
};

// Slide Status Constants (used for workplan slides)
// Note: These use the same values as ResearchStatus and DocumentStatus for consistency
const SlideStatus = {
  PENDING: "PENDING",
  RESEARCHING: "RESEARCHING",
  GENERATING: "GENERATING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
};

// Google Docs Block Types
const BlockType = {
  IMAGE: "image",
  HEADING: "heading",
  PARAGRAPH: "paragraph",
  STYLED: "styled",
  LINK: "link",
  BULLETS: "bullets",
  NUMBERED: "numbered",
  HORIZONTAL_RULE: "horizontalRule",
  SPACER: "spacer",
  TABLE: "table",
};

// LLM Task Types
const LLMTaskType = {
  CLASSIFICATION: "classification",
  EXTRACTION: "extraction",
  GENERATION: "generation",
  PLANNING: "planning",
};

// LLM Provider Names
const LLMProvider = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GROQ: "groq",
};

// Research Data Types
const ResearchDataType = {
  GROWTH_RATE: "GROWTH_RATE",
  MARKET_SIZE: "MARKET_SIZE",
  POPULATION: "POPULATION",
  BEHAVIOR: "BEHAVIOR",
};

// Job Types for LLM Tools
const JobType = {
  DOCUMENT_GENERATION: "document-generation",
  EMAIL_PARSE: "email-parse",
  ASANA_SYNC: "asana-sync",
  ASANA_PROJECT_INIT: "asana-project-init",
  NOTIFICATION: "notification",
  SNAPSHOT_SYNC: "snapshot-sync",
};

// Document Type Display Names (for UI/emails)
const DocumentTypeDisplayName = {
  BRAND_ORIGIN: "Brand Origin",
  QUOTE: "Quote",
  QUOTE_VARIANT: "Quote Variant",
  WORKPLAN: "Workplan",
};

// Reply-to Address Pattern
const ReplyToAddressPattern = {
  PREFIX: "clients-",
  DOMAIN_PLACEHOLDER: "@{domain}",
  // Pattern: clients-{clientId}-{projectId}@{domain}
};

// Workplan Service Type Fallback
const WorkplanServiceTypeFallback = {
  GENERAL: "GENERAL",
};

module.exports = {
  ProjectPhase,
  DocumentType,
  DocumentStatus,
  WorkplanServiceType,
  WorkplanServiceTypeFallback,
  SlideType,
  ResearchStatus,
  SlideStatus,
  EmailDirection,
  EmailIntent,
  Actor,
  CreatedBy,
  JobStatus,
  WebhookProvider,
  TeamRole,
  BrandAssets,
  LEVITATE_BRAND_GUIDELINES,
  DesignLayout,
  ActionType,
  AsanaPendingProjectsBoardSections,
  AsanaProjectBoardSections,
  ProcessingStatus,
  SystemProjects,
  SystemActors,
  AuditActions,
  SystemEmails,
  BlockType,
  LLMTaskType,
  LLMProvider,
  ResearchDataType,
  JobType,
  DocumentTypeDisplayName,
  ReplyToAddressPattern,
};
