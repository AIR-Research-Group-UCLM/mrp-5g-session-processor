import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { useSessionAccuracy } from "@/hooks/useSessions";
import { cn } from "@/utils/cn";
import type { SpeakerAccuracyBreakdown, TranscriptionAccuracy } from "@mrp/shared";
import { AlertCircle, HelpCircle, Target } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TranscriptionAccuracyPanelProps {
  sessionId: string;
}

function getAccuracyColor(value: number): string {
  if (value >= 90) return "text-green-600";
  if (value >= 70) return "text-yellow-600";
  return "text-red-600";
}

function getAccuracyBgColor(value: number): string {
  if (value >= 90) return "bg-green-100";
  if (value >= 70) return "bg-yellow-100";
  return "bg-red-100";
}

function getProgressBarColor(value: number): string {
  if (value >= 90) return "bg-green-500";
  if (value >= 70) return "bg-yellow-500";
  return "bg-red-500";
}

function AccuracyCard({ value, label, tooltip }: { value: number; label: string; tooltip?: string }) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center rounded-lg p-4",
        getAccuracyBgColor(value)
      )}
    >
      {tooltip && (
        <Tooltip content={tooltip} position="top" className="absolute right-2 top-2">
          <HelpCircle className="h-4 w-4 text-gray-400 hover:text-gray-600" />
        </Tooltip>
      )}
      <span className={cn("text-3xl font-bold", getAccuracyColor(value))}>{value.toFixed(1)}%</span>
      <span className="mt-1 text-center text-sm text-gray-600">{label}</span>
    </div>
  );
}

function SpeakerProgressBar({ speaker }: { speaker: SpeakerAccuracyBreakdown }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">
          {t(`speakers.${speaker.speaker}`, { defaultValue: speaker.speaker })}
        </span>
        <span className={cn("font-medium", getAccuracyColor(speaker.accuracy))}>
          {speaker.accuracy.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            getProgressBarColor(speaker.accuracy)
          )}
          style={{ width: `${Math.min(speaker.accuracy, 100)}%` }}
        />
      </div>
      <div className="text-xs text-gray-500">
        {t("accuracy.wordsOriginal")}: {speaker.originalCount.toLocaleString()} |{" "}
        {t("accuracy.wordsTranscribed")}: {speaker.matchedCount.toLocaleString()}
      </div>
    </div>
  );
}

function AccuracyContent({ accuracy }: { accuracy: TranscriptionAccuracy }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Main metrics */}
      <div className="grid grid-cols-2 gap-4">
        <AccuracyCard
          value={accuracy.overallTextSimilarity}
          label={t("accuracy.textSimilarity")}
          tooltip={t("accuracy.textSimilarityTooltip")}
        />
        <AccuracyCard
          value={accuracy.speakerAccuracy}
          label={t("accuracy.speakerAccuracy")}
          tooltip={t("accuracy.speakerAccuracyTooltip")}
        />
      </div>

      {/* Statistics */}
      <div>
        <h4 className="mb-2 text-sm font-medium text-gray-700">{t("accuracy.stats")}</h4>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between">
            <span className="text-gray-500">{t("accuracy.originalSegments")}</span>
            <span className="font-medium">{accuracy.stats.originalSegments}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">{t("accuracy.transcribedSegments")}</span>
            <span className="font-medium">{accuracy.stats.transcribedSegments}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">{t("accuracy.originalWords")}</span>
            <span className="font-medium">{accuracy.stats.originalWords.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">{t("accuracy.transcribedWords")}</span>
            <span className="font-medium">{accuracy.stats.transcribedWords.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* WER metric */}
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-gray-600">{t("accuracy.wordErrorRate")}</span>
            <Tooltip content={t("accuracy.wordErrorRateTooltip")} position="top">
              <HelpCircle className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600" />
            </Tooltip>
          </div>
          <span className="font-mono text-sm font-medium">
            {(accuracy.wordErrorRate * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Speaker breakdown */}
      {accuracy.speakerBreakdown.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-gray-700">{t("accuracy.bySpeaker")}</h4>
          <div className="space-y-4">
            {accuracy.speakerBreakdown.map((speaker) => (
              <SpeakerProgressBar key={speaker.speaker} speaker={speaker} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TranscriptionAccuracyPanel({ sessionId }: TranscriptionAccuracyPanelProps) {
  const { t } = useTranslation();
  const { data: accuracy, isLoading, error } = useSessionAccuracy(sessionId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-indigo-600" />
          {t("accuracy.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4" />
            {t("accuracy.errorLoading")}
          </div>
        )}
        {accuracy && <AccuracyContent accuracy={accuracy} />}
      </CardContent>
    </Card>
  );
}
