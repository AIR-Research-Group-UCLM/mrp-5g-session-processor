import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";
import { Upload, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { formatFileSize } from "@/utils/format";
import { extractTextFromFile } from "@/api/report-summary.api";
import { DOCUMENT_MIME_TYPES, DOCUMENT_MIME_TYPE_LIST } from "@mrp/shared";

interface FileTextDropzoneProps {
  onTextExtracted: (text: string) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = {
  "text/plain": [".txt", ".text", ".log", ".csv"],
  "text/markdown": [".md"],
  "text/xml": [".xml"],
  "text/html": [".html"],
  "text/rtf": [".rtf"],
  [DOCUMENT_MIME_TYPES.pdf]: [".pdf"],
  [DOCUMENT_MIME_TYPES.docx]: [".docx"],
  [DOCUMENT_MIME_TYPES.odt]: [".odt"],
};

const BINARY_TYPES = new Set<string>(DOCUMENT_MIME_TYPE_LIST);

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function getTranslatedError(code: string | undefined, t: (key: string) => string): string {
  switch (code) {
    case "file-invalid-type":
      return t("reportSummary.file.fileTypeError");
    case "file-too-large":
      return t("reportSummary.file.fileTooLarge");
    default:
      return t("reportSummary.file.readError");
  }
}

export function FileTextDropzone({ onTextExtracted, disabled }: FileTextDropzoneProps) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number } | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setError(null);

      if (fileRejections.length > 0) {
        const firstErrorCode = fileRejections[0]?.errors[0]?.code;
        setError(getTranslatedError(firstErrorCode, t));
        return;
      }

      const file = acceptedFiles[0];
      if (!file) return;

      setIsReading(true);
      try {
        let text: string;

        if (BINARY_TYPES.has(file.type)) {
          const result = await extractTextFromFile(file);
          text = result.text;
        } else {
          text = await readFileAsText(file);
        }

        setSelectedFile({ name: file.name, size: file.size });
        onTextExtracted(text);
      } catch {
        setError(t("reportSummary.file.readError"));
      } finally {
        setIsReading(false);
      }
    },
    [onTextExtracted, t],
  );

  const handleClear = () => {
    setSelectedFile(null);
    setError(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_SIZE,
    maxFiles: 1,
    disabled: disabled || isReading,
  });

  if (isReading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border-2 border-gray-200 bg-gray-50 p-6">
        <Spinner />
        <span className="text-sm text-gray-500">
          {t("reportSummary.file.extracting")}
        </span>
      </div>
    );
  }

  if (selectedFile) {
    return (
      <div className="rounded-lg border-2 border-gray-200 bg-gray-50 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-100">
              <FileText className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">{selectedFile.name}</p>
              <p className="text-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={handleClear} disabled={disabled}>
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
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
          isDragActive
            ? "border-primary-500 bg-primary-50"
            : "border-gray-300 hover:border-gray-400",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className={cn(
            "mb-3 h-8 w-8",
            isDragActive ? "text-primary-500" : "text-gray-400",
          )}
        />
        <p className="mb-1 text-center text-sm font-medium text-gray-700">
          {isDragActive
            ? t("reportSummary.file.dropzoneActive")
            : t("reportSummary.file.dropzone")}
        </p>
        <p className="text-center text-xs text-gray-500">
          {t("reportSummary.file.acceptedFormats")}
        </p>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
