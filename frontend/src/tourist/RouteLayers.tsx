import { Marker, Pane, Polyline } from "react-leaflet";
import { bubbleIcon, fmtDur, Mode, RouteOut } from "./util";

/** Routes drawn like Google Maps: selected route in blue, others in grey, parts inside hazard zones in red, time bubble on each. */
export default function RouteLayers({ routes, sel, onSelect, mode }: { routes: RouteOut[]; sel: number; onSelect: (i: number) => void; mode: Mode }) {
  const order = routes.map((_, i) => i).filter((i) => i !== sel).concat(sel);
  const walk = mode === "foot";
  return (
    <>
      <Pane name="routes" style={{ zIndex: 430 }}>
        {order.map((i) => {
          const r = routes[i], on = i === sel, click = { click: () => onSelect(i) };
          return [
            <Polyline key={`c${i}${on}`} positions={r.geometry} bubblingMouseEvents={false} eventHandlers={click} pathOptions={{ color: on ? "#1558b0" : "#80868b", weight: walk ? 9 : on ? 10 : 9, opacity: on ? 0.95 : 0.9, lineCap: "round", lineJoin: "round" }} />,
            <Polyline key={`l${i}${on}`} positions={r.geometry} bubblingMouseEvents={false} eventHandlers={click} pathOptions={walk ? { color: on ? "#4285f4" : "#dadce0", weight: 6, dashArray: "0 11", lineCap: "round" } : { color: on ? "#4285f4" : "#dadce0", weight: 6, lineCap: "round", lineJoin: "round" }} />,
            ...r.exposure.map((e, k) => <Polyline key={`x${i}${on}${k}`} positions={e} bubblingMouseEvents={false} eventHandlers={click} pathOptions={{ color: "#d93025", weight: 6, opacity: 0.95, lineCap: "butt" }} />),
          ];
        })}
      </Pane>
      {routes.map((r, i) => {
        const at = r.geometry[Math.floor(r.geometry.length * Math.max(0.2, 0.5 - 0.14 * i))];
        return at && <Marker key={`b${i}${i === sel}`} position={at} zIndexOffset={i === sel ? 900 : 500} icon={bubbleIcon(fmtDur(r.duration_min), (i === sel ? "on " : "") + (r.hazards.length ? "risky" : ""))} eventHandlers={{ click: () => onSelect(i) }} />;
      })}
    </>
  );
}
