import "dotenv/config";
import Database from "better-sqlite3";
import { config } from "../src/config/index.js";

function migrateClinicalIndicators(): void {
  const db = new Database(config.databasePath);
  db.pragma("foreign_keys = ON");

  // Check if table already exists
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='clinical_indicators'"
    )
    .get();

  if (tableExists) {
    console.log("Table clinical_indicators already exists, skipping migration");
    db.close();
    return;
  }

  console.log("Creating clinical_indicators table...");

  db.exec(`
    CREATE TABLE IF NOT EXISTS clinical_indicators (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        urgency_level TEXT CHECK(urgency_level IN ('low', 'medium', 'high')),
        appointment_priority TEXT CHECK(appointment_priority IN ('preferred', 'non_preferred')),
        reason_for_visit TEXT,
        consulted_specialty TEXT,
        main_clinical_problem TEXT,
        problem_status TEXT CHECK(problem_status IN ('new', 'chronic', 'exacerbation', 'follow_up', 'resolved')),
        diagnostic_hypothesis TEXT,
        requested_tests TEXT,
        treatment_plan TEXT,
        patient_education TEXT,
        warning_signs TEXT,
        follow_up_plan TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES medical_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_clinical_indicators_session_id ON clinical_indicators(session_id);
    CREATE INDEX IF NOT EXISTS idx_clinical_indicators_urgency ON clinical_indicators(urgency_level);
    CREATE INDEX IF NOT EXISTS idx_clinical_indicators_problem_status ON clinical_indicators(problem_status);
  `);

  db.close();
  console.log("Migration completed: clinical_indicators table created");
}

migrateClinicalIndicators();
