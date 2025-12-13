import { NavLink } from "react-router-dom";
import { cn } from "@/utils/cn";
import { Home, PlusCircle, FolderOpen } from "lucide-react";

const navItems = [
  { to: "/", icon: Home, label: "Inicio" },
  { to: "/nueva-sesion", icon: PlusCircle, label: "Nueva Sesión" },
  { to: "/sesiones", icon: FolderOpen, label: "Mis Sesiones" },
];

export function Sidebar() {
  return (
    <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center border-b border-gray-200 px-6">
        <h1 className="text-lg font-bold text-primary-600">MRP Processor</h1>
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
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
