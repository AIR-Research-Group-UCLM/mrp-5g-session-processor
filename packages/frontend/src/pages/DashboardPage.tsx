import { Link } from "react-router-dom";
import { useSessions } from "@/hooks/useSessions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SessionList } from "@/components/sessions/SessionList";
import { PlusCircle, FolderOpen, Clock, CheckCircle } from "lucide-react";

export function DashboardPage() {
  const { data, isLoading } = useSessions({ pageSize: 6 });

  const stats = {
    total: data?.total ?? 0,
    processing:
      data?.sessions.filter((s) => s.status === "processing").length ?? 0,
    completed:
      data?.sessions.filter((s) => s.status === "completed").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Panel de control</h1>
        <Link to="/nueva-sesion">
          <Button>
            <PlusCircle className="h-4 w-4" />
            Nueva Sesión
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={FolderOpen}
          label="Total de sesiones"
          value={stats.total}
          color="primary"
        />
        <StatCard
          icon={Clock}
          label="En procesamiento"
          value={stats.processing}
          color="warning"
        />
        <StatCard
          icon={CheckCircle}
          label="Completadas"
          value={stats.completed}
          color="success"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sesiones recientes</CardTitle>
          <Link to="/sesiones" className="text-sm text-primary-600 hover:text-primary-700">
            Ver todas
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
