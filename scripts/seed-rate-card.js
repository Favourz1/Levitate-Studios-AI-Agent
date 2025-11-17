/**
 * One-time script to seed the rate card into global_configs table
 * This script should be run once and then deleted after successful execution
 *
 * Usage: node scripts/seed-rate-card.js
 */

const { getPrismaClient } = require("../src/database");
const fs = require("fs");
const path = require("path");
const { createLogger } = require("../src/utils/logger");

const logger = createLogger("script:seed-rate-card");
const prisma = getPrismaClient();

async function seedRateCard() {
  try {
    logger.info("Starting rate card seeding process");

    // Read rate card JSON file
    const rateCardPath = path.join(__dirname, "..", "rateCard.json");

    if (!fs.existsSync(rateCardPath)) {
      throw new Error(`Rate card file not found at: ${rateCardPath}`);
    }

    const rateCardData = JSON.parse(fs.readFileSync(rateCardPath, "utf8"));

    // Validate rate card structure
    if (!rateCardData.sections || !Array.isArray(rateCardData.sections)) {
      throw new Error("Invalid rate card structure: missing 'sections' array");
    }

    // Check if rate card already exists
    const existingConfig = await prisma.globalConfig.findUnique({
      where: { key: "rate_card" },
    });

    if (existingConfig) {
      logger.warn(
        "Rate card already exists in database. Updating with new data..."
      );

      await prisma.globalConfig.update({
        where: { key: "rate_card" },
        data: {
          value: rateCardData,
          description: "Studio rate card for quote generation",
          updatedAt: new Date(),
        },
      });

      logger.info("Rate card updated successfully");
    } else {
      // Create new rate card config
      await prisma.globalConfig.create({
        data: {
          key: "rate_card",
          value: rateCardData,
          description: "Studio rate card for quote generation",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      logger.info("Rate card created successfully");
    }

    // Verify the data was stored correctly
    const verifyConfig = await prisma.globalConfig.findUnique({
      where: { key: "rate_card" },
    });

    if (!verifyConfig) {
      throw new Error("Failed to verify rate card was stored");
    }

    logger.info(
      {
        sectionsCount: verifyConfig.value.sections?.length || 0,
        hasMetadata: !!verifyConfig.value.metadata,
      },
      "Rate card seeded and verified successfully"
    );

    console.log("✅ Rate card seeded successfully!");
    console.log(`   Sections: ${verifyConfig.value.sections?.length || 0}`);
    console.log(`   Key: rate_card`);
    console.log(`   Description: ${verifyConfig.description}`);

    return true;
  } catch (error) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      "Failed to seed rate card"
    );

    console.error("❌ Failed to seed rate card:");
    console.error(`   ${error.message}`);

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding script
if (require.main === module) {
  seedRateCard()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { seedRateCard };
