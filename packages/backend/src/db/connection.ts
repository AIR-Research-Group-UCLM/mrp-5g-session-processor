import Database from "better-sqlite3";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import fs from "node:fs";
import path from "node:path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase first.");
  }
  return db;
}

export async function initializeDatabase(): Promise<void> {
  const dbDir = path.dirname(config.databasePath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.databasePath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = new URL("./schema.sql", import.meta.url);
  const schema = fs.readFileSync(schemaPath, "utf-8");

  db.exec(schema);

  logger.info(`Database initialized at ${config.databasePath}`);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
