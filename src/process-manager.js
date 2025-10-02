require("module-alias/register");
const { spawn } = require("child_process");
const { createLogger } = require("@/utils/logger");

const logger = createLogger("process-manager");

// Process configurations
const processes = [
  {
    name: "server",
    script: "src/server.js",
    port: process.env.PORT || 3000,
    env: { ...process.env, PORT: process.env.PORT || 3000 },
  },
  {
    name: "worker",
    script: "src/workers/index.js",
    port: null, // Workers don't need a port
    env: { ...process.env },
  },
  {
    name: "monitor",
    script: "src/monitoring/queueMonitor.js",
    port: process.env.MONITOR_PORT || 3567,
    env: { ...process.env, MONITOR_PORT: process.env.MONITOR_PORT || 3567 },
  },
];

// Store child processes
const childProcesses = [];

// Start a single process
const startProcess = (config) => {
  return new Promise((resolve, reject) => {
    logger.info(`Starting ${config.name}...`);

    const child = spawn("node", [config.script], {
      env: config.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    // Store process reference
    childProcesses.push({ name: config.name, process: child });

    // Handle stdout
    child.stdout.on("data", (data) => {
      const message = data.toString().trim();
      if (message) {
        logger.info(`[${config.name}] ${message}`);
      }
    });

    // Handle stderr
    child.stderr.on("data", (data) => {
      const message = data.toString().trim();
      if (message) {
        logger.error(`[${config.name}] ${message}`);
      }
    });

    // Handle process exit
    child.on("exit", (code, signal) => {
      if (code !== 0) {
        logger.error(
          `[${config.name}] Process exited with code ${code} and signal ${signal}`
        );
        reject(new Error(`${config.name} process failed`));
      } else {
        logger.info(`[${config.name}] Process exited gracefully`);
      }
    });

    // Handle process errors
    child.on("error", (error) => {
      logger.error(`[${config.name}] Process error:`, error);
      reject(error);
    });

    // Consider the process started after a short delay
    setTimeout(() => {
      if (!child.killed) {
        logger.info(
          `[${config.name}] Started successfully${
            config.port ? ` on port ${config.port}` : ""
          }`
        );
        resolve(child);
      }
    }, 2000);
  });
};

// Start all processes
const startAllProcesses = async () => {
  logger.info("Starting all processes...");

  try {
    // Start server first
    await startProcess(processes.find((p) => p.name === "server"));

    // Start worker and monitor in parallel
    const workerAndMonitor = processes.filter((p) => p.name !== "server");
    await Promise.all(workerAndMonitor.map(startProcess));

    logger.info("All processes started successfully!");

    // Log port information
    processes.forEach((config) => {
      if (config.port) {
        logger.info(`${config.name} is running on port ${config.port}`);
      }
    });
  } catch (error) {
    logger.error("Failed to start processes:", error);
    await stopAllProcesses();
    process.exit(1);
  }
};

// Stop all processes
const stopAllProcesses = async () => {
  logger.info("Stopping all processes...");

  const stopPromises = childProcesses.map(({ name, process }) => {
    return new Promise((resolve) => {
      if (!process.killed) {
        logger.info(`Stopping ${name}...`);
        process.kill("SIGTERM");

        // Force kill after 10 seconds
        const forceKillTimer = setTimeout(() => {
          if (!process.killed) {
            logger.warn(`Force killing ${name}...`);
            process.kill("SIGKILL");
          }
        }, 10000);

        process.on("exit", () => {
          clearTimeout(forceKillTimer);
          logger.info(`${name} stopped`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });

  await Promise.all(stopPromises);
  logger.info("All processes stopped");
};

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  await stopAllProcesses();
  process.exit(0);
};

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection at:", promise, "reason:", reason);
  gracefulShutdown("unhandledRejection");
});

// Start all processes if this file is executed directly
if (require.main === module) {
  startAllProcesses().catch((error) => {
    logger.error("Failed to start application:", error);
    process.exit(1);
  });
}

module.exports = {
  startAllProcesses,
  stopAllProcesses,
};
