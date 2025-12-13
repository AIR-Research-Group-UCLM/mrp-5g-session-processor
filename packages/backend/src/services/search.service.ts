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

  // Sort by date and limit
  return results
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export const searchService = {
  search,
};
