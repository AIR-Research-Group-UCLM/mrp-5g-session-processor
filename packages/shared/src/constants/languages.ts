// ISO 639-1 language codes to language names (in English, for prompts)
export const LANGUAGE_NAMES: Record<string, string> = {
  es: "Spanish",
  en: "English",
  // Add more languages as needed
};

// Get language name with fallback
export function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? LANGUAGE_NAMES["es"] ?? "Spanish";
}
