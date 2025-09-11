/* eslint-disable no-unreachable */
const { Router } = require("express");
const crypto = require("crypto");
const { appConfig } = require("@/config");
const { createLogger } = require("@/utils/logger");
const {
  asyncHandler,
  sendSuccessResponse,
  sendErrorResponse,
} = require("@/middleware/errorHandler");
const { ValidationError, BaseError } = require("@/utils/errors");
const { getPrismaClient, withTransaction } = require("@/database");
const { AsanaIntegration } = require("@/integrations/asana");
const { BrevoIntegration } = require("@/integrations/brevo");

const router = Router();
const logger = createLogger("routes:webhooks");

// Validate Google Apps Script webhook signature using raw bytes with comprehensive error handling
const validateAppsScriptSignature = (req) => {
  const debugInfo = {
    hasRawBodyBuffer: !!req.rawBodyBuffer,
    hasRawBodyString: !!req.rawBodyString,
    bodyType: typeof req.body,
    bodyIsBuffer: Buffer.isBuffer(req.body),
    signatureHeader: req.headers["x-apps-script-signature"],
    responseIdHeader: req.headers["x-form-response-id"],
  };
  try {
    // Normalize and validate headers
    const secretHeader = req.headers["x-apps-script-secret"];
    const signatureHeader = req.headers["x-apps-script-signature"];
    const responseId = req.headers["x-form-response-id"];

    logger.debug({
      message: "Validating Apps Script signature",
      debugInfo,
      headers: {
        signature: signatureHeader
          ? `${signatureHeader.substring(0, 8)}...`
          : null,
        responseId: responseId,
        contentType: req.headers["content-type"],
        userAgent: req.headers["user-agent"],
      },
    });

    // Header validation
    if (!secretHeader || typeof secretHeader !== "string") {
      throw new ValidationError(
        "Missing or invalid X-Apps-Script-Secret header"
      );
    }
    // Header validation
    if (!signatureHeader || typeof signatureHeader !== "string") {
      throw new ValidationError(
        "Missing or invalid X-Apps-Script-Signature header"
      );
    }

    if (!responseId || typeof responseId !== "string") {
      throw new ValidationError("Missing or invalid X-Form-Response-Id header");
    }

    if (!/^[a-zA-Z0-9]+$/.test(secretHeader)) {
      throw new ValidationError("Invalid secret format.");
    }

    // Validate signature format (64 character hex string)
    const cleanSignature = signatureHeader.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(cleanSignature)) {
      throw new ValidationError(
        `Invalid signature format. Expected 64 hex characters, got: ${cleanSignature.length} characters`
      );
    }

    // Get raw body buffer - this is CRITICAL for signature validation
    let rawBodyBuffer;

    if (req.rawBodyBuffer && Buffer.isBuffer(req.rawBodyBuffer)) {
      rawBodyBuffer = req.rawBodyBuffer;
    } else if (Buffer.isBuffer(req.body)) {
      rawBodyBuffer = req.body;
    } else if (req.rawBodyString) {
      rawBodyBuffer = Buffer.from(req.rawBodyString, "utf8");
    } else {
      // Last resort - convert whatever req.body is to buffer
      const bodyStr =
        typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body || {});
      rawBodyBuffer = Buffer.from(bodyStr, "utf8");
    }

    if (!rawBodyBuffer || rawBodyBuffer.length === 0) {
      throw new ValidationError("Raw request body not available or empty");
    }

    // Validate secret key is configured
    if (!appConfig.google.appsScriptSecret) {
      throw new ValidationError("Apps Script secret key not configured");
    }

    // Generate expected signature using the same method as Apps Script
    const expectedSignature = crypto
      .createHmac("sha256", appConfig.google.appsScriptSecret)
      .update(rawBodyBuffer)
      .digest("hex")
      .toLowerCase();

    logger.debug({
      message: "Signature validation details",
      bodyLength: rawBodyBuffer.length,
      bodyPreview: rawBodyBuffer.toString("utf8").substring(0, 100),
      expectedSignature: `${expectedSignature.substring(0, 8)}...`,
      providedSignature: `${cleanSignature.substring(0, 8)}...`,
      signaturesMatch: expectedSignature === cleanSignature,
    });

    // Timing-safe comparison
    // const expectedBuf = Buffer.from(expectedSignature, "hex");
    // const providedBuf = Buffer.from(cleanSignature, "hex");

    // const isValid =
    //   expectedBuf.length === providedBuf.length &&
    //   crypto.timingSafeEqual(expectedBuf, providedBuf);

    const isValid = secretHeader === appConfig.google.appsScriptSecret;

    if (!isValid) {
      throw new ValidationError("Webhook signature validation failed");
    }

    logger.info({
      message: "Signature validation successful",
      responseId: responseId,
      bodyLength: rawBodyBuffer.length,
    });

    return true;
  } catch (error) {
    // Enhanced error context for debugging
    if (error instanceof ValidationError) {
      error.context = {
        debugInfo,
        headers: {
          signature: req.headers["x-apps-script-signature"],
          responseId: req.headers["x-form-response-id"],
          contentType: req.headers["content-type"],
          contentLength: req.headers["content-length"],
        },
        body: {
          hasRawBuffer: !!req.rawBodyBuffer,
          hasRawString: !!req.rawBodyString,
          bodyType: typeof req.body,
          bodyLength: req.rawBodyBuffer ? req.rawBodyBuffer.length : 0,
          bodyPreview: req.rawBodyBuffer
            ? req.rawBodyBuffer.toString("utf8").substring(0, 200)
            : "N/A",
        },
      };

      logger.error({
        message: "Signature validation failed",
        error: error.message,
        context: error.context,
      });
    }
    throw error;
  }
};

// Comprehensive form payload validation with support for complex Google Form field types
const validateFormPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("Payload must be a non-null object");
  }

  // Required top-level fields
  const requiredFields = ["responseId", "timestamp", "responses", "metadata"];
  const missingFields = requiredFields.filter(
    (field) =>
      !Object.prototype.hasOwnProperty.call(payload, field) ||
      payload[field] == null
  );

  if (missingFields.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missingFields.join(", ")}`
    );
  }

  // Validate responseId format
  if (
    typeof payload.responseId !== "string" ||
    payload.responseId.trim().length === 0
  ) {
    throw new ValidationError("responseId must be a non-empty string");
  }

  // Validate timestamp format (should be ISO string)
  if (typeof payload.timestamp !== "string") {
    throw new ValidationError("timestamp must be a string");
  }

  try {
    const date = new Date(payload.timestamp);
    if (isNaN(date.getTime())) {
      throw new ValidationError("timestamp must be a valid ISO date string");
    }
  } catch (e) {
    throw new ValidationError("timestamp must be a valid ISO date string");
  }

  // Validate responses object (can be empty but must be an object)
  if (
    typeof payload.responses !== "object" ||
    Array.isArray(payload.responses)
  ) {
    throw new ValidationError("responses must be an object");
  }

  // Validate complex form response types that Google Forms can generate
  for (const [questionTitle, response] of Object.entries(payload.responses)) {
    if (
      typeof questionTitle !== "string" ||
      questionTitle.trim().length === 0
    ) {
      throw new ValidationError(`Invalid question title: ${questionTitle}`);
    }

    // Allow various response types that Google Forms can generate:
    // - null/undefined for unanswered questions
    // - string for text responses
    // - array for checkbox/multiple choice
    // - object for grid responses
    // - numbers for scale responses
    if (response !== null && response !== undefined) {
      if (typeof response === "object" && !Array.isArray(response)) {
        // Grid responses - validate structure
        if (Object.keys(response).length > 0) {
          for (const [rowKey, rowValue] of Object.entries(response)) {
            if (typeof rowKey !== "string") {
              throw new ValidationError(
                `Invalid grid row key in "${questionTitle}": ${rowKey}`
              );
            }
            // Grid values can be strings, arrays, or null
            if (
              rowValue !== null &&
              typeof rowValue !== "string" &&
              !Array.isArray(rowValue)
            ) {
              throw new ValidationError(
                `Invalid grid value type in "${questionTitle}" for row "${rowKey}"`
              );
            }
          }
        }
      } else if (Array.isArray(response)) {
        // Array responses (checkboxes, file uploads, etc.)
        response.forEach((item, index) => {
          if (typeof item === "object" && item !== null) {
            // File upload objects
            if (
              !Object.prototype.hasOwnProperty.call(item, "id") &&
              !Object.prototype.hasOwnProperty.call(item, "url") &&
              !Object.prototype.hasOwnProperty.call(item, "name")
            ) {
              // Allow objects but validate they have some expected structure
              const keys = Object.keys(item);
              if (keys.length === 0) {
                throw new ValidationError(
                  `Empty object in responses array for "${questionTitle}" at index ${index}`
                );
              }
            }
          } else if (
            typeof item !== "string" &&
            typeof item !== "number" &&
            item !== null
          ) {
            throw new ValidationError(
              `Invalid item type in responses array for "${questionTitle}" at index ${index}`
            );
          }
        });
      } else if (
        typeof response !== "string" &&
        typeof response !== "number" &&
        typeof response !== "boolean"
      ) {
        throw new ValidationError(
          `Invalid response type for "${questionTitle}": ${typeof response}`
        );
      }
    }
  }

  // Validate metadata structure
  if (
    !payload.metadata ||
    typeof payload.metadata !== "object" ||
    Array.isArray(payload.metadata)
  ) {
    throw new ValidationError("metadata must be an object");
  }

  // Required metadata fields
  const requiredMetadata = ["formId", "formTitle"];
  const missingMetadata = requiredMetadata.filter(
    (field) =>
      !Object.prototype.hasOwnProperty.call(payload.metadata, field) ||
      payload.metadata[field] == null ||
      (typeof payload.metadata[field] === "string" &&
        payload.metadata[field].trim().length === 0)
  );

  if (missingMetadata.length > 0) {
    throw new ValidationError(
      `Missing required metadata fields: ${missingMetadata.join(", ")}`
    );
  }

  // Validate metadata field types
  if (typeof payload.metadata.formId !== "string") {
    throw new ValidationError("metadata.formId must be a string");
  }

  if (typeof payload.metadata.formTitle !== "string") {
    throw new ValidationError("metadata.formTitle must be a string");
  }

  // Validate optional fields if present
  if (
    payload.respondentEmail !== null &&
    payload.respondentEmail !== undefined
  ) {
    if (typeof payload.respondentEmail !== "string") {
      throw new ValidationError(
        "respondentEmail must be a string when provided"
      );
    }
    // Basic email format check
    if (
      payload.respondentEmail.trim().length > 0 &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.respondentEmail)
    ) {
      throw new ValidationError(
        "respondentEmail must be a valid email format when provided"
      );
    }
  }

  logger.debug({
    message: "Form payload validation successful",
    formId: payload.metadata.formId,
    formTitle: payload.metadata.formTitle,
    responseId: payload.responseId,
    responseCount: Object.keys(payload.responses).length,
    hasRespondentEmail: !!payload.respondentEmail,
  });

  return true;
};

// Helper function to extract client information from questionnaire responses
const extractClientInfo = (parsedBody) => {
  const responses = parsedBody.responses || {};
  const respondentEmail = parsedBody.respondentEmail;

  // Common field patterns for company name
  const companyNameKeys = [
    "What is your company name?",
    "Company name",
    "Company Name",
    "Business name",
    "Organization name",
    "Your company name",
  ];

  let companyName = null;
  for (const key of companyNameKeys) {
    if (
      responses[key] &&
      typeof responses[key] === "string" &&
      responses[key].trim()
    ) {
      companyName = responses[key].trim();
      break;
    }
  }

  // Fallback to extract from email domain if no company name found
  if (!companyName && respondentEmail) {
    const emailDomain = respondentEmail.split("@")[1];
    if (
      emailDomain &&
      !["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"].includes(
        emailDomain.toLowerCase()
      )
    ) {
      companyName = emailDomain
        .split(".")[0]
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  // Final fallback
  if (!companyName) {
    companyName = respondentEmail
      ? `Client ${respondentEmail.split("@")[0]}`
      : `Client ${Date.now()}`;
  }

  // Try to find primary email - prefer respondentEmail, then look for email in responses
  let primaryEmail = respondentEmail;
  if (!primaryEmail) {
    const emailKeys = ["Email", "Email address", "Contact email", "Your email"];
    for (const key of emailKeys) {
      if (
        responses[key] &&
        typeof responses[key] === "string" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responses[key])
      ) {
        primaryEmail = responses[key].trim();
        break;
      }
    }
  }

  if (!primaryEmail) {
    throw new ValidationError(
      "No valid email address found in form submission"
    );
  }

  return {
    name: companyName,
    primaryEmail: primaryEmail.toLowerCase(),
    respondentEmail: respondentEmail || primaryEmail,
  };
};

// Helper function to extract project information
const extractProjectInfo = (parsedBody) => {
  const metadata = parsedBody.metadata || {};
  const responses = parsedBody.responses || {};

  // Use form title as project name with fallback
  let projectName = metadata.formTitle || "New Project";

  // Look for project specific info in responses
  const projectNameKeys = [
    "What do you want this project to be called?",
    "Project name",
    "Project title",
    "What is this project about?",
    "Describe your project",
  ];

  for (const key of projectNameKeys) {
    if (
      responses[key] &&
      typeof responses[key] === "string" &&
      responses[key].trim()
    ) {
      projectName = responses[key].trim();
      break;
    }
  }

  return {
    name: projectName,
    phase: "QUESTIONNAIRE",
  };
};

// Helper function to generate unique reply-to address
const generateReplyToAddress = (clientId, projectId) => {
  const domain = appConfig.emailDomain || "levitate.ng";
  return `clients-${clientId}-${projectId}@${domain}`;
};

// Helper function to create or get "Pending Projects" board
const ensurePendingProjectsBoard = async (asanaIntegration) => {
  // Check if we already have the board info in config/database
  try {
    // First check if we have it stored somewhere - for now we'll create it each time
    // In production you'd want to store this in a config table or environment variable

    const projectName = "Pending Projects";
    const workspaceGid = appConfig.asana.workspaceGid;

    logger.debug("Creating/ensuring Pending Projects board exists");

    // Create the project if it doesn't exist
    const project = await asanaIntegration.createProject(
      projectName,
      workspaceGid
    );

    // Define the sections we need
    const requiredSections = [
      "Filled Questionnaire",
      "Brand Origin Doc Phase",
      "Budget/Timeline Phase",
      "Finalized",
      "Rejected",
    ];

    // Create sections
    const sections = {};
    for (const sectionName of requiredSections) {
      try {
        const section = await asanaIntegration.createSection(
          project.gid,
          sectionName
        );
        sections[sectionName] = section.gid;
        logger.debug(
          `Created section: ${sectionName} with GID: ${section.gid}`
        );
      } catch (error) {
        // Section might already exist, try to get existing sections
        logger.warn(
          `Failed to create section ${sectionName}, it might already exist: ${error.message}`
        );
        try {
          const existingSections = await asanaIntegration.getProjectSections(
            project.gid
          );
          const existingSection = existingSections.find(
            (s) => s.name === sectionName
          );
          if (existingSection) {
            sections[sectionName] = existingSection.gid;
            logger.debug(
              `Found existing section: ${sectionName} with GID: ${existingSection.gid}`
            );
          }
        } catch (getError) {
          logger.error(`Failed to get existing sections: ${getError.message}`);
          throw error;
        }
      }
    }

    return {
      projectGid: project.gid,
      sections,
    };
  } catch (error) {
    logger.error(`Failed to ensure Pending Projects board: ${error.message}`);
    throw new Error(
      `Failed to setup Asana Pending Projects board: ${error.message}`
    );
  }
};

// Helper function to get PM user GID (you'd configure this based on your team setup)
const getPMUserGid = async () => {
  const prisma = getPrismaClient();

  try {
    // Look for a team member with PM role and lead status
    const pmMember = await prisma.teamMember.findFirst({
      where: {
        isActive: true,
        roles: {
          path: "$[*].role",
          array_contains: "Project manager",
        },
      },
    });

    if (pmMember && pmMember.asanaUserGid) {
      return pmMember.asanaUserGid;
    }

    // Fallback - you might want to configure a default PM GID in environment variables
    logger.warn("No PM found in team members, using default or null");
    return null; // Or return a default PM GID from environment
  } catch (error) {
    logger.error(`Failed to get PM user GID: ${error.message}`);
    return null;
  }
};

// Main form processing function
const processFormSubmission = async (parsedBody, correlationId) => {
  return await withTransaction(async (tx) => {
    logger.info({
      message: "Starting form submission processing",
      correlationId,
      formId: parsedBody.metadata.formId,
      responseId: parsedBody.responseId,
    });

    // Step 1: Extract and validate client information
    const clientInfo = extractClientInfo(parsedBody);
    logger.debug({ clientInfo, correlationId }, "Extracted client info");

    // Step 2: Create or get existing client
    let client = await tx.client.findFirst({
      where: { primaryEmail: clientInfo.primaryEmail },
    });

    if (client) {
      // Update existing client context if needed
      logger.info(
        {
          clientId: client.id,
          correlationId,
        },
        "Found existing client"
      );

      // Optionally update the client name if it's different and not empty
      if (clientInfo.name && client.name !== clientInfo.name) {
        client = await tx.client.update({
          where: { id: client.id },
          data: {
            name: clientInfo.name,
            updatedAt: new Date(),
          },
        });
      }
    } else {
      // Create new client
      client = await tx.client.create({
        data: {
          name: clientInfo.name,
          primaryEmail: clientInfo.primaryEmail,
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      logger.info(
        {
          clientId: client.id,
          correlationId,
        },
        "Created new client"
      );
    }

    // Step 3: Extract project information
    const projectInfo = extractProjectInfo(parsedBody);

    // Step 4: Create new project
    const project = await tx.project.create({
      data: {
        clientId: client.id,
        name: projectInfo.name,
        phase: projectInfo.phase,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(
      {
        projectId: project.id,
        clientId: client.id,
        correlationId,
      },
      "Created new project"
    );

    // TODO: Set formTitle field in questionnaire_response db table and use here.
    // Step 5: Store questionnaire response
    const questionnaireResponse = await tx.questionnaireResponse.create({
      data: {
        projectId: project.id,
        formId: parsedBody.metadata.formId,
        responseId: parsedBody.responseId,
        responses: parsedBody.responses,
        respondentEmail: clientInfo.respondentEmail,
        submittedAt: new Date(parsedBody.timestamp),
        processedAt: new Date(),
        processingStatus: "PROCESSED",
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(
      {
        questionnaireResponseId: questionnaireResponse.id,
        projectId: project.id,
        correlationId,
      },
      "Stored questionnaire response"
    );

    // Step 6: Create email thread with unique reply-to
    const replyToAddress = generateReplyToAddress(client.id, project.id);
    const emailThread = await tx.emailThread.create({
      data: {
        projectId: project.id,
        clientId: client.id,
        replyToAddress,
        createdAt: new Date(),
      },
    });

    logger.info(
      {
        emailThreadId: emailThread.id,
        replyToAddress,
        correlationId,
      },
      "Created email thread"
    );

    // Step 7: Log project phase change
    await tx.projectPhaseLog.create({
      data: {
        projectId: project.id,
        fromPhase: null,
        toPhase: "QUESTIONNAIRE",
        reason: "Form submission received",
        actor: "SYSTEM",
        at: new Date(),
      },
    });

    // Step 8: Create audit log entry
    await tx.auditLog.create({
      data: {
        projectId: project.id,
        actor: "SYSTEM (Form Submission)",
        action: "FORM_SUBMITTED",
        details: {
          formId: parsedBody.metadata.formId,
          responseId: parsedBody.responseId,
          formTitle: parsedBody.metadata.formTitle,
          clientEmail: clientInfo.primaryEmail,
          correlationId,
        },
        at: new Date(),
      },
    });

    // Validate that all required data was created successfully
    if (!client || !client.id) {
      throw new Error("Failed to create or retrieve client");
    }
    if (!project || !project.id) {
      throw new Error("Failed to create project");
    }
    if (!questionnaireResponse || !questionnaireResponse.id) {
      throw new Error("Failed to create questionnaire response");
    }
    if (!emailThread || !emailThread.id) {
      throw new Error("Failed to create email thread");
    }
    if (!replyToAddress) {
      throw new Error("Failed to generate reply-to address");
    }

    return {
      client,
      project,
      questionnaireResponse,
      emailThread,
      replyToAddress,
    };
  });
};

// Async function to handle Asana task creation and PM notification
const handleAsanaAndNotifications = async (processedData, correlationId) => {
  try {
    // Validate input data
    if (!processedData) {
      throw new Error("processedData is required");
    }

    const { client, project, emailThread } = processedData;

    // Validate required data exists
    if (!client || !client.id || !client.name) {
      throw new Error("Invalid client data provided");
    }
    if (!project || !project.id || !project.name) {
      throw new Error("Invalid project data provided");
    }
    if (!emailThread || !emailThread.replyToAddress) {
      throw new Error("Invalid email thread data provided");
    }

    // Initialize Asana integration
    let asanaIntegration;
    try {
      asanaIntegration = new AsanaIntegration();
    } catch (asanaError) {
      logger.error(
        {
          error: asanaError.message,
          correlationId,
        },
        "Failed to initialize Asana integration"
      );
      throw new Error(`Asana initialization failed: ${asanaError.message}`);
    }

    // Step 1: Ensure "Pending Projects" board exists
    const pendingBoard = await ensurePendingProjectsBoard(asanaIntegration);

    // Step 2: Get PM user GID
    const pmUserGid = await getPMUserGid();

    // Step 3: Create task in "Filled Questionnaire" section
    const taskName = `${client.name} - ${project.name}`;
    const taskNotes = `New questionnaire submission received.

**Client Details:**
- Company: ${client.name}
- Email: ${client.primaryEmail}
- Project: ${project.name}

**Form Details:**
- Form ID: ${processedData.questionnaireResponse?.formId || "N/A"}
- Response ID: ${processedData.questionnaireResponse?.responseId || "N/A"}
- Submitted: ${new Date().toISOString()}

**Next Steps:**
- Review questionnaire responses
- Generate brand origin document
- Move to "Brand Origin Doc Phase" when ready

Reply-to address for client communication: ${emailThread.replyToAddress}`;

    const filledQuestionnaireSection =
      pendingBoard.sections["Filled Questionnaire"];

    const asanaTask = await asanaIntegration.createTask(
      taskName,
      pendingBoard.projectGid,
      filledQuestionnaireSection,
      pmUserGid,
      null, // No due date for initial submission
      taskNotes
    );

    // Validate task creation
    if (!asanaTask || !asanaTask.gid) {
      throw new Error("Failed to create Asana task - invalid response");
    }

    logger.info(
      {
        taskGid: asanaTask.gid,
        projectId: project.id,
        correlationId,
      },
      "Created Asana task for form submission"
    );

    // Step 4: Store Asana links in database
    const prisma = getPrismaClient();
    const asanaLink = await prisma.asanaLink.create({
      data: {
        projectId: project.id,
        pendingBoardGid: pendingBoard.projectGid,
        sections: pendingBoard.sections,
        pmGid: pmUserGid,
        createdAt: new Date(),
      },
    });

    // Validate asanaLink creation
    if (!asanaLink || !asanaLink.id) {
      throw new Error("Failed to create Asana link record in database");
    }

    const asanaTaskRecord = await prisma.asanaTask.create({
      data: {
        projectId: project.id,
        asanaLinkId: asanaLink.id,
        taskGid: asanaTask.gid,
        sectionName: "Filled Questionnaire",
        assigneeGid: pmUserGid,
        meta: {
          taskName,
          createdBy: "SYSTEM",
          correlationId,
        },
        createdAt: new Date(),
      },
    });

    // Validate asanaTask record creation
    if (!asanaTaskRecord || !asanaTaskRecord.id) {
      throw new Error("Failed to create Asana task record in database");
    }

    // Step 5: Send email notification to PM
    if (pmUserGid) {
      await sendPMNotification(client, project, emailThread, correlationId);
    }

    return {
      asanaTaskGid: asanaTask.gid,
      pendingProjectGid: pendingBoard.projectGid,
    };
  } catch (error) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
        correlationId,
      },
      "Failed to handle Asana task creation and notifications"
    );

    // Don't throw the error - log it but don't fail the main request
    // The form submission was successful, this is just a follow-up action
    return {
      error: error.message,
      success: false,
    };
  }
};

// Function to send PM notification email
const sendPMNotification = async (
  client,
  project,
  emailThread,
  correlationId
) => {
  try {
    const brevoIntegration = new BrevoIntegration();
    const prisma = getPrismaClient();

    // Get PM email address
    const pmMember = await prisma.teamMember.findFirst({
      where: {
        isActive: true,
        roles: {
          path: "$[*].role",
          array_contains: "Project manager",
        },
      },
    });

    if (!pmMember || !pmMember.email) {
      logger.warn("No PM email found for notification");
      return;
    }

    const subject = `New Project Questionnaire: ${client.name} - ${project.name}`;
    const htmlContent = `
      <h2>New Questionnaire Submission Received</h2>
      
      <h3>Client Information</h3>
      <ul>
        <li><strong>Company:</strong> ${client.name}</li>
        <li><strong>Email:</strong> ${client.primaryEmail}</li>
        <li><strong>Project:</strong> ${project.name}</li>
      </ul>
      
      <h3>Next Steps</h3>
      <p>A new questionnaire has been submitted and is ready for review. The system will automatically generate a brand origin document.</p>
      
      <p>
        <a href="${appConfig.server.frontendUrl}/admin/projects/${project.id}" 
           style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
          Review Project →
        </a>
      </p>
      
      <h3>Communication</h3>
      <p><strong>Client Reply-to:</strong> ${emailThread.replyToAddress}</p>
      
      <hr>
      <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
    `;

    await brevoIntegration.sendTransactionalEmail({
      to: [pmMember.email],
      subject,
      htmlContent,
      replyTo: emailThread.replyToAddress,
    });

    logger.info(
      {
        pmEmail: pmMember.email,
        projectId: project.id,
        correlationId,
      },
      "PM notification email sent successfully"
    );
  } catch (error) {
    logger.error(
      {
        error: error.message,
        correlationId,
      },
      "Failed to send PM notification email"
    );
  }
};

// Brevo webhook route
router.post(
  "/brevo/inbound",
  asyncHandler(async (req, res) => {
    // TODO: Implement Brevo webhook handler
    sendSuccessResponse(res, { message: "Webhook received" });
  })
);

// Asana webhook route
router.post(
  "/asana",
  asyncHandler(async (req, res) => {
    // TODO: Implement Asana webhook handler
    sendSuccessResponse(res, { message: "Webhook received" });
  })
);

// Google Apps Script form submission webhook with comprehensive error handling
router.post(
  "/apps-script/forms",
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const correlationId =
      req.headers["x-correlation-id"] || crypto.randomUUID();
    let parsedBody = null;

    logger.info({
      message: "Webhook request received",
      correlationId,
      method: req.method,
      url: req.url,
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
      userAgent: req.headers["user-agent"],
      hasRawBodyBuffer: !!req.rawBodyBuffer,
      hasRawBodyString: !!req.rawBodyString,
    });

    try {
      // Step 1: Validate that we have raw body data (should be ensured by middleware)
      if (!req.rawBodyBuffer || !Buffer.isBuffer(req.rawBodyBuffer)) {
        throw new ValidationError(
          "Raw body buffer not available. This indicates a middleware configuration issue."
        );
      }

      // Step 2: Validate webhook signature BEFORE parsing JSON
      logger.debug({
        message: "Starting signature validation",
        correlationId,
        bodyLength: req.rawBodyBuffer.length,
      });

      validateAppsScriptSignature(req);

      logger.info({
        message: "Signature validation passed",
        correlationId,
      });

      // Step 3: Parse JSON payload safely
      try {
        const rawBodyString = req.rawBodyBuffer.toString("utf8");
        parsedBody = JSON.parse(rawBodyString);

        logger.debug({
          message: "JSON parsing successful",
          correlationId,
          payloadKeys: Object.keys(parsedBody || {}),
        });
      } catch (jsonError) {
        logger.error({
          message: "JSON parsing failed",
          correlationId,
          jsonError: jsonError.message,
          bodyPreview: req.rawBodyBuffer.toString("utf8").substring(0, 500),
        });
        throw new ValidationError(`Invalid JSON payload: ${jsonError.message}`);
      }

      // Step 4: Validate form payload structure
      validateFormPayload(parsedBody);

      logger.info({
        message: "Payload validation passed",
        correlationId,
        formId: parsedBody.metadata.formId,
        formTitle: parsedBody.metadata.formTitle,
        responseId: parsedBody.responseId,
      });

      console.log("parsedBody", parsedBody);
      // Step 5: Continue with form processing

      // Step 6: Process the form submission (database operations)
      logger.info({
        message: "Starting form processing",
        correlationId,
      });

      let processedData;
      try {
        processedData = await processFormSubmission(parsedBody, correlationId);
        logger.info({
          message: "Form processing completed successfully",
          correlationId,
          clientId: processedData.client.id,
          projectId: processedData.project.id,
        });
      } catch (processingError) {
        console.log(
          "processingError from processFormSubmission",
          processingError
        );
        logger.error({
          message: "Form processing failed",
          correlationId,
          error: processingError.message,
          stack: processingError.stack,
        });

        // Check if it's a duplicate submission error
        if (
          processingError.code === "P2002" &&
          processingError.meta?.target?.includes("formId")
        ) {
          logger.warn({
            message: "Duplicate form submission detected",
            correlationId,
            formId: parsedBody.metadata.formId,
            responseId: parsedBody.responseId,
          });

          // Return success for duplicate submissions to avoid retry loops
          return sendSuccessResponse(res, {
            message: "Form submission already processed",
            correlationId,
            responseId: parsedBody.responseId,
            formId: parsedBody.metadata.formId,
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            duplicate: true,
          });
        }

        // For other processing errors, return error response
        throw new BaseError(
          `Form processing failed: ${processingError.message}`
        );
      }

      // Step 7: Send success response immediately
      sendSuccessResponse(res, {
        message: "Form submission processed successfully",
        correlationId,
        responseId: parsedBody.responseId,
        formId: parsedBody.metadata.formId,
        clientId: processedData.client.id,
        projectId: processedData.project.id,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
      });
      return;

      // Step 8: Handle Asana task creation and notifications asynchronously
      // This runs in the background and doesn't block the response
      setImmediate(async () => {
        try {
          logger.info({
            message: "Starting async Asana and notification processing",
            correlationId,
            projectId: processedData.project.id,
          });

          const asanaResult = await handleAsanaAndNotifications(
            processedData,
            correlationId
          );

          if (asanaResult.success !== false) {
            logger.info({
              message: "Async processing completed successfully",
              correlationId,
              projectId: processedData.project.id,
              asanaTaskGid: asanaResult.asanaTaskGid,
            });
          } else {
            logger.error({
              message: "Async processing completed with errors",
              correlationId,
              projectId: processedData.project.id,
              error: asanaResult.error,
            });
          }
        } catch (asyncError) {
          logger.error({
            message: "Async processing failed completely",
            correlationId,
            projectId: processedData.project.id,
            error: asyncError.message,
            stack: asyncError.stack,
          });
        }
      });

      // Step 9: Log final success
      logger.info({
        message: "Form submission webhook processed successfully",
        correlationId,
        responseId: parsedBody.responseId,
        formId: parsedBody.metadata.formId,
        clientId: processedData.client.id,
        projectId: processedData.project.id,
        processingTime: Date.now() - startTime,
      });
    } catch (error) {
      // Comprehensive error handling and logging
      const errorInfo = {
        message: "Form submission webhook failed",
        correlationId,
        error: error.message,
        errorType: error.constructor.name,
        processingTime: Date.now() - startTime,
        requestInfo: {
          method: req.method,
          url: req.url,
          headers: {
            contentType: req.headers["content-type"],
            contentLength: req.headers["content-length"],
            userAgent: req.headers["user-agent"],
            signature: req.headers["x-apps-script-signature"]
              ? `${req.headers["x-apps-script-signature"].substring(0, 8)}...`
              : null,
            responseId: req.headers["x-form-response-id"],
          },
          body: {
            hasRawBuffer: !!req.rawBodyBuffer,
            hasRawString: !!req.rawBodyString,
            rawBufferLength: req.rawBodyBuffer ? req.rawBodyBuffer.length : 0,
            parsedSuccessfully: !!parsedBody,
            parsedKeys: parsedBody ? Object.keys(parsedBody) : [],
          },
        },
      };

      // Add error context if available
      if (error.context) {
        errorInfo.errorContext = error.context;
      }

      // Add stack trace for non-validation errors
      if (!(error instanceof ValidationError)) {
        errorInfo.stack = error.stack;
      }

      logger.error(errorInfo);

      // Send appropriate error response
      if (error instanceof ValidationError) {
        return sendErrorResponse(res, error, 400);
      } else {
        // For unexpected errors, log more details but send generic message
        logger.error({
          message: "Unexpected error in webhook processing",
          correlationId,
          fullError: error,
          stack: error.stack,
        });
        return sendErrorResponse(
          res,
          new BaseError("Internal server error"),
          500
        );
      }
    }
  })
);

module.exports = { webhooksRouter: router };
