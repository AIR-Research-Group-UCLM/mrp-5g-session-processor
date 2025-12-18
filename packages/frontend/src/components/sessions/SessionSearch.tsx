import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useSearchSessions } from "@/hooks/useSessions";
import type { SearchMatchSource } from "@mrp/shared";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface SessionSearchProps {
  onClose?: () => void;
}

const MATCH_SOURCE_COLORS: Record<SearchMatchSource, string> = {
  transcript: "bg-blue-100 text-blue-700",
  title: "bg-purple-100 text-purple-700",
  summary: "bg-green-100 text-green-700",
  keywords: "bg-orange-100 text-orange-700",
  tags: "bg-pink-100 text-pink-700",
  clinical_indicators: "bg-teal-100 text-teal-700",
};

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const regex = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  );
  const parts = text.split(regex);

  return parts.map((part, i) => {
    const isMatch = terms.some((t) => part.toLowerCase() === t.toLowerCase());
    if (isMatch) {
      return (
        <mark key={i} className="bg-yellow-200 px-0.5 rounded">
          {part}
        </mark>
      );
    }
    return part;
  });
}

export function SessionSearch({ onClose }: SessionSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results, isLoading } = useSearchSessions(
    debouncedQuery,
    debouncedQuery.length >= 2
  );

  const getSectionLabel = (sectionType: string | undefined): string => {
    if (!sectionType) return "";
    // Check if it's a section type or a clinical field key
    const sectionLabel = t(`sections.${sectionType}`, { defaultValue: "" });
    if (sectionLabel) return sectionLabel;
    const clinicalLabel = t(`clinicalFields.${sectionType}`, { defaultValue: "" });
    if (clinicalLabel) return clinicalLabel;
    return sectionType;
  };

  return (
    <div className="w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          className="pl-10"
        />
      </div>

      {debouncedQuery.length >= 2 && (
        <div className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          ) : results && results.length > 0 ? (
            <ul className="space-y-2">
              {results.map((result, index) => (
                <li key={`${result.sessionId}-${index}`}>
                  <Link
                    to={`/sessions/${result.sessionId}`}
                    onClick={onClose}
                    className="block rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">
                        {result.matchSource === "title"
                          ? highlightText(
                              result.title ?? t("sessions.untitledSession"),
                              debouncedQuery
                            )
                          : (result.title ?? t("sessions.untitledSession"))}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${MATCH_SOURCE_COLORS[result.matchSource]}`}
                        >
                          {t(`search.matchSources.${result.matchSource}`)}
                        </span>
                        {result.sectionType && (
                          <span className="text-xs text-gray-500">
                            {getSectionLabel(result.sectionType)}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                      {highlightText(result.matchedText, debouncedQuery)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-gray-500">{t("search.noResults")}</p>
          )}
        </div>
      )}
    </div>
  );
}
