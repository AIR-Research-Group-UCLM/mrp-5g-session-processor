import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { SimulationProgress } from "@/components/simulator/SimulationProgress";
import { useStartSimulation, useSimulatorVoices } from "@/hooks/useSimulator";
import { LANGUAGE_NAMES } from "@mrp/shared";

export function SimulatorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const startSimulation = useStartSimulation();
  const { data: voices, isLoading: voicesLoading } = useSimulatorVoices();

  const [context, setContext] = useState("");
  const [language, setLanguage] = useState("es");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [simulationId, setSimulationId] = useState<string | null>(null);

  // Voice selections (default to first 3 voices)
  const [doctorVoice, setDoctorVoice] = useState("");
  const [patientVoice, setPatientVoice] = useState("");
  const [specialistVoice, setSpecialistVoice] = useState("");

  // Set default voices when loaded
  useEffect(() => {
    if (voices && voices.length >= 3) {
      if (!doctorVoice) setDoctorVoice(voices[0]?.id ?? "");
      if (!patientVoice) setPatientVoice(voices[1]?.id ?? "");
      if (!specialistVoice) setSpecialistVoice(voices[2]?.id ?? "");
    }
  }, [voices, doctorVoice, patientVoice, specialistVoice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!context.trim() || !doctorVoice || !patientVoice || !specialistVoice) return;

    const result = await startSimulation.mutateAsync({
      context: context.trim(),
      language,
      voices: {
        DOCTOR: doctorVoice,
        PATIENT: patientVoice,
        SPECIALIST: specialistVoice,
      },
      title: title.trim() || undefined,
      userTags: tags
        ? tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined,
      notes: notes.trim() || undefined,
    });

    setSimulationId(result.simulationId);
  };

  const handleSimulationComplete = (sessionId: string) => {
    navigate(`/sessions/${sessionId}`);
  };

  if (simulationId) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>{t("simulator.progress.title")}</CardTitle>
            <CardDescription>{t("simulator.progress.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SimulationProgress
              simulationId={simulationId}
              onComplete={handleSimulationComplete}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">{t("simulator.title")}</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("simulator.contextSection")}</CardTitle>
            <CardDescription>{t("simulator.contextDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label
                htmlFor="context"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                {t("simulator.context")} *
              </label>
              <textarea
                id="context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder={t("simulator.contextPlaceholder")}
                rows={5}
                required
                minLength={10}
                maxLength={5000}
                disabled={startSimulation.isPending}
                className="input resize-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                {context.length}/5000
              </p>
            </div>

            <div>
              <label
                htmlFor="language"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                {t("simulator.language")}
              </label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={startSimulation.isPending}
                className="input"
              >
                {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {t(`languages.${code}`, name)} ({name})
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("simulator.voicesSection")}</CardTitle>
            <CardDescription>{t("simulator.voicesDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label
                htmlFor="doctorVoice"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                {t("simulator.doctorVoice")}
              </label>
              <select
                id="doctorVoice"
                value={doctorVoice}
                onChange={(e) => setDoctorVoice(e.target.value)}
                disabled={startSimulation.isPending || voicesLoading}
                className="input"
              >
                {voices
                  ?.filter((v) => v.id === doctorVoice || (v.id !== patientVoice && v.id !== specialistVoice))
                  .map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="patientVoice"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                {t("simulator.patientVoice")}
              </label>
              <select
                id="patientVoice"
                value={patientVoice}
                onChange={(e) => setPatientVoice(e.target.value)}
                disabled={startSimulation.isPending || voicesLoading}
                className="input"
              >
                {voices
                  ?.filter((v) => v.id === patientVoice || (v.id !== doctorVoice && v.id !== specialistVoice))
                  .map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="specialistVoice"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                {t("simulator.specialistVoice")}
              </label>
              <select
                id="specialistVoice"
                value={specialistVoice}
                onChange={(e) => setSpecialistVoice(e.target.value)}
                disabled={startSimulation.isPending || voicesLoading}
                className="input"
              >
                {voices
                  ?.filter((v) => v.id === specialistVoice || (v.id !== doctorVoice && v.id !== patientVoice))
                  .map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                    </option>
                  ))}
              </select>
            </div>
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
              disabled={startSimulation.isPending}
            />
            <Input
              id="tags"
              label={t("newSession.tags")}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("newSession.tagsPlaceholder")}
              disabled={startSimulation.isPending}
            />
            <div>
              <label
                htmlFor="notes"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                {t("newSession.notes")}
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("newSession.notesPlaceholder")}
                rows={3}
                disabled={startSimulation.isPending}
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
            disabled={startSimulation.isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={
              !context.trim() ||
              context.length < 10 ||
              !doctorVoice ||
              !patientVoice ||
              !specialistVoice ||
              startSimulation.isPending ||
              voicesLoading
            }
            isLoading={startSimulation.isPending}
          >
            {t("simulator.generate")}
          </Button>
        </div>
      </form>
    </div>
  );
}
