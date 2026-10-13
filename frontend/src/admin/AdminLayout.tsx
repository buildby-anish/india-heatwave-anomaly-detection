import { ReactNode, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, errMsg, Filters } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import FilterBar from "../components/FilterBar";
import { ErrorBox, Loading } from "../components/ui";
import MapPage from "../pages/MapPage";
import Analytics from "../pages/Analytics";
import Anomalies from "../pages/Anomalies";
import ModelPage from "../pages/ModelPage";
import Alerts from "../pages/Alerts";
import Zones from "./Zones";

interface Summary { rows: number; date_min: string; date_max: string; cities_list: string[]; regions: string[]; suggested_alert_date: string; source: string; valid: boolean }
const NAV = [["/admin", "Map", "map"], ["/admin/zones", "Zones", "crisis_alert"], ["/admin/analytics", "Analytics", "monitoring"], ["/admin/anomalies", "Anomalies", "troubleshoot"], ["/admin/model", "SVM model", "psychology"], ["/admin/alerts", "Alerts", "notifications"]] as const;

const Scroll = ({ children }: { children: ReactNode }) => <div className="h-full overflow-auto"><div className="p-4 space-y-3 max-w-[1500px]">{children}</div></div>;

export default function AdminLayout() {
  const { session, logout } = useAuth();
  const [sum, setSum] = useState<Summary | null>(null); const [err, setErr] = useState("");
  const [f, setF] = useState<Filters>({ start: "", end: "", cities: [], region: "" });
  useEffect(() => { api.get<Summary>("/api/dataset/summary").then((r) => { setSum(r.data); setF({ start: r.data.date_min, end: r.data.date_max, cities: [], region: "" }); }).catch((e) => setErr(errMsg(e))); }, []);
  if (err) return <div className="p-6"><ErrorBox msg={`Cannot reach the API at ${api.defaults.baseURL}: ${err}`} /></div>;
  if (!sum) return <Loading />;
  const bar = <FilterBar f={f} set={setF} cities={sum.cities_list} regions={sum.regions} min={sum.date_min} max={sum.date_max} />;
  return (
    <div className="h-full flex">
      <nav className="w-[76px] shrink-0 bg-white border-r border-g-line flex flex-col items-center py-3 gap-1 overflow-y-auto">
        <div className="mb-2 grid place-items-center w-10 h-10 rounded-full bg-[#fce8e6]" title="HeatWave India"><Icon n="local_fire_department" fill className="text-[#ea4335]" /></div>
        {NAV.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === "/admin"} className={({ isActive }) => "w-[68px] flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[11px] " + (isActive ? "text-g-blueDark" : "text-g-sub hover:text-g-text")}>
            {({ isActive }) => <><span className={"w-12 h-8 grid place-items-center rounded-full " + (isActive ? "bg-g-blueTint" : "hover:bg-g-hover")}><Icon n={icon} fill={isActive} size={22} /></span><span className="text-center leading-tight">{label}</span></>}
          </NavLink>
        ))}
        <div className="flex-1" />
        <a href="/app" target="_blank" rel="noreferrer" className="w-[68px] flex flex-col items-center gap-0.5 py-1.5 text-[11px] text-g-sub hover:text-g-text" title="Opens the tourist app in a new tab (sign in as the tourist there)">
          <span className="w-12 h-8 grid place-items-center rounded-full hover:bg-g-hover"><Icon n="travel_explore" size={22} /></span>Tourist app</a>
        <button onClick={logout} className="w-[68px] flex flex-col items-center gap-0.5 py-1.5 text-[11px] text-g-sub hover:text-g-text" title={`Signed in as ${session?.name}`}>
          <span className="w-12 h-8 grid place-items-center rounded-full hover:bg-g-hover"><Icon n="logout" size={22} /></span>Sign out</button>
      </nav>
      <div className="flex-1 min-w-0 h-full flex flex-col">
        <div className="shrink-0 bg-[#fef7e0] border-b border-[#f9e29c] text-[#6b4e00] text-xs px-3 py-1.5 leading-tight">
          <b>Data source: {sum.source}.</b> {sum.rows.toLocaleString()} records, {sum.date_min} to {sum.date_max}. Not real historical weather data; not an official warning.{!sum.valid && " Validation found problems."}
        </div>
        <div className="flex-1 min-h-0">
          <Routes>
            <Route index element={<MapPage f={f} set={setF} cities={sum.cities_list} regions={sum.regions} min={sum.date_min} max={sum.date_max} />} />
            <Route path="zones" element={<Zones />} />
            <Route path="analytics" element={<Scroll>{bar}<Analytics f={f} /></Scroll>} />
            <Route path="anomalies" element={<Scroll>{bar}<Anomalies f={f} /></Scroll>} />
            <Route path="model" element={<Scroll><ModelPage /></Scroll>} />
            <Route path="alerts" element={<Scroll><Alerts suggested={sum.suggested_alert_date} min={sum.date_min} max={sum.date_max} /></Scroll>} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
