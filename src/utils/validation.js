const { z } = require("zod");
const {
  ProjectPhase,
  DocumentType,
  DocumentStatus,
  WorkplanServiceType,
  SlideType,
  ResearchStatus,
  EmailDirection,
  EmailIntent,
  Actor,
  CreatedBy,
  JobStatus,
  WebhookProvider,
  TeamRole,
} = require("@/constants");
const { ValidationError } = require("@/utils/errors");

// Enum validators
const projectPhaseSchema = z.enum([
  ProjectPhase.QUESTIONNAIRE,
  ProjectPhase.BRAND_ORIGIN,
  ProjectPhase.QUOTE_DOCUMENT,
  ProjectPhase.FINALIZED,
  ProjectPhase.REJECTED,
]);

const documentTypeSchema = z.enum([
  DocumentType.BRAND_ORIGIN,
  DocumentType.QUOTE,
  DocumentType.QUOTE_VARIANT,
  DocumentType.WORKPLAN,
]);

const documentStatusSchema = z.enum([
  DocumentStatus.DRAFT,
  DocumentStatus.PM_REVIEW,
  DocumentStatus.FINANCE_MANAGER_REVIEW,
  DocumentStatus.SENT_TO_CLIENT,
  DocumentStatus.CLIENT_FEEDBACK,
  DocumentStatus.ACCEPTED,
  DocumentStatus.REJECTED,
  // Workplan-specific statuses
  DocumentStatus.RESEARCHING,
  DocumentStatus.GENERATING,
  DocumentStatus.COMPLETED,
  DocumentStatus.FAILED,
]);

const emailDirectionSchema = z.enum([
  EmailDirection.INBOUND,
  EmailDirection.OUTBOUND,
]);

const emailIntentSchema = z.enum([
  EmailIntent.NONE,
  EmailIntent.DOC_FEEDBACK,
  EmailIntent.ACCEPT,
  EmailIntent.REJECT,
  EmailIntent.OFFTOPIC,
  EmailIntent.OTHER,
]);

const actorSchema = z.enum([Actor.SYSTEM, Actor.USER, Actor.LLM]);

const createdBySchema = z.enum([
  CreatedBy.AGENT,
  CreatedBy.PM,
  CreatedBy.FINANCE,
  CreatedBy.CLIENT,
]);

const jobStatusSchema = z.enum([
  JobStatus.QUEUED,
  JobStatus.RUNNING,
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
]);

const webhookProviderSchema = z.enum([
  WebhookProvider.ASANA,
  WebhookProvider.BREVO,
  WebhookProvider.APPS_SCRIPT,
]);

const teamRoleSchema = z.enum([
  TeamRole.ADMIN,
  TeamRole.MANAGER,
  TeamRole.WEB_DESIGNER,
  TeamRole.GRAPHICS_DESIGNER,
  TeamRole.CREATIVE_DIRECTOR,
  TeamRole.UI_DESIGNER,
  TeamRole.PROJECT_MANAGER,
  TeamRole.COPY_WRITER,
  TeamRole.DIGITAL_MARKETER,
  TeamRole.MOTION_GRAPHICS_DESIGNER,
  TeamRole.FINANCE_MANAGER,
  TeamRole.HR_MANAGER,
  TeamRole.ART_DIRECTOR,
  TeamRole.CLIENT_SERVICE,
]);

// Workplan enum schemas
const workplanServiceTypeSchema = z.enum(Object.values(WorkplanServiceType));

const workplanStatusSchema = z.enum([
  DocumentStatus.DRAFT,
  DocumentStatus.RESEARCHING,
  DocumentStatus.GENERATING,
  DocumentStatus.COMPLETED,
  DocumentStatus.FAILED,
]);

const slideTypeSchema = z.enum(Object.values(SlideType));

const researchStatusSchema = z.enum(Object.values(ResearchStatus));

// Base schemas
const idSchema = z.number().int().positive();
const emailSchema = z.string().email();
const urlSchema = z.string().url();
const dateSchema = z.string().datetime().or(z.date());

// Complex object schemas
const teamMemberRoleSchema = z.object({
  role: teamRoleSchema,
  isLead: z.boolean(),
});

const asanaSectionsSchema = z.record(z.string(), z.string());

const emailAttachmentMetaSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string().url().optional(),
});

const asanaTaskMetaSchema = z.object({
  name: z.string(),
  notes: z.string().optional(),
  completed: z.boolean().optional(),
  priority: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// API request schemas
const createClientSchema = z.object({
  name: z.string().min(1).max(255),
  primaryEmail: emailSchema,
  context: z.string().optional(),
});

const createProjectSchema = z.object({
  clientId: idSchema,
  name: z.string().min(1).max(255),
  context: z.string().optional(),
});

const createDocumentSchema = z.object({
  projectId: idSchema,
  type: documentTypeSchema,
});

const updateDocumentStatusSchema = z.object({
  status: documentStatusSchema,
  reason: z.string().optional(),
});

const createEmailSchema = z.object({
  threadId: idSchema,
  direction: emailDirectionSchema,
  fromAddr: emailSchema,
  toAddr: emailSchema,
  subject: z.string(),
  rawHeaders: z.record(z.unknown()),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  attachmentsMeta: z.array(emailAttachmentMetaSchema).optional(),
  brevoEventId: z.string().optional(),
});

const webhookSchema = z.object({
  provider: webhookProviderSchema,
  resourceId: z.string(),
  secret: z.string(),
  callbackUrl: urlSchema,
});

const auditLogSchema = z.object({
  projectId: idSchema.optional(),
  actor: z.string(),
  action: z.string(),
  details: z.record(z.unknown()),
});

// Webhook payload schemas
const brevoWebhookSchema = z.object({
  event: z.string(),
  messageId: z.string(),
  email: emailSchema,
  subject: z.string(),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  attachments: z.array(z.unknown()).optional(),
  headers: z.record(z.unknown()).optional(),
});

const asanaWebhookSchema = z.object({
  events: z.array(
    z.object({
      action: z.string(),
      resource: z.object({
        gid: z.string(),
        resource_type: z.string(),
      }),
      parent: z
        .object({
          gid: z.string(),
          resource_type: z.string(),
        })
        .optional(),
      user: z
        .object({
          gid: z.string(),
        })
        .optional(),
    })
  ),
});

const googleFormsWebhookSchema = z.object({
  formId: z.string(),
  responseId: z.string(),
  responses: z.record(z.unknown()),
  respondentEmail: emailSchema.optional(),
  timestamp: dateSchema,
});

// Job data schemas
const documentGenerationJobSchema = z.object({
  projectId: idSchema,
  documentType: documentTypeSchema,
  context: z.string().optional(),
  regenerate: z.boolean().default(false),
  dedupeKey: z.string().optional(),
});

const emailParseJobSchema = z.object({
  projectId: idSchema,
  emailId: idSchema,
  dedupeKey: z.string().optional(),
});

const asanaSyncJobSchema = z.object({
  projectId: idSchema,
  action: z.enum(["create_project", "update_task", "add_comment", "move_task"]),
  data: z.record(z.unknown()),
  dedupeKey: z.string().optional(),
});

const notificationJobSchema = z.object({
  type: z.enum(["email", "webhook"]),
  recipients: z.array(z.string()),
  template: z.string().optional(),
  data: z.record(z.unknown()),
  dedupeKey: z.string().optional(),
});

// Pagination schema
const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// Query parameter schemas
const projectQuerySchema = z.object({
  clientId: idSchema.optional(),
  phase: projectPhaseSchema.optional(),
  ...paginationSchema.shape,
});

const documentQuerySchema = z.object({
  projectId: idSchema.optional(),
  type: documentTypeSchema.optional(),
  status: documentStatusSchema.optional(),
  ...paginationSchema.shape,
});

const emailQuerySchema = z.object({
  threadId: idSchema.optional(),
  direction: emailDirectionSchema.optional(),
  intent: emailIntentSchema.optional(),
  processed: z.coerce.boolean().optional(),
  ...paginationSchema.shape,
});

// Validation helper function
const validateSchema = (schema, data) => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.errors
        .map((err) => `${err.path.join(".")}: ${err.message}`)
        .join(", ");
      throw new ValidationError(`Validation failed: ${message}`, {
        errors: error.errors,
      });
    }
    throw error;
  }
};

// Validation middleware helper
const createValidationMiddleware = (schema) => {
  return (data) => {
    return validateSchema(schema, data);
  };
};

module.exports = {
  projectPhaseSchema,
  documentTypeSchema,
  documentStatusSchema,
  emailDirectionSchema,
  emailIntentSchema,
  actorSchema,
  createdBySchema,
  jobStatusSchema,
  webhookProviderSchema,
  teamRoleSchema,
  workplanServiceTypeSchema,
  workplanStatusSchema,
  slideTypeSchema,
  researchStatusSchema,
  idSchema,
  emailSchema,
  urlSchema,
  dateSchema,
  teamMemberRoleSchema,
  asanaSectionsSchema,
  emailAttachmentMetaSchema,
  asanaTaskMetaSchema,
  createClientSchema,
  createProjectSchema,
  createDocumentSchema,
  updateDocumentStatusSchema,
  createEmailSchema,
  webhookSchema,
  auditLogSchema,
  brevoWebhookSchema,
  asanaWebhookSchema,
  googleFormsWebhookSchema,
  documentGenerationJobSchema,
  emailParseJobSchema,
  asanaSyncJobSchema,
  notificationJobSchema,
  paginationSchema,
  projectQuerySchema,
  documentQuerySchema,
  emailQuerySchema,
  validateSchema,
  createValidationMiddleware,
};
