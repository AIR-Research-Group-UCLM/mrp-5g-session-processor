import type { HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "error" | "info";
}

export function Badge({
  className,
  variant = "default",
  children,
  ...props
}: BadgeProps) {
  const variants = {
    default: "bg-gray-100 text-gray-700",
    success: "bg-green-100 text-green-700",
    warning: "bg-yellow-100 text-yellow-700",
    error: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function SessionStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();

  const statusConfig: Record<
    string,
    { labelKey: string; variant: BadgeProps["variant"] }
  > = {
    pending: { labelKey: "status.pending", variant: "default" },
    processing: { labelKey: "status.processing", variant: "warning" },
    completed: { labelKey: "status.completed", variant: "success" },
    failed: { labelKey: "status.failed", variant: "error" },
  };

  const config = statusConfig[status] ?? { labelKey: status, variant: "default" };

  return <Badge variant={config.variant}>{t(config.labelKey)}</Badge>;
}
