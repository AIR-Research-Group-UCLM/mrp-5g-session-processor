import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";
import "dayjs/locale/es";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.locale("es");

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
