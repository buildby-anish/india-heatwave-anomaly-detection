import { useState } from "react";
import OfflineBase from "../OfflineBase";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { api, qs, Filters, SEV_COLOR } from "../api";
import FilterBar from "../components/FilterBar";
import { Empty, ErrorBox, Legend, Loading, SevBadge, useFetch } from "../components/ui";
import { HazType, TILES, useLiveHazards, ZoneCircles } from "../hazards";

interface Pt { city: string; state: string; lat: number; lon: number; days: number; peak_severity: string; peak_max_temp_c: number; peak_date: string; mean_max_temp_c: number; mean_risk_score: number; max_risk_score: number; heatwave_days: number; labelled_anomalies: number; iforest_flags: number; agreement: number }
const ALL: Record<HazType, boolean> = { heatwave: true, anomaly: true, risk: true };

const Mini = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
  <div className="leading-tight"><div className="text-[11px] text-g-sub whitespace-nowrap">{label}</div><div className="text-[19px] font-medium">{value}{sub && <span className="ml-1 text-[11px] font-normal text-g-sub">{sub}</span>}</div></div>
);

/** Header (filters + stats) on top, controls on the bottom, so the map gets all the space in between. */
export default function MapPage({ f, set, cities, regions, min, max }: { f: Filters; set: (f: Filters) => void; cities: string[]; regions: string[]; min: string; max: string }) {
  const [showAnom, setShowAnom] = useState(true); const [showZones, setShowZones] = useState(true); const [colorBy, setColorBy] = useState<"severity" | "risk">("severity");
  const { data, loading, error } = useFetch(() => api.get<{ points: Pt[]; message: string | null }>("/api/map?" + qs(f)).then((r) => r.data), [JSON.stringify(f)]);
  const live = useLiveHazards();
  const pts = data?.points ?? [];
  const riskColor = (v: number) => (v < 25 ? SEV_COLOR.Low : v < 40 ? SEV_COLOR.Moderate : v < 55 ? SEV_COLOR.High : v < 70 ? SEV_COLOR.Severe : SEV_COLOR.Extreme);
  const sum = (k: keyof Pt) => pts.reduce((a, p) => a + (p[k] as number), 0).toLocaleString();
  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 bg-white border-b border-g-line px-3 py-2 flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterBar flat f={f} set={set} cities={cities} regions={regions} min={min} max={max} />
        <div className="flex flex-wrap gap-x-6 gap-y-1 lg:ml-auto">
          <Mini label="Cities shown" value={pts.length} sub={`of ${cities.length}`} />
          <Mini label="Heatwave-flagged city-days" value={sum("heatwave_days")} />
          <Mini label="Labelled anomalies" value={sum("labelled_anomalies")} sub="dataset labels" />
          <Mini label="Isolation Forest flags" value={sum("iforest_flags")} sub="model output" />
        </div>
      </header>
      {error && <ErrorBox msg={error} />}
      <div className="relative flex-1 min-h-0">
        {loading && <div className="absolute z-[500] top-2 left-1/2 -translate-x-1/2 bg-white rounded-full px-3 shadow-card"><Loading /></div>}
        {!loading && !pts.length && <div className="absolute z-[500] inset-0 grid place-items-center pointer-events-none"><div className="bg-white rounded-lg shadow-card"><Empty msg={data?.message ?? "No data for this selection."} /></div></div>}
        <MapContainer center={[22.5, 79]} zoom={5} scrollWheelZoom>
          <OfflineBase />
          <TileLayer attribution={TILES.map.attr} url={TILES.map.url} subdomains={TILES.map.sub} />
          {showZones && <ZoneCircles hazards={live.hazards} show={ALL} />}
          {showAnom && pts.filter((p) => p.iforest_flags > 0).map((p) => (
            <CircleMarker key={p.city + "r"} center={[p.lat, p.lon]} radius={14 + Math.min(14, Math.sqrt(p.iforest_flags))} pathOptions={{ color: "#202124", weight: 1.5, dashArray: "4 4", fillOpacity: 0 }} interactive={false} />
          ))}
          {pts.map((p) => {
            const c = colorBy === "severity" ? SEV_COLOR[p.peak_severity] : riskColor(p.mean_risk_score);
            return (
              <CircleMarker key={p.city} center={[p.lat, p.lon]} radius={10} pathOptions={{ color: "#fff", weight: 2, fillColor: c, fillOpacity: 0.95 }}>
                <Popup><div className="text-sm space-y-1 min-w-[210px]">
                  <div className="font-medium">{p.city}, {p.state}</div>
                  <div>Peak severity: <SevBadge s={p.peak_severity} /> ({p.peak_max_temp_c}°C on {p.peak_date})</div>
                  <div>Mean max temp: {p.mean_max_temp_c}°C · Mean risk score: {p.mean_risk_score} (max {p.max_risk_score})</div>
                  <div>Heatwave days: {p.heatwave_days} of {p.days}</div>
                  <div>Labelled anomalies: {p.labelled_anomalies} · Isolation Forest flags: {p.iforest_flags} · both: {p.agreement}</div>
                  <div className="text-xs text-g-sub">Synthetic demo data</div></div></Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
      <footer className="shrink-0 bg-white border-t border-g-line px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Legend />
        <span className="text-xs text-g-sub flex-1 min-w-[260px]">Marker colour = peak severity in selected range (or mean risk score). Dashed ring = Isolation Forest flagged days (size grows with count). Shaded circles = live risk zones.</span>
        <div className="flex gap-2">
          <button className={"btn " + (colorBy === "severity" ? "btn-on" : "")} onClick={() => setColorBy("severity")}>Peak severity</button>
          <button className={"btn " + (colorBy === "risk" ? "btn-on" : "")} onClick={() => setColorBy("risk")}>Mean risk score</button>
          <button className={"btn " + (showAnom ? "btn-on" : "")} onClick={() => setShowAnom(!showAnom)}>Anomaly rings</button>
          <button className={"btn " + (showZones ? "btn-on" : "")} onClick={() => setShowZones(!showZones)}>Risk zones</button>
        </div>
      </footer>
    </div>
  );
}
