import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Circle, Marker, Pane, Popup } from "react-leaflet";
import { api, getAuth } from "./api";

export type HazType = "heatwave" | "anomaly" | "risk";
export interface Hazard { id: string; name: string; type: HazType; category: string; severity: string; lat: number; lon: number; radius_km: number; active: boolean; note: string; source: string; updated_at: string; updated_by: string }
export interface HazardPayload { version: number; hazards: Hazard[]; viewers: { tourist: number; admin: number }; seed_date: string }

export const TYPE_META: Record<HazType, { label: string; color: string; icon: string }> = {
  heatwave: { label: "Heatwave", color: "#e8710a", icon: "local_fire_department" },
  anomaly: { label: "AI anomaly", color: "#9334e6", icon: "troubleshoot" },
  risk: { label: "Other risk", color: "#d93025", icon: "warning" },
};
export const SEV_FILL: Record<string, number> = { Low: 0.1, Moderate: 0.16, High: 0.22, Severe: 0.3, Extreme: 0.38 };
export const zoneLabel = (h: Pick<Hazard, "type" | "category">) => (h.type === "risk" && h.category ? h.category : TYPE_META[h.type].label);

// No API key needed. Set VITE_TILE_URL in .env (e.g. http://localhost:8080/tiles/{z}/{x}/{y}.png) to use a local tile server instead.
const LOCAL = import.meta.env.VITE_TILE_URL as string | undefined;
export const TILES = {
  map: { url: LOCAL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: LOCAL ? "Local map tiles" : "&copy; OpenStreetMap contributors", sub: "abc" },
  terrain: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr: "&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)", sub: "abc" },
} as const;

/** Zones from the server, kept live over Server-Sent Events (falls back to the last value if the stream drops). */
export function useLiveHazards() {
  const [data, setData] = useState<HazardPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [stamp, setStamp] = useState<Date | null>(null);
  const apply = useCallback((p: HazardPayload) => { setData(p); setStamp(new Date()); }, []);
  const refresh = useCallback(() => api.get<HazardPayload>("/api/hazards").then((r) => apply(r.data)), [apply]);
  useEffect(() => {
    refresh().catch(() => {});
    const s = getAuth(); if (!s) return;
    const es = new EventSource(`${api.defaults.baseURL}/api/hazards/stream?token=${encodeURIComponent(s.token)}`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => { setConnected(true); apply(JSON.parse(e.data)); };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [refresh, apply]);
  return { hazards: data?.hazards ?? [], version: data?.version ?? 0, viewers: data?.viewers, seedDate: data?.seed_date, connected, stamp, ready: !!data, refresh };
}

export const dotIcon = (h: Pick<Hazard, "type">, dim = false) => L.divIcon({
  className: "hw-pin", iconSize: [24, 24], iconAnchor: [12, 12],
  html: `<div class="zone-dot" style="background:${TYPE_META[h.type].color};${dim ? "opacity:.55" : ""}"><span class="ms ms-fill" style="font-size:14px">${TYPE_META[h.type].icon}</span></div>`,
});

export function ZoneCircles({ hazards, show, selectedId, onSelect, popup = true, dimInactive = false }: { hazards: Hazard[]; show: Record<HazType, boolean>; selectedId?: string | null; onSelect?: (h: Hazard) => void; popup?: boolean; dimInactive?: boolean }) {
  const list = hazards.filter((h) => show[h.type] && (dimInactive || h.active));
  return (
    <>
      <Pane name="zones" style={{ zIndex: 410 }}>
        {list.map((h) => {
          const c = TYPE_META[h.type].color, off = !h.active;
          return (
            <Circle key={h.id} center={[h.lat, h.lon]} radius={h.radius_km * 1000} bubblingMouseEvents={false}
              pathOptions={{ color: c, weight: selectedId === h.id ? 3 : 1.5, dashArray: h.type === "heatwave" ? undefined : "6 5", fillColor: c, fillOpacity: off ? 0.04 : SEV_FILL[h.severity] ?? 0.2, opacity: off ? 0.4 : 0.9 }}
              eventHandlers={onSelect ? { click: () => onSelect(h) } : undefined}>
              {popup && !onSelect && <ZonePopup h={h} />}
            </Circle>
          );
        })}
      </Pane>
      <Pane name="zone-dots" style={{ zIndex: 620 }}>
        {list.map((h) => (
          <Marker key={h.id} position={[h.lat, h.lon]} icon={dotIcon(h, !h.active)} eventHandlers={onSelect ? { click: () => onSelect(h) } : undefined}>
            {popup && !onSelect && <ZonePopup h={h} />}
          </Marker>
        ))}
      </Pane>
    </>
  );
}

export const ZonePopup = ({ h }: { h: Hazard }) => (
  <Popup>
    <div className="min-w-[200px]">
      <div className="font-medium text-[14px]">{h.name}</div>
      <div className="mt-0.5" style={{ color: TYPE_META[h.type].color }}>{zoneLabel(h)} · {h.severity} · {h.radius_km} km radius</div>
      {h.note && <div className="mt-1 text-g-sub">{h.note}</div>}
      <div className="mt-1 text-[11px] text-g-sub">Source: {h.source.replace("+edited", " (edited)")} · simulated, not an official warning</div>
    </div>
  </Popup>
);

export function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v); const t = useRef<number>();
  useEffect(() => { window.clearTimeout(t.current); t.current = window.setTimeout(() => setD(v), ms); return () => window.clearTimeout(t.current); }, [v, ms]);
  return d;
}

export const haversineKm = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
};
