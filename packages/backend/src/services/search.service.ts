import { getDb } from "../db/connection.js";
import type { SearchResult } from "@mrp/shared";

interface DbTranscriptSearchResult {
  session_id: string;
  title: string | null;
  content: string;
  section_type: string;
  created_at: string;
}

interface DbSessionSearchResult {
  id: string;
  title: string | null;
  summary: string | null;
  keywords: string | null;
  user_tags: string | null;
  created_at: string;
}

interface DbClinicalIndicatorsSearchResult {
  session_id: string;
  title: string | null;
  reason_for_visit: string | null;
  consulted_specialty: string | null;
  main_clinical_problem: string | null;
  diagnostic_hypothesis: string | null;
  requested_tests: string | null;
  patient_education: string | null;
  warning_signs: string | null;
  created_at: string;
}

// Clinical field keys to search - labels are in frontend i18n
const CLINICAL_FIELD_KEYS: Array<keyof DbClinicalIndicatorsSearchResult> = [
  "reason_for_visit",
  "consulted_specialty",
  "main_clinical_problem",
  "diagnostic_hypothesis",
  "requested_tests",
  "patient_education",
  "warning_signs",
];

function findMatchingClinicalField(
  row: DbClinicalIndicatorsSearchResult,
  searchTerms: string
): { field: string; text: string } | null {
  for (const key of CLINICAL_FIELD_KEYS) {
    const value = row[key];
    if (value && String(value).toLowerCase().includes(searchTerms)) {
      // Return the key itself - frontend uses i18n to get the label
      return { field: key, text: String(value) };
    }
  }
  return null;
}

async function search(
  userId: string,
  query: string,
  limit: number = 20
): Promise<SearchResult[]> {
  const db = getDb();
  const results: SearchResult[] = [];
  const seenSessions = new Set<string>();
  const searchTerms = query.toLowerCase().trim();

  // 1. Search in transcript using FTS
  const ftsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" OR ");

  if (ftsQuery) {
    const transcriptRows = db
      .prepare(
        `
        SELECT
          ts.session_id,
          ms.title,
          ts.content,
          ts.section_type,
          ms.created_at
        FROM transcript_fts fts
        JOIN transcript_sections ts ON ts.session_id = fts.session_id AND ts.content = fts.content
        JOIN medical_sessions ms ON ms.id = ts.session_id
        WHERE ms.user_id = ? AND fts.content MATCH ?
        ORDER BY rank
        LIMIT ?
      `
      )
      .all(userId, ftsQuery, limit) as DbTranscriptSearchResult[];

    for (const row of transcriptRows) {
      results.push({
        sessionId: row.session_id,
        title: row.title,
        matchedText: row.content.substring(0, 200),
        matchSource: "transcript",
        sectionType: row.section_type,
        createdAt: row.created_at,
      });
      seenSessions.add(row.session_id);
    }
  }

  // 2. Search in session metadata (title, summary, keywords, tags)
  const sessionRows = db
    .prepare(
      `
      SELECT id, title, summary, keywords, user_tags, created_at
      FROM medical_sessions
      WHERE user_id = ? AND (
        LOWER(title) LIKE ? OR
        LOWER(summary) LIKE ? OR
        LOWER(keywords) LIKE ? OR
        LOWER(user_tags) LIKE ?
      )
      ORDER BY created_at DESC
      LIMIT ?
    `
    )
    .all(
      userId,
      `%${searchTerms}%`,
      `%${searchTerms}%`,
      `%${searchTerms}%`,
      `%${searchTerms}%`,
      limit
    ) as DbSessionSearchResult[];

  for (const row of sessionRows) {
    // Check which field matched and add result
    const titleLower = row.title?.toLowerCase() ?? "";
    const summaryLower = row.summary?.toLowerCase() ?? "";
    const keywordsLower = row.keywords?.toLowerCase() ?? "";
    const tagsLower = row.user_tags?.toLowerCase() ?? "";

    // Title match
    if (titleLower.includes(searchTerms) && !seenSessions.has(`${row.id}-title`)) {
      results.push({
        sessionId: row.id,
        title: row.title,
        matchedText: row.title ?? "",
        matchSource: "title",
        sectionType: null,
        createdAt: row.created_at,
      });
      seenSessions.add(`${row.id}-title`);
    }

    // Summary match
    if (summaryLower.includes(searchTerms) && !seenSessions.has(`${row.id}-summary`)) {
      results.push({
        sessionId: row.id,
        title: row.title,
        matchedText: row.summary?.substring(0, 200) ?? "",
        matchSource: "summary",
        sectionType: null,
        createdAt: row.created_at,
      });
      seenSessions.add(`${row.id}-summary`);
    }

    // Keywords match
    if (keywordsLower.includes(searchTerms) && !seenSessions.has(`${row.id}-keywords`)) {
      const keywords: string[] = row.keywords ? JSON.parse(row.keywords) : [];
      const matchedKeywords = keywords.filter((k) =>
        k.toLowerCase().includes(searchTerms)
      );
      results.push({
        sessionId: row.id,
        title: row.title,
        matchedText: matchedKeywords.join(", "),
        matchSource: "keywords",
        sectionType: null,
        createdAt: row.created_at,
      });
      seenSessions.add(`${row.id}-keywords`);
    }

    // Tags match
    if (tagsLower.includes(searchTerms) && !seenSessions.has(`${row.id}-tags`)) {
      const tags: string[] = row.user_tags ? JSON.parse(row.user_tags) : [];
      const matchedTags = tags.filter((t) =>
        t.toLowerCase().includes(searchTerms)
      );
      results.push({
        sessionId: row.id,
        title: row.title,
        matchedText: matchedTags.join(", "),
        matchSource: "tags",
        sectionType: null,
        createdAt: row.created_at,
      });
      seenSessions.add(`${row.id}-tags`);
    }
  }

  // 3. Search in clinical indicators
  const clinicalRows = db
    .prepare(
      `
      SELECT
        ci.session_id,
        ms.title,
        ci.reason_for_visit,
        ci.consulted_specialty,
        ci.main_clinical_problem,
        ci.diagnostic_hypothesis,
        ci.requested_tests,
        ci.patient_education,
        ci.warning_signs,
        ms.created_at
      FROM clinical_indicators ci
      JOIN medical_sessions ms ON ms.id = ci.session_id
      WHERE ms.user_id = ? AND (
        LOWER(ci.reason_for_visit) LIKE ? OR
        LOWER(ci.consulted_specialty) LIKE ? OR
        LOWER(ci.main_clinical_problem) LIKE ? OR
        LOWER(ci.diagnostic_hypothesis) LIKE ? OR
        LOWER(ci.requested_tests) LIKE ? OR
        LOWER(ci.patient_education) LIKE ? OR
        LOWER(ci.warning_signs) LIKE ?
      )
      ORDER BY ms.created_at DESC
      LIMIT ?
    `
    )
    .all(
      userId,
      `%${searchTerms}%`,
      `%${searchTerms}%`,
      `%${searchTerms}%`,
      `%${searchTerms}%`,
      `%${searchTerms}%`,
      `%${searchTerms}%`,
      `%${searchTerms}%`,
      limit
    ) as DbClinicalIndicatorsSearchResult[];

  for (const row of clinicalRows) {
    if (seenSessions.has(`${row.session_id}-clinical`)) continue;

    // Find which field matched and create appropriate result
    const matchedField = findMatchingClinicalField(row, searchTerms);
    if (matchedField) {
      results.push({
        sessionId: row.session_id,
        title: row.title,
        matchedText: matchedField.text.substring(0, 200),
        matchSource: "clinical_indicators",
        sectionType: matchedField.field,
        createdAt: row.created_at,
      });
      seenSessions.add(`${row.session_id}-clinical`);
    }
  }

  // Sort by date and limit
  return results
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export const searchService = {
  search,
};
