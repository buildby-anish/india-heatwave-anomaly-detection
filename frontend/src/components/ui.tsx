import { ReactNode, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { SEV_COLOR, SEVS } from "../api";

export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <div className="card"><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-semibold mt-1">{value}</div>{sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}</div>
);
export const Loading = () => <div className="flex items-center gap-2 text-slate-500 text-sm p-6"><Loader2 className="animate-spin" size={16} /> Loading…</div>;
export const ErrorBox = ({ msg }: { msg: string }) => <div className="card border-red-300 bg-red-50 text-red-800 text-sm flex gap-2"><AlertTriangle size={16} /> {msg}</div>;
export const Empty = ({ msg }: { msg: string }) => <div className="text-sm text-slate-500 p-6 text-center">{msg}</div>;
export const SevBadge = ({ s }: { s: string }) => <span className="px-2 py-0.5 rounded text-xs font-medium text-white" style={{ background: SEV_COLOR[s] }}>{s}</span>;
export const Legend = () => (
  <div className="flex flex-wrap gap-3 text-xs">{SEVS.map((s) => <span key={s} className="flex items-center gap-1"><i className="w-3 h-3 rounded-full inline-block" style={{ background: SEV_COLOR[s] }} />{s}</span>)}</div>
);
export const Panel = ({ title, note, children }: { title: string; note?: string; children: ReactNode }) => (
  <section className="card"><h3 className="font-semibold text-sm">{title}</h3>{note && <p className="text-xs text-slate-500 mb-2">{note}</p>}{children}</section>
);
/** Fetch helper with loading/error state; refetches when deps change. */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { let live = true; setLoading(true); setError("");
    fn().then((d) => live && setData(d)).catch((e) => live && setError(e?.response?.data?.detail ? JSON.stringify(e.response.data.detail) : e.message)).finally(() => live && setLoading(false));
    return () => { live = false; }; // eslint-disable-next-line
  }, deps);
  return { data, loading, error };
}
