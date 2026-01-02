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

function runMigrations(database: Database.Database): void {
  // Migration: Add role column to users table
  const tableInfo = database
    .prepare("PRAGMA table_info(users)")
    .all() as Array<{ name: string }>;
  const hasRoleColumn = tableInfo.some((col) => col.name === "role");

  if (!hasRoleColumn) {
    logger.info("Running migration: Adding role column to users table...");
    database.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"
    );
    // Update existing admin user to have admin role
    database
      .prepare("UPDATE users SET role = 'admin' WHERE email = ?")
      .run("admin@user.com");
    logger.info("Migration completed: role column added");
  }
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

  // Run migrations for existing databases
  runMigrations(db);

  logger.info(`Database initialized at ${config.databasePath}`);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
