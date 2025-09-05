const asana = require("asana");
const { appConfig } = require("@/config");
const { AsanaError } = require("@/utils/errors");
const { createLogger, logIntegrationCall } = require("@/utils/logger");
const { retry, sleep } = require("@/utils");

const logger = createLogger("integration:asana");

// Asana API client
class AsanaIntegration {
  constructor() {
    // Validate that asana module is available
    if (!asana || !asana.Client) {
      throw new Error(
        "Asana client library is not properly installed or imported"
      );
    }

    // Validate that access token is configured
    if (!appConfig.asana?.accessToken) {
      throw new Error("Asana access token is not configured");
    }

    try {
      this.client = asana.Client.create().useAccessToken(
        appConfig.asana.accessToken
      );

      // Validate the client was created successfully
      if (!this.client) {
        throw new Error("Failed to create Asana client");
      }

      logger.info("Asana client initialized successfully");
    } catch (error) {
      logger.error(
        { error: error.message },
        "Failed to initialize Asana client"
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
            const workspace = await this.client.workspaces.getWorkspace(
              appConfig.asana.workspaceGid
            );
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
  async createProject(name, notes, team) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const project = await this.client.projects.createProject({
              name,
              notes,
              team: team || appConfig.asana.workspaceGid,
              workspace: appConfig.asana.workspaceGid,
              layout: "board",
            });

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
            const project = await this.client.projects.getProject(projectGid);

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

  // Create sections in a project
  async createSection(projectGid, name) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const section = await this.client.sections.createSectionForProject(
              projectGid,
              {
                name,
              }
            );

            return {
              gid: section.gid,
              name: section.name,
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
            const sections = await this.client.sections.getSectionsForProject(
              projectGid
            );

            return sections.data.map((section) => ({
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
            const taskData = {
              name,
              notes,
              projects: [projectGid],
              assignee: assigneeGid,
              due_on: dueOn,
            };

            if (sectionGid) {
              taskData.memberships = [
                {
                  project: projectGid,
                  section: sectionGid,
                },
              ];
            }

            const task = await this.client.tasks.createTask(taskData);

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
            const task = await this.client.tasks.updateTask(taskGid, updates);

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

  // Move task to section
  async moveTaskToSection(taskGid, projectGid, sectionGid) {
    const startTime = Date.now();

    try {
      await retry(
        async () => {
          return this.handleRateLimit(async () => {
            await this.client.sections.addTaskForSection(sectionGid, {
              task: taskGid,
            });
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

  // Add comment (story) to task
  async addTaskComment(taskGid, text, htmlText) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const story = await this.client.stories.createStoryForTask(
              taskGid,
              {
                text,
                html_text: htmlText,
              }
            );

            return {
              gid: story.gid,
              text: story.text,
              created_at: story.created_at,
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
      throw new AsanaError("addTaskComment", error, { taskGid, text });
    }
  }

  // Get users in workspace
  async getWorkspaceUsers() {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const users = await this.client.users.getUsersForWorkspace(
              appConfig.asana.workspaceGid
            );

            return users.data.map((user) => ({
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

  // Create webhook
  async createWebhook(resourceGid, targetUrl, filters) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.handleRateLimit(async () => {
            const webhook = await this.client.webhooks.createWebhook({
              resource: resourceGid,
              target: targetUrl,
              filters,
            });

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
            await this.client.webhooks.deleteWebhook(webhookGid);
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
            const tasks = await this.client.tasks.getTasksForProject(
              projectGid,
              {
                opt_fields:
                  "gid,name,notes,assignee,due_on,projects,memberships",
              }
            );

            return tasks.data.map((task) => ({
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
            await this.client.tasks.deleteTask(taskGid);
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
}

// Export the class instead of singleton instance to avoid initialization issues
module.exports = { AsanaIntegration };
