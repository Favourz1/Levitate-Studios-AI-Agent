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
  LEVITATE_LOGO_FILE_ID: "1UXsLtQ0HemLj7aHjssGu_ipp4mRBj0Hc", // Google Drive file ID for logo
  LEVITATE_LOGO_URL:
    "https://levitate.ng/wp-content/uploads/2022/02/Group-1.svg", // Fallback URL
  LOGO_DIMENSIONS: {
    WIDTH: 125, // pixels
    HEIGHT: 32, // pixels
  },
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
};

// System Email Addresses
const SystemEmails = {
  AI_AGENT: "ai-agent@levitate.ng",
};

module.exports = {
  ProjectPhase,
  DocumentType,
  DocumentStatus,
  EmailDirection,
  EmailIntent,
  Actor,
  CreatedBy,
  JobStatus,
  WebhookProvider,
  TeamRole,
  BrandAssets,
  ActionType,
  AsanaPendingProjectsBoardSections,
  AsanaProjectBoardSections,
  ProcessingStatus,
  SystemProjects,
  SystemActors,
  AuditActions,
  SystemEmails,
};
