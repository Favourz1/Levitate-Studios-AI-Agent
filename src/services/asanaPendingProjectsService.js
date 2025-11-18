const crypto = require("crypto");
const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { asanaIntegration } = require("@/integrations/asana");
const { getConfig, setConfig, CONFIG_KEYS } = require("@/utils/globalConfig");
const {
  TeamRole,
  AsanaPendingProjectsBoardSections,
  SystemProjects,
  SystemActors,
} = require("@/constants");

const logger = createLogger("service:asana-pending-projects");

/**
 * AsanaPendingProjectsService handles all business logic related to the
 * "Pending Projects" board in Asana, including setup, verification, and task creation
 */
class AsanaPendingProjectsService {
  /**
   * Validates that all required sections exist in the stored configuration
   * @param {Object} storedConfig - Configuration from database
   * @returns {boolean} True if all sections are present and valid
   */
  static validateStoredSections(storedConfig) {
    if (
      !storedConfig ||
      !storedConfig.sections ||
      typeof storedConfig.sections !== "object"
    ) {
      return false;
    }

    const requiredSections = [
      AsanaPendingProjectsBoardSections.FILLED_QUESTIONNAIRE,
      AsanaPendingProjectsBoardSections.BRAND_ORIGIN_DOC_PHASE,
      AsanaPendingProjectsBoardSections.QUOTE_DOCUMENT_PHASE,
      AsanaPendingProjectsBoardSections.FINALIZED,
      AsanaPendingProjectsBoardSections.REJECTED,
    ];

    return requiredSections.every((sectionName) => {
      const sectionGid = storedConfig.sections[sectionName];
      return (
        sectionGid &&
        typeof sectionGid === "string" &&
        sectionGid.trim().length > 0
      );
    });
  }

  /**
   * Helper function to clean up invalid Pending Projects configuration
   * This handles edge cases where the configuration exists but references
   * deleted/invalid Asana resources
   *
   * @param {string} reason - Reason for cleanup
   * @param {string} correlationId - Correlation ID for logging
   */
  static async cleanupInvalidPendingProjectsConfig(reason, correlationId) {
    try {
      logger.warn(
        { correlationId, reason },
        "Cleaning up invalid Pending Projects configuration"
      );

      await setConfig(
        CONFIG_KEYS.ASANA_PENDING_PROJECTS,
        null,
        `Configuration invalidated: ${reason}`
      );

      logger.info(
        { correlationId, reason },
        "Invalid configuration cleaned up"
      );
    } catch (cleanupError) {
      logger.error(
        {
          correlationId,
          reason,
          error: cleanupError.message,
        },
        "Failed to cleanup invalid configuration"
      );
      // Don't throw - this is cleanup, not critical
    }
  }

  /**
   * Ensures the "Pending Projects" board exists in Asana and returns its configuration.
   * This function implements a database-first approach:
   * 1. Check if configuration exists in database
   * 2. If exists, verify the project still exists in Asana
   * 3. If doesn't exist or verification fails, create/recreate and store in database
   *
   * This prevents recreating the board on every form submission and provides
   * edge case handling if the board is accidentally deleted.
   *
   * @param {AsanaIntegration} asanaIntegrationInstance - Initialized Asana integration instance
   * @returns {Promise<{projectGid: string, sections: Object}>} Pending Projects board configuration
   * @throws {Error} If board setup fails after all retry attempts
   */
  static async ensureAsanaPendingProjectsBoard(
    asanaIntegrationInstance = asanaIntegration
  ) {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    try {
      logger.info(
        { correlationId },
        "Starting Pending Projects board verification"
      );

      // Step 1: Check if we have stored configuration
      let storedConfig = null;
      try {
        storedConfig = await getConfig(CONFIG_KEYS.ASANA_PENDING_PROJECTS);
        if (storedConfig) {
          logger.debug(
            {
              correlationId,
              projectGid: storedConfig.projectGid,
              sectionsCount: Object.keys(storedConfig.sections || {}).length,
            },
            "Found stored Pending Projects configuration"
          );
        }
      } catch (configError) {
        logger.warn(
          {
            correlationId,
            error: configError.message,
          },
          "Failed to retrieve stored configuration, will create new"
        );
      }

      // Step 2: If we have stored config, validate and verify it
      if (storedConfig && storedConfig.projectGid) {
        // First validate the stored configuration structure
        if (!this.validateStoredSections(storedConfig)) {
          logger.warn(
            {
              correlationId,
              projectGid: storedConfig.projectGid,
            },
            "Stored configuration has invalid section structure"
          );

          await this.cleanupInvalidPendingProjectsConfig(
            "Invalid section structure",
            correlationId
          );
        } else {
          // Configuration structure is valid, verify against Asana
          try {
            logger.debug(
              {
                correlationId,
                projectGid: storedConfig.projectGid,
              },
              "Verifying existing project in Asana"
            );

            // Try to get project details to verify it exists
            const existingProject = await asanaIntegrationInstance.getProject(
              storedConfig.projectGid
            );

            if (
              existingProject &&
              existingProject.gid === storedConfig.projectGid
            ) {
              // Verify sections still exist
              const existingSections =
                await asanaIntegrationInstance.getProjectSections(
                  storedConfig.projectGid
                );
              const existingSectionGids = new Set(
                existingSections.map((s) => s.gid)
              );

              // Check if all required sections exist
              const requiredSections = [
                AsanaPendingProjectsBoardSections.FILLED_QUESTIONNAIRE,
                AsanaPendingProjectsBoardSections.BRAND_ORIGIN_DOC_PHASE,
                AsanaPendingProjectsBoardSections.QUOTE_DOCUMENT_PHASE,
                AsanaPendingProjectsBoardSections.FINALIZED,
                AsanaPendingProjectsBoardSections.REJECTED,
              ];

              const allSectionsExist = requiredSections.every((sectionName) => {
                const sectionGid = storedConfig.sections[sectionName];
                return sectionGid && existingSectionGids.has(sectionGid);
              });

              if (allSectionsExist) {
                logger.info(
                  {
                    correlationId,
                    projectGid: storedConfig.projectGid,
                    duration: Date.now() - startTime,
                  },
                  "Pending Projects board verified successfully"
                );

                return {
                  projectGid: storedConfig.projectGid,
                  sections: storedConfig.sections,
                };
              } else {
                // Only recreate missing sections, don't delete the entire project
                logger.warn(
                  {
                    correlationId,
                    projectGid: storedConfig.projectGid,
                  },
                  "Some sections are missing, will recreate missing sections only"
                );

                const missingSections = requiredSections.filter(
                  (sectionName) => {
                    const sectionGid = storedConfig.sections[sectionName];
                    return !sectionGid || !existingSectionGids.has(sectionGid);
                  }
                );

                logger.info(
                  {
                    correlationId,
                    projectGid: storedConfig.projectGid,
                    missingSections,
                  },
                  "Recreating missing sections"
                );

                // Recreate only missing sections
                const updatedSections = { ...storedConfig.sections };
                const sectionErrors = [];

                for (const sectionName of missingSections) {
                  try {
                    logger.debug(
                      {
                        correlationId,
                        projectGid: storedConfig.projectGid,
                        sectionName,
                      },
                      "Creating missing section"
                    );

                    const section =
                      await asanaIntegrationInstance.createSection(
                        storedConfig.projectGid,
                        sectionName
                      );

                    if (!section || !section.gid) {
                      throw new Error(
                        `Invalid section response for ${sectionName}`
                      );
                    }

                    updatedSections[sectionName] = section.gid;
                    logger.info(
                      {
                        correlationId,
                        sectionName,
                        sectionGid: section.gid,
                      },
                      "Missing section recreated successfully"
                    );
                  } catch (sectionError) {
                    logger.error(
                      {
                        correlationId,
                        sectionName,
                        error: sectionError.message,
                      },
                      "Failed to recreate missing section"
                    );
                    sectionErrors.push(
                      `Failed to recreate section "${sectionName}": ${sectionError.message}`
                    );
                  }
                }

                // Check if all missing sections were successfully recreated
                const stillMissingSections = missingSections.filter(
                  (name) => !updatedSections[name]
                );
                if (stillMissingSections.length > 0) {
                  logger.error(
                    {
                      correlationId,
                      projectGid: storedConfig.projectGid,
                      stillMissingSections,
                      sectionErrors,
                    },
                    "Failed to recreate some sections, will fall back to full recreation"
                  );

                  // Only fall back to full recreation if we can't recreate sections
                  await this.cleanupInvalidPendingProjectsConfig(
                    `Failed to recreate sections: ${stillMissingSections.join(
                      ", "
                    )}`,
                    correlationId
                  );
                } else {
                  // Successfully recreated all missing sections, update stored config
                  const updatedConfig = {
                    ...storedConfig,
                    sections: updatedSections,
                    lastVerified: new Date().toISOString(),
                  };

                  try {
                    await setConfig(
                      CONFIG_KEYS.ASANA_PENDING_PROJECTS,
                      updatedConfig,
                      "Updated configuration after recreating missing sections"
                    );

                    logger.info(
                      {
                        correlationId,
                        projectGid: storedConfig.projectGid,
                        recreatedSections: missingSections,
                        duration: Date.now() - startTime,
                      },
                      "Missing sections recreated and configuration updated"
                    );

                    return {
                      projectGid: storedConfig.projectGid,
                      sections: updatedSections,
                    };
                  } catch (configError) {
                    logger.error(
                      {
                        correlationId,
                        projectGid: storedConfig.projectGid,
                        error: configError.message,
                      },
                      "Failed to update configuration after recreating sections"
                    );

                    // Even if config update fails, sections were recreated successfully
                    return {
                      projectGid: storedConfig.projectGid,
                      sections: updatedSections,
                    };
                  }
                }
              }
            } else {
              logger.warn(
                {
                  correlationId,
                  projectGid: storedConfig.projectGid,
                },
                "Project not found in Asana, will recreate"
              );

              await this.cleanupInvalidPendingProjectsConfig(
                "Project not found in Asana",
                correlationId
              );
            }
          } catch (verificationError) {
            logger.warn(
              {
                correlationId,
                projectGid: storedConfig.projectGid,
                error: verificationError.message,
              },
              "Failed to verify existing project, will create new"
            );

            // Check if it's a specific Asana error that indicates the project was deleted
            if (
              verificationError.message.includes("Not Found") ||
              verificationError.message.includes("404") ||
              verificationError.message.includes("does not exist")
            ) {
              await this.cleanupInvalidPendingProjectsConfig(
                "Project deleted from Asana",
                correlationId
              );
            }
          }
        }
      }

      // Step 3: Create or recreate the Pending Projects board
      logger.info({ correlationId }, "Creating Pending Projects board");

      const projectName = SystemProjects.PENDING_PROJECTS_NAME;
      const { appConfig } = require("@/config");
      const workspaceGid = appConfig.asana.workspaceGid;

      if (!workspaceGid) {
        throw new Error("Asana workspace GID not configured");
      }

      // Create the project
      let project;
      try {
        project = await asanaIntegrationInstance.createProject(
          projectName,
          SystemProjects.PENDING_PROJECTS_DESCRIPTION,
          null // Let the method auto-detect the team
        );

        if (!project || !project.gid) {
          throw new Error(
            "Failed to create project - invalid response from Asana"
          );
        }

        logger.info(
          {
            correlationId,
            projectGid: project.gid,
          },
          "Pending Projects project created successfully"
        );
      } catch (createError) {
        logger.error(
          {
            correlationId,
            error: createError.message,
          },
          "Failed to create Pending Projects project"
        );
        throw new Error(
          `Failed to create Pending Projects project: ${createError.message}`
        );
      }

      // Step 4: Create required sections
      const requiredSections = [
        AsanaPendingProjectsBoardSections.FILLED_QUESTIONNAIRE,
        AsanaPendingProjectsBoardSections.BRAND_ORIGIN_DOC_PHASE,
        AsanaPendingProjectsBoardSections.QUOTE_DOCUMENT_PHASE,
        AsanaPendingProjectsBoardSections.FINALIZED,
        AsanaPendingProjectsBoardSections.REJECTED,
      ];

      const sections = {};
      const sectionErrors = [];

      for (const sectionName of requiredSections) {
        try {
          logger.debug(
            {
              correlationId,
              projectGid: project.gid,
              sectionName,
            },
            "Creating section"
          );

          const section = await asanaIntegrationInstance.createSection(
            project.gid,
            sectionName
          );

          if (!section || !section.gid) {
            throw new Error(`Invalid section response for ${sectionName}`);
          }

          sections[sectionName] = section.gid;
          logger.debug(
            {
              correlationId,
              sectionName,
              sectionGid: section.gid,
            },
            "Section created successfully"
          );
        } catch (sectionError) {
          logger.warn(
            {
              correlationId,
              sectionName,
              error: sectionError.message,
            },
            "Failed to create section, trying to find existing"
          );

          // Try to find existing section
          try {
            const existingSections =
              await asanaIntegrationInstance.getProjectSections(project.gid);
            const existingSection = existingSections.find(
              (s) => s.name === sectionName
            );

            if (existingSection && existingSection.gid) {
              sections[sectionName] = existingSection.gid;
              logger.info(
                {
                  correlationId,
                  sectionName,
                  sectionGid: existingSection.gid,
                },
                "Found existing section"
              );
            } else {
              sectionErrors.push(
                `Section "${sectionName}" not found and could not be created`
              );
            }
          } catch (getError) {
            logger.error(
              {
                correlationId,
                sectionName,
                error: getError.message,
              },
              "Failed to get existing sections"
            );
            sectionErrors.push(
              `Failed to create or find section "${sectionName}": ${sectionError.message}`
            );
          }
        }
      }

      // Validate that all required sections were created/found
      const missingSections = requiredSections.filter(
        (name) => !sections[name]
      );
      if (missingSections.length > 0) {
        const errorMessage = `Missing required sections: ${missingSections.join(
          ", "
        )}`;
        logger.error(
          {
            correlationId,
            projectGid: project.gid,
            missingSections,
            sectionErrors,
          },
          errorMessage
        );
        throw new Error(errorMessage);
      }

      // Step 5: Store configuration in database
      const configValue = {
        projectGid: project.gid,
        sections,
        lastVerified: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        workspaceGid,
      };

      try {
        await setConfig(
          CONFIG_KEYS.ASANA_PENDING_PROJECTS,
          configValue,
          "Configuration for the persistent Pending Projects board in Asana"
        );

        logger.info(
          {
            correlationId,
            projectGid: project.gid,
            sectionsCount: Object.keys(sections).length,
          },
          "Pending Projects configuration stored in database"
        );
      } catch (configError) {
        logger.error(
          {
            correlationId,
            projectGid: project.gid,
            error: configError.message,
          },
          "Failed to store configuration in database - board created but not cached"
        );

        // Don't fail the entire operation if we can't store config
        // The board was created successfully
      }

      const duration = Date.now() - startTime;
      logger.info(
        {
          correlationId,
          projectGid: project.gid,
          sectionsCount: Object.keys(sections).length,
          duration,
        },
        "Pending Projects board setup completed successfully"
      );

      return {
        projectGid: project.gid,
        sections,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        {
          correlationId,
          error: error.message,
          stack: error.stack,
          duration,
        },
        "Failed to ensure Pending Projects board"
      );

      throw new Error(
        `Failed to setup Asana Pending Projects board: ${error.message}`
      );
    }
  }

  /**
   * Helper function to get PM user GID (configured based on team setup)
   * Attempts to find the appropriate Project Manager in the following order:
   * 1. If projectId provided, looks up PM from project's asanaLink record
   * 2. Searches for a lead Project Manager in TeamMembers
   * 3. Falls back to any active Project Manager if no lead found
   *
   * @param {number} [projectId] - Optional project ID to look up assigned PM
   * @returns {Promise<Object|null>} PM user data containing:
   *   - id {number} - TeamMember ID
   *   - name {string} - PM's name
   *   - email {string} - PM's email
   *   - asanaUserGid {string} - PM's Asana user GID
   *   - roles {Array<{role: string, isLead: boolean}>} - PM's roles
   *   - isActive {boolean} - Whether PM is active
   *   - createdAt {Date} - When PM was created
   * @returns {null} If no active PM found or error occurs
   */
  static async getPMUser(projectId) {
    const prisma = getPrismaClient();

    try {
      // If projectId provided, first try to get PM from asana links
      if (projectId != null) {
        const asanaLink = await prisma.asanaLink.findFirst({
          where: {
            projectId: projectId,
            pmGid: {
              not: null,
            },
          },
          select: {
            pmGid: true,
          },
        });

        // If PM GID found in asana links, try to match team member
        if (asanaLink?.pmGid) {
          const pmMember = await prisma.teamMember.findFirst({
            where: {
              isActive: true,
              asanaUserGid: asanaLink.pmGid,
            },
          });

          if (pmMember) {
            return pmMember;
          }
        }
      }

      // Fallback: Find lead project manager from team members
      let pmMember = await prisma.teamMember.findFirst({
        where: {
          isActive: true,
          roles: {
            array_contains: [
              {
                role: TeamRole.PROJECT_MANAGER,
                isLead: true,
              },
            ],
          },
        },
      });

      // If no lead PM found, fall back to any project manager
      if (!pmMember) {
        pmMember = await prisma.teamMember.findFirst({
          where: {
            isActive: true,
            roles: {
              array_contains: [
                {
                  role: TeamRole.PROJECT_MANAGER,
                },
              ],
            },
          },
        });
      }

      if (pmMember && pmMember.asanaUserGid) {
        return pmMember;
      }

      logger.warn("No active project manager found in team members");
      return null;
    } catch (error) {
      logger.error(`Failed to get PM user GID: ${error.message}`);
      return null;
    }
  }

  /**
   * Helper function to get Finance Manager user GID (similar to getPMUser)
   * @param {number} [projectId]
   * @returns {Promise<Object|null>}
   */
  static async getFinanceManager(projectId) {
    const prisma = getPrismaClient();

    try {
      if (projectId != null) {
        const asanaLink = await prisma.asanaLink.findFirst({
          where: {
            projectId,
            financeGid: {
              not: null,
            },
          },
          select: {
            financeGid: true,
          },
        });

        if (asanaLink?.financeGid) {
          const financeMember = await prisma.teamMember.findFirst({
            where: {
              isActive: true,
              asanaUserGid: asanaLink.financeGid,
            },
          });

          if (financeMember) {
            return financeMember;
          }
        }
      }

      let financeMember = await prisma.teamMember.findFirst({
        where: {
          isActive: true,
          roles: {
            array_contains: [
              {
                role: TeamRole.FINANCE_MANAGER,
                isLead: true,
              },
            ],
          },
        },
      });

      if (!financeMember) {
        financeMember = await prisma.teamMember.findFirst({
          where: {
            isActive: true,
            roles: {
              array_contains: [
                {
                  role: TeamRole.FINANCE_MANAGER,
                },
              ],
            },
          },
        });
      }

      if (financeMember && financeMember.asanaUserGid) {
        return financeMember;
      }

      logger.warn("No active finance manager found in team members");
      return null;
    } catch (error) {
      logger.error(`Failed to get Finance Manager user: ${error.message}`);
      return null;
    }
  }

  /**
   * Move the Pending Projects task for a project to a specified section
   * @param {number} projectId
   * @param {string} targetSectionName
   * @param {Object} options
   * @param {string} [options.correlationId]
   * @returns {Promise<Object|null>}
   */
  static async moveTaskToSection(projectId, targetSectionName, options = {}) {
    const prisma = getPrismaClient();
    const correlationId = options.correlationId;

    try {
      const pendingBoard = await this.ensureAsanaPendingProjectsBoard();

      if (!pendingBoard?.sections?.[targetSectionName]) {
        logger.warn(
          {
            projectId,
            targetSectionName,
            correlationId,
          },
          "Target section not found in Pending Projects configuration"
        );
        return null;
      }

      const asanaLink = await prisma.asanaLink.findFirst({
        where: {
          projectId,
          pendingBoardGid: pendingBoard.projectGid,
        },
        include: {
          tasks: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!asanaLink || !asanaLink.tasks || asanaLink.tasks.length === 0) {
        logger.warn(
          {
            projectId,
            targetSectionName,
            correlationId,
          },
          "No Asana task found for project - cannot move section"
        );
        return null;
      }

      const asanaTask = asanaLink.tasks[0];
      const sectionGid = pendingBoard.sections[targetSectionName];

      await asanaIntegration.moveTaskToSection(
        asanaTask.taskGid,
        pendingBoard.projectGid,
        sectionGid
      );

      try {
        await prisma.asanaTask.update({
          where: { id: asanaTask.id },
          data: {
            sectionName: targetSectionName,
          },
        });
      } catch (updateError) {
        logger.warn(
          {
            projectId,
            targetSectionName,
            updateError: updateError.message,
            correlationId,
          },
          "Failed to update Asana task section in database after move"
        );
      }

      logger.info(
        {
          projectId,
          targetSectionName,
          taskGid: asanaTask.taskGid,
          sectionGid,
          correlationId,
        },
        "Asana task moved to target section successfully"
      );

      return {
        taskGid: asanaTask.taskGid,
        sectionGid,
        projectGid: pendingBoard.projectGid,
      };
    } catch (error) {
      logger.error(
        {
          projectId,
          targetSectionName,
          error: error.message,
          correlationId,
        },
        "Failed to move Asana task to target section"
      );
      return null;
    }
  }

  /**
   * Creates an Asana task in the Pending Projects board and stores relevant records
   * @param {Object} processedData - Form processing result data
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Task creation result with Asana task GID and board info
   */
  static async createPendingProjectTask(processedData, correlationId) {
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

      // Step 1: Ensure Pending Projects board exists
      const pendingBoard = await this.ensureAsanaPendingProjectsBoard();

      // Step 2: Get PM user GID
      const pmUser = await this.getPMUser();
      const pmUserGid = pmUser?.asanaUserGid;

      // Step 3: Create task in Filled Questionnaire section
      const taskName = `${client.name} - ${project.name}`;
      const submissionDate = new Date();
      const formattedDate = submissionDate.toLocaleString("en-NG", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short",
      });
      const taskNotes = `New questionnaire submission received.

*Client Details:*
- Company: ${client.name}
- Email: ${client.primaryEmail}
- Project: ${project.name}

*Form Details:*
- Form ID: ${processedData.questionnaireResponse?.formId || "N/A"}
- Response ID: ${processedData.questionnaireResponse?.responseId || "N/A"}
- Submitted: ${formattedDate}

*Next Steps:*
- Review questionnaire responses
- Review brand origin document when ready

Reply-to address for client communication: ${emailThread.replyToAddress}`;

      const filledQuestionnaireSection =
        pendingBoard.sections[
          AsanaPendingProjectsBoardSections.FILLED_QUESTIONNAIRE
        ];

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
          sectionName: AsanaPendingProjectsBoardSections.FILLED_QUESTIONNAIRE,
          assigneeGid: pmUserGid,
          meta: {
            taskName,
            createdBy: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
            correlationId,
          },
          createdAt: new Date(),
        },
      });

      // Validate asanaTask record creation
      if (!asanaTaskRecord || !asanaTaskRecord.id) {
        throw new Error("Failed to create Asana task record in database");
      }

      return {
        asanaTaskGid: asanaTask.gid,
        pendingProjectGid: pendingBoard.projectGid,
        asanaLinkId: asanaLink.id,
        taskRecordId: asanaTaskRecord.id,
      };
    } catch (error) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          correlationId,
        },
        "Failed to create pending project task"
      );

      // Re-throw with more context
      throw new Error(
        `Failed to create Asana pending project task: ${error.message}`
      );
    }
  }
}

module.exports = { AsanaPendingProjectsService };
