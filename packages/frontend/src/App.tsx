import { Layout } from "@/components/layout/Layout";
import { useAuth } from "@/hooks/useAuth";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { NewSessionPage } from "@/pages/NewSessionPage";
import { SessionDetailPage } from "@/pages/SessionDetailPage";
import { SessionsPage } from "@/pages/SessionsPage";
import { SimulatorPage } from "@/pages/SimulatorPage";
import { UsersPage } from "@/pages/UsersPage";
import { ConsultationSummaryPage } from "@/pages/ConsultationSummaryPage";
import { ReportSummaryPage } from "@/pages/ReportSummaryPage";
import { ReportSummaryDetailPage } from "@/pages/ReportSummaryDetailPage";
import { Navigate, Route, Routes } from "react-router-dom";

const ADMIN_EMAIL = "admin@user.com";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (!user || user.email !== ADMIN_EMAIL) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/p/:token" element={<ConsultationSummaryPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route
          path="users"
          element={
            <AdminRoute>
              <UsersPage />
            </AdminRoute>
          }
        />
        <Route path="new-session" element={<NewSessionPage />} />
        <Route path="simulator" element={<SimulatorPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="sessions/:id" element={<SessionDetailPage />} />
        <Route path="report-summary" element={<ReportSummaryPage />} />
        <Route path="report-summaries/:id" element={<ReportSummaryDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
