import type { HTMLAttributes } from "react";
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
  const statusConfig: Record<
    string,
    { label: string; variant: BadgeProps["variant"] }
  > = {
    pending: { label: "Pendiente", variant: "default" },
    processing: { label: "Procesando", variant: "warning" },
    completed: { label: "Completado", variant: "success" },
    failed: { label: "Error", variant: "error" },
  };

  const config = statusConfig[status] ?? { label: status, variant: "default" };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}
