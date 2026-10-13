import { KeyboardEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { Hazard, useDebounced } from "../hazards";
import { CityInfo, Place, zonesAt } from "./util";

interface Props { value: Place | null; onPick: (p: Place) => void; onClear?: () => void; placeholder: string; cities: CityInfo[]; hazards: Hazard[]; autoFocus?: boolean; leading?: ReactNode; trailing?: ReactNode; bare?: boolean }

/** City search with instant suggestions from the dataset cities, plus any place in India via OpenStreetMap search. */
export default function PlaceInput({ value, onPick, onClear, placeholder, cities, hazards, autoFocus, leading, trailing, bare }: Props) {
  const [text, setText] = useState(value?.name ?? ""); const [focus, setFocus] = useState(false); const [remote, setRemote] = useState<Place[]>([]); const [hi, setHi] = useState(0);
  useEffect(() => setText(value?.name ?? ""), [value]);
  const q = text.trim().toLowerCase(); const dq = useDebounced(q, 500);

  useEffect(() => {
    if (!focus || dq.length < 3 || dq === (value?.name ?? "").toLowerCase()) { setRemote([]); return; }
    let live = true;
    api.get<{ results: { name: string; display: string; lat: number; lon: number }[] }>("/api/geocode", { params: { q: dq } })
      .then((r) => live && setRemote(r.data.results.map((x) => ({ name: x.name, sub: x.display.split(",").slice(1, 3).join(",").trim(), lat: x.lat, lon: x.lon, kind: "place" as const }))))
      .catch(() => live && setRemote([]));
    return () => { live = false; };
  }, [dq, focus]); // eslint-disable-line

  const items = useMemo<Place[]>(() => {
    const cs = cities.filter((c) => !q || c.city.toLowerCase().includes(q) || c.state.toLowerCase().includes(q))
      .sort((a, b) => Number(b.city.toLowerCase().startsWith(q)) - Number(a.city.toLowerCase().startsWith(q)) || a.city.localeCompare(b.city))
      .map<Place>((c) => ({ name: c.city, sub: c.state, lat: c.lat, lon: c.lon, kind: "city", city: c }));
    const known = new Set(cs.map((c) => c.name.toLowerCase()));
    return [...cs, ...remote.filter((r) => !known.has(r.name.toLowerCase()))];
  }, [cities, q, remote]);
  useEffect(() => setHi(0), [q]);

  const pick = (p: Place) => { setText(p.name); setFocus(false); onPick(p); };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(items.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter" && items[hi]) { e.preventDefault(); pick(items[hi]); (e.target as HTMLInputElement).blur(); }
    else if (e.key === "Escape") (e.target as HTMLInputElement).blur();
  };
  return (
    <div className="relative">
      <div className={"flex items-center gap-2 " + (bare ? "" : "h-11 rounded-md border border-g-line px-3 focus-within:border-g-blue focus-within:ring-1 focus-within:ring-g-blue")}>
        {leading}
        <input value={text} autoFocus={autoFocus} placeholder={placeholder} aria-label={placeholder} role="combobox" aria-expanded={focus} autoComplete="off"
          onChange={(e) => { setText(e.target.value); setFocus(true); }} onFocus={(e) => { setFocus(true); e.target.select(); }} onBlur={() => setTimeout(() => setFocus(false), 120)} onKeyDown={key}
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] placeholder:text-[#70757a] h-full" />
        {text && onClear && <button type="button" className="p-1 rounded-full hover:bg-g-hover text-g-sub" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { setText(""); onClear(); }}><Icon n="close" size={20} /></button>}
        {trailing}
      </div>
      {focus && items.length > 0 && (
        <ul role="listbox" className="absolute left-0 right-0 top-full mt-1 z-[1100] bg-white rounded-lg shadow-card max-h-[min(340px,50vh)] overflow-auto py-1">
          {!q && <li className="px-4 pt-2 pb-1 text-xs text-g-sub">Cities</li>}
          {items.map((p, i) => {
            const z = p.kind === "place" ? 0 : zonesAt(p.lat, p.lon, hazards).length;
            return (
              <li key={p.name + p.lat} role="option" aria-selected={i === hi} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setHi(i)}
                className={"flex items-center gap-3 px-4 py-2 cursor-pointer " + (i === hi ? "bg-g-hover" : "")}>
                <Icon n={p.kind === "city" ? "location_city" : "place"} className="text-g-sub" size={22} />
                <div className="flex-1 min-w-0"><div className="text-sm truncate">{p.name}</div>{p.sub && <div className="text-xs text-g-sub truncate">{p.sub}</div>}</div>
                {z > 0 && <span className="flex items-center gap-1 text-[11px] text-[#b45309] bg-[#fef3e2] rounded-full px-2 py-0.5 shrink-0" title="Inside an active hazard zone right now"><Icon n="warning" fill size={13} />Hazard</span>}
              </li>);
          })}
        </ul>)}
    </div>
  );
}
