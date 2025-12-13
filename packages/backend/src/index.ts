import "dotenv/config";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./config/logger.js";
import { initializeDatabase } from "./db/connection.js";
import { queueService } from "./services/processing/queue.service.js";

async function main() {
  try {
    await initializeDatabase();
    logger.info("Database initialized");

    await queueService.startWorker();
    logger.info("Processing worker started");

    const app = await createApp();

    app.listen(config.port, () => {
      logger.info(`Server running on http://localhost:${config.port}`);
    });
  } catch (error) {
    logger.error(error, "Failed to start server");
    process.exit(1);
  }
}

main();
