import { useSessionStatus } from "@/hooks/useSessions";
import { cn } from "@/utils/cn";
import { Check, Loader2, AlertCircle } from "lucide-react";
import type { ProcessingProgress as ProgressType } from "@mrp/shared";

interface ProcessingProgressProps {
  sessionId: string;
  onComplete?: () => void;
}

export function ProcessingProgress({
  sessionId,
  onComplete,
}: ProcessingProgressProps) {
  const { data: progress, isLoading } = useSessionStatus(sessionId, true);

  if (isLoading || !progress) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (progress.status === "completed" && onComplete) {
    onComplete();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Estado del procesamiento</h3>
        <StatusBadge status={progress.status} />
      </div>

      <div className="space-y-3">
        {progress.steps.map((step, index) => (
          <StepItem
            key={step.type}
            step={step}
            isActive={progress.currentStep === step.type}
            index={index + 1}
          />
        ))}
      </div>

      {progress.errorMessage && (
        <div className="mt-4 rounded-lg bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <p className="font-medium text-red-800">Error en el procesamiento</p>
              <p className="mt-1 text-sm text-red-700">{progress.errorMessage}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ProgressType["status"] }) {
  const config: Record<
    ProgressType["status"],
    { label: string; className: string }
  > = {
    pending: { label: "Pendiente", className: "bg-gray-100 text-gray-700" },
    processing: { label: "Procesando", className: "bg-yellow-100 text-yellow-700" },
    completed: { label: "Completado", className: "bg-green-100 text-green-700" },
    failed: { label: "Error", className: "bg-red-100 text-red-700" },
  };

  const { label, className } = config[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium",
        className
      )}
    >
      {label}
    </span>
  );
}

interface StepItemProps {
  step: ProgressType["steps"][number];
  isActive: boolean;
  index: number;
}

function StepItem({ step, isActive, index }: StepItemProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium",
          step.status === "completed" && "bg-green-100 text-green-600",
          step.status === "processing" && "bg-primary-100 text-primary-600",
          step.status === "pending" && "bg-gray-100 text-gray-400",
          step.status === "failed" && "bg-red-100 text-red-600"
        )}
      >
        {step.status === "completed" ? (
          <Check className="h-4 w-4" />
        ) : step.status === "processing" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : step.status === "failed" ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          index
        )}
      </div>
      <span
        className={cn(
          "text-sm",
          isActive ? "font-medium text-gray-900" : "text-gray-600"
        )}
      >
        {step.label}
      </span>
    </div>
  );
}
