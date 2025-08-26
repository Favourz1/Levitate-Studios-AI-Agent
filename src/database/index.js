const { PrismaClient } = require("@prisma/client");
const { createLogger, logError } = require("@/utils/logger");
const { appConfig } = require("@/config");

const logger = createLogger("database");

// Create a singleton Prisma client
let prisma = null;

const createPrismaClient = () => {
  if (prisma) {
    return prisma;
  }

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: appConfig.database.url,
      },
    },
    log: [
      {
        emit: "event",
        level: "query",
      },
      {
        emit: "event",
        level: "error",
      },
      {
        emit: "event",
        level: "warn",
      },
    ],
  });

  // Log database queries in development
  if (appConfig.server.nodeEnv === "development") {
    prisma.$on("query", (e) => {
      logger.debug(
        {
          query: e.query,
          params: e.params,
          duration: e.duration,
        },
        "Database query executed"
      );
    });
  }

  // Log database errors
  prisma.$on("error", (e) => {
    logError(logger, new Error(e.message), {
      target: e.target,
    });
  });

  // Log database warnings
  prisma.$on("warn", (e) => {
    logger.warn(
      {
        message: e.message,
        target: e.target,
      },
      "Database warning"
    );
  });

  return prisma;
};

const getPrismaClient = () => {
  if (!prisma) {
    return createPrismaClient();
  }
  return prisma;
};

const disconnectDatabase = async () => {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info("Database disconnected");
  }
};

// Health check function
const checkDatabaseHealth = async () => {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logError(logger, error, { operation: "health_check" });
    return false;
  }
};

// Transaction helper
const withTransaction = async (callback) => {
  const client = getPrismaClient();
  return client.$transaction(callback);
};

module.exports = {
  createPrismaClient,
  getPrismaClient,
  disconnectDatabase,
  checkDatabaseHealth,
  withTransaction,
  prisma,
};

module.exports.default = getPrismaClient;
