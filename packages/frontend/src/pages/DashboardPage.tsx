import { SessionList } from "@/components/sessions/SessionList";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { useSessions } from "@/hooks/useSessions";
import { CheckCircle, Clock, FolderOpen, PlusCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useSessions({ pageSize: 6 });

  const stats = {
    total: data?.total ?? 0,
    processing: data?.sessions.filter((s) => s.status === "processing").length ?? 0,
    completed: data?.sessions.filter((s) => s.status === "completed").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t("dashboard.title")}</h1>
        <Link to="/new-session">
          <Button>
            <PlusCircle className="h-4 w-4" />
            {t("navigation.newSession")}
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={FolderOpen}
          label={t("dashboard.totalSessions")}
          value={stats.total}
          color="primary"
        />
        <StatCard
          icon={Clock}
          label={t("dashboard.processing")}
          value={stats.processing}
          color="warning"
        />
        <StatCard
          icon={CheckCircle}
          label={t("dashboard.completed")}
          value={stats.completed}
          color="success"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("dashboard.recentSessions")}</CardTitle>
          <Link to="/sessions" className="text-sm text-primary-600 hover:text-primary-700">
            {t("common.viewAll")}
          </Link>
        </CardHeader>
        <CardContent>
          <SessionList sessions={data?.sessions ?? []} isLoading={isLoading} />
        </CardContent>
      </Card>
    </div>
  );
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: "primary" | "warning" | "success";
}

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
  const colors = {
    primary: "bg-primary-100 text-primary-600",
    warning: "bg-yellow-100 text-yellow-600",
    success: "bg-green-100 text-green-600",
  };

  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className={`rounded-lg p-3 ${colors[color]}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </Card>
  );
}
