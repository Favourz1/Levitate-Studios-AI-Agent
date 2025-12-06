const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { NotFoundError } = require("@/utils/errors");
const { ProjectPhase } = require("@/constants");

const logger = createLogger("service:project");
const prisma = getPrismaClient();

class ProjectService {
  // Create a new project
  static async createProject(data) {
    try {
      const project = await prisma.project.create({
        data: {
          clientId: data.clientId,
          name: data.name,
          phase: ProjectPhase.QUESTIONNAIRE,
          context: data.context,
        },
        include: {
          client: true,
        },
      });

      logger.info(
        {
          projectId: project.id,
          projectName: data.name,
          clientId: data.clientId,
        },
        "Project created successfully"
      );

      return {
        id: project.id,
        name: project.name,
        phase: project.phase,
        context: project.context,
        client: {
          id: project.client.id,
          name: project.client.name,
          email: project.client.primaryEmail,
        },
        createdAt: project.createdAt,
      };
    } catch (error) {
      logger.error(
        {
          projectData: data,
          error: error.message,
        },
        "Failed to create project"
      );
      throw error;
    }
  }

  // Get project by ID
  static async getProject(projectId) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: true,
          documents: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!project) {
        throw new NotFoundError("Project", projectId);
      }

      return {
        id: project.id,
        name: project.name,
        phase: project.phase,
        context: project.context,
        client: {
          id: project.client.id,
          name: project.client.name,
          email: project.client.primaryEmail,
        },
        documents: project.documents.map((doc) => ({
          id: doc.id,
          type: doc.type,
          status: doc.status,
          createdAt: doc.createdAt,
        })),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    } catch (error) {
      logger.error(
        {
          projectId,
          error: error.message,
        },
        "Failed to get project"
      );
      throw error;
    }
  }

  // Update project
  static async updateProject(projectId, data) {
    try {
      const updatedProject = await prisma.project.update({
        where: { id: projectId },
        data: {
          name: data.name,
          phase: data.phase,
          context: data.context,
        },
        include: {
          client: true,
        },
      });

      logger.info(
        {
          projectId,
          updatedFields: Object.keys(data),
        },
        "Project updated successfully"
      );

      return {
        id: updatedProject.id,
        name: updatedProject.name,
        phase: updatedProject.phase,
        context: updatedProject.context,
        updatedAt: updatedProject.updatedAt,
      };
    } catch (error) {
      logger.error(
        {
          projectId,
          updateData: data,
          error: error.message,
        },
        "Failed to update project"
      );
      throw error;
    }
  }

  // List projects with pagination
  static async listProjects(options = {}) {
    const { page = 1, limit = 20, clientId, phase } = options;
    const skip = (page - 1) * limit;

    try {
      const where = {};

      if (clientId) {
        where.clientId = clientId;
      }

      if (phase) {
        where.phase = phase;
      }

      const [projects, total] = await Promise.all([
        prisma.project.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            client: true,
            _count: {
              select: { documents: true },
            },
          },
        }),
        prisma.project.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          phase: project.phase,
          client: {
            id: project.client.id,
            name: project.client.name,
            email: project.client.primaryEmail,
          },
          documentCount: project._count.documents,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      logger.error(
        {
          options,
          error: error.message,
        },
        "Failed to list projects"
      );
      throw error;
    }
  }
}

module.exports = { ProjectService };
