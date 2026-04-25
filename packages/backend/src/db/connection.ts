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

  // Migration: Add consultation_summaries table
  const hasConsultationSummariesTable = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='consultation_summaries'"
    )
    .get();

  if (!hasConsultationSummariesTable) {
    logger.info("Running migration: Creating consultation_summaries table...");
    database.exec(`
      CREATE TABLE IF NOT EXISTS consultation_summaries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        what_happened TEXT NOT NULL,
        diagnosis TEXT NOT NULL,
        treatment_plan TEXT NOT NULL,
        follow_up TEXT NOT NULL,
        warning_signs TEXT NOT NULL,
        additional_notes TEXT,
        share_token TEXT UNIQUE,
        share_expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES medical_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_consultation_summaries_session_id ON consultation_summaries(session_id);
      CREATE INDEX IF NOT EXISTS idx_consultation_summaries_share_token ON consultation_summaries(share_token);
    `);
    logger.info("Migration completed: consultation_summaries table created");
  }

  // Migration: Add report_summaries table
  const hasReportSummariesTable = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='report_summaries'"
    )
    .get();

  if (!hasReportSummariesTable) {
    logger.info("Running migration: Creating report_summaries table...");
    database.exec(`
      CREATE TABLE IF NOT EXISTS report_summaries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT,
        what_happened TEXT NOT NULL,
        diagnosis TEXT NOT NULL,
        treatment_plan TEXT NOT NULL,
        follow_up TEXT NOT NULL,
        warning_signs TEXT NOT NULL,
        additional_notes TEXT,
        share_token TEXT UNIQUE,
        share_expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_report_summaries_user_id ON report_summaries(user_id);
      CREATE INDEX IF NOT EXISTS idx_report_summaries_share_token ON report_summaries(share_token);
    `);
    logger.info("Migration completed: report_summaries table created");
  }

  // Migration: Add tooltips column to consultation_summaries and report_summaries
  const csColumns = database
    .prepare("PRAGMA table_info(consultation_summaries)")
    .all() as Array<{ name: string }>;

  if (!csColumns.some((col) => col.name === "tooltips")) {
    logger.info("Running migration: Adding tooltips column to consultation_summaries...");
    database.exec("ALTER TABLE consultation_summaries ADD COLUMN tooltips TEXT");
    logger.info("Migration completed: tooltips column added to consultation_summaries");
  }

  const rsColumns = database
    .prepare("PRAGMA table_info(report_summaries)")
    .all() as Array<{ name: string }>;

  if (!rsColumns.some((col) => col.name === "tooltips")) {
    logger.info("Running migration: Adding tooltips column to report_summaries...");
    database.exec("ALTER TABLE report_summaries ADD COLUMN tooltips TEXT");
    logger.info("Migration completed: tooltips column added to report_summaries");
  }

  // Migration: Add report_summary_assignments table
  const hasReportSummaryAssignmentsTable = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='report_summary_assignments'"
    )
    .get();

  if (!hasReportSummaryAssignmentsTable) {
    logger.info("Running migration: Creating report_summary_assignments table...");
    database.exec(`
      CREATE TABLE IF NOT EXISTS report_summary_assignments (
        id TEXT PRIMARY KEY,
        report_summary_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        can_write INTEGER NOT NULL DEFAULT 0,
        assigned_by TEXT NOT NULL,
        assigned_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (report_summary_id) REFERENCES report_summaries(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE(report_summary_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_report_summary_assignments_report_summary_id ON report_summary_assignments(report_summary_id);
      CREATE INDEX IF NOT EXISTS idx_report_summary_assignments_user_id ON report_summary_assignments(user_id);
    `);
    logger.info("Migration completed: report_summary_assignments table created");
  }
}

export async function initializeDatabase(): Promise<void> {
  const dbDir = path.dirname(config.databasePath);
  fs.mkdirSync(dbDir, { recursive: true });

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
