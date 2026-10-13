import axios from "axios";

export interface Session { token: string; role: "admin" | "tourist"; name: string; username: string }
// sessionStorage = one login per browser tab, so an admin tab and a tourist tab can sit side by side.
const KEY = "hw_session";
export const getAuth = (): Session | null => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; } };
export const setAuth = (s: Session | null) => (s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY));

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8000" });
api.interceptors.request.use((c) => { const s = getAuth(); if (s) c.headers.Authorization = `Bearer ${s.token}`; return c; });
api.interceptors.response.use((r) => r, (e) => {
  if (e.response?.status === 401 && !String(e.config?.url).includes("/auth/login")) { setAuth(null); window.location.assign("/login"); }
  return Promise.reject(e);
});

export const SEVS = ["Low", "Moderate", "High", "Severe", "Extreme"] as const;
export const SEV_COLOR: Record<string, string> = { Low: "#2e9e5b", Moderate: "#e8b923", High: "#ee7d22", Severe: "#d93a2b", Extreme: "#7b1230" };
export interface Filters { start: string; end: string; cities: string[]; region: string }
export const qs = (f: Filters, extra: Record<string, string | number> = {}) => {
  const p = new URLSearchParams();
  if (f.start) p.set("start", f.start);
  if (f.end) p.set("end", f.end);
  if (f.cities.length) p.set("cities", f.cities.join(","));
  if (f.region) p.set("region", f.region);
  Object.entries(extra).forEach(([k, v]) => p.set(k, String(v)));
  return p.toString();
};
export const errMsg = (e: unknown) => (axios.isAxiosError(e) ? (e.response?.data?.detail ? (typeof e.response.data.detail === "string" ? e.response.data.detail : JSON.stringify(e.response.data.detail)) : e.message) : String(e));
