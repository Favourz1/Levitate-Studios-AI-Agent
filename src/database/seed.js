const { PrismaClient } = require("@prisma/client");
const { TeamRole } = require("@/constants");
const { createLogger } = require("@/utils/logger");

const logger = createLogger("database:seed");
const prisma = new PrismaClient();

async function seedTeamMembers() {
  logger.info("Seeding team members...");

  const teamMembers = [
    {
      name: "John Doe",
      email: "john.doe@levitate.ng",
      asanaUserGid: "user_gid_john",
      roles: [{ role: TeamRole.PROJECT_MANAGER, isLead: true }],
    },
    {
      name: "Jane Smith",
      email: "jane.smith@levitate.ng",
      asanaUserGid: "user_gid_jane",
      roles: [{ role: TeamRole.FINANCE_MANAGER, isLead: true }],
    },
    {
      name: "Bob Wilson",
      email: "bob.wilson@levitate.ng",
      asanaUserGid: "user_gid_bob",
      roles: [
        { role: TeamRole.GRAPHICS_DESIGNER, isLead: true },
        { role: TeamRole.WEB_DESIGNER, isLead: false },
      ],
    },
    {
      name: "Alice Johnson",
      email: "alice.johnson@levitate.ng",
      asanaUserGid: "user_gid_alice",
      roles: [{ role: TeamRole.CREATIVE_DIRECTOR, isLead: true }],
    },
    {
      name: "Charlie Brown",
      email: "charlie.brown@levitate.ng",
      asanaUserGid: "user_gid_charlie",
      roles: [{ role: TeamRole.UI_DESIGNER, isLead: true }],
    },
    {
      name: "Diana Prince",
      email: "diana.prince@levitate.ng",
      asanaUserGid: "user_gid_diana",
      roles: [{ role: TeamRole.COPY_WRITER, isLead: true }],
    },
    {
      name: "Frank Miller",
      email: "frank.miller@levitate.ng",
      asanaUserGid: "user_gid_frank",
      roles: [{ role: TeamRole.DIGITAL_MARKETER, isLead: true }],
    },
    {
      name: "Grace Hopper",
      email: "grace.hopper@levitate.ng",
      asanaUserGid: "user_gid_grace",
      roles: [{ role: TeamRole.MOTION_GRAPHICS_DESIGNER, isLead: true }],
    },
    {
      name: "Admin User",
      email: "admin@levitate.ng",
      asanaUserGid: "user_gid_admin",
      roles: [{ role: TeamRole.ADMIN, isLead: true }],
    },
    {
      name: "Manager User",
      email: "manager@levitate.ng",
      asanaUserGid: "user_gid_manager",
      roles: [{ role: TeamRole.MANAGER, isLead: true }],
    },
  ];

  for (const member of teamMembers) {
    await prisma.teamMember.upsert({
      where: { email: member.email },
      update: {
        name: member.name,
        asanaUserGid: member.asanaUserGid,
        roles: member.roles,
      },
      create: member,
    });
  }

  logger.info(`Seeded ${teamMembers.length} team members`);
}

async function seedSampleData() {
  logger.info("Seeding sample data...");

  // Create a sample client
  const client = await prisma.client.upsert({
    where: { primaryEmail: "client@example.com" },
    update: {},
    create: {
      name: "Example Client Corp",
      primaryEmail: "client@example.com",
      context:
        "A technology startup focused on innovative solutions. They prefer modern, clean designs with a minimalist approach.",
    },
  });

  // Create a sample project
  await prisma.project.upsert({
    where: { id: 1 },
    update: {},
    create: {
      clientId: client.id,
      name: "Brand Identity Project",
      phase: "QUESTIONNAIRE",
      context:
        "Complete brand identity including logo, website design, and marketing materials for tech startup launch.",
    },
  });

  logger.info("Seeded sample data");
}

async function main() {
  try {
    logger.info("Starting database seed...");

    await seedTeamMembers();
    await seedSampleData();

    logger.info("Database seed completed successfully");
  } catch (error) {
    logger.error("Database seed failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed function if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { seed: main };
