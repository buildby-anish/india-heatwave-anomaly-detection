import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, errMsg, getAuth, setAuth, Session } from "./api";

export type Role = "admin" | "tourist";
interface Ctx { session: Session | null; login: (username: string, password: string, role: Role) => Promise<Session>; logout: () => void }
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(getAuth());
  const login = useCallback(async (username: string, password: string, role: Role) => {
    try {
      const r = await api.post<Session>("/api/auth/login", { username, password, role });
      setAuth(r.data); setSession(r.data); return r.data;
    } catch (e) {
      if (e instanceof Error && !("response" in e && (e as { response?: unknown }).response)) throw new Error(`Can't reach the server at ${api.defaults.baseURL}. Start the backend first.`);
      throw new Error(errMsg(e).replace(/^"|"$/g, ""));
    }
  }, []);
  const logout = useCallback(() => { setAuth(null); setSession(null); }, []);
  return <AuthCtx.Provider value={{ session, login, logout }}>{children}</AuthCtx.Provider>;
}

export const homeFor = (s: Session | null) => (!s ? "/login" : s.role === "admin" ? "/admin" : "/app");

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  if (!roles.includes(session.role)) return <Navigate to={homeFor(session)} replace />;
  return <>{children}</>;
}
