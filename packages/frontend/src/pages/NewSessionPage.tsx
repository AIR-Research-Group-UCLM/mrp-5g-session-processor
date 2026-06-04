import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Tooltip } from "@/components/ui/Tooltip";
import { ProcessingProgress } from "@/components/videos/ProcessingProgress";
import { VideoUploader } from "@/components/videos/VideoUploader";
import { useAuth } from "@/hooks/useAuth";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useCreateSession } from "@/hooks/useSessions";
import type { TranscriptionEngine } from "@mrp/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export function NewSessionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const createSession = useCreateSession();
  const { data: appConfig } = useAppConfig();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [engine, setEngine] = useState<TranscriptionEngine | null>(null);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);

  const whisperxAvailable = appConfig?.transcription.whisperxAvailable ?? false;
  const whisperxDevice = (appConfig?.transcription.whisperxDevice ?? "cpu").toUpperCase();
  const defaultEngine = appConfig?.transcription.defaultEngine ?? "openai";
  // Never auto-select an engine whose service isn't up.
  const fallbackEngine: TranscriptionEngine =
    defaultEngine === "whisperx" && !whisperxAvailable ? "openai" : defaultEngine;
  const selectedEngine: TranscriptionEngine = engine ?? fallbackEngine;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    const session = await createSession.mutateAsync({
      file,
      metadata: {
        title: title || undefined,
        userTags: tags
          ? tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : undefined,
        notes: notes || undefined,
        transcriptionEngine: selectedEngine,
      },
    });

    setCreatedSessionId(session.id);
  };

  const handleComplete = () => {
    if (createdSessionId) {
      navigate(`/sessions/${createdSessionId}`);
    }
  };

  if (createdSessionId) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>{t("processing.title")}</CardTitle>
            <CardDescription>{t("processing.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProcessingProgress sessionId={createdSessionId} onComplete={handleComplete} />
            <div className="mt-6 flex justify-end">
              <Button variant="secondary" onClick={handleComplete}>
                {t("processing.viewSession")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">{t("newSession.title")}</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("newSession.videoSection")}</CardTitle>
            <CardDescription>{t("newSession.videoDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <VideoUploader
              selectedFile={file}
              onFileSelect={setFile}
              onClear={() => setFile(null)}
              disabled={createSession.isPending || !canWrite}
            />
            {!canWrite && (
              <p className="mt-2 text-sm text-amber-600">
                {t("permissions.noWriteAccess")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("newSession.transcriptionSection")}</CardTitle>
            <CardDescription>{t("newSession.transcriptionDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <label
              htmlFor="transcriptionEngine"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              {t("newSession.transcriptionEngine")}
            </label>
            <select
              id="transcriptionEngine"
              value={selectedEngine}
              onChange={(e) => setEngine(e.target.value as TranscriptionEngine)}
              disabled={createSession.isPending || !canWrite}
              className="input"
            >
              <option value="openai">{t("newSession.engineOpenai")}</option>
              <option value="whisperx" disabled={!whisperxAvailable}>
                {whisperxAvailable
                  ? t("newSession.engineWhisperx", { device: whisperxDevice })
                  : t("newSession.engineWhisperxUnavailable")}
              </option>
            </select>
            {selectedEngine === "whisperx" && whisperxAvailable && (
              <p className="mt-1.5 text-sm text-gray-500">
                {t("newSession.engineWhisperxHint", { device: whisperxDevice })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("newSession.additionalInfo")}</CardTitle>
            <CardDescription>{t("newSession.additionalInfoDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              id="title"
              label={t("newSession.sessionTitle")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("newSession.sessionTitlePlaceholder")}
              disabled={createSession.isPending}
            />
            <Input
              id="tags"
              label={t("newSession.tags")}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("newSession.tagsPlaceholder")}
              disabled={createSession.isPending}
            />
            <div>
              <label htmlFor="notes" className="mb-1.5 block text-sm font-medium text-gray-700">
                {t("newSession.notes")}
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("newSession.notesPlaceholder")}
                rows={3}
                disabled={createSession.isPending}
                className="input resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(-1)}
            disabled={createSession.isPending}
          >
            {t("common.cancel")}
          </Button>
          {canWrite ? (
            <Button
              type="submit"
              disabled={!file || createSession.isPending}
              isLoading={createSession.isPending}
            >
              {t("newSession.processSession")}
            </Button>
          ) : (
            <Tooltip content={t("permissions.noWriteAccess")} position="top">
              <Button type="button" disabled>
                {t("newSession.processSession")}
              </Button>
            </Tooltip>
          )}
        </div>
      </form>
    </div>
  );
}
