import L from "leaflet";
import { Hazard, haversineKm } from "../hazards";

export interface CityInfo { city: string; state: string; region: string; lat: number; lon: number; demo_date: string; max_temp_c: number | null; severity: string | null }
export interface Place { name: string; sub?: string; lat: number; lon: number; kind: "city" | "place" | "pin"; city?: CityInfo }
export interface Step { text: string; distance_m: number; road: string }
export interface RouteHaz { id: string; name: string; type: Hazard["type"]; category: string; severity: string; km_inside: number; lat: number; lon: number; radius_km: number }
export interface RouteOut { kind: "safe" | "fast" | "alt"; label: string; via: string; distance_km: number; duration_min: number; geometry: [number, number][]; steps: Step[]; hazards: RouteHaz[]; hazard_km: number; exposure: [number, number][][]; fully_avoided: boolean }
export interface PlanOut { mode: Mode; avoid: boolean; routes: RouteOut[]; notes: string[]; endpoint_zones: string[] }
export type Mode = "car" | "bike" | "foot";

export const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "car", label: "Driving", icon: "directions_car" },
  { id: "bike", label: "Cycling", icon: "directions_bike" },
  { id: "foot", label: "Walking", icon: "directions_walk" },
];

export const fmtDur = (min: number) => {
  if (min < 1) return "1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 48) return `${Math.floor(h / 24)} d ${h % 24} hr`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
};
export const fmtKm = (km: number) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`);
export const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m / 10) * 10} m`);

export const zonesAt = (lat: number, lon: number, hz: Hazard[]) => hz.filter((h) => h.active && haversineKm([lat, lon], [h.lat, h.lon]) <= h.radius_km);
export const zonesNear = (lat: number, lon: number, hz: Hazard[], within = 100) =>
  hz.filter((h) => h.active).map((h) => ({ h, away: haversineKm([lat, lon], [h.lat, h.lon]) - h.radius_km })).filter((x) => x.away > 0 && x.away <= within).sort((a, b) => a.away - b.away);

export const stepIcon = (t: string) => {
  const s = t.toLowerCase();
  if (s.startsWith("arrive")) return "flag";
  if (s.includes("roundabout")) return "roundabout_left";
  if (s.includes("u-turn")) return "u_turn_left";
  if (s.includes("slightly left")) return "turn_slight_left";
  if (s.includes("slightly right")) return "turn_slight_right";
  if (s.includes("left")) return "turn_left";
  if (s.includes("right")) return "turn_right";
  if (s.startsWith("merge")) return "merge";
  if (s.startsWith("head")) return "navigation";
  return "straight";
};

export const originIcon = L.divIcon({ className: "hw-pin", iconSize: [20, 20], iconAnchor: [10, 10], html: `<div style="width:20px;height:20px;border-radius:50%;background:#fff;border:5px solid #5f6368;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>` });
export const pinIcon = L.divIcon({ className: "hw-pin", iconSize: [30, 42], iconAnchor: [15, 40], html: `<svg width="30" height="42" viewBox="0 0 24 34" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))"><path fill="#ea4335" stroke="#b31412" stroke-width=".8" d="M12 .8C6 .8 1.2 5.5 1.2 11.4 1.2 19 12 33 12 33s10.8-14 10.8-21.6C22.8 5.5 18 .8 12 .8z"/><circle cx="12" cy="11.4" r="4.2" fill="#7b1713"/></svg>` });
export const bubbleIcon = (text: string, cls: string) => L.divIcon({ className: "hw-pin", iconSize: [0, 0], html: `<div class="hw-bubble ${cls}">${text}</div>` });
