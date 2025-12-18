import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";

const LANGUAGES = [
  { code: "es-ES", label: "language.es-ES" },
  { code: "en-GB", label: "language.en-GB" },
] as const;

export function LanguageSelector() {
  const { t, i18n } = useTranslation();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(e.target.value);
  };

  return (
    <div className="flex items-center gap-2">
      <Languages className="h-4 w-4 text-gray-500" />
      <select
        value={i18n.language}
        onChange={handleChange}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        aria-label={t("language.selector")}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {t(lang.label)}
          </option>
        ))}
      </select>
    </div>
  );
}
