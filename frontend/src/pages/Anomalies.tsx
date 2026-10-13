import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs, Filters } from "../api";
import Confusion from "../components/Confusion";
import { Empty, ErrorBox, Loading, Panel, SevBadge, Stat, useFetch } from "../components/ui";

interface Row { record_id: number; date: string; city: string; max_temp_c: number; humidity: number; rainfall_mm: number; wind_kmh: number; labelled: boolean; label_type: string | null; iforest_flag: boolean; if_score: number; severity: string }
export default function Anomalies({ f }: { f: Filters }) {
  const [mode, setMode] = useState("either"); const [page, setPage] = useState(1); const [type, setType] = useState("");
  const m = useFetch(() => api.get("/api/model/metrics").then((r) => r.data.isolation_forest), []);
  const t = useFetch(() => api.get<{ total: number; rows: Row[]; page_size: number }>("/api/anomalies?" + qs(f, { mode, page, page_size: 20, ...(type ? { anomaly_type: type } : {}) })).then((r) => r.data), [JSON.stringify(f), mode, page, type]);
  const bt = m.data ? Object.entries(m.data.by_type).map(([k, v]) => ({ type: k, recall: +((v as { recall: number }).recall * 100).toFixed(1) })) : [];
  const pages = t.data ? Math.max(1, Math.ceil(t.data.total / t.data.page_size)) : 1;
  return (
    <div className="space-y-3">
      {m.error && <ErrorBox msg={m.error} />}
      {m.data && <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Precision" value={m.data.precision.toFixed(3)} sub="vs dataset labels" /><Stat label="Recall" value={m.data.recall.toFixed(3)} />
          <Stat label="F1" value={m.data.f1.toFixed(3)} /><Stat label="ROC-AUC" value={m.data.roc_auc.toFixed(3)} sub="score ranking" /><Stat label="PR-AUC" value={m.data.pr_auc.toFixed(3)} sub="base rate ≈ 0.020" />
        </div>
        <div className="grid lg:grid-cols-2 gap-3">
          <Panel title="Isolation Forest vs dataset anomaly labels" note={m.data.caveat}><Confusion m={m.data.confusion_matrix} labels={m.data.confusion_labels} />
            <p className="text-xs mt-2">Features: {m.data.features.join(", ")}. Baseline: {m.data.baseline}. Flagged {m.data.flagged.toLocaleString()} rows; {m.data.labelled_anomalies.toLocaleString()} labelled.</p></Panel>
          <Panel title="Recall by labelled anomaly type (%)" note="Which injected outlier kinds the model recovers. Weak recall on humidity/temperature types means those were not extreme enough relative to city-month variation.">
            <ResponsiveContainer width="100%" height={220}><BarChart data={bt}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="type" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} /><Tooltip /><Bar dataKey="recall" fill="#0f1f33" /></BarChart></ResponsiveContainer></Panel>
        </div></>}
      <Panel title="Anomaly records" note="Filtered by the date/city bar above. Sorted by Isolation Forest score (0–100, min–max scaled).">
        <div className="flex flex-wrap gap-2 mb-2">
          {[["either", "Either"], ["both", "Both agree"], ["label", "Labelled only set"], ["iforest", "Isolation Forest set"]].map(([v, l]) => <button key={v} className={"btn " + (mode === v ? "btn-on" : "")} onClick={() => { setMode(v); setPage(1); }}>{l}</button>)}
          <select className="inp" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">All label types</option>{["Temperature Spike", "Humidity Outlier", "Rainfall Outlier", "Wind Outlier"].map((x) => <option key={x}>{x}</option>)}</select>
        </div>
        {t.loading ? <Loading /> : t.error ? <ErrorBox msg={t.error} /> : !t.data?.rows.length ? <Empty msg="No anomalies match these filters." /> :
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500">{["Date", "City", "Max °C", "Hum %", "Rain mm", "Wind", "Severity", "Label", "IF flag", "IF score"].map((h) => <th key={h} className="py-1 pr-3">{h}</th>)}</tr></thead>
            <tbody>{t.data.rows.map((r) => <tr key={r.record_id} className="border-t border-slate-100"><td className="py-1 pr-3">{r.date}</td><td className="pr-3">{r.city}</td><td className="pr-3">{r.max_temp_c}</td><td className="pr-3">{r.humidity}</td><td className="pr-3">{r.rainfall_mm}</td><td className="pr-3">{r.wind_kmh}</td><td className="pr-3"><SevBadge s={r.severity} /></td><td className="pr-3">{r.labelled ? r.label_type : "—"}</td><td className="pr-3">{r.iforest_flag ? "yes" : "no"}</td><td>{r.if_score}</td></tr>)}</tbody></table></div>}
        <div className="flex items-center gap-2 mt-3 text-sm"><button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>Page {page} / {pages} ({t.data?.total.toLocaleString() ?? 0} rows)<button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      </Panel>
    </div>
  );
}
