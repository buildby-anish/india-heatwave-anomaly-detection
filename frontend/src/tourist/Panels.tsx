import { useState } from "react";
import { Icon } from "../components/Icon";
import { SevBadge } from "../components/ui";
import { Hazard, TYPE_META, zoneLabel } from "../hazards";
import { fmtDur, fmtKm, fmtM, PlanOut, Place, RouteHaz, stepIcon, zonesAt, zonesNear } from "./util";

const ZoneRow = ({ z, right, onClick }: { z: { type: Hazard["type"]; category: string; name: string; severity: string }; right?: string; onClick?: () => void }) => (
  <button type="button" onClick={onClick} className="w-full flex items-center gap-3 py-1.5 text-left hover:bg-g-hover rounded">
    <span className="zone-dot shrink-0" style={{ background: TYPE_META[z.type].color }}><Icon n={TYPE_META[z.type].icon} fill size={14} /></span>
    <span className="flex-1 min-w-0"><span className="block text-sm truncate">{z.name}</span><span className="block text-xs text-g-sub">{zoneLabel(z)} · {z.severity}</span></span>
    {right && <span className="text-xs text-g-sub shrink-0">{right}</span>}
  </button>
);

export function RouteCards({ plan, sel, onSelect, onZone }: { plan: PlanOut; sel: number; onSelect: (i: number) => void; onZone: (z: { lat: number; lon: number; radius_km: number }) => void }) {
  const [steps, setSteps] = useState(false);
  const fast = plan.routes.find((r) => r.kind === "fast");
  return (
    <div>
      {plan.routes.map((r, i) => {
        const on = i === sel, risky = r.hazards.length > 0;
        const avoided: RouteHaz[] = r.kind === "safe" && fast ? fast.hazards.filter((h) => !r.hazards.some((x) => x.id === h.id)) : [];
        const extraKm = fast && r.kind === "safe" ? r.distance_km - fast.distance_km : 0, extraMin = fast && r.kind === "safe" ? r.duration_min - fast.duration_min : 0;
        return (
          <div key={r.kind + i} className={"border-b border-g-line " + (on ? "bg-g-blueTint/60" : "")}>
            <button type="button" onClick={() => onSelect(i)} aria-pressed={on} className="w-full text-left px-4 pt-3 pb-2.5 hover:bg-g-hover/70">
              <div className="flex items-baseline gap-2"><span className={"text-[22px] leading-7 " + (on ? "font-medium" : "")} style={{ color: risky ? "#c5221f" : "#188038" }}>{fmtDur(r.duration_min)}</span><span className="text-sm text-g-sub">{fmtKm(r.distance_km)}</span>
                <span className={"ml-auto text-xs rounded-full px-2 py-0.5 " + (r.kind === "safe" ? "bg-[#e6f4ea] text-g-green font-medium" : "bg-g-hover text-g-sub")}>{r.label}</span></div>
              <div className="text-sm text-g-sub mt-0.5">{r.via}</div>
              <div className={"mt-1.5 flex items-center gap-1.5 text-[13px] " + (risky ? "text-[#c5221f]" : "text-g-green")}>
                <Icon n={risky ? "warning" : "check_circle"} fill size={16} />
                {risky ? `Crosses ${r.hazards.length} hazard zone${r.hazards.length > 1 ? "s" : ""} · ${fmtKm(r.hazard_km)} inside` : r.kind === "safe" ? `Avoids ${avoided.length} hazard zone${avoided.length === 1 ? "" : "s"}` : "No hazard zones on this route"}
              </div>
              {r.kind === "safe" && fast && <div className="text-xs text-g-sub mt-1">Compared with the fastest route: {extraKm >= 0 ? "+" : ""}{Math.round(extraKm)} km, {extraMin >= 0 ? "+" : ""}{Math.round(extraMin)} min</div>}
            </button>
            {on && (risky || avoided.length > 0) && (
              <div className="px-4 pb-2">
                <div className="text-xs text-g-sub mb-0.5">{risky ? "Zones on this route" : "Zones it goes around"}</div>
                {(risky ? r.hazards : avoided).map((h) => <ZoneRow key={h.id} z={h} right={risky ? `${fmtKm(h.km_inside)} inside` : undefined} onClick={() => onZone(h)} />)}
              </div>)}
            {on && r.steps.length > 0 && (
              <div className="px-4 pb-3">
                <button type="button" className="btn-text !px-0 flex items-center gap-1" onClick={() => setSteps(!steps)} aria-expanded={steps}><Icon n={steps ? "expand_less" : "expand_more"} size={20} />{steps ? "Hide steps" : `Steps (${r.steps.length})`}</button>
                {steps && <ol className="mt-1 max-h-[300px] overflow-auto divide-y divide-g-line border-t border-g-line">
                  {r.steps.map((s, k) => <li key={k} className="flex items-center gap-3 py-2"><Icon n={stepIcon(s.text)} className="text-g-sub" size={20} /><span className="flex-1 text-sm">{s.text}</span><span className="text-xs text-g-sub">{fmtM(s.distance_m)}</span></li>)}
                </ol>}
              </div>)}
          </div>);
      })}
    </div>
  );
}

export function PlaceCard({ place, hazards, onDirections, onZone }: { place: Place; hazards: Hazard[]; onDirections: () => void; onZone: (z: Hazard) => void }) {
  const inside = zonesAt(place.lat, place.lon, hazards), near = zonesNear(place.lat, place.lon, hazards).slice(0, 4), c = place.city;
  return (
    <div>
      <div className="px-4 pt-4 pb-3">
        <h2 className="text-[22px] leading-7">{place.name}</h2>
        <div className="text-sm text-g-sub mt-0.5">{place.kind === "city" ? `${place.sub} · ${c?.region} India` : place.sub || `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`}</div>
        <button className="mt-3 btn-primary flex items-center gap-1.5" onClick={onDirections}><Icon n="directions" fill size={20} />Directions</button>
      </div>
      <div className="border-t border-g-line px-4 py-3">
        <div className="text-sm font-medium mb-1">Hazards here</div>
        {inside.length ? <>{inside.map((z) => <ZoneRow key={z.id} z={z} onClick={() => onZone(z)} />)}<p className="text-xs text-g-sub mt-1">Directions to or from here can't avoid a zone that contains the start or end point.</p></>
          : <div className="flex items-center gap-2 text-sm text-g-green"><Icon n="check_circle" fill size={18} />No active hazard zones at this location</div>}
        {near.length > 0 && <div className="mt-3"><div className="text-xs text-g-sub mb-0.5">Within 100 km</div>{near.map(({ h, away }) => <ZoneRow key={h.id} z={h} right={`${Math.round(away)} km away`} onClick={() => onZone(h)} />)}</div>}
      </div>
      {c && c.max_temp_c != null && (
        <div className="border-t border-g-line px-4 py-3 text-sm">
          <div className="font-medium mb-1">Conditions</div>
          <div className="flex items-center gap-2"><Icon n="device_thermostat" className="text-g-sub" size={20} />{c.max_temp_c}°C high {c.severity && <SevBadge s={c.severity} />}</div>
          <div className="text-xs text-g-sub mt-1">Synthetic demo data for {c.demo_date}. Not a forecast.</div>
        </div>)}
    </div>
  );
}
