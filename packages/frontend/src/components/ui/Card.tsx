import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div className={cn("card", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: CardProps) {
  return (
    <div className={cn("mb-4", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: CardProps) {
  return (
    <h3 className={cn("text-lg font-semibold text-gray-900", className)} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children, ...props }: CardProps) {
  return (
    <p className={cn("mt-1 text-sm text-gray-500", className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }: CardProps) {
  return (
    <div className={cn("", className)} {...props}>
      {children}
    </div>
  );
}
