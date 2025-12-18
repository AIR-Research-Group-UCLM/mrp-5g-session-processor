import { SessionList } from "@/components/sessions/SessionList";
import { SessionSearch } from "@/components/sessions/SessionSearch";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useSessions } from "@/hooks/useSessions";
import { PlusCircle, Search, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function SessionsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const [showSearch, setShowSearch] = useState(false);

  const { data, isLoading } = useSessions({
    page,
    pageSize: 12,
    status,
  });

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t("sessions.title")}</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setShowSearch(!showSearch)}>
            {showSearch ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            {showSearch ? t("common.close") : t("common.search")}
          </Button>
          <Link to="/new-session">
            <Button>
              <PlusCircle className="h-4 w-4" />
              {t("navigation.newSession")}
            </Button>
          </Link>
        </div>
      </div>

      {showSearch && (
        <Card>
          <SessionSearch onClose={() => setShowSearch(false)} />
        </Card>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">{t("sessions.filterByStatus")}</span>
        <div className="flex gap-1">
          <FilterButton
            active={!status}
            onClick={() => {
              setStatus(undefined);
              setPage(1);
            }}
          >
            {t("sessions.all")}
          </FilterButton>
          <FilterButton
            active={status === "pending"}
            onClick={() => {
              setStatus("pending");
              setPage(1);
            }}
          >
            {t("status.pending")}
          </FilterButton>
          <FilterButton
            active={status === "processing"}
            onClick={() => {
              setStatus("processing");
              setPage(1);
            }}
          >
            {t("status.processing")}
          </FilterButton>
          <FilterButton
            active={status === "completed"}
            onClick={() => {
              setStatus("completed");
              setPage(1);
            }}
          >
            {t("status.completed")}
          </FilterButton>
          <FilterButton
            active={status === "failed"}
            onClick={() => {
              setStatus("failed");
              setPage(1);
            }}
          >
            {t("status.failed")}
          </FilterButton>
        </div>
      </div>

      <SessionList sessions={data?.sessions ?? []} isLoading={isLoading} />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("common.previous")}
          </Button>
          <span className="text-sm text-gray-600">
            {t("common.page", { current: page, total: totalPages })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterButton({ active, onClick, children }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1 text-sm font-medium transition-colors ${
        active ? "bg-primary-100 text-primary-700" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}
