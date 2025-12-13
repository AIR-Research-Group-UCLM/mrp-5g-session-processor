import { useState } from "react";
import { Link } from "react-router-dom";
import { useSessions } from "@/hooks/useSessions";
import { SessionList } from "@/components/sessions/SessionList";
import { SessionSearch } from "@/components/sessions/SessionSearch";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PlusCircle, Search, X } from "lucide-react";

export function SessionsPage() {
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
        <h1 className="text-2xl font-bold text-gray-900">Mis Sesiones</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowSearch(!showSearch)}
          >
            {showSearch ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            {showSearch ? "Cerrar" : "Buscar"}
          </Button>
          <Link to="/nueva-sesion">
            <Button>
              <PlusCircle className="h-4 w-4" />
              Nueva Sesión
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
        <span className="text-sm text-gray-500">Filtrar por estado:</span>
        <div className="flex gap-1">
          <FilterButton
            active={!status}
            onClick={() => {
              setStatus(undefined);
              setPage(1);
            }}
          >
            Todas
          </FilterButton>
          <FilterButton
            active={status === "pending"}
            onClick={() => {
              setStatus("pending");
              setPage(1);
            }}
          >
            Pendientes
          </FilterButton>
          <FilterButton
            active={status === "processing"}
            onClick={() => {
              setStatus("processing");
              setPage(1);
            }}
          >
            Procesando
          </FilterButton>
          <FilterButton
            active={status === "completed"}
            onClick={() => {
              setStatus("completed");
              setPage(1);
            }}
          >
            Completadas
          </FilterButton>
          <FilterButton
            active={status === "failed"}
            onClick={() => {
              setStatus("failed");
              setPage(1);
            }}
          >
            Error
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
            Anterior
          </Button>
          <span className="text-sm text-gray-600">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
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
        active
          ? "bg-primary-100 text-primary-700"
          : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}
