import { basePathNormalized } from "@/api/client";
import { ClinicalIndicatorsPanel } from "@/components/sessions/ClinicalIndicatorsPanel";
import { ProcessingTimeline } from "@/components/sessions/ProcessingTimeline";
import { TranscriptionAccuracyPanel } from "@/components/sessions/TranscriptionAccuracyPanel";
import { TranscriptViewer } from "@/components/sessions/TranscriptViewer";
import { Badge, SessionStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { ProcessingProgress } from "@/components/videos/ProcessingProgress";
import { useAuth } from "@/hooks/useAuth";
import { useDeleteSession, useSession, useUpdateSession } from "@/hooks/useSessions";
import { cn } from "@/utils/cn";
import { formatDate, formatDuration } from "@/utils/format";
import {
  ArrowLeft,
  Calendar,
  Clock,
  FileText,
  Languages,
  Navigation,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

export function SessionDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { canWrite } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, refetch } = useSession(id!);
  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [autoScrollTranscript, setAutoScrollTranscript] = useState(true);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center">
        <p className="text-gray-500">{t("sessions.notFound")}</p>
        <Link to="/sessions" className="mt-4 text-primary-600">
          {t("sessions.backToSessions")}
        </Link>
      </div>
    );
  }

  const { session } = data;
  // Use streaming endpoint instead of presigned URL to avoid CORS issues
  const videoUrl = `${basePathNormalized}/api/sessions/${session.id}/video/stream`;

  const handleStartEdit = () => {
    setEditTitle(session.title ?? "");
    setEditTags(session.userTags?.join(", ") ?? "");
    setEditNotes(session.notes ?? "");
    setIsEditing(true);
  };

  const handleSave = async () => {
    await updateSession.mutateAsync({
      id: session.id,
      data: {
        title: editTitle || undefined,
        userTags: editTags
          ? editTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        notes: editNotes || undefined,
      },
    });
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (confirm(t("sessions.confirmDelete"))) {
      await deleteSession.mutateAsync(session.id);
      window.location.href = `${basePathNormalized}/sessions`;
    }
  };

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  const isProcessing = session.status === "processing" || session.status === "pending";

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 sm:items-center sm:gap-4">
          <Link to="/sessions" className="shrink-0">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-gray-900 sm:text-2xl">
              {session.title ?? t("sessions.untitledSession")}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500 sm:gap-4">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4 shrink-0" />
                {formatDate(session.createdAt)}
              </span>
              {session.videoDurationSeconds && (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4 shrink-0" />
                  {formatDuration(session.videoDurationSeconds)}
                </span>
              )}
              {session.language && (
                <span className="flex items-center gap-1">
                  <Languages className="h-4 w-4 shrink-0" />
                  {t(`languages.${session.language}`, {
                    defaultValue: session.language.toUpperCase(),
                  })}
                </span>
              )}
              {session.status !== "completed" && <SessionStatusBadge status={session.status} />}
              {session.isSimulated && <Badge variant="secondary">{t("sessions.simulated")}</Badge>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {!isEditing ? (
            <>
              {canWrite ? (
                <>
                  <Button variant="secondary" onClick={handleStartEdit}>
                    {t("common.edit")}
                  </Button>
                  <Button variant="danger" onClick={handleDelete}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Tooltip content={t("permissions.noWriteAccess")} position="bottom">
                    <Button variant="secondary" disabled>
                      {t("common.edit")}
                    </Button>
                  </Tooltip>
                  <Tooltip content={t("permissions.noWriteAccess")} position="bottom">
                    <Button variant="danger" disabled>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                </>
              )}
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setIsEditing(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSave} isLoading={updateSession.isPending}>
                <Save className="h-4 w-4" />
                {t("common.save")}
              </Button>
            </>
          )}
        </div>
      </div>

      {isProcessing ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("sessionDetail.processingSession")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProcessingProgress sessionId={session.id} onComplete={() => refetch()} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-6">
            {session.videoS3Key && (
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="aspect-video bg-black">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      className="h-full w-full"
                      controls
                      onTimeUpdate={handleTimeUpdate}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>{t("sessionDetail.information")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {isEditing ? (
                  <>
                    <Input
                      label={t("newSession.sessionTitle")}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                    <Input
                      label={t("newSession.tags")}
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                    />
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        {t("sessionDetail.notes")}
                      </label>
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={3}
                        className="input resize-none"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {session.summary && (
                      <div>
                        <h4 className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
                          <FileText className="h-4 w-4" />
                          {t("sessionDetail.summary")}
                        </h4>
                        <p className="text-sm text-gray-600">{session.summary}</p>
                      </div>
                    )}

                    {session.keywords && session.keywords.length > 0 && (
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-gray-700">
                          {t("sessionDetail.keywords")}
                        </h4>
                        <div className="flex flex-wrap gap-1">
                          {session.keywords.map((kw) => (
                            <Badge key={kw} variant="default">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {session.userTags && session.userTags.length > 0 && (
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-gray-700">
                          {t("sessionDetail.tags")}
                        </h4>
                        <div className="flex flex-wrap gap-1">
                          {session.userTags.map((tag) => (
                            <Badge key={tag} variant="info">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {session.notes && (
                      <div>
                        <h4 className="mb-1 text-sm font-medium text-gray-700">
                          {t("sessionDetail.notes")}
                        </h4>
                        <p className="text-sm text-gray-600">{session.notes}</p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {session.clinicalIndicators && (
              <ClinicalIndicatorsPanel indicators={session.clinicalIndicators} />
            )}

            {session.isSimulated && session.status === "completed" && (
              <TranscriptionAccuracyPanel sessionId={session.id} />
            )}

            {session.status === "completed" && (
              <ProcessingTimeline
                processingTimeline={session.processingTimeline}
                simulationTimeline={session.simulationTimeline}
                isSimulated={session.isSimulated}
              />
            )}
          </div>

          <Card className="h-fit min-w-0 lg:sticky lg:top-6">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t("sessionDetail.transcript")}</CardTitle>
              {session.transcript.length > 0 && (
                <Tooltip
                  content={
                    autoScrollTranscript
                      ? t("sessionDetail.disableTracking")
                      : t("sessionDetail.enableTracking")
                  }
                  position="bottom"
                >
                  <button
                    onClick={() => setAutoScrollTranscript(!autoScrollTranscript)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                      autoScrollTranscript
                        ? "bg-primary-100 text-primary-700"
                        : "text-gray-500 hover:bg-gray-100"
                    )}
                  >
                    <Navigation className={cn("h-4 w-4", autoScrollTranscript && "fill-current")} />
                    {t("sessionDetail.autoScroll")}
                  </button>
                </Tooltip>
              )}
            </CardHeader>
            <CardContent>
              <div ref={transcriptContainerRef} className="max-h-[600px] overflow-auto">
                {session.transcript.length > 0 ? (
                  <TranscriptViewer
                    sections={session.transcript}
                    sectionSummaries={session.sectionSummaries}
                    currentTime={currentTime}
                    onSeek={handleSeek}
                    autoScroll={autoScrollTranscript}
                    scrollContainerRef={transcriptContainerRef}
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-gray-500">
                    {t("sessionDetail.noTranscript")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
