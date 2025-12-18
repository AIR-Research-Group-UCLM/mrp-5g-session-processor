import "dotenv/config";
import Database from "better-sqlite3";
import { config } from "../src/config/index.js";

const SPEAKER_MAPPING: Record<string, string> = {
  Doctor: "DOCTOR",
  Paciente: "PATIENT",
  Especialista: "SPECIALIST",
  Otro: "OTHER",
};

const SECTION_TYPE_MAPPING: Record<string, string> = {
  presentacion: "introduction",
  sintomas: "symptoms",
  diagnostico: "diagnosis",
  tratamiento: "treatment",
  despedida: "closing",
};

function migrateI18n(): void {
  const db = new Database(config.databasePath);
  db.pragma("foreign_keys = ON");

  console.log("Starting i18n migration...");

  // 1. Check if language column exists
  const columns = db
    .prepare("PRAGMA table_info(medical_sessions)")
    .all() as Array<{ name: string }>;

  const hasLanguageColumn = columns.some((col) => col.name === "language");

  if (!hasLanguageColumn) {
    console.log("Adding 'language' column to medical_sessions...");
    db.exec(`
      ALTER TABLE medical_sessions ADD COLUMN language TEXT DEFAULT 'es';
    `);
    console.log("Language column added");
  } else {
    console.log("Language column already exists, skipping");
  }

  // 2. Set language = 'es' for all existing sessions without a language
  const updateLanguage = db.prepare(`
    UPDATE medical_sessions SET language = 'es' WHERE language IS NULL
  `);
  const languageResult = updateLanguage.run();
  console.log(`Updated ${languageResult.changes} sessions with default language 'es'`);

  // 3. Migrate speakers from Spanish labels to neutral keys
  console.log("Migrating speaker labels...");

  let speakerChanges = 0;
  for (const [spanishLabel, neutralKey] of Object.entries(SPEAKER_MAPPING)) {
    const updateSpeaker = db.prepare(`
      UPDATE transcript_sections SET speaker = ? WHERE speaker = ?
    `);
    const result = updateSpeaker.run(neutralKey, spanishLabel);
    speakerChanges += result.changes;
    if (result.changes > 0) {
      console.log(`  Migrated ${result.changes} sections: "${spanishLabel}" → "${neutralKey}"`);
    }
  }

  if (speakerChanges === 0) {
    console.log("  No speaker labels needed migration");
  }

  // 4. Migrate section types from Spanish to English
  console.log("Migrating section types...");

  let sectionTypeChanges = 0;
  for (const [spanishType, englishType] of Object.entries(SECTION_TYPE_MAPPING)) {
    // Update transcript_sections
    const updateTranscriptSections = db.prepare(`
      UPDATE transcript_sections SET section_type = ? WHERE section_type = ?
    `);
    const transcriptResult = updateTranscriptSections.run(englishType, spanishType);
    sectionTypeChanges += transcriptResult.changes;

    // Update section_summaries
    const updateSectionSummaries = db.prepare(`
      UPDATE section_summaries SET section_type = ? WHERE section_type = ?
    `);
    const summaryResult = updateSectionSummaries.run(englishType, spanishType);
    sectionTypeChanges += summaryResult.changes;

    if (transcriptResult.changes > 0 || summaryResult.changes > 0) {
      console.log(`  Migrated "${spanishType}" → "${englishType}": ${transcriptResult.changes} transcript sections, ${summaryResult.changes} summaries`);
    }
  }

  if (sectionTypeChanges === 0) {
    console.log("  No section types needed migration");
  }

  db.close();
  console.log("i18n migration completed successfully!");
}

migrateI18n();
