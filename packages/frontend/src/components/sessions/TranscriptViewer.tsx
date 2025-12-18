import { cn } from "@/utils/cn";
import { formatDuration } from "@/utils/format";
import type { SectionSummary, SectionType, TranscriptSection } from "@mrp/shared";
import { SECTION_TYPES } from "@mrp/shared";
import { Clock, GraduationCap, Sparkles, Stethoscope, User } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface TranscriptViewerProps {
  sections: TranscriptSection[];
  sectionSummaries?: SectionSummary[];
  currentTime?: number;
  onSeek?: (time: number) => void;
  autoScroll?: boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function TranscriptViewer({
  sections,
  sectionSummaries = [],
  currentTime = 0,
  onSeek,
  autoScroll = false,
  scrollContainerRef,
}: TranscriptViewerProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SectionType | "all">("all");
  const activeItemRef = useRef<HTMLDivElement>(null);

  const filteredSections =
    activeTab === "all" ? sections : sections.filter((s) => s.sectionType === activeTab);

  const groupedByType = SECTION_TYPES.reduce(
    (acc, type) => {
      acc[type] = sections.filter((s) => s.sectionType === type);
      return acc;
    },
    {} as Record<SectionType, TranscriptSection[]>
  );

  // Get summaries indexed by section type
  const summariesByType = sectionSummaries.reduce(
    (acc, summary) => {
      acc[summary.sectionType] = summary.summary;
      return acc;
    },
    {} as Record<SectionType, string>
  );

  // Get summary for current tab (only when viewing a specific section type)
  const currentSummary = activeTab !== "all" ? summariesByType[activeTab] : null;

  // Find the active section based on current playback time
  const activeSectionId = filteredSections.find(
    (s) =>
      s.startTimeSeconds != null &&
      s.endTimeSeconds != null &&
      currentTime >= s.startTimeSeconds &&
      currentTime <= s.endTimeSeconds
  )?.id;

  // Auto-scroll to active section when enabled
  useEffect(() => {
    if (!autoScroll || !scrollContainerRef?.current || !activeItemRef.current) return;

    const container = scrollContainerRef.current;
    const item = activeItemRef.current;
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();

    // Only scroll if item is not visible
    if (itemRect.top < containerRect.top || itemRect.bottom > containerRect.bottom) {
      const scrollTop = container.scrollTop + (itemRect.top - containerRect.top) - containerRect.height / 2 + itemRect.height / 2;
      container.scrollTo({ top: scrollTop, behavior: "smooth" });
    }
  }, [activeSectionId, autoScroll, scrollContainerRef]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-2">
        <TabButton active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          {t("transcript.all")}
        </TabButton>
        {SECTION_TYPES.map((type) => (
          <TabButton
            key={type}
            active={activeTab === type}
            onClick={() => setActiveTab(type)}
            count={groupedByType[type].length}
          >
            {t(`sections.${type}`)}
          </TabButton>
        ))}
      </div>

      <div className="flex-1 space-y-4 py-4">
        {/* Section summary card */}
        {currentSummary && (
          <SectionSummaryCard sectionType={activeTab as SectionType} summary={currentSummary} />
        )}

        {filteredSections.length === 0 ? (
          <p className="text-center text-sm text-gray-500">{t("transcript.noContent")}</p>
        ) : (
          filteredSections.map((section) => (
            <SectionItem
              key={section.id}
              ref={section.id === activeSectionId ? activeItemRef : null}
              section={section}
              isActive={section.id === activeSectionId}
              onSeek={onSeek}
              showType={activeTab === "all"}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}

function TabButton({ active, onClick, children, count }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-primary-100 text-primary-700" : "text-gray-600 hover:bg-gray-100"
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-xs",
            active ? "bg-primary-200" : "bg-gray-200"
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

interface SectionItemProps {
  section: TranscriptSection;
  isActive?: boolean;
  onSeek?: (time: number) => void;
  showType: boolean;
}

function getSpeakerIcon(speaker: string | null) {
  switch (speaker?.toUpperCase()) {
    case "DOCTOR":
      return Stethoscope;
    case "SPECIALIST":
      return GraduationCap;
    default:
      return User;
  }
}

const SectionItem = forwardRef<HTMLDivElement, SectionItemProps>(function SectionItem(
  { section, isActive, onSeek, showType },
  ref
) {
  const { t } = useTranslation();
  const SpeakerIcon = getSpeakerIcon(section.speaker);

  const getSpeakerLabel = (speaker: string | null): string => {
    if (!speaker) return t("speakers.unknown");
    const key = speaker.toUpperCase();
    const translated = t(`speakers.${key}`, { defaultValue: "" });
    return translated || speaker;
  };

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border-2 p-4 transition-colors duration-300",
        isActive ? "border-primary-500 bg-primary-50 shadow-md" : "border-gray-200 bg-white"
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SpeakerIcon className={cn("h-4 w-4", isActive ? "text-primary-600" : "text-gray-500")} />
          <span
            className={cn("text-sm font-medium", isActive ? "text-primary-700" : "text-gray-700")}
          >
            {getSpeakerLabel(section.speaker)}
          </span>
          {showType && (
            <span
              className={cn(
                "rounded px-2 py-0.5 text-xs",
                isActive ? "bg-primary-200 text-primary-700" : "bg-gray-100 text-gray-600"
              )}
            >
              {t(`sections.${section.sectionType}`)}
            </span>
          )}
        </div>
        {section.startTimeSeconds != null && onSeek && (
          <button
            onClick={() => onSeek(section.startTimeSeconds!)}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
          >
            <Clock className="h-3 w-3" />
            {formatDuration(Math.round(section.startTimeSeconds))}
          </button>
        )}
      </div>
      <p
        className={cn(
          "whitespace-pre-wrap text-sm",
          isActive ? "text-primary-900" : "text-gray-800"
        )}
      >
        {section.content}
      </p>
    </div>
  );
});

interface SectionSummaryCardProps {
  sectionType: SectionType;
  summary: string;
}

function SectionSummaryCard({ sectionType, summary }: SectionSummaryCardProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border-2 border-primary-200 bg-primary-50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary-600" />
        <span className="text-sm font-semibold text-primary-700">
          {t("transcript.summary")}: {t(`sections.${sectionType}`)}
        </span>
      </div>
      <p className="text-sm text-primary-900">{summary}</p>
    </div>
  );
}
