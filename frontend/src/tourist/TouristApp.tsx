import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMapEvents, ZoomControl, CircleMarker, Tooltip } from "react-leaflet";
import { Link } from "react-router-dom";
import { api, errMsg, SEV_COLOR } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { HazType, TILES, TYPE_META, useLiveHazards, ZoneCircles } from "../hazards";
import OfflineBase from "../OfflineBase";
import PlaceInput from "./PlaceInput";
import { PlaceCard, RouteCards } from "./Panels";
import RouteLayers from "./RouteLayers";
import { CityInfo, MODES, Mode, originIcon, PlanOut, Place, pinIcon } from "./util";

const DEMO_ROUTES: [string, string][] = [["Delhi", "Jaipur"], ["Hyderabad", "Bengaluru"], ["Delhi", "Amritsar"], ["Pune", "Bengaluru"], ["Chennai", "Bengaluru"], ["Nagpur", "Hyderabad"]];
const shadow = "shadow-card";

function MapClicks({ onClick }: { onClick: (lat: number, lon: number) => void }) { useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) }); return null; }

export default function TouristApp() {
  const { session, logout } = useAuth();
  const live = useLiveHazards();
  const mapRef = useRef<L.Map | null>(null);
  const [cities, setCities] = useState<CityInfo[]>([]);
  const [layers, setLayers] = useState<Record<HazType | "cities", boolean>>({ heatwave: true, anomaly: true, risk: true, cities: true });
  const [basemap, setBasemap] = useState<"map" | "terrain">("map"); const [layersOpen, setLayersOpen] = useState(false); const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<"search" | "directions">("search");
  const [place, setPlace] = useState<Place | null>(null);
  const [origin, setOrigin] = useState<Place | null>(null); const [dest, setDest] = useState<Place | null>(null);
  const [mode, setMode] = useState<Mode>("car"); const [avoid, setAvoid] = useState(true);
  const [plan, setPlan] = useState<PlanOut | null>(null); const [sel, setSel] = useState(0); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const reqId = useRef(0); const planRef = useRef<PlanOut | null>(null); planRef.current = plan;
  const activeCount = live.hazards.filter((h) => h.active).length;

  useEffect(() => { api.get("/api/cities").then((r) => setCities(r.data.cities)).catch(() => {}); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); }, [toast]);

  const flyTo = (lat: number, lon: number, zoom = 9) => mapRef.current?.flyTo([lat, lon], zoom, { duration: 0.8 });
  const fit = (r: { geometry: [number, number][] }) => {
    const m = mapRef.current; if (!m || !r.geometry.length) return;
    const wide = window.innerWidth >= 768;
    m.fitBounds(L.latLngBounds(r.geometry), { paddingTopLeft: [wide ? 440 : 24, wide ? 70 : 280], paddingBottomRight: [60, 60], maxZoom: 13 });
  };

  const run = useCallback(async (refit: boolean) => {
    if (!origin || !dest) return;
    const id = ++reqId.current; setLoading(true); setError("");
    try {
      const r = await api.post<PlanOut>("/api/route", { origin: { lat: origin.lat, lon: origin.lon, name: origin.name }, destination: { lat: dest.lat, lon: dest.lon, name: dest.name }, mode, avoid }, { timeout: 180000 });
      if (id !== reqId.current) return;
      setPlan(r.data); setSel(0); if (refit) fit(r.data.routes[0]);
    } catch (e) { if (id === reqId.current) { setPlan(null); setError(errMsg(e)); } }
    finally { if (id === reqId.current) setLoading(false); }
  }, [origin, dest, mode, avoid]);

  useEffect(() => { if (origin && dest) run(true); else { reqId.current++; setPlan(null); setLoading(false); setError(""); } }, [origin, dest, mode, avoid]); // eslint-disable-line

  // Live: when an admin changes a zone, re-plan the current route without moving the map.
  const lastV = useRef<number | null>(null);
  useEffect(() => {
    if (!live.ready) return;
    if (lastV.current !== null && lastV.current !== live.version) {
      setToast("A hazard zone was updated.");
      if (planRef.current && origin && dest) { run(false); setToast("A hazard zone was updated. Your route was recalculated."); }
    }
    lastV.current = live.version;
  }, [live.version, live.ready]); // eslint-disable-line

  const pickPlace = (p: Place) => { setPlace(p); flyTo(p.lat, p.lon, p.kind === "city" ? 9 : 12); };
  const startDirections = (to?: Place | null) => { setPanel("directions"); if (to) setDest(to); };
  const swap = () => { setOrigin(dest); setDest(origin); };
  const clickMap = (lat: number, lon: number) => {
    const p: Place = { name: "Dropped pin", sub: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, kind: "pin" };
    if (panel === "directions") { if (!origin) setOrigin(p); else if (!dest) setDest(p); } else setPlace(p);
  };
  const zoomZone = (z: { lat: number; lon: number; radius_km: number }) => mapRef.current?.fitBounds(L.latLng(z.lat, z.lon).toBounds(z.radius_km * 2600), { padding: [40, 40], paddingTopLeft: window.innerWidth >= 768 ? [440, 40] : [24, 280] });
  const demo = ([a, b]: [string, string]) => {
    const A = cities.find((c) => c.city === a), B = cities.find((c) => c.city === b); if (!A || !B) return;
    const pl = (c: CityInfo): Place => ({ name: c.city, sub: c.state, lat: c.lat, lon: c.lon, kind: "city", city: c });
    setOrigin(pl(A)); setDest(pl(B)); setMode("car"); setAvoid(true);
  };

  const chip = (on: boolean) => `h-9 px-3 rounded-full flex items-center gap-1.5 text-sm whitespace-nowrap shadow-float ${on ? "bg-g-blueTint text-g-blueDark" : "bg-white text-g-text hover:bg-g-hover"}`;

  return (
    <div className="relative h-full overflow-hidden bg-[#e5e3df]">
      <MapContainer ref={mapRef} center={[22.5, 79]} zoom={5} minZoom={4} zoomControl={false} attributionControl={false} scrollWheelZoom>
        <OfflineBase />
        <TileLayer key={basemap} url={TILES[basemap].url} subdomains={TILES[basemap].sub} attribution={TILES[basemap].attr} />
        <MapClicks onClick={clickMap} />
        <ZoneCircles hazards={live.hazards} show={layers} />
        {layers.cities && cities.map((c) => (
          <CircleMarker key={c.city} center={[c.lat, c.lon]} radius={5} pathOptions={{ color: "#fff", weight: 1.5, fillColor: c.severity ? SEV_COLOR[c.severity] : "#5f6368", fillOpacity: 1 }}
            eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); setPanel("search"); pickPlace({ name: c.city, sub: c.state, lat: c.lat, lon: c.lon, kind: "city", city: c }); } }}>
            <Tooltip direction="top" offset={[0, -4]}>{c.city}</Tooltip>
          </CircleMarker>))}
        {plan && <RouteLayers routes={plan.routes} sel={sel} onSelect={setSel} mode={mode} />}
        {panel === "directions" && origin && <Marker position={[origin.lat, origin.lon]} icon={originIcon} zIndexOffset={800} />}
        {panel === "directions" && dest && <Marker position={[dest.lat, dest.lon]} icon={pinIcon} zIndexOffset={800} />}
        {panel === "search" && place && <Marker position={[place.lat, place.lon]} icon={pinIcon} zIndexOffset={800} />}
        <ZoomControl position="bottomright" />
      </MapContainer>

      {/* left panel */}
      <div className="absolute z-[1000] top-3 left-3 right-3 md:right-auto md:w-[408px] max-h-[calc(100%-24px)] flex flex-col">
        <div className={`bg-white rounded-lg ${shadow} flex flex-col min-h-0`}>
          {panel === "search" ? (
            <div className="px-3 py-1.5">
              <PlaceInput bare value={place} cities={cities} hazards={live.hazards} placeholder="Search cities and places" onPick={pickPlace} onClear={() => setPlace(null)}
                leading={<Icon n="search" className="text-g-sub" />}
                trailing={<><span className="w-px h-7 bg-g-line mx-1" /><button className="p-2 rounded-full text-g-blue hover:bg-g-blueTint" aria-label="Directions" title="Directions" onMouseDown={(e) => e.preventDefault()} onClick={() => startDirections(place)}><Icon n="directions" fill /></button></>} />
            </div>
          ) : (
            <div className="px-3 pt-2 pb-3">
              <div className="flex items-center gap-1">
                {MODES.map((m) => (
                  <button key={m.id} onClick={() => setMode(m.id)} aria-pressed={mode === m.id} title={m.label} aria-label={m.label}
                    className={"h-10 px-3.5 rounded-full flex items-center gap-1.5 text-sm " + (mode === m.id ? "bg-g-blue text-white" : "text-g-sub hover:bg-g-hover")}><Icon n={m.icon} fill={mode === m.id} size={22} />{mode === m.id && m.label}</button>))}
                <button className="ml-auto p-2 rounded-full hover:bg-g-hover text-g-sub" aria-label="Close directions" onClick={() => { setPanel("search"); }}><Icon n="close" /></button>
              </div>
              <div className="mt-2 flex items-center gap-1">
                <div className="flex flex-col items-center w-5 shrink-0 text-g-sub"><i className="w-3 h-3 rounded-full border-[3px] border-[#5f6368]" /><i className="my-0.5 w-0.5 h-1 bg-[#9aa0a6]" /><i className="w-0.5 h-1 bg-[#9aa0a6]" /><i className="my-0.5 w-0.5 h-1 bg-[#9aa0a6]" /><Icon n="location_on" fill size={18} className="text-[#ea4335]" /></div>
                <div className="flex-1 min-w-0 space-y-2">
                  <PlaceInput value={origin} cities={cities} hazards={live.hazards} placeholder="Choose starting point" autoFocus={!origin && !!dest} onPick={setOrigin} onClear={() => setOrigin(null)} />
                  <PlaceInput value={dest} cities={cities} hazards={live.hazards} placeholder="Choose destination" autoFocus={!!origin && !dest} onPick={setDest} onClear={() => setDest(null)} />
                </div>
                <button className="p-2 rounded-full hover:bg-g-hover text-g-sub" aria-label="Swap start and destination" title="Swap" onClick={swap}><Icon n="swap_vert" /></button>
              </div>
              <label className="mt-3 flex items-center gap-3 text-sm cursor-pointer select-none">
                <button type="button" role="switch" aria-checked={avoid} className={"sw " + (avoid ? "on" : "")} onClick={() => setAvoid(!avoid)} />
                <span className="flex-1">Avoid heatwave and anomaly zones<span className="block text-xs text-g-sub">{activeCount} zone{activeCount === 1 ? "" : "s"} active right now</span></span>
              </label>
            </div>
          )}
          {loading && <div className="bar-indeterminate" role="progressbar" aria-label="Finding a route" />}
          {panel === "directions" && loading && <div className="px-4 py-3 text-sm text-g-sub">{avoid ? `Finding roads and checking ${activeCount} hazard zones…` : "Finding roads…"}</div>}
        </div>

        {(panel === "search" ? place : panel === "directions" && (plan || error || !(origin && dest))) && (
          <div className={`mt-2 bg-white rounded-lg ${shadow} overflow-auto min-h-0`}>
            {panel === "search" && place && <PlaceCard place={place} hazards={live.hazards} onDirections={() => startDirections(place)} onZone={zoomZone} />}
            {panel === "directions" && error && <div role="alert" className="m-4 flex gap-2 text-sm text-g-red"><Icon n="error" size={20} />{error}</div>}
            {panel === "directions" && plan && !loading && (
              <>
                {plan.notes.map((n, i) => <div key={i} className={"flex gap-2 px-4 py-2.5 text-[13px] border-b border-g-line " + (/can't|could not/i.test(n) ? "bg-[#fef7e0] text-[#6b4e00]" : "bg-g-blueTint/50 text-g-text")}><Icon n={/can't|could not/i.test(n) ? "info" : "shield"} fill size={18} />{n}</div>)}
                <RouteCards plan={plan} sel={sel} onSelect={(i) => { setSel(i); fit(plan.routes[i]); }} onZone={zoomZone} />
              </>)}
            {panel === "directions" && !(origin && dest) && !loading && (
              <div className="py-2">
                <div className="px-4 pt-2 pb-1 text-xs text-g-sub">Try a route that crosses hazard zones</div>
                {DEMO_ROUTES.map((d) => (
                  <button key={d.join()} onClick={() => demo(d)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-g-hover text-left text-sm">
                    <Icon n="history" className="text-g-sub" size={20} />{d[0]}<Icon n="arrow_forward" size={16} className="text-g-sub" />{d[1]}</button>))}
              </div>)}
          </div>)}
      </div>

      {/* top chips and account */}
      <div className="hidden md:flex absolute z-[900] top-3 left-[432px] right-16 gap-2 overflow-x-auto pb-1 pointer-events-none [&>*]:pointer-events-auto">
        {(Object.keys(TYPE_META) as HazType[]).map((t) => (
          <button key={t} className={chip(layers[t])} aria-pressed={layers[t]} onClick={() => setLayers({ ...layers, [t]: !layers[t] })}><Icon n={TYPE_META[t].icon} fill size={18} color={TYPE_META[t].color} />{TYPE_META[t].label === "Other risk" ? "Other risks" : TYPE_META[t].label}</button>))}
        <button className={chip(layers.cities)} aria-pressed={layers.cities} onClick={() => setLayers({ ...layers, cities: !layers.cities })}><Icon n="location_city" size={18} />Cities</button>
        <span className={`${chip(false)} cursor-default`} title={live.stamp ? `Last update ${live.stamp.toLocaleTimeString()}` : ""}><i className={"w-2 h-2 rounded-full " + (live.connected ? "bg-g-green" : "bg-g-sub")} />{live.connected ? "Live" : "Reconnecting…"}</span>
      </div>
      <div className="absolute z-[1000] top-3 right-3">
        <button onClick={() => setMenuOpen(!menuOpen)} aria-label="Account" className={`w-10 h-10 rounded-full bg-g-blue text-white text-base font-medium grid place-items-center ${shadow}`}>{session?.name[0]}</button>
        {menuOpen && (
          <div className={`absolute right-0 mt-2 w-60 bg-white rounded-lg ${shadow} py-2 text-sm`}>
            <div className="px-4 py-2"><div className="font-medium">{session?.name}</div><div className="text-xs text-g-sub capitalize">{session?.role} · {session?.username}</div></div>
            {session?.role === "admin" && <Link to="/admin" className="block px-4 py-2 hover:bg-g-hover">Back to admin console</Link>}
            <button className="w-full text-left px-4 py-2 hover:bg-g-hover" onClick={logout}>Sign out</button>
          </div>)}
      </div>

      {/* layers */}
      <div className="absolute z-[900] bottom-8 left-3 hidden md:block">
        {layersOpen && (
          <div className={`mb-2 w-[260px] bg-white rounded-lg ${shadow} p-3 text-sm`}>
            <div className="text-xs text-g-sub mb-2">Map type</div>
            <div className="flex gap-3">
              {(["map", "terrain"] as const).map((b) => (
                <button key={b} onClick={() => setBasemap(b)} className="flex-1 text-center text-xs" aria-pressed={basemap === b}>
                  <span className={"block h-12 rounded-md mb-1 border-2 " + (basemap === b ? "border-g-blue" : "border-transparent")} style={{ background: b === "map" ? "linear-gradient(135deg,#e5e3df 0 40%,#f7d9a0 40% 48%,#aadaff 48% 70%,#c8e6c9 70%)" : "linear-gradient(135deg,#d9e8c4,#b7cf9a 45%,#e7dcc3)" }} />
                  <span className={basemap === b ? "text-g-blueDark font-medium" : ""}>{b === "map" ? "Default" : "Terrain"}</span></button>))}
            </div>
            <div className="text-xs text-g-sub mt-3 mb-1">Map details</div>
            {(Object.keys(TYPE_META) as HazType[]).map((t) => <label key={t} className="flex items-center gap-2 py-1 cursor-pointer"><input type="checkbox" className="accent-[#1a73e8]" checked={layers[t]} onChange={() => setLayers({ ...layers, [t]: !layers[t] })} />{TYPE_META[t].label === "Other risk" ? "Other risk zones" : `${TYPE_META[t].label} zones`}</label>)}
            <label className="flex items-center gap-2 py-1 cursor-pointer"><input type="checkbox" className="accent-[#1a73e8]" checked={layers.cities} onChange={() => setLayers({ ...layers, cities: !layers.cities })} />City markers</label>
          </div>)}
        <button onClick={() => setLayersOpen(!layersOpen)} aria-expanded={layersOpen} className={`w-12 h-12 rounded-lg bg-white ${shadow} grid place-items-center text-g-sub hover:text-g-text`} title="Layers"><Icon n="layers" /></button>
      </div>

      {toast && <div role="status" className="absolute z-[1200] bottom-12 left-1/2 -translate-x-1/2 bg-[#323232] text-white text-sm rounded-md px-4 py-2.5 shadow-card max-w-[92%]">{toast}</div>}
      <div className="absolute z-[900] bottom-0 right-0 left-0 md:left-auto bg-white/80 text-[10px] text-[#5f6368] px-2 py-0.5 text-right truncate" title="Synthetic demo data. Zones are simulated and are not official warnings.">
        Synthetic demo data · simulated zones, not official warnings · {TILES[basemap].attr.replace(/&copy;/g, "©")}
      </div>
    </div>
  );
}
