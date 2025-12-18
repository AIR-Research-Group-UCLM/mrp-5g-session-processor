import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";
import { Upload, X, Film, Music } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatFileSize } from "@/utils/format";

interface VideoUploaderProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onClear: () => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = {
  // Video formats
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
  "video/quicktime": [".mov"],
  "video/x-msvideo": [".avi"],
  "video/x-matroska": [".mkv"],
  // Audio formats
  "audio/mpeg": [".mp3"],
  "audio/mp4": [".m4a"],
  "audio/wav": [".wav"],
  "audio/x-wav": [".wav"],
  "audio/ogg": [".ogg"],
  "audio/webm": [".weba"],
};

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/");
}

const MAX_SIZE = 500 * 1024 * 1024; // 500MB

export function VideoUploader({
  onFileSelect,
  selectedFile,
  onClear,
  disabled,
}: VideoUploaderProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setError(null);

      if (fileRejections.length > 0) {
        const firstError = fileRejections[0]?.errors[0]?.message;
        setError(firstError ?? t("upload.invalidFile"));
        return;
      }

      if (acceptedFiles.length > 0 && acceptedFiles[0]) {
        onFileSelect(acceptedFiles[0]);
      }
    },
    [onFileSelect, t]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_SIZE,
    maxFiles: 1,
    disabled,
  });

  if (selectedFile) {
    const isAudio = isAudioFile(selectedFile);
    const IconComponent = isAudio ? Music : Film;

    return (
      <div className="rounded-lg border-2 border-gray-200 bg-gray-50 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-100">
              <IconComponent className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">{selectedFile.name}</p>
              <p className="text-sm text-gray-500">
                {formatFileSize(selectedFile.size)}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClear}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors",
          isDragActive
            ? "border-primary-500 bg-primary-50"
            : "border-gray-300 hover:border-gray-400",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className={cn(
            "mb-4 h-12 w-12",
            isDragActive ? "text-primary-500" : "text-gray-400"
          )}
        />
        <p className="mb-2 text-center font-medium text-gray-700">
          {isDragActive
            ? t("upload.dropzoneActive")
            : t("upload.dropzone")}
        </p>
        <p className="text-center text-sm text-gray-500">
          {t("upload.acceptedFormats")}
        </p>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
