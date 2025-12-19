import { useSimulationStatus } from "@/hooks/useSimulator";
import { Spinner } from "@/components/ui/Spinner";
import { useTranslation } from "react-i18next";

interface SimulationProgressProps {
  simulationId: string;
  onComplete?: (sessionId: string) => void;
}

type StepStatus = "pending" | "active" | "completed" | "error";

interface Step {
  key: string;
  labelKey: string;
  status: StepStatus;
  progress?: string;
}

export function SimulationProgress({ simulationId, onComplete }: SimulationProgressProps) {
  const { t } = useTranslation();
  const { data: progress, isLoading, error } = useSimulationStatus(simulationId);

  // Call onComplete when simulation is done
  if (progress?.status === "completed" && progress.sessionId && onComplete) {
    onComplete(progress.sessionId);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-700">
        <p className="font-medium">{t("common.error")}</p>
        <p className="text-sm">{(error as Error).message}</p>
      </div>
    );
  }

  if (!progress) {
    return null;
  }

  // Build steps based on progress
  const getStepStatus = (stepStatus: string, currentStatus: string): StepStatus => {
    if (currentStatus === "failed") {
      return stepStatus === progress.status ? "error" : "pending";
    }
    if (stepStatus === currentStatus) {
      return "active";
    }
    // Determine if step is completed based on order
    const statusOrder = [
      "pending",
      "generating-conversation",
      "generating-audio",
      "concatenating-audio",
      "creating-session",
      "completed",
    ];
    const currentIndex = statusOrder.indexOf(currentStatus);
    const stepIndex = statusOrder.indexOf(stepStatus);
    return stepIndex < currentIndex ? "completed" : "pending";
  };

  const steps: Step[] = [
    {
      key: "generating-conversation",
      labelKey: "simulator.progress.generatingConversation",
      status: getStepStatus("generating-conversation", progress.status),
    },
    {
      key: "generating-audio",
      labelKey: "simulator.progress.generatingAudio",
      status: getStepStatus("generating-audio", progress.status),
      progress:
        progress.status === "generating-audio" && progress.totalSegments
          ? `(${Math.round(((progress.completedSegments ?? 0) / progress.totalSegments) * 100)}%)`
          : undefined,
    },
    {
      key: "concatenating-audio",
      labelKey: "simulator.progress.concatenatingAudio",
      status: getStepStatus("concatenating-audio", progress.status),
    },
    {
      key: "creating-session",
      labelKey: "simulator.progress.creatingSession",
      status: getStepStatus("creating-session", progress.status),
    },
  ];

  return (
    <div className="space-y-4">
      {progress.status === "failed" && progress.errorMessage && (
        <div className="rounded-lg bg-red-50 p-4 text-red-700">
          <p className="font-medium">{t("common.error")}</p>
          <p className="text-sm">{progress.errorMessage}</p>
        </div>
      )}

      <ul className="space-y-3">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-3">
            <StepIndicator status={step.status} />
            <span
              className={`text-sm ${
                step.status === "active"
                  ? "font-medium text-blue-600"
                  : step.status === "completed"
                  ? "text-green-600"
                  : step.status === "error"
                  ? "text-red-600"
                  : "text-gray-500"
              }`}
            >
              {t(step.labelKey)}
              {step.progress && (
                <span className="ml-1 text-gray-400">{step.progress}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepIndicator({ status }: { status: StepStatus }) {
  switch (status) {
    case "completed":
      return (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    case "active":
      return (
        <div className="flex h-5 w-5 items-center justify-center">
          <Spinner size="sm" />
        </div>
      );
    case "error":
      return (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
    default:
      return (
        <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
      );
  }
}
