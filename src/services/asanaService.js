const { createLogger } = require("@/utils/logger");

const logger = createLogger("service:asana");

class AsanaService {
  // Placeholder implementation
  static async createProject(data) {
    logger.info("Asana service placeholder - createProject");
    return { gid: "test-project-gid", ...data };
  }

  static async createTask(data) {
    logger.info("Asana service placeholder - createTask");
    return { gid: "test-task-gid", ...data };
  }

  static async updateTask(taskGid, data) {
    logger.info("Asana service placeholder - updateTask");
    return { gid: taskGid, ...data };
  }
}

module.exports = { AsanaService };
