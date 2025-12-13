import OpenAI from "openai";
import { config } from "../../config/index.js";
import { getDb } from "../../db/connection.js";
import { logger } from "../../config/logger.js";

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

interface TranscriptSection {
  section_type: string;
  content: string;
}

interface SessionInfo {
  title: string | null;
  user_tags: string | null;
}

function buildMetadataPrompt(needsTitle: boolean, needsTags: boolean): string {
  const fields: string[] = [
    '1. Un resumen breve (2-3 oraciones) del contenido de la consulta',
    '2. Palabras clave relevantes (5-10 términos) que ayuden a buscar esta sesión',
  ];

  const jsonFields: string[] = [
    '"summary": "Resumen de la consulta..."',
    '"keywords": ["palabra1", "palabra2", ...]',
  ];

  if (needsTitle) {
    fields.push('3. Un título descriptivo y conciso (máximo 10 palabras) para identificar esta sesión');
    jsonFields.push('"title": "Título de la sesión"');
  }

  if (needsTags) {
    fields.push(`${needsTitle ? '4' : '3'}. Etiquetas de categorización (3-5) para organizar la sesión`);
    jsonFields.push('"userTags": ["etiqueta1", "etiqueta2", ...]');
  }

  return `Eres un experto en análisis de consultas médicas. Dada la transcripción segmentada de una sesión médica, genera:

${fields.join('\n')}

Responde en JSON con el siguiente formato:
{
  ${jsonFields.join(',\n  ')}
}

Las palabras clave deben incluir:
- Síntomas mencionados
- Diagnósticos discutidos
- Tratamientos recomendados
- Términos médicos relevantes${needsTitle ? `

El título debe ser descriptivo pero breve, por ejemplo:
- "Consulta por dolor abdominal agudo"
- "Seguimiento de hipertensión arterial"
- "Primera consulta: cefalea recurrente"` : ''}${needsTags ? `

Las etiquetas deben ser categorías generales útiles para filtrar, por ejemplo:
- Tipo de consulta: "primera consulta", "seguimiento", "urgencia"
- Especialidad: "cardiología", "neurología", "medicina general"
- Grupo etario si es relevante: "pediátrico", "geriátrico"` : ''}`;
}

export async function processMetadata(sessionId: string): Promise<void> {
  const db = getDb();

  // Check if title and tags already exist
  const sessionInfo = db
    .prepare("SELECT title, user_tags FROM medical_sessions WHERE id = ?")
    .get(sessionId) as SessionInfo | undefined;

  const needsTitle = !sessionInfo?.title;
  const needsTags = !sessionInfo?.user_tags;

  const sections = db
    .prepare(
      "SELECT section_type, content FROM transcript_sections WHERE session_id = ? ORDER BY section_order"
    )
    .all(sessionId) as TranscriptSection[];

  if (sections.length === 0) {
    throw new Error("No transcript sections found");
  }

  const transcriptText = sections
    .map((s) => `[${s.section_type.toUpperCase()}]\n${s.content}`)
    .join("\n\n");

  logger.info({ sessionId, needsTitle, needsTags, model: config.openai.models.metadata }, "Generating metadata");

  const prompt = buildMetadataPrompt(needsTitle, needsTags);

  const completion = await openai.chat.completions.create({
    model: config.openai.models.metadata,
    messages: [
      {
        role: "system",
        content: prompt,
      },
      {
        role: "user",
        content: transcriptText,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from GPT");
  }

  const result = JSON.parse(content) as {
    summary: string;
    keywords: string[];
    title?: string;
    userTags?: string[];
  };

  // Trim all text fields
  const summary = result.summary?.trim() ?? "";
  const keywords = (result.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const title = result.title?.trim();
  const userTags = result.userTags?.map((t) => t.trim()).filter(Boolean);

  // Build dynamic update query
  const updates: string[] = ["summary = ?", "keywords = ?", "updated_at = datetime('now')"];
  const params: (string | null)[] = [summary, JSON.stringify(keywords)];

  if (needsTitle && title) {
    updates.push("title = ?");
    params.push(title);
  }

  if (needsTags && userTags && userTags.length > 0) {
    updates.push("user_tags = ?");
    params.push(JSON.stringify(userTags));
  }

  params.push(sessionId);

  db.prepare(`
    UPDATE medical_sessions
    SET ${updates.join(", ")}
    WHERE id = ?
  `).run(...params);

  logger.info(
    {
      sessionId,
      keywordCount: keywords.length,
      generatedTitle: needsTitle ? title : null,
      generatedTagsCount: needsTags ? userTags?.length : null,
    },
    "Metadata generation completed"
  );
}
