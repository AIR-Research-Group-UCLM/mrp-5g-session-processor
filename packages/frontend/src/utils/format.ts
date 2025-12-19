import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";

dayjs.extend(relativeTime);
dayjs.extend(utc);
// Locale is set by i18n/index.ts based on user language preference

export function formatDate(date: string): string {
  // Parse as UTC and convert to local timezone
  return dayjs.utc(date).local().format("DD/MM/YYYY HH:mm");
}

export function formatRelativeDate(date: string): string {
  // Parse as UTC and convert to local timezone
  return dayjs.utc(date).local().fromNow();
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format milliseconds as human-readable processing duration
 * Examples: "2s", "1m 30s", "5m 45s"
 */
export function formatProcessingDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format USD cost amount
 * Examples: "$0.03", "$1.25", "< $0.01"
 */
export function formatCost(usdAmount: number): string {
  if (usdAmount < 0.01) {
    return "< $0.01";
  }
  return `$${usdAmount.toFixed(2)}`;
}
