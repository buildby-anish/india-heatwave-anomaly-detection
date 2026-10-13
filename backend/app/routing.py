"""Road routing (OSRM) with hazard avoidance.

1. Ask OSRM for the fastest route (+ alternatives).
2. Measure how much of each route lies inside active hazard circles.
3. If the best route still crosses zones, push the route around them: add a via-point just outside each crossed
   zone (on the side with the smaller detour), re-route, and repeat. Both sides are tried each round.
Zones that contain the start or destination are reported but not avoided (you can't route around them).
"""
import asyncio
import math
import os
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
import numpy as np

KM = 111.195
UA = {"User-Agent": "HeatWaveIndiaDemo/1.0 (local demo app)"}
PROFILES = {
    "car": ["https://routing.openstreetmap.de/routed-car", "https://router.project-osrm.org"],
    "bike": ["https://routing.openstreetmap.de/routed-bike"],
    "foot": ["https://routing.openstreetmap.de/routed-foot"],
}
# Point at your own OSRM instead of the free public servers, e.g. HEATWAVE_OSRM_URL=http://localhost:5000  ("{mode}" is replaced by car/bike/foot)
CUSTOM_OSRM = os.environ.get("HEATWAVE_OSRM_URL")
MAX_ROUNDS = 6
MAX_DETOUR_FACTOR = 2.2  # ignore "safe" routes that take more than this multiple of the fastest time
MIN_INTERVAL = 0.6  # seconds between requests to the free public routing servers (they ask for ~1 req/s)
_CACHE: dict = {}
_THROTTLE = {"lock": None, "last": 0.0}


class RoutingError(Exception):
    pass


# ---------------------------------------------------------------- geometry
def haversine_km(a, b) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def bearing(a, b) -> float:
    dy = b[0] - a[0]
    dx = (b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.degrees(math.atan2(dx, dy)) % 360


def offset(p, bearing_deg: float, dist_km: float):
    r = math.radians(bearing_deg)
    return (p[0] + math.cos(r) * dist_km / KM, p[1] + math.sin(r) * dist_km / (KM * math.cos(math.radians(p[0]))))


def densify(c: np.ndarray, step_km: float = 1.0) -> np.ndarray:
    """Insert points so consecutive points are at most step_km apart (c is Nx2 lat,lon)."""
    if len(c) < 2:
        return c
    seg = c[1:] - c[:-1]
    length = np.hypot(seg[:, 1] * np.cos(np.radians((c[1:, 0] + c[:-1, 0]) / 2)) * KM, seg[:, 0] * KM)
    n = np.maximum(1, np.ceil(length / step_km)).astype(int)
    idx = np.repeat(np.arange(len(seg)), n)
    within = np.arange(n.sum()) - np.repeat(np.cumsum(n) - n, n)
    t = ((within + 1) / np.repeat(n, n))[:, None]
    return np.vstack([c[:1], c[idx] + seg[idx] * t])


def dist_to(c: np.ndarray, lat: float, lon: float) -> np.ndarray:
    return np.hypot((c[:, 0] - lat) * KM, (c[:, 1] - lon) * math.cos(math.radians(lat)) * KM)


def thin(c: np.ndarray, min_km: float = 0.02) -> list:
    out, last = [c[0]], c[0]
    for p in c[1:-1]:
        if abs(p[0] - last[0]) * KM > min_km or abs(p[1] - last[1]) * KM > min_km:
            out.append(p)
            last = p
    out.append(c[-1])
    return [[round(float(a), 5), round(float(b), 5)] for a, b in out]


def contains(z: dict, p) -> bool:
    return haversine_km((z["lat"], z["lon"]), p) <= z["radius_km"]


# ---------------------------------------------------------------- route objects
@dataclass
class Cand:
    coords: np.ndarray
    distance_m: float
    duration_s: float
    steps: list = field(default_factory=list)
    vias: list = field(default_factory=list)
    hits: list = field(default_factory=list)  # [{zone..., km_inside}]
    hazard_km: float = 0.0
    exposure: list = field(default_factory=list)

    @property
    def key(self):
        return (len(self.hits), round(self.hazard_km, 1), self.duration_s)


def evaluate(c: Cand, zones: list[dict]):
    d = densify(c.coords)
    seg_km = np.hypot((d[1:, 1] - d[:-1, 1]) * np.cos(np.radians(d[1:, 0])) * KM, (d[1:, 0] - d[:-1, 0]) * KM)
    any_in = np.zeros(len(d), bool)
    hits = []
    for z in zones:
        inside = dist_to(d, z["lat"], z["lon"]) <= z["radius_km"]
        if inside.any():
            both = inside[1:] & inside[:-1]
            hits.append({**z, "km_inside": round(float(seg_km[both].sum()), 1), "_first": int(np.argmax(inside))})
            any_in |= inside
    hits.sort(key=lambda h: h["_first"])
    c.hits = hits
    c.hazard_km = round(float(seg_km[any_in[1:] & any_in[:-1]].sum()), 1) if hits else 0.0
    runs, cur = [], []
    for i in range(len(d)):
        if any_in[i]:
            if not cur and i > 0:
                cur.append(d[i - 1])
            cur.append(d[i])
        elif cur:
            cur.append(d[i])
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    c.exposure = [thin(np.array(r), 0.2) for r in runs]
    c._dens = d  # for detour planning


# ---------------------------------------------------------------- OSRM
DIRS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
MODS = {"left": "left", "right": "right", "slight left": "slightly left", "slight right": "slightly right",
        "sharp left": "sharp left", "sharp right": "sharp right", "uturn": "around (U-turn)", "straight": "straight"}


def _road(s: dict) -> str:
    n, ref = s.get("name") or "", s.get("ref") or ""
    return f"{n} ({ref})" if n and ref and ref not in n else (n or ref)


def _instruction(s: dict) -> str:
    m = s.get("maneuver", {})
    t, mod, road = m.get("type", ""), MODS.get(m.get("modifier", ""), m.get("modifier", "")), _road(s)
    onto = f" onto {road}" if road else ""
    if t == "depart":
        return f"Head {DIRS[int(((m.get('bearing_after', 0) + 22.5) % 360) // 45)]}" + (f" on {road}" if road else "")
    if t == "arrive":
        return "Arrive at your destination"
    if t == "turn":
        return f"Turn {mod}{onto}"
    if t == "end of road":
        return f"At the end of the road, turn {mod}{onto}"
    if t == "fork":
        return f"Keep {mod} at the fork{onto}"
    if t == "merge":
        return f"Merge {mod}{onto}".replace("  ", " ")
    if t == "on ramp":
        return f"Take the ramp{onto}"
    if t == "off ramp":
        return f"Take the exit{onto}"
    if t in ("roundabout", "rotary", "roundabout turn"):
        return f"At the roundabout, take exit {m['exit']}{onto}" if m.get("exit") else f"Go through the roundabout{onto}"
    return f"Continue{onto}"


def _via_text(steps: list) -> str:
    tot: dict = {}
    for s in steps:
        r = s.get("ref") or s.get("name")
        if r:
            tot[r] = tot.get(r, 0) + s["distance"]
    top = [k for k, _ in sorted(tot.items(), key=lambda kv: -kv[1])[:2]]
    return "via " + " and ".join(top) if top else "via local roads"


def _parse(r: dict, vias: list) -> Cand:
    steps = []
    for leg in r.get("legs", []):
        for s in leg.get("steps", []):
            steps.append({"text": _instruction(s), "distance_m": round(s["distance"]), "road": _road(s),
                          "ref": s.get("ref", ""), "name": s.get("name", ""), "distance": s["distance"]})
    c = Cand(np.array([[p[1], p[0]] for p in r["geometry"]["coordinates"]]), r["distance"], r["duration"], steps, list(vias))
    return c


async def _osrm(client: httpx.AsyncClient, mode: str, pts: list, alternatives: bool, steps: bool) -> list[dict]:
    key = (mode, tuple((round(a, 4), round(b, 4)) for a, b in pts), alternatives, steps)
    if key in _CACHE:
        return _CACHE[key]
    coords = ";".join(f"{lon:.5f},{lat:.5f}" for lat, lon in pts)
    params = {"overview": "full", "geometries": "geojson", "steps": str(steps).lower(), "alternatives": str(alternatives).lower()}
    err = "no routing server answered"
    for base in ([CUSTOM_OSRM.format(mode=mode).rstrip('/')] if CUSTOM_OSRM else PROFILES[mode]):
        try:
            if _THROTTLE["lock"] is None:
                _THROTTLE["lock"] = asyncio.Lock()
            async with _THROTTLE["lock"]:
                wait = _THROTTLE["last"] + MIN_INTERVAL - time.monotonic()
                if wait > 0:
                    await asyncio.sleep(wait)
                _THROTTLE["last"] = time.monotonic()
            # the "driving" path segment is correct for every profile; the server host decides car/bike/foot
            url = httpx.URL(f"{base}/route/v1/driving/{coords}", params=params)
            # send ',' and ';' in the coordinate list literally: OSRM's URL parser does not expect them percent-encoded
            raw = (httpx.URL(base).path.rstrip("/") + f"/route/v1/driving/{coords}?" + "&".join(f"{k}={v}" for k, v in params.items())).encode()
            r = await client.get(url, extensions={"target": raw})
            if r.status_code == 429 or r.status_code >= 500:
                err = f"{base} returned {r.status_code}"
                continue
            j = r.json()
            if j.get("code") != "Ok":
                err = j.get("message") or j.get("code", "routing failed")
                if j.get("code") in ("NoRoute", "NoSegment"):
                    raise RoutingError(f"No {mode} route found between these points ({err}).")
                continue
            if len(_CACHE) > 300:
                _CACHE.pop(next(iter(_CACHE)))
            _CACHE[key] = j["routes"]
            return j["routes"]
        except (httpx.HTTPError, ValueError) as e:
            err = f"{base}: {e}"
    raise RoutingError(f"Routing service unavailable ({err}).")


# ---------------------------------------------------------------- planner
def _order_vias(vias: dict, o, d) -> list:
    dx, dy = d[1] - o[1], d[0] - o[0]
    n = dx * dx + dy * dy or 1.0
    return [p for _, p in sorted(vias.items(), key=lambda kv: ((kv[1][1] - o[1]) * dx + (kv[1][0] - o[0]) * dy) / n)]


def _candidate_vias(z: dict, cur: Cand, scale: float) -> list:
    """Two via-points just outside zone z, on either side of the current route. Best (shorter detour) first."""
    dens, centre = cur._dens, (z["lat"], z["lon"])
    i = int(np.argmin(dist_to(dens, z["lat"], z["lon"])))
    span = max(2, int(z["radius_km"]))
    a, b = dens[max(0, i - span)], dens[min(len(dens) - 1, i + span)]
    brg = bearing(a, b)
    far = (z["radius_km"] + 8) * scale
    pts = [offset(centre, brg + 90, far), offset(centre, brg - 90, far)]
    wa, wb = dens[max(0, i - 2 * span)], dens[min(len(dens) - 1, i + 2 * span)]
    return sorted(pts, key=lambda p: haversine_km(wa, p) + haversine_km(p, wb))


async def plan(origin: dict, dest: dict, mode: str, avoid: bool, zones: list[dict], client: Optional[httpx.AsyncClient] = None) -> dict:
    o, d = (origin["lat"], origin["lon"]), (dest["lat"], dest["lon"])
    if haversine_km(o, d) < 0.3:
        raise RoutingError("Origin and destination are the same place.")
    own = client is None
    client = client or httpx.AsyncClient(timeout=35, headers=UA)
    sem = asyncio.Semaphore(2)
    try:
        active = [z for z in zones if z["active"]]
        endpoint = [z for z in active if contains(z, o) or contains(z, d)]
        avoidable = [z for z in active if z not in endpoint]

        async def get(pts, alternatives=False, steps=False) -> list[Cand]:
            async with sem:
                raw = await _osrm(client, mode, pts, alternatives, steps)
            out = [_parse(r, pts[1:-1]) for r in raw]
            for c in out:
                evaluate(c, avoidable)
            return out

        base = await get([o, d], alternatives=True, steps=True)
        fast = base[0]
        notes: list[str] = []
        safe = fast
        if avoid and fast.hits:
            cap = fast.duration_s * MAX_DETOUR_FACTOR
            pool = [c for c in base if c.duration_s <= cap]
            safe = min(pool, key=lambda c: c.key)
            vias: dict = {}
            scale: dict = {}
            cur = safe
            for _ in range(MAX_ROUNDS):
                if not cur.hits:
                    break
                variants = []
                for k in (0, 1):
                    v = dict(vias)
                    for h in cur.hits:
                        v[h["id"]] = _candidate_vias(h, cur, scale.get(h["id"], 1.15))[k]
                    variants.append(v)
                res = await asyncio.gather(*[get([o, *_order_vias(v, o, d), d]) for v in variants], return_exceptions=True)
                ok = [(r[0], v) for r, v in zip(res, variants) if not isinstance(r, Exception) and r[0].duration_s <= cap]
                if not ok:
                    for h in cur.hits:
                        scale[h["id"]] = scale.get(h["id"], 1.15) * 1.35
                    continue
                pick, pv = min(ok, key=lambda t: t[0].key)
                for h in pick.hits:
                    scale[h["id"]] = scale.get(h["id"], 1.15) * 1.35
                if pick.key < cur.key:
                    cur, vias = pick, pv
                if pick.key < safe.key:
                    safe = pick
            if safe.vias:  # fetch turn-by-turn for the final detour
                try:
                    full = await get([o, *safe.vias, d], steps=True)
                    full[0].vias = safe.vias
                    if full[0].key <= safe.key:
                        safe = full[0]
                except Exception:
                    pass
        routes = []
        if avoid and fast.hits and safe is not fast:
            routes.append(_out(safe, "safe", "Safer route"))
            routes.append(_out(fast, "fast", "Fastest route"))
            n_fast, n_safe = len(fast.hits), len(safe.hits)
            pl = lambda n: f"{n} hazard zone" + ("" if n == 1 else "s")
            if n_safe == 0:
                notes.append(f"Goes around {'the' if n_fast == 1 else 'all'} {pl(n_fast)} on the fastest route: +{safe.distance_m / 1000 - fast.distance_m / 1000:.0f} km, +{(safe.duration_s - fast.duration_s) / 60:.0f} min.")
            else:
                notes.append(f"Could not fully avoid every zone. The safer route crosses {n_safe} instead of {n_fast}.")
        else:
            routes.append(_out(fast, "fast", "Fastest route" if not avoid else "Best route"))
            if avoid and not fast.hits:
                notes.append("No active hazard zone on the fastest route.")
            elif avoid:
                notes.append(f"Could not find a way around the {len(fast.hits)} zone{'' if len(fast.hits) == 1 else 's'} on this route within a reasonable detour.")
            if not avoid:
                routes += [_out(c, "alt", "Alternative") for c in base[1:3]]
        if endpoint:
            names = ", ".join(z["name"] for z in endpoint[:3]) + (f" and {len(endpoint) - 3} more" if len(endpoint) > 3 else "")
            notes.append(f"Your start or destination is inside {names}. Zones around the start or end can't be avoided.")
        return {"mode": mode, "avoid": avoid, "routes": routes, "notes": notes, "endpoint_zones": [z["id"] for z in endpoint]}
    finally:
        if own:
            await client.aclose()


def _out(c: Cand, kind: str, label: str) -> dict:
    steps = [{k: s[k] for k in ("text", "distance_m", "road")} for s in c.steps if s["distance_m"] >= 50 or s["text"].startswith(("Arrive", "Head"))]
    return {"kind": kind, "label": label, "via": _via_text(c.steps), "distance_km": round(c.distance_m / 1000, 1),
            "duration_min": round(c.duration_s / 60), "geometry": thin(c.coords), "steps": steps,
            "hazards": [{k: h[k] for k in ("id", "name", "type", "category", "severity", "km_inside", "lat", "lon", "radius_km")} for h in c.hits],
            "hazard_km": c.hazard_km, "exposure": c.exposure, "fully_avoided": not c.hits}
