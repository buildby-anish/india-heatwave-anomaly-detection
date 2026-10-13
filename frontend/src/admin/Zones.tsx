import { useEffect, useMemo, useRef, useState } from "react";
import OfflineBase from "../OfflineBase";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { api, errMsg, SEVS, SEV_COLOR } from "../api";
import { Icon } from "../components/Icon";
import { dotIcon, Hazard, HazType, SEV_FILL, TILES, TYPE_META, useLiveHazards, zoneLabel, ZoneCircles } from "../hazards";

type Draft = Omit<Hazard, "id" | "source" | "updated_at" | "updated_by"> & { id?: string };
const ALL: Record<HazType, boolean> = { heatwave: true, anomaly: true, risk: true };
const blank = (): Draft => ({ name: "", type: "heatwave", category: "", severity: "High", lat: 22.5, lon: 79, radius_km: 30, active: true, note: "" });
const toDraft = (h: Hazard): Draft => ({ id: h.id, name: h.name, type: h.type, category: h.category, severity: h.severity, lat: h.lat, lon: h.lon, radius_km: h.radius_km, active: h.active, note: h.note });
const body = (d: Draft) => ({ name: d.name.trim(), type: d.type, category: d.category.trim(), severity: d.severity, lat: d.lat, lon: d.lon, radius_km: d.radius_km, active: d.active, note: d.note });
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function Fly({ to }: { to: [number, number, number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (to) map.flyTo([to[0], to[1]], to[2], { duration: 0.8 }); }, [to, map]);
  return null;
}
function Clicks({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick(r4(e.latlng.lat), r4(e.latlng.lng)) });
  return null;
}

export default function Zones() {
  const live = useLiveHazards();
  const [draft, setDraft] = useState<Draft | null>(null); const orig = useRef("");
  const [tab, setTab] = useState<"all" | HazType>("all");
  const [fly, setFly] = useState<[number, number, number, number] | null>(null);
  const [toast, setToast] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [syncOpen, setSyncOpen] = useState(false); const [syncDate, setSyncDate] = useState(""); const [cities, setCities] = useState<{ city: string; lat: number; lon: number }[]>([]);
  useEffect(() => { api.get("/api/cities").then((r) => setCities(r.data.cities)).catch(() => {}); }, []);
  useEffect(() => { if (live.seedDate && !syncDate) setSyncDate(live.seedDate); }, [live.seedDate, syncDate]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);

  const dirty = !!draft && JSON.stringify(draft) !== orig.current;
  const open = (d: Draft | null, focus = true) => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDraft(d); orig.current = JSON.stringify(d); setErr("");
    if (d?.id && focus) setFly([d.lat, d.lon, 7, Date.now()]);
  };
  const pick = (h: Hazard) => open(toDraft(h));
  const upd = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setErr("Give the zone a name.");
    if (![draft.lat, draft.lon, draft.radius_km].every(Number.isFinite)) return setErr("Latitude, longitude and radius must be numbers.");
    setBusy(true); setErr("");
    try {
      const r = draft.id ? await api.put<Hazard>(`/api/hazards/${draft.id}`, body(draft)) : await api.post<Hazard>("/api/hazards", body(draft));
      await live.refresh();
      const d = toDraft(r.data); setDraft(d); orig.current = JSON.stringify(d);
      const n = live.viewers?.tourist ?? 0;
      setToast(`Saved. Live now for ${n} tourist app${n === 1 ? "" : "s"} that ${n === 1 ? "is" : "are"} open.`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!draft?.id || !window.confirm(`Delete "${draft.name}"? Tourist routes will update immediately.`)) return;
    try { await api.delete(`/api/hazards/${draft.id}`); await live.refresh(); setDraft(null); orig.current = ""; setToast("Zone deleted."); } catch (e) { setErr(errMsg(e)); }
  };
  const toggleActive = async (h: Hazard) => {
    try { await api.put(`/api/hazards/${h.id}`, body({ ...toDraft(h), active: !h.active })); await live.refresh(); setToast(h.active ? `${h.name} switched off. Routes can use this area again.` : `${h.name} switched on. Routes now avoid it.`); } catch (e) { setToast(errMsg(e)); }
  };
  const doSync = async () => {
    setBusy(true);
    try { const r = await api.post("/api/hazards/sync", { date: syncDate, window_days: 7 }); await live.refresh(); setSyncOpen(false); setToast(`Rebuilt ${r.data.created} model zones for the 7 days to ${r.data.date}.`); } catch (e) { setToast(errMsg(e)); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!window.confirm("Reset to the original demo zones? Your own zones will be removed.")) return;
    await api.post("/api/hazards/reset"); await live.refresh(); setDraft(null); orig.current = ""; setToast("Reset to the demo set.");
  };

  const list = useMemo(() => live.hazards.filter((h) => tab === "all" || h.type === tab), [live.hazards, tab]);
  const counts = useMemo(() => ({ all: live.hazards.length, heatwave: 0, anomaly: 0, risk: 0, ...Object.fromEntries((["heatwave", "anomaly", "risk"] as HazType[]).map((t) => [t, live.hazards.filter((h) => h.type === t).length])) }), [live.hazards]);
  const others = live.hazards.filter((h) => h.id !== draft?.id);
  const tourists = live.viewers?.tourist ?? 0;
  const lab = "block text-xs text-g-sub mb-1";

  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 bg-white border-b border-g-line px-4 py-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[18px] font-medium">Risk zones</h1>
        <span className={"inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 " + (live.connected ? "bg-[#e6f4ea] text-g-green" : "bg-g-hover text-g-sub")}>
          <i className={"w-2 h-2 rounded-full " + (live.connected ? "bg-g-green" : "bg-g-sub")} />{live.connected ? "Live" : "Reconnecting…"} · {tourists} tourist app{tourists === 1 ? "" : "s"} open
        </span>
        <span className="text-xs text-g-sub hidden xl:inline">Every active zone is avoided by tourist routes. Saved changes reach open tourist apps within a second.</span>
        <div className="ml-auto flex items-center gap-2 relative">
          <button className="btn" onClick={() => setSyncOpen(!syncOpen)}>Rebuild AI zones</button>
          <button className="btn" onClick={reset}>Reset demo set</button>
          <button className="btn-primary flex items-center gap-1" onClick={() => open({ ...blank() }, false)}><Icon n="add" size={18} />New zone</button>
          {syncOpen && (
            <div className="absolute right-0 top-11 z-[1000] w-[320px] bg-white rounded-lg shadow-card p-4 text-sm">
              <div className="font-medium">Rebuild zones from the data</div>
              <p className="text-xs text-g-sub mt-1">Creates heatwave zones for cities at High or above and anomaly zones for Isolation Forest flags in the 7 days up to this date. Zones you made or edited are kept.</p>
              <label className={lab + " mt-3"}>Date</label><input type="date" className="inp w-full" value={syncDate} onChange={(e) => setSyncDate(e.target.value)} />
              <div className="mt-3 flex justify-end gap-2"><button className="btn-text" onClick={() => setSyncOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy || !syncDate} onClick={doSync}>Rebuild</button></div>
            </div>)}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside className="md:w-[380px] shrink-0 bg-white md:border-r border-b md:border-b-0 border-g-line flex flex-col min-h-0 max-h-[45%] md:max-h-none">
          {!draft ? (
            <>
              <div className="flex border-b border-g-line text-sm overflow-x-auto">
                {([["all", "All"], ["heatwave", "Heatwave"], ["anomaly", "AI anomaly"], ["risk", "Other"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} className={"px-3 py-2.5 whitespace-nowrap border-b-[3px] -mb-px " + (tab === k ? "border-g-blue text-g-blue font-medium" : "border-transparent text-g-sub hover:bg-g-hover")}>{l} <span className="text-xs">{counts[k]}</span></button>
                ))}
              </div>
              <ul className="flex-1 overflow-auto divide-y divide-g-line">
                {list.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-g-hover cursor-pointer" onClick={() => pick(h)}>
                    <span className="zone-dot shrink-0" style={{ background: TYPE_META[h.type].color, opacity: h.active ? 1 : 0.4 }}><Icon n={TYPE_META[h.type].icon} fill size={14} /></span>
                    <div className={"flex-1 min-w-0 " + (h.active ? "" : "opacity-60")}>
                      <div className="text-sm font-medium truncate">{h.name}</div>
                      <div className="text-xs text-g-sub truncate">{zoneLabel(h)} · {h.severity} · {h.radius_km} km · {h.source.replace("+edited", " (edited)")}</div>
                    </div>
                    <button className={"sw " + (h.active ? "on" : "")} role="switch" aria-checked={h.active} aria-label={`Avoid ${h.name}`} title={h.active ? "Avoided in routes. Click to switch off" : "Not avoided. Click to switch on"} onClick={(e) => { e.stopPropagation(); toggleActive(h); }} />
                  </li>
                ))}
                {!list.length && <li className="p-6 text-sm text-g-sub text-center">No zones here yet. Use New zone to add one.</li>}
              </ul>
            </>
          ) : (
            <div className="flex-1 overflow-auto">
              <div className="flex items-center gap-1 px-2 py-2 border-b border-g-line">
                <button className="p-2 rounded-full hover:bg-g-hover" aria-label="Back to the list" onClick={() => open(null)}><Icon n="arrow_back" size={22} /></button>
                <div className="text-base font-medium">{draft.id ? "Edit zone" : "New zone"}</div>
                {dirty && <span className="ml-auto text-xs text-g-amber font-medium pr-2">Unsaved changes</span>}
              </div>
              <div className="p-4 space-y-4">
                <div><label className={lab} htmlFor="zn">Name</label><input id="zn" className="inp w-full" value={draft.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Kota heat belt" /></div>
                <div><span className={lab}>Type</span>
                  <div className="grid grid-cols-3 gap-2">{(Object.keys(TYPE_META) as HazType[]).map((t) => (
                    <button key={t} type="button" onClick={() => upd({ type: t })} className={"rounded-lg border px-2 py-2 text-sm flex flex-col items-center gap-1 " + (draft.type === t ? "border-2 font-medium" : "border-g-line hover:bg-g-hover")} style={draft.type === t ? { borderColor: TYPE_META[t].color, color: TYPE_META[t].color } : undefined}>
                      <Icon n={TYPE_META[t].icon} fill size={20} />{TYPE_META[t].label}</button>))}</div></div>
                {draft.type === "risk" && <div><label className={lab} htmlFor="zc">What kind of risk?</label><input id="zc" className="inp w-full" value={draft.category} onChange={(e) => upd({ category: e.target.value })} placeholder="Flood, dust storm, road closure, wildfire…" /></div>}
                <div><span className={lab}>Severity</span>
                  <div className="flex gap-1.5 flex-wrap">{SEVS.map((s) => (
                    <button key={s} type="button" onClick={() => upd({ severity: s })} className={"rounded-full border px-3 py-1 text-sm " + (draft.severity === s ? "text-white border-transparent" : "border-g-line hover:bg-g-hover")} style={draft.severity === s ? { background: SEV_COLOR[s] } : undefined}>{s}</button>))}</div></div>
                <div><label className={lab} htmlFor="zr">Radius: {draft.radius_km} km</label>
                  <div className="flex items-center gap-3"><input id="zr" type="range" min={3} max={150} value={Math.min(150, draft.radius_km)} onChange={(e) => upd({ radius_km: Number(e.target.value) })} className="flex-1 accent-[#1a73e8]" />
                    <input type="number" min={3} max={300} className="inp w-20" value={draft.radius_km} onChange={(e) => upd({ radius_km: Number(e.target.value) })} /></div></div>
                <div>
                  <span className={lab}>Location. Click the map or drag the pin to move it.</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" step="0.01" className="inp" aria-label="Latitude" value={draft.lat} onChange={(e) => upd({ lat: Number(e.target.value) })} />
                    <input type="number" step="0.01" className="inp" aria-label="Longitude" value={draft.lon} onChange={(e) => upd({ lon: Number(e.target.value) })} /></div>
                  <select className="inp w-full mt-2" value="" onChange={(e) => { const c = cities.find((x) => x.city === e.target.value); if (c) { upd({ lat: c.lat, lon: c.lon }); setFly([c.lat, c.lon, 7, Date.now()]); } }}>
                    <option value="">Jump to a city…</option>{cities.map((c) => <option key={c.city}>{c.city}</option>)}</select></div>
                <div><label className={lab} htmlFor="zt">Note (shown to tourists)</label><textarea id="zt" rows={3} className="inp w-full" value={draft.note} onChange={(e) => upd({ note: e.target.value })} /></div>
                <label className="flex items-center gap-3 text-sm cursor-pointer"><button type="button" role="switch" aria-checked={draft.active} className={"sw " + (draft.active ? "on" : "")} onClick={() => upd({ active: !draft.active })} />Avoid this zone when planning routes</label>
                {err && <div role="alert" className="text-sm text-g-red flex gap-2"><Icon n="error" size={18} />{err}</div>}
                <div className="flex items-center gap-2 pt-1">
                  <button className="btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
                  <button className="btn-text" onClick={() => open(null)}>{dirty ? "Discard" : "Close"}</button>
                  {draft.id && <button className="btn-text ml-auto !text-g-red hover:!bg-[#fce8e6]" onClick={remove}>Delete</button>}
                </div>
              </div>
            </div>
          )}
        </aside>

        <div className="relative flex-1 min-h-[300px]">
          <MapContainer center={[22.5, 79]} zoom={5} scrollWheelZoom>
            <OfflineBase />
          <TileLayer attribution={TILES.map.attr} url={TILES.map.url} subdomains={TILES.map.sub} />
            <Fly to={fly} />
            <Clicks onClick={(lat, lon) => draft && upd({ lat, lon })} />
            <ZoneCircles hazards={others} show={ALL} onSelect={pick} dimInactive selectedId={draft?.id} />
            {draft && Number.isFinite(draft.lat) && Number.isFinite(draft.lon) && (
              <>
                <Circle center={[draft.lat, draft.lon]} radius={(draft.radius_km || 1) * 1000} interactive={false}
                  pathOptions={{ color: TYPE_META[draft.type].color, weight: 3, fillColor: TYPE_META[draft.type].color, fillOpacity: SEV_FILL[draft.severity], dashArray: draft.active ? undefined : "4 6" }} />
                <Marker position={[draft.lat, draft.lon]} draggable zIndexOffset={1000} icon={dotIcon(draft)} eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); upd({ lat: r4(p.lat), lon: r4(p.lng) }); } }} />
              </>)}
          </MapContainer>
          {!draft && <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-white rounded-full shadow-card px-4 py-1.5 text-sm text-g-sub pointer-events-none">Click a zone to edit it, or add a new one</div>}
          {toast && <div role="status" className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-[#323232] text-white text-sm rounded-md px-4 py-2.5 shadow-card max-w-[90%]">{toast}</div>}
        </div>
      </div>
    </div>
  );
}
