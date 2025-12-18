import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { LanguageSelector } from "@/components/ui/LanguageSelector";
import { LogOut, User } from "lucide-react";

export function Header() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
        <LanguageSelector />
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <User className="h-4 w-4" />
          <span>{user?.name}</span>
        </div>
        <Button variant="secondary" size="sm" onClick={logout}>
          <LogOut className="h-4 w-4" />
          {t("common.logout")}
        </Button>
      </div>
    </header>
  );
}
