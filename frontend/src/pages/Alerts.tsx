import { useState } from "react";
import { api, SEVS, SEV_COLOR } from "../api";
import { Empty, ErrorBox, Loading, SevBadge, useFetch } from "../components/ui";

interface A { city: string; date: string; severity: string; max_temp_c: number; heat_index_c: number; risk_score: number; iforest_flag: boolean; advice: string }
export default function Alerts({ suggested, min, max }: { suggested: string; min: string; max: string }) {
  const [date, setDate] = useState(suggested); const [sev, setSev] = useState("High"); const [days, setDays] = useState(1);
  const { data, loading, error } = useFetch(() => api.get<{ alerts: A[]; count: number }>(`/api/alerts?date=${date}&min_severity=${sev}&days=${days}`).then((r) => r.data), [date, sev, days]);
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap gap-3 items-end text-xs">
        <label>Alert date<br /><input className="inp" type="date" min={min} max={max} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Window<br /><select className="inp" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</select></label>
        <label>Minimum severity<br /><select className="inp" value={sev} onChange={(e) => setSev(e.target.value)}>{SEVS.map((s) => <option key={s}>{s}</option>)}</select></label>
        <button className="btn" onClick={() => setDate(suggested)}>Jump to suggested date</button>
        <p className="text-slate-500 max-w-md">Historical replay of synthetic data: alerts are rows at/above the chosen severity, or flagged by Isolation Forest. These are simulated, not live or official warnings.</p>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox msg={error} /> : !data?.alerts.length ? <Empty msg="No alerts for this date, window and severity." /> :
        <div className="grid md:grid-cols-2 gap-3">{data.alerts.map((a, i) => <div key={i} className="card" style={{ borderLeft: `4px solid ${SEV_COLOR[a.severity]}` }}>
          <div className="flex justify-between items-center"><b>{a.city}</b><SevBadge s={a.severity} /></div>
          <div className="text-xs text-slate-500">{a.date}</div>
          <div className="text-sm mt-1">Max {a.max_temp_c}°C · heat index {a.heat_index_c}°C · risk score {a.risk_score}{a.iforest_flag && " · anomaly flagged"}</div>
          <div className="text-sm mt-1">{a.advice}</div></div>)}</div>}
    </div>
  );
}
