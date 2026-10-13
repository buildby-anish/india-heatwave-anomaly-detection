import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { homeFor, Role, useAuth } from "../auth";
import { Icon } from "../components/Icon";

const DEMO: Record<Role, { id: string; pw: string; blurb: string }> = {
  tourist: { id: "tourist", pw: "tourist123", blurb: "Search cities, get directions, and route around heat and anomaly zones." },
  admin: { id: "admin", pw: "admin123", blurb: "Dashboards, model results, and a live editor for risk zones." },
};

function Field({ id, label, type = "text", value, onChange, autoFocus }: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <input id={id} type={type} value={value} placeholder=" " autoFocus={autoFocus} autoComplete={type === "password" ? "current-password" : "username"} onChange={(e) => onChange(e.target.value)}
        className="peer w-full h-14 rounded-md border border-[#80868b] bg-white px-3.5 pt-4 text-base outline-none focus-visible:outline-none focus:border-[2px] focus:border-g-blue focus:px-[13px]" />
      <label htmlFor={id} className="pointer-events-none absolute left-3.5 top-4 bg-white px-0.5 text-base text-g-sub transition-all peer-focus:-top-2 peer-focus:text-xs peer-focus:text-g-blue peer-[:not(:placeholder-shown)]:-top-2 peer-[:not(:placeholder-shown)]:text-xs">{label}</label>
    </div>
  );
}

export default function Login() {
  const { session, login } = useAuth(); const nav = useNavigate();
  const [role, setRole] = useState<Role>("tourist"); const [id, setId] = useState(""); const [pw, setPw] = useState("");
  const [show, setShow] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (session) return <Navigate to={homeFor(session)} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { const s = await login(id, pw, role); nav(homeFor(s), { replace: true }); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const use = (r: Role) => { setRole(r); setId(DEMO[r].id); setPw(DEMO[r].pw); setErr(""); };
  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-[#f0f4f9] p-4 gap-4">
      <form onSubmit={submit} className="w-full max-w-[450px] rounded-[28px] bg-white px-6 sm:px-10 pt-10 pb-8 shadow-sm border border-g-line">
        <div className="flex items-center gap-2">
          <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden><path fill="#ea4335" d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" /><path fill="#fff" d="M12 4.6c.5 1.6 2.5 2.5 2.5 4.5a2.5 2.5 0 0 1-5 0c0-.9.4-1.5.9-2 .1.6.4 1 .8 1.1-.3-1.4-.2-2.8.8-3.6z" /></svg>
          <span className="text-[22px] text-g-sub">HeatWave India</span>
        </div>
        <h1 className="mt-6 text-[24px] font-normal leading-8">Sign in</h1>
        <p className="mt-1 text-base">to continue to the {role === "admin" ? "admin console" : "travel map"}</p>

        <div role="tablist" className="mt-6 flex border-b border-g-line">
          {(["tourist", "admin"] as Role[]).map((r) => (
            <button key={r} type="button" role="tab" aria-selected={role === r} onClick={() => { setRole(r); setErr(""); }}
              className={"flex-1 pb-2.5 pt-1 text-sm font-medium border-b-[3px] -mb-px capitalize " + (role === r ? "border-g-blue text-g-blue" : "border-transparent text-g-sub hover:bg-g-hover")}>{r}</button>
          ))}
        </div>
        <p className="mt-3 text-sm text-g-sub">{DEMO[role].blurb}</p>

        <div className="mt-6 space-y-5">
          <Field id="uid" label="ID" value={id} onChange={setId} autoFocus />
          <div>
            <Field id="pw" label="Password" type={show ? "text" : "password"} value={pw} onChange={setPw} />
            <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer w-fit"><input type="checkbox" className="h-4 w-4 accent-[#1a73e8]" checked={show} onChange={(e) => setShow(e.target.checked)} />Show password</label>
          </div>
          {err && <div role="alert" className="flex items-start gap-2 text-sm text-g-red"><Icon n="error" size={18} className="mt-px" />{err}</div>}
        </div>
        <div className="mt-8 flex justify-end"><button className="btn-primary" disabled={busy || !id || !pw}>{busy ? "Signing in…" : "Sign in"}</button></div>
      </form>

      <div className="w-full max-w-[450px] rounded-2xl border border-g-line bg-white px-5 py-4">
        <div className="text-sm font-medium">Demo accounts</div>
        <ul className="mt-2 divide-y divide-g-line">
          {(Object.keys(DEMO) as Role[]).map((r) => (
            <li key={r} className="flex items-center gap-3 py-2 text-sm">
              <Icon n={r === "admin" ? "admin_panel_settings" : "explore"} className="text-g-sub" size={20} />
              <div className="flex-1 min-w-0"><span className="capitalize font-medium">{r}</span><span className="text-g-sub"> · {DEMO[r].id} / {DEMO[r].pw}</span></div>
              <button type="button" className="btn-text" onClick={() => use(r)}>Fill in</button>
            </li>
          ))}
        </ul>
      </div>
      <p className="max-w-[450px] text-center text-xs text-g-sub">Uses synthetic demo data. Hazard zones are simulated and are not official weather warnings.</p>
    </div>
  );
}
