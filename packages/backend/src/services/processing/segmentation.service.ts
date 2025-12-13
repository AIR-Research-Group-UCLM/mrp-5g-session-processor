import type { SectionType } from "@mrp/shared";
import { SECTION_DESCRIPTIONS, SECTION_TYPES } from "@mrp/shared";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { getDb } from "../../db/connection.js";
import { s3Service } from "../s3.service.js";

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

interface TranscriptData {
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
  }>;
}

interface SegmentedSection {
  sectionType: SectionType;
  speaker: string;
  content: string;
  startTime: number;
  endTime: number;
}

interface SectionSummaryResult {
  sectionType: SectionType;
  summary: string;
}

const SEGMENTATION_PROMPT = `Eres un experto en análisis de consultas médicas. Tu tarea es segmentar la transcripción de una sesión médica en las siguientes secciones:

${SECTION_TYPES.map((type) => `- ${type}: ${SECTION_DESCRIPTIONS[type]}`).join("\n")}

Analiza la transcripción y devuelve un JSON con el siguiente formato:
{
  "sections": [
    {
      "sectionType": "presentacion" | "sintomas" | "diagnostico" | "tratamiento" | "despedida",
      "speaker": "Doctor" | "Paciente" | "Especialista" | "Otro",
      "content": "Texto del turno de habla",
      "startTime": 0.0,
      "endTime": 10.5
    }
  ],
  "sectionSummaries": [
    {
      "sectionType": "presentacion",
      "summary": "Resumen breve de esta sección (1-2 oraciones)"
    }
  ]
}

Reglas:
1. IMPORTANTE: Genera UNA sección por cada turno de habla, preservando quién dice cada frase
2. Los speakers en la transcripción original (A, B, C, etc.) deben ser re-etiquetados semánticamente como "Doctor", "Paciente", "Especialista" u "Otro"
3. Identifica quién es quién basándote en el contexto (ej: quien saluda como "doctor" es el paciente, quien hace preguntas médicas es el doctor)
4. Cada sección debe tener un tipo de los especificados (presentacion, sintomas, etc.)
5. Los tiempos deben coincidir con los timestamps de la transcripción original
6. El contenido debe ser el texto exacto de la transcripción
7. Mantén el orden cronológico de las secciones
8. IMPORTANTE: El tipo de sección debe seguir el orden lógico de una consulta médica: presentacion → sintomas → diagnostico → tratamiento → despedida. Una vez que una sección avanza a un tipo posterior, NO puede retroceder a un tipo anterior. Por ejemplo, si ya clasificaste un turno como "diagnostico", los turnos siguientes solo pueden ser "diagnostico", "tratamiento" o "despedida", nunca "sintomas" o "presentacion".
9. Para sectionSummaries, genera UN resumen por cada tipo de sección que exista (agrupando todos los turnos de habla del mismo tipo)
10. Los resúmenes deben ser concisos y capturar los puntos clave de cada sección`;

export async function processSegmentation(sessionId: string): Promise<void> {
  const db = getDb();

  const session = db
    .prepare("SELECT video_s3_key FROM medical_sessions WHERE id = ?")
    .get(sessionId) as { video_s3_key: string } | undefined;

  if (!session?.video_s3_key) {
    throw new Error("Session not found");
  }

  const transcriptS3Key = session.video_s3_key.replace(/\.[^.]+$/, "_transcript.json");
  const transcriptUrl = await s3Service.getPresignedUrl(transcriptS3Key);

  const response = await fetch(transcriptUrl);
  const transcriptData = (await response.json()) as TranscriptData;

  logger.info({ sessionId, model: config.openai.models.segmentation }, "Segmenting transcript");

  const completion = await openai.chat.completions.create({
    model: config.openai.models.segmentation,
    messages: [
      {
        role: "system",
        content: SEGMENTATION_PROMPT,
      },
      {
        role: "user",
        content: `Transcripción a segmentar:\n\n${transcriptData.text}\n\nSegmentos con timestamps:\n${JSON.stringify(transcriptData.segments, null, 2)}`,
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
    sections: SegmentedSection[];
    sectionSummaries: SectionSummaryResult[];
  };

  const insertSectionStmt = db.prepare(`
    INSERT INTO transcript_sections (
      id, session_id, section_type, section_order, speaker, content,
      start_time_seconds, end_time_seconds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSummaryStmt = db.prepare(`
    INSERT INTO section_summaries (id, session_id, section_type, summary)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, section_type) DO UPDATE SET summary = excluded.summary
  `);

  const insertAll = db.transaction(() => {
    // Insert sections
    for (let i = 0; i < result.sections.length; i++) {
      const section = result.sections[i]!;
      insertSectionStmt.run(
        uuidv4(),
        sessionId,
        section.sectionType,
        i,
        section.speaker,
        section.content,
        section.startTime,
        section.endTime
      );
    }

    // Insert section summaries
    for (const summary of result.sectionSummaries ?? []) {
      insertSummaryStmt.run(uuidv4(), sessionId, summary.sectionType, summary.summary);
    }
  });

  insertAll();

  logger.info(
    {
      sessionId,
      sectionCount: result.sections.length,
      summaryCount: result.sectionSummaries?.length ?? 0,
    },
    "Segmentation completed"
  );
}
