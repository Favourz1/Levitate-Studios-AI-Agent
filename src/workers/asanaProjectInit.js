const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError } = require("@/utils/errors");
const { asanaIntegration } = require("@/integrations/asana");
const {
  TeamMemberSelectionService,
} = require("@/services/teamMemberSelectionService");
const { AsanaProjectService } = require("@/services/asanaProjectService");
const {
  AuditActions,
  SystemActors,
  AsanaProjectBoardSections,
  DocumentType,
  DocumentStatus,
  ProjectPhase,
} = require("@/constants");
const {
  isValidProjectPhaseTransition,
} = require("@/utils/validation/commonValidation");
const { WorkplanPlannerService } = require("@/services/workplanPlannerService");
const { QueueService } = require("@/queues");

const logger = createLogger("worker:asanaProjectInit");
const prisma = getPrismaClient();

/**
 * Asana Project Initialization Processor
 * Creates Asana project, adds team members, generates description
 * Implements Phase 8.2 from Implementation Plan
 */
const asanaProjectInitProcessor = async (job) => {
  const startTime = Date.now();
  const { projectId, correlationId } = job.data;

  logger.info(
    {
      jobId: job.id,
      projectId,
      correlationId,
    },
    "Starting Asana project initialization"
  );

  try {
    // Step 1: Get project with all related data
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        documents: {
          where: {
            driveFileId: {
              not: null,
            },
            // Only get accepted brand origin and accepted quote with selectedQuoteId
            OR: [
              {
                type: DocumentType.BRAND_ORIGIN,
                status: DocumentStatus.ACCEPTED,
              },
              {
                type: DocumentType.QUOTE,
                status: DocumentStatus.ACCEPTED,
                selectedQuoteId: {
                  not: null,
                },
              },
            ],
          },
          orderBy: { updatedAt: "desc" },
        },
      },
    });

    if (!project) {
      throw new ValidationError(`Project not found: ${projectId}`);
    }

    if (!project.client) {
      throw new ValidationError(
        `Project ${projectId} has no associated client`
      );
    }

    logger.info(
      {
        projectId,
        projectName: project.name,
        clientName: project.client.name,
        correlationId,
      },
      "Project data retrieved successfully"
    );

    // Step 2: Create Asana project with board layout
    const projectName = `${project.name} - ${project.client.name}`;
    logger.info(
      {
        projectId,
        projectName,
        correlationId,
      },
      "Creating Asana project"
    );

    const asanaProject = await asanaIntegration.createProject(
      projectName,
      "", // Notes will be added later after description generation
      null // Team will be auto-selected by Asana integration
    );

    if (!asanaProject || !asanaProject.gid) {
      throw new Error("Failed to create Asana project - no GID returned");
    }

    const asanaProjectGid = asanaProject.gid;

    logger.info(
      {
        projectId,
        asanaProjectGid,
        correlationId,
      },
      "Asana project created successfully"
    );

    // Step 3: Create sections: "To Do", "In Progress", "In Review", "Completed"
    const sectionNames = [
      AsanaProjectBoardSections.TO_DO,
      AsanaProjectBoardSections.IN_PROGRESS,
      AsanaProjectBoardSections.IN_REVIEW,
      AsanaProjectBoardSections.COMPLETED,
    ];
    const sections = {};

    logger.info(
      {
        projectId,
        asanaProjectGid,
        sectionCount: sectionNames.length,
        correlationId,
      },
      "Creating project sections"
    );

    for (const sectionName of sectionNames) {
      try {
        const section = await asanaIntegration.createSection(
          asanaProjectGid,
          sectionName
        );

        if (!section || !section.gid) {
          throw new Error(`Failed to create section: ${sectionName}`);
        }

        sections[sectionName] = section.gid;

        logger.debug(
          {
            projectId,
            asanaProjectGid,
            sectionName,
            sectionGid: section.gid,
            correlationId,
          },
          "Section created successfully"
        );
      } catch (sectionError) {
        logger.error(
          {
            projectId,
            asanaProjectGid,
            sectionName,
            error: sectionError.message,
            correlationId,
          },
          "Failed to create section"
        );
        // Continue with other sections even if one fails
        // But log the error for visibility
      }
    }

    if (Object.keys(sections).length === 0) {
      throw new Error("Failed to create any sections in Asana project");
    }

    logger.info(
      {
        projectId,
        asanaProjectGid,
        sectionsCreated: Object.keys(sections).length,
        correlationId,
      },
      "All sections created successfully"
    );

    // Step 4: Store asana_project_gid, finalizedBoardGid, and sections in database
    await withTransaction(async (tx) => {
      // Get current project phase
      const currentProject = await tx.project.findUnique({
        where: { id: projectId },
        select: { phase: true },
      });

      // Update project with asana_project_gid
      await tx.project.update({
        where: { id: projectId },
        data: {
          asanaProjectGid: asanaProjectGid,
          updatedAt: new Date(),
        },
      });

      // Create or update asana_links record with sections and finalizedBoardGid
      const existingLink = await tx.asanaLink.findFirst({
        where: { projectId: projectId },
      });

      if (existingLink) {
        await tx.asanaLink.update({
          where: { id: existingLink.id },
          data: {
            finalizedBoardGid: asanaProjectGid, // Save the board GID as finalizedBoardGid
            sections: sections,
          },
        });
      } else {
        await tx.asanaLink.create({
          data: {
            projectId: projectId,
            finalizedBoardGid: asanaProjectGid, // Save the board GID as finalizedBoardGid
            sections: sections,
            createdAt: new Date(),
          },
        });
      }

      // Transition project phase from ASANA_INIT to WORKPLAN_GENERATION
      if (currentProject && currentProject.phase === ProjectPhase.ASANA_INIT) {
        if (
          isValidProjectPhaseTransition(
            ProjectPhase.ASANA_INIT,
            ProjectPhase.WORKPLAN_GENERATION
          )
        ) {
          await tx.project.update({
            where: { id: projectId },
            data: {
              phase: ProjectPhase.WORKPLAN_GENERATION,
              updatedAt: new Date(),
            },
          });

          // Log phase transition
          await tx.projectPhaseLog.create({
            data: {
              projectId,
              fromPhase: ProjectPhase.ASANA_INIT,
              toPhase: ProjectPhase.WORKPLAN_GENERATION,
              reason:
                "Asana project initialized successfully - starting workplan generation",
              actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
              at: new Date(),
            },
          });

          logger.info(
            {
              projectId,
              fromPhase: ProjectPhase.ASANA_INIT,
              toPhase: ProjectPhase.WORKPLAN_GENERATION,
              correlationId,
            },
            "Project phase transitioned to WORKPLAN_GENERATION"
          );
        } else {
          logger.warn(
            {
              projectId,
              currentPhase: currentProject.phase,
              correlationId,
            },
            "Invalid phase transition from ASANA_INIT to WORKPLAN_GENERATION"
          );
        }
      }
    });

    logger.info(
      {
        projectId,
        asanaProjectGid,
        correlationId,
      },
      "Project and sections stored in database"
    );

    // Step 5: Select team members using TeamMemberSelectionService
    logger.info(
      {
        projectId,
        correlationId,
      },
      "Selecting team members for project"
    );

    const selectedTeamMembers =
      await TeamMemberSelectionService.selectTeamMembersForProject(
        project,
        asanaIntegration
      );

    if (!selectedTeamMembers || selectedTeamMembers.length === 0) {
      logger.warn(
        {
          projectId,
          correlationId,
        },
        "No team members selected for project"
      );
    } else {
      logger.info(
        {
          projectId,
          teamMemberCount: selectedTeamMembers.length,
          teamMembers: selectedTeamMembers.map((m) => ({
            id: m.id,
            name: m.name,
            roles: m.roles,
          })),
          correlationId,
        },
        "Team members selected successfully"
      );

      // Step 6: Add selected team members to Asana project
      const memberGids = selectedTeamMembers
        .map((member) => member.asanaUserGid)
        .filter((gid) => gid && typeof gid === "string");

      if (memberGids.length > 0) {
        logger.info(
          {
            projectId,
            asanaProjectGid,
            memberCount: memberGids.length,
            correlationId,
          },
          "Adding team members to Asana project"
        );

        const addMembersResult = await asanaIntegration.addMembersToProject(
          asanaProjectGid,
          memberGids
        );

        logger.info(
          {
            projectId,
            asanaProjectGid,
            membersAdded: addMembersResult.membersAdded,
            totalMembers: addMembersResult.totalMembers,
            correlationId,
          },
          "Team members added to Asana project"
        );
      } else {
        logger.warn(
          {
            projectId,
            correlationId,
          },
          "No valid Asana user GIDs found for selected team members"
        );
      }
    }

    // Step 7: Generate project description (exclude financials)
    logger.info(
      {
        projectId,
        correlationId,
      },
      "Generating project description"
    );

    let projectDescription = "";
    try {
      projectDescription = await AsanaProjectService.generateProjectDescription(
        projectId
      );

      if (!projectDescription || projectDescription.trim().length === 0) {
        logger.warn(
          {
            projectId,
            correlationId,
          },
          "Generated project description is empty, using fallback"
        );
        projectDescription = `Project: ${project.name}\nClient: ${project.client.name}\n\nThis project has been initialized and is ready for task assignment.`;
      }
    } catch (descriptionError) {
      logger.error(
        {
          projectId,
          error: descriptionError.message,
          correlationId,
        },
        "Failed to generate project description, using fallback"
      );
      // Use fallback description
      projectDescription = `Project: ${project.name}\nClient: ${project.client.name}\n\nThis project has been initialized and is ready for task assignment.`;
    }

    // Step 8: Add description to Asana project
    logger.info(
      {
        projectId,
        asanaProjectGid,
        descriptionLength: projectDescription.length,
        correlationId,
      },
      "Updating Asana project description"
    );

    await asanaIntegration.updateProjectDescription(
      asanaProjectGid,
      projectDescription
    );

    logger.info(
      {
        projectId,
        asanaProjectGid,
        correlationId,
      },
      "Project description added to Asana project"
    );

    // Step 9: Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: AuditActions.ASANA_PROJECT_INITIALIZED,
        details: {
          asanaProjectGid,
          finalizedBoardGid: asanaProjectGid, // Also logged in audit
          sections,
          teamMembersCount: selectedTeamMembers?.length || 0,
          teamMembers:
            selectedTeamMembers?.map((m) => ({
              id: m.id,
              name: m.name,
              asanaUserGid: m.asanaUserGid,
            })) || [],
          descriptionLength: projectDescription.length,
          correlationId,
        },
        at: new Date(),
      },
    });

    // Step 10: Enqueue workplan generation (service type is cached if already determined)
    // Use reusable triggerWorkplanGeneration function to ensure consistency
    try {
      await triggerWorkplanGeneration(project.id, correlationId);
    } catch (workplanError) {
      // Don't fail the entire Asana init process if workplan job enqueue fails
      // It can be retried later - just log the error
      logger.error(
        {
          projectId,
          error: workplanError.message,
          correlationId,
        },
        "Failed to enqueue workplan generation job"
      );
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        projectId,
        asanaProjectGid,
        duration,
        correlationId,
      },
      "Asana project initialization completed successfully"
    );

    return {
      success: true,
      projectId,
      asanaProjectGid,
      sections,
      teamMembersCount: selectedTeamMembers?.length || 0,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        jobId: job.id,
        projectId,
        error: error.message,
        errorType: error.constructor.name,
        stack: error.stack,
        duration,
        correlationId,
      },
      "Asana project initialization failed"
    );

    // Create audit log for failure
    try {
      await prisma.auditLog.create({
        data: {
          projectId: projectId,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          action: "ASANA_PROJECT_INIT_FAILED",
          details: {
            error: error.message,
            errorType: error.constructor.name,
            correlationId,
          },
          at: new Date(),
        },
      });
    } catch (auditError) {
      logger.error(
        {
          projectId,
          auditError: auditError.message,
          correlationId,
        },
        "Failed to create audit log for initialization failure"
      );
    }

    throw error;
  }
};

/**
 * Trigger workplan generation job for a project
 * This function is extracted to be reusable by UI manual operations
 * @param {number} projectId - Project ID
 * @param {string} correlationId - Correlation ID
 * @returns {Promise<void>}
 */
async function triggerWorkplanGeneration(projectId, correlationId) {
  try {
    const serviceType = await WorkplanPlannerService.getServiceType(projectId);

    await QueueService.addWorkplanGenerationJob(
      {
        projectId,
        serviceType,
        correlationId,
      },
      5
    );

    logger.info(
      {
        projectId,
        serviceType,
        correlationId,
      },
      "Workplan generation job enqueued"
    );
  } catch (error) {
    logger.error(
      {
        projectId,
        correlationId,
        error: error.message,
      },
      "Failed to enqueue workplan generation job"
    );
    throw error;
  }
}

module.exports = {
  asanaProjectInitProcessor,
  triggerWorkplanGeneration,
};
