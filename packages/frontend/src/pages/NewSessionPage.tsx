import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ProcessingProgress } from "@/components/videos/ProcessingProgress";
import { VideoUploader } from "@/components/videos/VideoUploader";
import { useCreateSession } from "@/hooks/useSessions";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export function NewSessionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createSession = useCreateSession();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);

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
              disabled={createSession.isPending}
            />
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
          <Button
            type="submit"
            disabled={!file || createSession.isPending}
            isLoading={createSession.isPending}
          >
            {t("newSession.processSession")}
          </Button>
        </div>
      </form>
    </div>
  );
}
