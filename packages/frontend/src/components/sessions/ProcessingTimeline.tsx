import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatProcessingDuration, formatCost } from "@/utils/format";
import type { ProcessingTimeline as ProcessingTimelineType, SimulationTimeline } from "@mrp/shared";
import { CheckCircle2, Clock, Sparkles, Coins } from "lucide-react";

interface ProcessingTimelineProps {
  processingTimeline: ProcessingTimelineType | null;
  simulationTimeline?: SimulationTimeline | null;
  isSimulated: boolean;
}

export function ProcessingTimeline({
  processingTimeline,
  simulationTimeline,
  isSimulated,
}: ProcessingTimelineProps) {
  const { t } = useTranslation();

  // Don't render if there's no timeline data
  if (!processingTimeline && !simulationTimeline) {
    return null;
  }

  const totalProcessingTime = processingTimeline?.totalDurationMs ?? 0;
  const totalSimulationTime = simulationTimeline?.totalDurationMs ?? 0;
  const grandTotal = isSimulated ? totalProcessingTime + totalSimulationTime : totalProcessingTime;

  // Calculate total cost
  const processingCost = processingTimeline?.totalCostUsd ?? 0;
  const simulationCost = simulationTimeline?.totalCostUsd ?? 0;
  const grandTotalCost = isSimulated ? processingCost + simulationCost : processingCost;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-600" />
          {t("timing.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Grand Total - Time and Cost */}
        {(grandTotal > 0 || grandTotalCost > 0) && (
          <div className="flex items-center justify-between gap-4 rounded-lg bg-blue-50 px-4 py-3">
            {grandTotal > 0 && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-800">{t("timing.totalTime")}</span>
                <span className="text-lg font-semibold text-blue-900">
                  {formatProcessingDuration(grandTotal)}
                </span>
              </div>
            )}
            {grandTotalCost > 0 && (
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-800">{t("costs.totalCost")}</span>
                <span className="text-lg font-semibold text-green-900">
                  {formatCost(grandTotalCost)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Simulation Steps (if simulated) */}
        {isSimulated && simulationTimeline && (
          <div className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Sparkles className="h-4 w-4 text-purple-500" />
              {t("timing.simulationSteps")}
            </h4>
            <div className="space-y-1 rounded-lg bg-gray-50 p-3">
              <TimelineStep
                label={t("timing.conversationGeneration")}
                durationMs={simulationTimeline.conversationDurationMs}
                costUsd={simulationTimeline.conversationCostUsd}
              />
              <TimelineStep
                label={t("timing.audioGeneration")}
                durationMs={simulationTimeline.audioDurationMs}
                costUsd={simulationTimeline.elevenlabsCostUsd}
              />
              <TimelineStep
                label={t("timing.audioConcatenation")}
                durationMs={simulationTimeline.concatenationDurationMs}
              />
              {(simulationTimeline.totalDurationMs || simulationTimeline.totalCostUsd) && (
                <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2">
                  <span className="text-sm font-medium text-gray-600">{t("timing.subtotal")}</span>
                  <div className="flex items-center gap-4">
                    {simulationTimeline.totalDurationMs && (
                      <span className="font-medium text-gray-800">
                        {formatProcessingDuration(simulationTimeline.totalDurationMs)}
                      </span>
                    )}
                    {simulationTimeline.totalCostUsd && (
                      <span className="font-medium text-green-700">
                        {formatCost(simulationTimeline.totalCostUsd)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Processing Steps */}
        {processingTimeline && processingTimeline.steps.length > 0 && (
          <div className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Clock className="h-4 w-4 text-blue-500" />
              {t("timing.processingSteps")}
            </h4>
            <div className="space-y-1 rounded-lg bg-gray-50 p-3">
              {processingTimeline.steps
                .filter((step) => step.type !== "complete")
                .map((step) => (
                  <TimelineStep
                    key={step.type}
                    label={t(`timing.${step.type}`)}
                    durationMs={step.durationMs}
                    costUsd={step.costUsd}
                  />
                ))}
              {(processingTimeline.totalDurationMs || processingTimeline.totalCostUsd) && (
                <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2">
                  <span className="text-sm font-medium text-gray-600">{t("timing.subtotal")}</span>
                  <div className="flex items-center gap-4">
                    {processingTimeline.totalDurationMs && (
                      <span className="font-medium text-gray-800">
                        {formatProcessingDuration(processingTimeline.totalDurationMs)}
                      </span>
                    )}
                    {processingTimeline.totalCostUsd && (
                      <span className="font-medium text-green-700">
                        {formatCost(processingTimeline.totalCostUsd)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TimelineStepProps {
  label: string;
  durationMs: number | null;
  costUsd?: number | null;
}

function TimelineStep({ label, durationMs, costUsd }: TimelineStepProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        <span className="text-gray-600">{label}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-gray-500">
          {durationMs ? formatProcessingDuration(durationMs) : "-"}
        </span>
        {costUsd != null && costUsd > 0 && (
          <span className="text-green-600 tabular-nums">
            {formatCost(costUsd)}
          </span>
        )}
      </div>
    </div>
  );
}
