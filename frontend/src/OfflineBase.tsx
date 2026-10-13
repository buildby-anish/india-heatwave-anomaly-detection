import type { GeoJsonObject } from "geojson";
import { GeoJSON, Pane } from "react-leaflet";
import data from "./assets/south_asia.json";

/** Bundled India + neighbours outline, drawn under the map tiles. With no internet (or no tiles) this is what you see. */
export default function OfflineBase() {
  return (
    <Pane name="offline" style={{ zIndex: 150 }}>
      <GeoJSON data={data as unknown as GeoJsonObject} interactive={false}
        style={(f) => (f?.properties?.role === "india" ? { fillColor: "#f5f3ee", fillOpacity: 1, color: "#7d8387", weight: 1.2 } : { fillColor: "#e6e4df", fillOpacity: 1, color: "#b5b8bb", weight: 0.8 })} />
    </Pane>
  );
}
