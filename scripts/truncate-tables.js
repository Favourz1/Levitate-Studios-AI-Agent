/**
 * Script to truncate all tables except vital tables:
 * - global_configs
 * - team_members
 * - role_permission_override
 *
 * This script uses CASCADE to handle foreign key constraints automatically.
 *
 * Usage: node scripts/truncate-tables.js
 *
 * WARNING: This will delete all data from the tables listed below!
 * Make sure you have backups if needed.
 */
require("module-alias/register");
const { getPrismaClient } = require("../src/database");

const prisma = getPrismaClient();

// Tables to preserve (DO NOT truncate)
const PRESERVED_TABLES = [
  "global_configs",
  "team_members",
  "role_permission_override",
];

// All tables in the database (from schema.prisma)
const ALL_TABLES = [
  "clients",
  "projects",
  "project_phase_log",
  "documents",
  "document_revisions",
  "workplan_slides",
  "email_threads",
  "emails",
  "asana_links",
  "asana_tasks",
  "team_members", // Will be filtered out
  "job_runs",
  "webhook_subscriptions",
  "questionnaire_responses",
  "audit_log",
  "global_configs", // Will be filtered out
  "role_permission_override", // Will be filtered out
];

// Tables to truncate (all tables except preserved ones)
const TABLES_TO_TRUNCATE = ALL_TABLES.filter(
  (table) => !PRESERVED_TABLES.includes(table)
);

async function truncateTables() {
  try {
    console.log("[INFO] Starting table truncation process");
    console.log(`[INFO] Preserving tables: ${PRESERVED_TABLES.join(", ")}`);
    console.log(`[INFO] Truncating ${TABLES_TO_TRUNCATE.length} tables...`);

    // Build TRUNCATE statement with all tables at once
    // Using CASCADE to handle foreign key constraints automatically
    // This is more efficient and safer than truncating one by one
    const tableList = TABLES_TO_TRUNCATE.map((table) => `"${table}"`).join(", ");
    
    console.log(`[INFO] Executing TRUNCATE on ${TABLES_TO_TRUNCATE.length} tables...`);
    
    try {
      // Truncate all tables in a single statement with CASCADE
      // CASCADE will automatically handle foreign key dependencies
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${tableList} CASCADE;`
      );
      
      console.log(`[✓] Successfully truncated all ${TABLES_TO_TRUNCATE.length} tables`);
    } catch (error) {
      // If bulk truncate fails (e.g., some tables don't exist), try individual truncation
      console.warn(`[WARN] Bulk truncate failed, trying individual truncation:`, error.message);
      
      for (const table of TABLES_TO_TRUNCATE) {
        try {
          // Check if table exists first
          const tableExists = await prisma.$queryRawUnsafe(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables 
              WHERE table_schema = 'public' 
              AND table_name = '${table}'
            );
          `);
          
          if (!tableExists[0]?.exists) {
            console.log(`[INFO] Table ${table} does not exist, skipping...`);
            continue;
          }
          
          console.log(`[INFO] Truncating table: ${table}...`);
          
          // Use CASCADE to automatically truncate dependent tables
          await prisma.$executeRawUnsafe(
            `TRUNCATE TABLE "${table}" CASCADE;`
          );
          
          console.log(`[✓] Successfully truncated: ${table}`);
        } catch (tableError) {
          console.warn(`[WARN] Failed to truncate ${table}:`, tableError.message);
          // Continue with other tables
        }
      }
    }

    // Verify preserved tables still have data
    console.log("\n[INFO] Verifying preserved tables...");
    for (const table of PRESERVED_TABLES) {
      try {
        const count = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*) as count FROM "${table}";`
        );
        const rowCount = count[0]?.count || 0;
        console.log(`[✓] ${table}: ${rowCount} rows preserved`);
      } catch (error) {
        console.warn(`[WARN] Could not verify ${table}:`, error.message);
      }
    }

    console.log("\n✅ Table truncation completed successfully!");
    console.log(`   Truncated: ${TABLES_TO_TRUNCATE.length} tables`);
    console.log(`   Preserved: ${PRESERVED_TABLES.length} tables`);

    return true;
  } catch (error) {
    console.error("[ERROR] Failed to truncate tables", {
      error: error.message,
      stack: error.stack,
    });

    console.error("❌ Failed to truncate tables:");
    console.error(`   ${error.message}`);

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  // Block script if NODE_ENV is 'production' or 'prod'
  const env = process.env.NODE_ENV;
  if (env && (env.toLowerCase() === "production" || env.toLowerCase() === "prod")) {
    console.error("\n❌ Refusing to run: Script will not run in production (NODE_ENV=production or prod).");
    process.exit(1);
  }

  // Add confirmation prompt
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n⚠️  WARNING: This will delete all data from the following tables:");
  console.log(`   ${TABLES_TO_TRUNCATE.join(", ")}\n`);
  console.log("✅ The following tables will be preserved:");
  console.log(`   ${PRESERVED_TABLES.join(", ")}\n`);

  rl.question("Are you sure you want to continue? (yes/no): ", (answer) => {
    if (answer.toLowerCase() === "yes" || answer.toLowerCase() === "y") {
      rl.close();
      truncateTables()
        .then(() => {
          process.exit(0);
        })
        .catch((error) => {
          console.error(error);
          process.exit(1);
        });
    } else {
      console.log("❌ Truncation cancelled.");
      rl.close();
      process.exit(0);
    }
  });
}

module.exports = { truncateTables };
