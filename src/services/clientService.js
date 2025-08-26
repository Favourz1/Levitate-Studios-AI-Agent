const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { NotFoundError, ConflictError } = require("@/utils/errors");

const logger = createLogger("service:client");
const prisma = getPrismaClient();

class ClientService {
  // Create a new client
  static async createClient(data) {
    try {
      // Check if client with this email already exists
      const existingClient = await prisma.client.findFirst({
        where: { primaryEmail: data.primaryEmail },
      });

      if (existingClient) {
        throw new ConflictError(
          `Client with email ${data.primaryEmail} already exists`,
          { existingClientId: existingClient.id }
        );
      }

      const client = await prisma.client.create({
        data: {
          name: data.name,
          primaryEmail: data.primaryEmail,
          context: data.context,
          status: "ACTIVE",
        },
      });

      logger.info(
        {
          clientId: client.id,
          clientName: data.name,
          clientEmail: data.primaryEmail,
        },
        "Client created successfully"
      );

      return {
        id: client.id,
        name: client.name,
        primaryEmail: client.primaryEmail,
        status: client.status,
      };
    } catch (error) {
      logger.error(
        {
          clientData: data,
          error: error.message,
        },
        "Failed to create client"
      );
      throw error;
    }
  }

  // Get client by ID
  static async getClient(clientId) {
    try {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: {
          projects: {
            orderBy: { createdAt: "desc" },
            take: 10, // Latest 10 projects
          },
        },
      });

      if (!client) {
        throw new NotFoundError("Client", clientId);
      }

      logger.info({ clientId }, "Client retrieved successfully");

      return {
        id: client.id,
        name: client.name,
        primaryEmail: client.primaryEmail,
        context: client.context,
        status: client.status,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt,
        projects: client.projects.map((project) => ({
          id: project.id,
          name: project.name,
          phase: project.phase,
          createdAt: project.createdAt,
        })),
      };
    } catch (error) {
      logger.error(
        {
          clientId,
          error: error.message,
        },
        "Failed to get client"
      );
      throw error;
    }
  }

  // Update client
  static async updateClient(clientId, data) {
    try {
      const existingClient = await prisma.client.findUnique({
        where: { id: clientId },
      });

      if (!existingClient) {
        throw new NotFoundError("Client", clientId);
      }

      // Check for email conflict if email is being updated
      if (
        data.primaryEmail &&
        data.primaryEmail !== existingClient.primaryEmail
      ) {
        const emailConflict = await prisma.client.findFirst({
          where: {
            primaryEmail: data.primaryEmail,
            NOT: { id: clientId },
          },
        });

        if (emailConflict) {
          throw new ConflictError(
            `Client with email ${data.primaryEmail} already exists`,
            { conflictingClientId: emailConflict.id }
          );
        }
      }

      const updatedClient = await prisma.client.update({
        where: { id: clientId },
        data: {
          name: data.name,
          primaryEmail: data.primaryEmail,
          context: data.context,
          status: data.status,
        },
      });

      logger.info(
        {
          clientId,
          updatedFields: Object.keys(data),
        },
        "Client updated successfully"
      );

      return {
        id: updatedClient.id,
        name: updatedClient.name,
        primaryEmail: updatedClient.primaryEmail,
        status: updatedClient.status,
        updatedAt: updatedClient.updatedAt,
      };
    } catch (error) {
      logger.error(
        {
          clientId,
          updateData: data,
          error: error.message,
        },
        "Failed to update client"
      );
      throw error;
    }
  }

  // List clients with pagination
  static async listClients(options = {}) {
    const { page = 1, limit = 20, search, status } = options;
    const skip = (page - 1) * limit;

    try {
      const where = {};

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { primaryEmail: { contains: search, mode: "insensitive" } },
        ];
      }

      if (status) {
        where.status = status;
      }

      const [clients, total] = await Promise.all([
        prisma.client.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            _count: {
              select: { projects: true },
            },
          },
        }),
        prisma.client.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      logger.info(
        {
          page,
          limit,
          total,
          totalPages,
          search,
          status,
        },
        "Clients listed successfully"
      );

      return {
        clients: clients.map((client) => ({
          id: client.id,
          name: client.name,
          primaryEmail: client.primaryEmail,
          status: client.status,
          projectCount: client._count.projects,
          createdAt: client.createdAt,
          updatedAt: client.updatedAt,
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
        "Failed to list clients"
      );
      throw error;
    }
  }

  // Delete client (soft delete)
  static async deleteClient(clientId) {
    try {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: {
          projects: {
            where: {
              phase: {
                in: ["QUESTIONNAIRE", "BRAND_ORIGIN", "BUDGET_TIMELINE"],
              },
            },
          },
        },
      });

      if (!client) {
        throw new NotFoundError("Client", clientId);
      }

      // Check if client has active projects
      if (client.projects.length > 0) {
        throw new ConflictError("Cannot delete client with active projects", {
          activeProjectCount: client.projects.length,
          activeProjectIds: client.projects.map((p) => p.id),
        });
      }

      // Soft delete by setting status to INACTIVE
      const deletedClient = await prisma.client.update({
        where: { id: clientId },
        data: { status: "INACTIVE" },
      });

      logger.info(
        {
          clientId,
          clientName: client.name,
        },
        "Client deleted (soft delete) successfully"
      );

      return {
        id: deletedClient.id,
        name: deletedClient.name,
        status: deletedClient.status,
      };
    } catch (error) {
      logger.error(
        {
          clientId,
          error: error.message,
        },
        "Failed to delete client"
      );
      throw error;
    }
  }
}

module.exports = { ClientService };
