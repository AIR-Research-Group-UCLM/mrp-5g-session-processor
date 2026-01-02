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

  // Migration: Add session_assignments table
  const hasAssignmentsTable = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='session_assignments'"
    )
    .get();

  if (!hasAssignmentsTable) {
    logger.info("Running migration: Creating session_assignments table...");
    database.exec(`
      CREATE TABLE IF NOT EXISTS session_assignments (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        can_write INTEGER NOT NULL DEFAULT 0,
        assigned_by TEXT NOT NULL,
        assigned_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES medical_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE(session_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_session_assignments_session_id ON session_assignments(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_assignments_user_id ON session_assignments(user_id);
    `);
    logger.info("Migration completed: session_assignments table created");
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
