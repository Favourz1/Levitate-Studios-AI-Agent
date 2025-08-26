// Test setup file for Jest
import { beforeAll, afterAll } from "@jest/globals";
import { createPrismaClient, disconnectDatabase } from "@/database";

// Setup test database connection
beforeAll(async () => {
  // Initialize database connection for tests
  createPrismaClient();
});

// Cleanup after all tests
afterAll(async () => {
  // Disconnect from database
  await disconnectDatabase();
});

// Mock environment variables for tests
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test_db";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.BREVO_API_KEY = "test-brevo-key";
process.env.ASANA_ACCESS_TOKEN = "test-asana-token";
process.env.ASANA_WORKSPACE_GID = "test-workspace";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_PROJECT_ID = "test-project";
process.env.GOOGLE_CLIENT_EMAIL = "test@test.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY =
  "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n";
process.env.ADMIN_EMAIL = "admin@test.com";
process.env.FRONTEND_URL = "http://localhost:3001";
process.env.EMAIL_DOMAIN = "test.com";

// Global test timeout
jest.setTimeout(30000);
