import { basePathNormalized } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/utils/cn";
import { FolderOpen, Home, PlusCircle, Users, Wand2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";

const ADMIN_EMAIL = "admin@user.com";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const isAdmin = user?.email === ADMIN_EMAIL;
  const isFirstMount = useRef(true);

  // Close sidebar on route change (mobile) - skip first mount
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    onClose();
  }, [location.pathname, onClose]);

  // Close sidebar on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const navItems = [
    { to: "/", icon: Home, labelKey: "navigation.home" },
    ...(isAdmin ? [{ to: "/users", icon: Users, labelKey: "navigation.users" }] : []),
    { to: "/new-session", icon: PlusCircle, labelKey: "navigation.newSession" },
    { to: "/simulator", icon: Wand2, labelKey: "navigation.simulator" },
    { to: "/sessions", icon: FolderOpen, labelKey: "navigation.mySessions" },
  ];

  return (
    <>
      {/* Backdrop for mobile */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-full flex-col border-r border-gray-200 bg-white transition-transform sm:w-80 lg:static lg:w-64 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Close button for mobile */}
        <button
          type="button"
          className="absolute right-2 top-2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
          <span className="sr-only">{t("common.close")}</span>
        </button>

        <div className="flex h-44 items-center justify-center overflow-hidden border-b border-gray-200 px-6">
          <Link to="/" className="flex h-full items-center">
            <img
              src={`${basePathNormalized}/logo.png`}
              alt={t("common.appName")}
              className="h-40 w-auto object-contain"
            />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary-50 text-primary-600"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
