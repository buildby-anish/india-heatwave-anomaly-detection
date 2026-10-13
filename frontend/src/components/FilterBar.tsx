import { Filters } from "../api";

/** Compact single-row filter bar. `flat` drops the card chrome so it can sit inside a page header. */
export default function FilterBar({ f, set, cities, regions, min, max, flat }: { f: Filters; set: (f: Filters) => void; cities: string[]; regions: string[]; min: string; max: string; flat?: boolean }) {
  const toggle = (c: string) => set({ ...f, cities: f.cities.includes(c) ? f.cities.filter((x) => x !== c) : [...f.cities, c] });
  const lab = "flex items-center gap-1.5 text-xs text-g-sub";
  return (
    <div className={(flat ? "" : "card ") + "flex flex-wrap gap-x-4 gap-y-2 items-center"}>
      <label className={lab}>From<input className="inp" type="date" min={min} max={max} value={f.start} onChange={(e) => set({ ...f, start: e.target.value })} /></label>
      <label className={lab}>To<input className="inp" type="date" min={min} max={max} value={f.end} onChange={(e) => set({ ...f, end: e.target.value })} /></label>
      <label className={lab}>Region<select className="inp" value={f.region} onChange={(e) => set({ ...f, region: e.target.value })}><option value="">All</option>{regions.map((r) => <option key={r}>{r}</option>)}</select></label>
      <details className="text-xs relative"><summary className="btn cursor-pointer list-none">Cities: {f.cities.length ? f.cities.length + " selected" : `all ${cities.length}`}</summary>
        <div className="absolute z-[1000] mt-1 bg-white border border-g-line rounded-lg p-2 w-52 max-h-64 overflow-auto shadow-card">
          {cities.map((c) => <label key={c} className="flex gap-2 py-0.5 text-sm"><input type="checkbox" checked={f.cities.includes(c)} onChange={() => toggle(c)} />{c}</label>)}
        </div></details>
      <button className="btn" onClick={() => set({ start: min, end: max, cities: [], region: "" })}>Reset</button>
    </div>
  );
}
