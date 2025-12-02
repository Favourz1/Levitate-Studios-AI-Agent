const asana = require("asana");
const { appConfig } = require("@/config");
const { AsanaError } = require("@/utils/errors");
const { createLogger, logIntegrationCall } = require("@/utils/logger");
const { retry, sleep } = require("@/utils");

const logger = createLogger("integration:asana");

// Asana API client for v3 SDK
class AsanaIntegration {
  constructor() {
    // Validate that asana module is available and has v3 structure
    if (!asana || !asana.ApiClient) {
      throw new Error(
        "Asana client library is not properly installed or imported. Expected v3 SDK structure."
      );
    }

    // Validate that access token is configured
    if (!appConfig.asana?.accessToken) {
      throw new Error("Asana access token is not configured");
    }

    try {
      // Initialize v3 SDK client
      this.apiClient = asana.ApiClient.instance;

      // Configure authentication
      const token = this.apiClient.authentications["token"];
      if (!token) {
        throw new Error("Token authentication not available in Asana client");
      }
      token.accessToken = appConfig.asana.accessToken;

      // Initialize API instances
      this.projectsApi = new asana.ProjectsApi();
      this.sectionsApi = new asana.SectionsApi();
      this.workspacesApi = new asana.WorkspacesApi();
      this.usersApi = new asana.UsersApi();
      this.webhooksApi = new asana.WebhooksApi();
      this.teamsApi = new asana.TeamsApi();

      // Initialize TasksApi
      this.tasksApi = new asana.TasksApi();

      // Initialize StoriesApi for comments
      this.storiesApi = new asana.StoriesApi();

      // Validate the client was configured successfully
      if (!this.apiClient || !this.projectsApi) {
        throw new Error("Failed to initialize Asana v3 client");
      }

      logger.info("Asana v3 client initialized successfully");
    } catch (error) {
      logger.error(
        { error: error.message },
        "Failed to initialize Asana v3 client"
      );
      throw new AsanaError("client_initialization", error);
    }
  }

  // Handle rate limiting automatically
  async handleRateLimit(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error.status === 429) {
        const retryAfter = error.retryAfter || 60; // Default to 60 seconds if not specified
        logger.warn(
          { retryAfter },
          "Rate limited by Asana, waiting before retry"
        );
        await sleep(retryAfter * 1000);
        return operation(); // Retry once after waiting
      }
      throw error;
    }
  }

  // Get workspace information
  async getWorkspace() {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const workspaceGid = appConfig.asana.workspaceGid;
            const opts = {};

            const response = await this.workspacesApi.getWorkspace(
              workspaceGid,
              opts
            );
            const workspace = response.data;

            return {
              gid: workspace.gid,
              name: workspace.name,
              email_domains: workspace.email_domains || [],
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "getWorkspace", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "getWorkspace",
        false,
        duration,
        error
      );
      throw new AsanaError("getWorkspace", error);
    }
  }

  // Create a new project
  async createProject(name, notes = "", team = null) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            // Prepare the request body according to Asana SDK v3.1.1 format
            const projectData = {
              name,
              workspace: appConfig.asana.workspaceGid,
              layout: "board",
            };

            // Add notes if provided and not empty
            if (notes && notes.trim().length > 0) {
              projectData.notes = notes;
            }

            // For organization workspaces, team is usually required
            // If no team is provided, try to get a default team
            if (team) {
              projectData.team = team;
            } else {
              // Try to get a default team from the workspace
              try {
                const teams = await this.getTeamsForWorkspace();
                if (teams && teams.length > 0) {
                  projectData.team = teams[0].gid;
                  logger.info(
                    `Using default team: ${teams[0].gid} (${teams[0].name}) for project creation`
                  );
                } else {
                  logger.info(
                    "No teams found in workspace, creating project without team (personal workspace)"
                  );
                }
              } catch (teamError) {
                logger.warn(
                  "Could not fetch teams for workspace, will attempt project creation without team",
                  teamError
                );
                // Don't add team field if we can't fetch teams - might be a personal workspace
              }
            }

            const requestBody = {
              data: projectData,
            };

            const opts = {};
            const response = await this.projectsApi.createProject(
              requestBody,
              opts
            );

            // Extract project data from response
            const project = response.data;

            // Validate response structure
            if (!project || !project.gid) {
              throw new Error(
                "Invalid response from Asana API: missing project data"
              );
            }

            return {
              gid: project.gid,
              name: project.name || name,
              notes: project.notes || "",
              team: project.team?.gid || "",
              workspace: project.workspace?.gid || appConfig.asana.workspaceGid,
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "createProject", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "createProject",
        false,
        duration,
        error
      );
      throw new AsanaError("createProject", error, {
        name,
        notes,
        team,
      });
    }
  }

  // Get project by GID
  async getProject(projectGid) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const opts = {};
            const response = await this.projectsApi.getProject(
              projectGid,
              opts
            );
            const project = response.data;

            return {
              gid: project.gid,
              name: project.name,
              notes: project.notes,
              team: project.team?.gid || "",
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "getProject", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "getProject", false, duration, error);
      throw new AsanaError("getProject", error, { projectGid });
    }
  }

  // Update project description/notes
  async updateProjectDescription(projectGid, description) {
    const startTime = Date.now();

    try {
      if (!projectGid || typeof projectGid !== "string") {
        throw new Error("projectGid is required and must be a string");
      }

      if (description === undefined || description === null) {
        throw new Error("description is required");
      }

      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const requestBody = {
              data: {
                notes: description || "",
              },
            };

            const opts = {};
            const response = await this.projectsApi.updateProject(
              requestBody,
              projectGid,
              opts
            );
            const project = response.data;

            return {
              gid: project.gid,
              name: project.name,
              notes: project.notes || "",
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "updateProjectDescription",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "updateProjectDescription",
        false,
        duration,
        error
      );
      throw new AsanaError("updateProjectDescription", error, {
        projectGid,
        descriptionLength: description?.length || 0,
      });
    }
  }

  // Add members to a project
  async addMembersToProject(projectGid, memberGids) {
    const startTime = Date.now();

    try {
      if (!projectGid || typeof projectGid !== "string") {
        throw new Error("projectGid is required and must be a string");
      }

      if (!Array.isArray(memberGids) || memberGids.length === 0) {
        throw new Error("memberGids is required and must be a non-empty array");
      }

      // Validate each memberGid is a string
      const invalidGids = memberGids.filter(
        (gid) => !gid || typeof gid !== "string" || gid.trim().length === 0
      );
      if (invalidGids.length > 0) {
        throw new Error(
          `Invalid memberGids found: ${invalidGids.length} invalid entries. All memberGids must be non-empty strings.`
        );
      }

      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            // Add members one by one (Asana API doesn't support batch add)
            const results = [];
            for (const memberGid of memberGids) {
              try {
                const requestBody = {
                  data: {
                    user: memberGid,
                  },
                };

                const opts = {};
                await this.projectsApi.addUserForProject(
                  requestBody,
                  projectGid,
                  opts
                );

                results.push({
                  gid: memberGid,
                  success: true,
                });
              } catch (memberError) {
                // If member is already in project, that's okay - continue
                if (
                  memberError.status === 400 &&
                  memberError.message?.includes("already")
                ) {
                  logger.debug(
                    { projectGid, memberGid },
                    "Member already in project, skipping"
                  );
                  results.push({
                    gid: memberGid,
                    success: true,
                    alreadyMember: true,
                  });
                } else {
                  logger.warn(
                    {
                      projectGid,
                      memberGid,
                      error: memberError.message,
                    },
                    "Failed to add member to project"
                  );
                  results.push({
                    gid: memberGid,
                    success: false,
                    error: memberError.message,
                  });
                }
              }
            }

            return {
              projectGid,
              membersAdded: results.filter((r) => r.success).length,
              totalMembers: memberGids.length,
              results,
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "addMembersToProject",
        true,
        duration,
        {
          projectGid,
          membersCount: memberGids.length,
          successCount: result.membersAdded,
        }
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "addMembersToProject",
        false,
        duration,
        error
      );
      throw new AsanaError("addMembersToProject", error, {
        projectGid,
        memberCount: memberGids?.length || 0,
      });
    }
  }

  // Create sections in a project
  async createSection(projectGid, name) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            // Prepare the request body according to Asana SDK v3.1.1 format
            // NOTE: project_gid is passed as URL parameter, NOT in the data body
            const opts = {
              body: {
                data: {
                  name,
                  // Do NOT include project field - it's already in the URL path
                },
              },
            };

            const response = await this.sectionsApi.createSectionForProject(
              projectGid,
              opts
            );
            const section = response.data;

            // Validate response structure
            if (!section || !section.gid) {
              throw new Error(
                "Invalid response from Asana API: missing section data"
              );
            }

            return {
              gid: section.gid,
              name: section.name || name,
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "createSection", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "createSection",
        false,
        duration,
        error
      );
      throw new AsanaError("createSection", error, {
        projectGid,
        name,
      });
    }
  }

  // Get sections in a project
  async getProjectSections(projectGid) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const opts = {};
            const response = await this.sectionsApi.getSectionsForProject(
              projectGid,
              opts
            );

            return response.data.map((section) => ({
              gid: section.gid,
              name: section.name,
            }));
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "getProjectSections", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "getProjectSections",
        false,
        duration,
        error
      );
      throw new AsanaError("getProjectSections", error, {
        projectGid,
      });
    }
  }

  // Create a task
  async createTask(name, projectGid, sectionGid, assigneeGid, dueOn, notes) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            // Prepare the request body according to Asana SDK v3.1.1 format
            const taskData = {
              name,
              notes,
              projects: [projectGid],
            };

            // Only add assignee if provided
            if (assigneeGid) {
              taskData.assignee = assigneeGid;
            }

            // Only add due date if provided
            if (dueOn) {
              taskData.due_on = dueOn;
            }

            // Only add memberships if sectionGid is provided
            if (sectionGid) {
              taskData.memberships = [
                {
                  project: projectGid,
                  section: sectionGid,
                },
              ];
            }

            const requestBody = {
              data: taskData,
            };

            const opts = {};
            const response = await this.tasksApi.createTask(requestBody, opts);
            const task = response.data;

            // Validate response structure
            if (!task || !task.gid) {
              throw new Error(
                "Invalid response from Asana API: missing task data"
              );
            }

            return {
              gid: task.gid,
              name: task.name || name,
              notes: task.notes || "",
              assignee: task.assignee?.gid || null,
              due_on: task.due_on || null,
              projects: task.projects?.map((p) => p.gid) || [],
              memberships: task.memberships || [],
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "createTask", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "createTask", false, duration, error);
      throw new AsanaError("createTask", error, {
        name,
        projectGid,
        sectionGid,
        assigneeGid,
        dueOn,
      });
    }
  }

  // Update task
  async updateTask(taskGid, updates) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            // Prepare the request body according to Asana SDK v3.1.1 format
            const requestBody = {
              data: updates,
            };

            const opts = {};
            const response = await this.tasksApi.updateTask(
              requestBody,
              taskGid,
              opts
            );
            const task = response.data;

            return {
              gid: task.gid,
              name: task.name,
              notes: task.notes,
              assignee: task.assignee?.gid,
              due_on: task.due_on,
              projects: task.projects?.map((p) => p.gid) || [],
              memberships: task.memberships || [],
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "updateTask", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "updateTask", false, duration, error);
      throw new AsanaError("updateTask", error, { taskGid, updates });
    }
  }

  /**
   * Move a task to a specific section within a project
   * @param {string} taskGid - The GID of the task to move (required)
   * @param {string} projectGid - The GID of the project containing the task (required)
   * @param {string} sectionGid - The GID of the target section (required)
   * @returns {Promise<void>} Resolves when task is successfully moved
   * @throws {AsanaError} When the operation fails or parameters are invalid
   * @public
   */
  async moveTaskToSection(taskGid, projectGid, sectionGid) {
    const startTime = Date.now();

    // Validate required parameters
    if (
      !taskGid ||
      typeof taskGid !== "string" ||
      taskGid.trim().length === 0
    ) {
      throw new AsanaError(
        "moveTaskToSection",
        new Error("taskGid is required and must be a non-empty string"),
        {
          taskGid,
          projectGid,
          sectionGid,
        }
      );
    }

    if (
      !projectGid ||
      typeof projectGid !== "string" ||
      projectGid.trim().length === 0
    ) {
      throw new AsanaError(
        "moveTaskToSection",
        new Error("projectGid is required and must be a non-empty string"),
        {
          taskGid,
          projectGid,
          sectionGid,
        }
      );
    }

    if (
      !sectionGid ||
      typeof sectionGid !== "string" ||
      sectionGid.trim().length === 0
    ) {
      throw new AsanaError(
        "moveTaskToSection",
        new Error("sectionGid is required and must be a non-empty string"),
        {
          taskGid,
          projectGid,
          sectionGid,
        }
      );
    }

    try {
      await retry(
        async () => {
          return this.handleRateLimit(async () => {
            // Prepare the request body according to Asana SDK v3.1.1 format
            const opts = {
              body: {
                data: {
                  task: taskGid.trim(),
                },
              },
            };

            await this.sectionsApi.addTaskForSection(sectionGid.trim(), opts);
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "moveTaskToSection", true, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "moveTaskToSection",
        false,
        duration,
        error
      );
      throw new AsanaError("moveTaskToSection", error, {
        taskGid,
        projectGid,
        sectionGid,
      });
    }
  }

  /**
   * Add a comment (story) to an Asana task
   * @param {string} taskGid - The GID of the task to comment on (required)
   * @param {string} htmlText - HTML content for rich formatting (required).
   * Must be wrapped in <body> tags. Only supports limited HTML tags:
   * <a>, <ol>, <ul>, <li>, <strong>, <em>, <u>, <code>, <body>
   * @returns {Promise<Object>} The created story object with gid, text, and created_at
   * @throws {AsanaError} When the operation fails or parameters are invalid
   * @public
   */
  async addTaskComment(taskGid, htmlText) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            // Prepare the request body according to Asana SDK v3.1.1 format
            const requestBody = {
              data: {
                html_text: htmlText,
              },
            };

            const opts = {};
            const response = await this.storiesApi.createStoryForTask(
              requestBody,
              taskGid,
              opts
            );
            const story = response.data;

            // Validate response structure
            if (!story || !story.gid) {
              throw new Error(
                "Invalid response from Asana API: missing story data"
              );
            }

            return {
              gid: story.gid,
              text: story.text || requestBody.data.text,
              created_at: story.created_at || new Date().toISOString(),
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "addTaskComment", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "addTaskComment",
        false,
        duration,
        error
      );
      throw new AsanaError("addTaskComment", error, { taskGid, htmlText });
    }
  }

  // Get users in workspace
  async getWorkspaceUsers() {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const workspaceGid = appConfig.asana.workspaceGid;
            const opts = {};
            const response = await this.usersApi.getUsersForWorkspace(
              workspaceGid,
              opts
            );

            return response.data.map((user) => ({
              gid: user.gid,
              name: user.name,
              email: user.email,
            }));
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "getWorkspaceUsers", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "getWorkspaceUsers",
        false,
        duration,
        error
      );
      throw new AsanaError("getWorkspaceUsers", error);
    }
  }

  // Get teams for workspace
  async getTeamsForWorkspace() {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const workspaceGid = appConfig.asana.workspaceGid;
            const opts = {};

            const response = await this.teamsApi.getTeamsForWorkspace(
              workspaceGid,
              opts
            );

            // Validate response structure
            if (!response || !response.data || !Array.isArray(response.data)) {
              logger.warn(
                "Invalid teams response from Asana API, returning empty array"
              );
              return [];
            }

            return response.data.map((team) => ({
              gid: team.gid,
              name: team.name || "Unnamed Team",
            }));
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "getTeamsForWorkspace",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "getTeamsForWorkspace",
        false,
        duration,
        error
      );

      // Return empty array if teams can't be fetched (might be a personal workspace)
      logger.warn("Could not fetch teams for workspace, returning empty array");
      return [];
    }
  }

  // Create webhook
  async createWebhook(resourceGid, targetUrl, filters) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            // Prepare the request body according to Asana SDK v3.1.1 format
            const requestBody = {
              data: {
                resource: resourceGid,
                target: targetUrl,
                filters,
              },
            };

            const opts = {};
            const response = await this.webhooksApi.createWebhook(
              requestBody,
              opts
            );
            const webhook = response.data;

            return {
              gid: webhook.gid,
              secret: webhook.secret,
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "createWebhook", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "createWebhook",
        false,
        duration,
        error
      );
      throw new AsanaError("createWebhook", error, {
        resourceGid,
        targetUrl,
        filters,
      });
    }
  }

  // Delete webhook
  async deleteWebhook(webhookGid) {
    const startTime = Date.now();

    try {
      await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const opts = {};
            await this.webhooksApi.deleteWebhook(webhookGid, opts);
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "deleteWebhook", true, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "deleteWebhook",
        false,
        duration,
        error
      );
      throw new AsanaError("deleteWebhook", error, { webhookGid });
    }
  }

  // Get tasks in project
  async getProjectTasks(projectGid) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const opts = {
              opt_fields: "gid,name,notes,assignee,due_on,projects,memberships",
            };
            const response = await this.tasksApi.getTasksForProject(
              projectGid,
              opts
            );

            return response.data.map((task) => ({
              gid: task.gid,
              name: task.name,
              notes: task.notes,
              assignee: task.assignee?.gid,
              due_on: task.due_on,
              projects: task.projects?.map((p) => p.gid) || [],
              memberships: task.memberships || [],
            }));
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "getProjectTasks", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "getProjectTasks",
        false,
        duration,
        error
      );
      throw new AsanaError("getProjectTasks", error, { projectGid });
    }
  }

  // Delete task
  async deleteTask(taskGid) {
    const startTime = Date.now();

    try {
      await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const opts = {};
            await this.tasksApi.deleteTask(taskGid, opts);
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "deleteTask", true, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "deleteTask", false, duration, error);
      throw new AsanaError("deleteTask", error, { taskGid });
    }
  }

  // Get tasks assigned to a user across all projects
  // Supports pagination for large result sets
  async getTasksForUser(userGid, options = {}) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const opts = {
              assignee: userGid,
              completed_since: options.completed_since || "now", // Default to incomplete tasks
              opt_fields: options.opt_fields || "gid,completed",
              limit: options.limit || 100,
            };

            if (options.offset) {
              opts.offset = options.offset;
            }

            const response = await this.tasksApi.getTasks(opts);

            return {
              data: response.data || [],
              next_page: response.next_page || null,
            };
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Asana", "getTasksForUser", true, duration, {
        userGid,
        taskCount: result.data.length,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Asana",
        "getTasksForUser",
        false,
        duration,
        error,
        { userGid }
      );
      throw new AsanaError("getTasksForUser", error, { userGid });
    }
  }
}

// Create singleton instance
let asanaIntegration = null;

const getAsanaIntegration = () => {
  if (!asanaIntegration) {
    asanaIntegration = new AsanaIntegration();
  }
  return asanaIntegration;
};

// Export both class and singleton instance
module.exports = {
  AsanaIntegration,
  asanaIntegration: getAsanaIntegration(),
  getAsanaIntegration,
};
