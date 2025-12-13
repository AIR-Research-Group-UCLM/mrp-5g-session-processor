export const SECTION_TYPES = [
  "presentacion",
  "sintomas",
  "diagnostico",
  "tratamiento",
  "despedida",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_LABELS: Record<SectionType, string> = {
  presentacion: "Presentación",
  sintomas: "Exposición de síntomas",
  diagnostico: "Diagnóstico",
  tratamiento: "Asignación de tratamiento",
  despedida: "Despedida",
};

export const SECTION_DESCRIPTIONS: Record<SectionType, string> = {
  presentacion:
    "Saludo inicial y presentación entre el profesional de salud y el paciente",
  sintomas:
    "El paciente describe sus síntomas, molestias o motivo de la consulta",
  diagnostico:
    "El profesional de salud evalúa y comunica el diagnóstico o posibles diagnósticos",
  tratamiento:
    "Indicaciones de tratamiento, medicación, cambios de hábitos o recomendaciones",
  despedida: "Cierre de la consulta, próximos pasos y despedida",
};

export const SESSION_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export const JOB_TYPES = [
  "transcribe",
  "segment",
  "generate-metadata",
  "complete",
] as const;

export const JOB_TYPE_LABELS: Record<(typeof JOB_TYPES)[number], string> = {
  transcribe: "Transcribiendo audio",
  segment: "Segmentando secciones",
  "generate-metadata": "Generando metadatos",
  complete: "Finalizando",
};
