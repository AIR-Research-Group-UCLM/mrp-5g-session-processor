import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { AuthUser, LoginCredentials } from "@mrp/shared";
import * as authApi from "@/api/auth.api";
import { basePathNormalized } from "@/api/client";

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isReadOnly: boolean;
  canWrite: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Compute role-based flags
  const isAdmin = useMemo(() => user?.role === "admin", [user?.role]);
  const isReadOnly = useMemo(() => user?.role === "readonly", [user?.role]);
  const canWrite = useMemo(
    () => user !== null && user.role !== "readonly",
    [user]
  );

  useEffect(() => {
    authApi.getMe().then((user) => {
      setUser(user);
      setIsLoading(false);
    });
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const user = await authApi.login(credentials);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    window.location.href = `${basePathNormalized}/login`;
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, logout, isAdmin, isReadOnly, canWrite }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return context;
}
