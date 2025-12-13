import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateSession } from "@/hooks/useSessions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { VideoUploader } from "@/components/videos/VideoUploader";
import { ProcessingProgress } from "@/components/videos/ProcessingProgress";

export function NewSessionPage() {
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
          ? tags.split(",").map((t) => t.trim()).filter(Boolean)
          : undefined,
        notes: notes || undefined,
      },
    });

    setCreatedSessionId(session.id);
  };

  const handleComplete = () => {
    if (createdSessionId) {
      navigate(`/sesiones/${createdSessionId}`);
    }
  };

  if (createdSessionId) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Procesando sesión</CardTitle>
            <CardDescription>
              Tu video está siendo procesado. Esto puede tomar unos minutos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProcessingProgress
              sessionId={createdSessionId}
              onComplete={handleComplete}
            />
            <div className="mt-6 flex justify-end">
              <Button variant="secondary" onClick={handleComplete}>
                Ver sesión
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Nueva Sesión</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Video de la sesión</CardTitle>
            <CardDescription>
              Sube el video de la consulta médica para procesarlo
            </CardDescription>
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
            <CardTitle>Información adicional</CardTitle>
            <CardDescription>
              Estos campos son opcionales pero ayudan a organizar las sesiones
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              id="title"
              label="Título"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Consulta Dr. García - Paciente #123"
              disabled={createSession.isPending}
            />
            <Input
              id="tags"
              label="Etiquetas (separadas por comas)"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Ej: cardiología, seguimiento, urgente"
              disabled={createSession.isPending}
            />
            <div>
              <label
                htmlFor="notes"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Notas
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas adicionales sobre la sesión..."
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
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={!file || createSession.isPending}
            isLoading={createSession.isPending}
          >
            Procesar Sesión
          </Button>
        </div>
      </form>
    </div>
  );
}
