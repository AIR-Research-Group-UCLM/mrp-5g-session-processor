/**
 * Canonical, deterministic content returned by the fake AI server.
 *
 * The same dialogue is used as the simulator conversation, the diarized
 * transcription and the segmentation output, so a simulated session processed
 * end-to-end yields a perfect accuracy score and tests can assert exact values.
 */

export type Speaker = "DOCTOR" | "PATIENT" | "SPECIALIST";
export type SectionType = "introduction" | "symptoms" | "diagnosis" | "treatment" | "closing";

interface DialogueTurn {
  speaker: Speaker;
  diarizedSpeaker: string;
  sectionType: SectionType;
  text: string;
  start: number;
  end: number;
}

export const DIALOGUE: readonly DialogueTurn[] = [
  {
    speaker: "DOCTOR",
    diarizedSpeaker: "A",
    sectionType: "introduction",
    text: "Buenos días, soy la doctora García. ¿Qué le trae hoy por la consulta?",
    start: 0,
    end: 4.5,
  },
  {
    speaker: "PATIENT",
    diarizedSpeaker: "B",
    sectionType: "symptoms",
    text: "Llevo dos semanas con migraña intensa y náuseas por las mañanas.",
    start: 4.5,
    end: 9,
  },
  {
    speaker: "SPECIALIST",
    diarizedSpeaker: "C",
    sectionType: "diagnosis",
    text: "Por lo que veo a través de las gafas, parece una migraña sin aura.",
    start: 9,
    end: 13.5,
  },
  {
    speaker: "DOCTOR",
    diarizedSpeaker: "A",
    sectionType: "treatment",
    text: "Le pauto ibuprofeno 600 miligramos cada ocho horas durante cinco días.",
    start: 13.5,
    end: 18,
  },
  {
    speaker: "PATIENT",
    diarizedSpeaker: "B",
    sectionType: "closing",
    text: "Muchas gracias, doctora. Volveré a revisión en un mes.",
    start: 18,
    end: 21,
  },
];

export const FAKE_TRANSCRIPTION = {
  text: DIALOGUE.map((t) => t.text).join(" "),
  // No `language` field on purpose: diarized_json does not include it, which
  // exercises the language-detection fallback in the transcription step.
  segments: DIALOGUE.map((t) => ({
    speaker: t.diarizedSpeaker,
    text: t.text,
    start: t.start,
    end: t.end,
  })),
};

export const FAKE_DETECTED_LANGUAGE = "es";

export const FAKE_SECTION_SUMMARIES: Record<SectionType, string> = {
  introduction: "La doctora García recibe a la paciente.",
  symptoms: "La paciente refiere migraña y náuseas desde hace dos semanas.",
  diagnosis: "El especialista orienta el cuadro como migraña sin aura.",
  treatment: "Se pauta ibuprofeno 600 mg cada ocho horas durante cinco días.",
  closing: "Se acuerda una revisión en un mes.",
};

export const FAKE_SEGMENTATION = {
  sections: DIALOGUE.map((t) => ({
    sectionType: t.sectionType,
    speaker: t.speaker,
    content: t.text,
    startTime: t.start,
    endTime: t.end,
  })),
  sectionSummaries: Object.entries(FAKE_SECTION_SUMMARIES).map(([sectionType, summary]) => ({
    sectionType,
    summary,
  })),
};

export const FAKE_METADATA = {
  summary: "Consulta por migraña sin aura de dos semanas de evolución tratada con ibuprofeno.",
  keywords: ["migraña", "náuseas", "ibuprofeno", "cefalea"],
  title: "Consulta por migraña sin aura",
  userTags: ["neurología", "cefalea"],
  clinicalIndicators: {
    urgencyLevel: "low",
    appointmentPriority: "non_preferred",
    reasonForVisit: "Migraña de dos semanas de evolución",
    consultedSpecialty: "Neurología",
    mainClinicalProblem: "Migraña sin aura",
    problemStatus: "new",
    diagnosticHypothesis: [{ condition: "Migraña sin aura", certainty: "probable" }],
    requestedTests: [],
    treatmentPlan: {
      medicationStarted: ["Ibuprofeno 600 mg cada 8 horas"],
      medicationAdjusted: [],
      medicationDiscontinued: [],
      nonPharmacologicalMeasures: ["Descanso en ambiente oscuro"],
    },
    patientEducation: ["Evitar desencadenantes conocidos"],
    warningSigns: ["Pérdida de visión", "Fiebre alta"],
    followUpPlan: {
      followUpType: "review",
      timeFrame: "1 mes",
      responsibleCareLevel: "primary_care",
    },
  },
};

export const FAKE_PATIENT_SUMMARY = {
  whatHappened: "Acudió a consulta por dolores de cabeza intensos.",
  diagnosis: "Tiene migraña, un tipo de dolor de cabeza recurrente.",
  treatmentPlan: "Tome ibuprofeno 600 mg cada ocho horas durante cinco días.",
  followUp: "Vuelva a revisión dentro de un mes.",
  warningSigns: ["Pérdida de visión", "Fiebre alta"],
  additionalNotes: null,
};

// The term appears verbatim in DIALOGUE, so the deterministic glossary axis
// of the safety validator reports no issues for transcript-based summaries.
export const FAKE_TOOLTIPS = {
  migraña: "Dolor de cabeza intenso que suele repetirse.",
};

// Returned only for the medication axis so tests can assert per-axis severity.
export const FAKE_MEDICATION_ISSUE = "La dosis de ibuprofeno debe confirmarse con la fuente.";

export const FAKE_CONTEXT_SUGGESTION =
  "Mujer de 35 años con migraña de dos semanas de evolución y náuseas matutinas.";

export const FAKE_CONVERSATION = {
  segments: DIALOGUE.map((t) => ({ text: t.text, speaker: t.speaker })),
};
