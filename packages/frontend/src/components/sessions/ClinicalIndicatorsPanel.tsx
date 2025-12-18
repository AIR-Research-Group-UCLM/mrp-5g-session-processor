import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { ClinicalIndicators, TreatmentPlan } from "@mrp/shared";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Calendar,
  ClipboardList,
  FileText,
  GraduationCap,
  Pill,
  Stethoscope,
} from "lucide-react";

interface ClinicalIndicatorsPanelProps {
  indicators: ClinicalIndicators;
}

export function ClinicalIndicatorsPanel({ indicators }: ClinicalIndicatorsPanelProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-teal-600" />
          {t("clinicalIndicators.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Urgencia, Prioridad y Estado */}
        <div className="flex flex-wrap gap-3">
          {indicators.urgencyLevel && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">{t("clinicalIndicators.urgency")}</span>
              <UrgencyBadge level={indicators.urgencyLevel} />
            </div>
          )}
          {indicators.appointmentPriority && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">{t("clinicalIndicators.appointmentPriority")}</span>
              <Badge
                variant={indicators.appointmentPriority === "preferred" ? "warning" : "default"}
              >
                {t(`appointmentPriorities.${indicators.appointmentPriority}`)}
              </Badge>
            </div>
          )}
          {indicators.problemStatus && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">{t("clinicalIndicators.status")}</span>
              <ProblemStatusBadge status={indicators.problemStatus} />
            </div>
          )}
          {indicators.consultedSpecialty && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">{t("clinicalIndicators.specialty")}</span>
              <Badge variant="info">{indicators.consultedSpecialty}</Badge>
            </div>
          )}
        </div>

        {/* Motivo de consulta */}
        {indicators.reasonForVisit && (
          <Section icon={ClipboardList} title={t("clinicalIndicators.reasonForVisit")}>
            <p className="text-sm text-gray-700">{indicators.reasonForVisit}</p>
          </Section>
        )}

        {/* Problema clínico principal */}
        {indicators.mainClinicalProblem && (
          <Section icon={Stethoscope} title={t("clinicalIndicators.mainProblem")}>
            <p className="text-sm text-gray-700">{indicators.mainClinicalProblem}</p>
          </Section>
        )}

        {/* Hipótesis diagnósticas */}
        {indicators.diagnosticHypothesis && indicators.diagnosticHypothesis.length > 0 && (
          <Section icon={FileText} title={t("clinicalIndicators.diagnosticHypothesis")}>
            <ul className="space-y-2">
              {indicators.diagnosticHypothesis.map((h, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">{h.condition}</span>
                  <CertaintyBadge certainty={h.certainty} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Pruebas solicitadas */}
        {indicators.requestedTests && indicators.requestedTests.length > 0 && (
          <Section icon={ClipboardList} title={t("clinicalIndicators.requestedTests")}>
            <div className="flex flex-wrap gap-1">
              {indicators.requestedTests.map((test, i) => (
                <Badge key={i} variant="default">
                  {test}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {/* Plan de tratamiento */}
        {indicators.treatmentPlan && hasTreatmentContent(indicators.treatmentPlan) && (
          <TreatmentPlanSection plan={indicators.treatmentPlan} />
        )}

        {/* Educación sanitaria */}
        {indicators.patientEducation && indicators.patientEducation.length > 0 && (
          <Section icon={GraduationCap} title={t("clinicalIndicators.patientEducation")}>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              {indicators.patientEducation.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </Section>
        )}

        {/* Signos de alarma */}
        {indicators.warningSigns && indicators.warningSigns.length > 0 && (
          <Section icon={AlertTriangle} title={t("clinicalIndicators.warningSigns")} variant="warning">
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              {indicators.warningSigns.map((sign, i) => (
                <li key={i}>{sign}</li>
              ))}
            </ul>
          </Section>
        )}

        {/* Plan de seguimiento */}
        {indicators.followUpPlan && indicators.followUpPlan.followUpType && (
          <Section icon={Calendar} title={t("clinicalIndicators.followUpPlan")}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">
                {t(`followUpTypes.${indicators.followUpPlan.followUpType}`)}
              </Badge>
              {indicators.followUpPlan.responsibleCareLevel && (
                <Badge variant="default">
                  {t(`careLevels.${indicators.followUpPlan.responsibleCareLevel}`)}
                </Badge>
              )}
              {indicators.followUpPlan.timeFrame && (
                <span className="text-sm text-gray-700">{indicators.followUpPlan.timeFrame}</span>
              )}
            </div>
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

// Helper components

function UrgencyBadge({ level }: { level: ClinicalIndicators["urgencyLevel"] }) {
  const { t } = useTranslation();
  if (!level) return null;
  const variants = {
    low: "success",
    medium: "warning",
    high: "error",
  } as const;

  return <Badge variant={variants[level]}>{t(`urgencyLevels.${level}`)}</Badge>;
}

function ProblemStatusBadge({ status }: { status: ClinicalIndicators["problemStatus"] }) {
  const { t } = useTranslation();
  if (!status) return null;
  const variants: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
    new: "info",
    chronic: "default",
    exacerbation: "warning",
    follow_up: "default",
    resolved: "success",
  };

  return <Badge variant={variants[status] ?? "default"}>{t(`problemStatuses.${status}`)}</Badge>;
}

function CertaintyBadge({ certainty }: { certainty: string }) {
  const { t } = useTranslation();
  const variants: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
    confirmed: "success",
    probable: "warning",
    to_be_ruled_out: "default",
  };

  return <Badge variant={variants[certainty] ?? "default"}>{t(`diagnosticCertainties.${certainty}`, { defaultValue: certainty })}</Badge>;
}

interface SectionProps {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  variant?: "default" | "warning";
}

function Section({ icon: Icon, title, children, variant = "default" }: SectionProps) {
  return (
    <div className={variant === "warning" ? "rounded-lg bg-amber-50 p-3" : ""}>
      <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
        <Icon className={`h-4 w-4 ${variant === "warning" ? "text-amber-600" : "text-gray-500"}`} />
        {title}
      </h4>
      {children}
    </div>
  );
}

function hasTreatmentContent(plan: TreatmentPlan): boolean {
  return (
    plan.medicationStarted.length > 0 ||
    plan.medicationAdjusted.length > 0 ||
    plan.medicationDiscontinued.length > 0 ||
    plan.nonPharmacologicalMeasures.length > 0
  );
}

function TreatmentPlanSection({ plan }: { plan: TreatmentPlan }) {
  const { t } = useTranslation();
  return (
    <Section icon={Pill} title={t("clinicalIndicators.treatmentPlan")}>
      <div className="space-y-3">
        {plan.medicationStarted.length > 0 && (
          <div>
            <span className="text-xs font-medium text-green-600">{t("clinicalIndicators.medicationStarted")}</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {plan.medicationStarted.map((med, i) => (
                <Badge key={i} variant="success">
                  {med}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {plan.medicationAdjusted.length > 0 && (
          <div>
            <span className="text-xs font-medium text-blue-600">{t("clinicalIndicators.medicationAdjusted")}</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {plan.medicationAdjusted.map((med, i) => (
                <Badge key={i} variant="info">
                  {med}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {plan.medicationDiscontinued.length > 0 && (
          <div>
            <span className="text-xs font-medium text-red-600">{t("clinicalIndicators.medicationDiscontinued")}</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {plan.medicationDiscontinued.map((med, i) => (
                <Badge key={i} variant="error">
                  {med}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {plan.nonPharmacologicalMeasures.length > 0 && (
          <div>
            <span className="text-xs font-medium text-gray-600">{t("clinicalIndicators.nonPharmacological")}</span>
            <ul className="mt-1 list-disc list-inside text-sm text-gray-700">
              {plan.nonPharmacologicalMeasures.map((measure, i) => (
                <li key={i}>{measure}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
