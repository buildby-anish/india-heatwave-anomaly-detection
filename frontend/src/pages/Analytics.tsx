import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend as RLegend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { api, qs, Filters, SEV_COLOR, SEVS } from "../api";
import { Empty, ErrorBox, Loading, Panel, useFetch } from "../components/ui";

const PALETTE = ["#0f1f33", "#d93a2b", "#2e7ab8", "#e8b923", "#7a4fb5", "#2e9e5b"];
const H = 260;
export default function Analytics({ f }: { f: Filters }) {
  const [freq, setFreq] = useState("M"); const k = JSON.stringify(f);
  const trend = useFetch(() => api.get("/api/analytics/trend?" + qs(f, { freq })).then((r) => r.data), [k, freq]);
  const cmp = useFetch(() => api.get("/api/analytics/city-comparison?" + qs({ ...f, cities: [] })).then((r) => r.data), [k]);
  const mon = useFetch(() => api.get("/api/analytics/monthly?" + qs(f)).then((r) => r.data), [k]);
  const dist = useFetch(() => api.get("/api/analytics/severity-distribution?" + qs(f)).then((r) => r.data), [k]);
  const sc = useFetch(() => api.get("/api/analytics/scatter?" + qs(f)).then((r) => r.data), [k]);
  const cor = useFetch(() => api.get("/api/analytics/correlation?" + qs(f)).then((r) => r.data), [k]);
  const err = trend.error || cmp.error || mon.error || dist.error || sc.error || cor.error;
  return (
    <div className="space-y-3">
      {err && <ErrorBox msg={err} />}
      <div className="grid lg:grid-cols-2 gap-3">
        <Panel title="Max temperature trend" note={`Peak max temp per ${freq === "M" ? "month" : freq === "W" ? "week" : "day"}; shows up to 6 selected cities (pick cities in the filter bar).`}>
          <div className="mb-2 flex gap-2">{["D", "W", "M"].map((x) => <button key={x} className={"btn " + (freq === x ? "btn-on" : "")} onClick={() => setFreq(x)}>{x === "D" ? "Daily" : x === "W" ? "Weekly" : "Monthly"}</button>)}</div>
          {trend.loading ? <Loading /> : !trend.data?.series.length ? <Empty msg="No data for this selection." /> :
            <ResponsiveContainer width="100%" height={H}><LineChart data={trend.data.series}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} /><YAxis unit="°" domain={["auto", "auto"]} /><Tooltip /><RLegend />
              {trend.data.cities.map((c: string, i: number) => <Line key={c} type="monotone" dataKey={c} stroke={PALETTE[i]} dot={false} strokeWidth={1.8} connectNulls />)}</LineChart></ResponsiveContainer>}
        </Panel>
        <Panel title="City comparison: mean risk score" note="Risk score is the dataset's heat_risk_score (synthetic).">
          {cmp.loading ? <Loading /> : <ResponsiveContainer width="100%" height={H}><BarChart data={cmp.data?.rows} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="city" tick={{ fontSize: 10 }} width={95} interval={0} /><Tooltip /><Bar dataKey="mean_risk" fill="#d93a2b" name="Mean risk" /></BarChart></ResponsiveContainer>}
        </Panel>
        <Panel title="Heatwave days by month" note="Days flagged heatwave_flag=1, summed across selected cities and years.">
          {mon.loading ? <Loading /> : <ResponsiveContainer width="100%" height={H}><BarChart data={mon.data?.rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><RLegend /><Bar dataKey="heatwave_days" fill="#ee7d22" name="Heatwave days" /><Bar dataKey="anomalies" fill="#0f1f33" name="Labelled anomalies" /></BarChart></ResponsiveContainer>}
        </Panel>
        <Panel title="Severity distribution" note="Log-like imbalance is real in this dataset: Extreme is ~0.1% of rows.">
          {dist.loading ? <Loading /> : <ResponsiveContainer width="100%" height={H}><BarChart data={dist.data?.rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="severity" /><YAxis scale="sqrt" /><Tooltip /><Bar dataKey="count">{(dist.data?.rows ?? []).map((r: { severity: string }) => <Cell key={r.severity} fill={SEV_COLOR[r.severity]} />)}</Bar></BarChart></ResponsiveContainer>}
          <p className="text-xs text-slate-500">Y axis is square-root scaled so small classes stay visible.</p>
        </Panel>
        <Panel title="Humidity vs max temperature" note={sc.data?.note}>
          {sc.loading ? <Loading /> : <ResponsiveContainer width="100%" height={H}><ScatterChart><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey="temp" name="Max temp" unit="°C" domain={["auto", "auto"]} /><YAxis type="number" dataKey="humidity" name="Humidity" unit="%" /><ZAxis range={[14, 14]} /><Tooltip cursor={{ strokeDasharray: "3 3" }} /><RLegend />
            {SEVS.map((s) => <Scatter key={s} name={s} data={(sc.data?.rows ?? []).filter((r: { severity: string }) => r.severity === s)} fill={SEV_COLOR[s]} fillOpacity={0.6} />)}</ScatterChart></ResponsiveContainer>}
        </Panel>
        <Panel title="Feature correlations" note="Pearson r on the filtered records. Note max/min temp and heat index are strongly related by construction.">
          {cor.loading ? <Loading /> : !cor.data?.matrix.length ? <Empty msg="Not enough rows." /> :
            <div className="overflow-x-auto"><table className="text-[11px] border-separate border-spacing-0.5"><thead><tr><th />{cor.data.cols.map((c: string) => <th key={c} className="font-normal px-1 max-w-[70px] break-words">{c.replace(/_/g, " ")}</th>)}</tr></thead>
              <tbody>{cor.data.matrix.map((row: number[], i: number) => <tr key={i}><td className="pr-2 text-right">{cor.data.cols[i].replace(/_/g, " ")}</td>{row.map((v, j) => <td key={j} className="w-14 h-8 text-center rounded" style={{ background: v >= 0 ? `rgba(217,58,43,${Math.abs(v)})` : `rgba(46,122,184,${Math.abs(v)})`, color: Math.abs(v) > 0.55 ? "#fff" : "#0f1f33" }}>{v.toFixed(2)}</td>)}</tr>)}</tbody></table></div>}
        </Panel>
      </div>
    </div>
  );
}
