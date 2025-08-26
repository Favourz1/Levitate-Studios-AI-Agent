const { appConfig } = require("@/config");
const { createPrismaClient } = require("@/database");

// Global test setup
beforeAll(async () => {
  // Ensure we're in test environment
  if (appConfig.server.nodeEnv !== "test") {
    throw new Error("Tests must be run in test environment");
  }

  // Setup test database
  const prisma = createPrismaClient();

  try {
    // Clean database before tests
    await prisma.$executeRaw`PRAGMA foreign_keys = OFF;`;

    // Delete all data in the correct order (respecting foreign keys)
    await prisma.documentRevision.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.email.deleteMany({});
    await prisma.emailThread.deleteMany({});
    await prisma.projectPhaseLog.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.webhook.deleteMany({});
    await prisma.teamMemberRole.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.client.deleteMany({});

    await prisma.$executeRaw`PRAGMA foreign_keys = ON;`;
  } catch (error) {
    console.error("Error setting up test database:", error);
    throw error;
  }
});

// Global test teardown
afterAll(async () => {
  const prisma = createPrismaClient();

  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error("Error cleaning up test database:", error);
  }
});

// Setup jest matchers and global test utilities
expect.extend({
  toBeValidDate(received) {
    const pass = received instanceof Date && !isNaN(received.getTime());
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid date`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid date`,
        pass: false,
      };
    }
  },
});
