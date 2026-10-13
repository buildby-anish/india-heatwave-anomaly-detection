"""Auth, live hazard zones, and the hazard-avoiding route planner (OSRM is mocked: roads = straight lines)."""
import asyncio
import json
import math

import httpx
import pytest
from fastapi.testclient import TestClient

from app import routing

routing.MIN_INTERVAL = 0
from app.main import app, hazard_events


def login(c, user, pw, role=None):
    return c.post("/api/auth/login", json={"username": user, "password": pw, "role": role})


@pytest.fixture(scope="module")
def clients():
    with TestClient(app) as anon:
        out = {"anon": anon}
        for role, pw in (("admin", "admin123"), ("tourist", "tourist123")):
            c = TestClient(app)
            c.headers["Authorization"] = "Bearer " + login(anon, role, pw).json()["token"]
            out[role] = c
        yield out


def test_login_rules(clients):
    a = clients["anon"]
    assert login(a, "admin", "admin123", "admin").status_code == 200
    assert login(a, "admin", "nope").status_code == 401
    r = login(a, "tourist", "tourist123", "admin")
    assert r.status_code == 401 and "Tourist" in r.json()["detail"]


def test_roles_are_enforced(clients):
    assert clients["anon"].get("/api/hazards").status_code == 401
    assert clients["anon"].get("/api/health").status_code == 200
    t, a = clients["tourist"], clients["admin"]
    assert t.get("/api/hazards").status_code == 200
    assert t.get("/api/cities").json()["cities"].__len__() == 20
    assert t.get("/api/map").status_code == 403          # dashboards are admin only
    assert t.delete("/api/hazards/x").status_code == 403
    assert a.get("/api/map").status_code == 200
    assert clients["anon"].get("/api/hazards?token=garbage").status_code == 401


def test_seed_has_many_zones_of_each_kind(clients):
    hz = clients["tourist"].get("/api/hazards").json()["hazards"]
    types = {h["type"] for h in hz}
    assert types == {"heatwave", "anomaly", "risk"} and len(hz) >= 12
    assert {"dataset", "demo"} <= {h["source"] for h in hz}


def test_admin_edit_is_saved_and_versioned(clients):
    a, t = clients["admin"], clients["tourist"]
    v0 = t.get("/api/hazards").json()["version"]
    body = dict(name="Test flood", type="risk", category="Flood", severity="Severe", lat=22.0, lon=79.0, radius_km=30, note="x")
    z = a.post("/api/hazards", json=body)
    assert z.status_code == 201
    zid = z.json()["id"]
    snap = t.get("/api/hazards").json()
    assert snap["version"] > v0 and any(h["id"] == zid for h in snap["hazards"])
    body.update(radius_km=45, active=False)
    assert a.put(f"/api/hazards/{zid}", json=body).json()["radius_km"] == 45
    assert not [h for h in t.get("/api/hazards").json()["hazards"] if h["id"] == zid][0]["active"]
    assert a.post("/api/hazards", json={**body, "radius_km": 0}).status_code == 422
    assert a.delete(f"/api/hazards/{zid}").status_code == 200
    assert a.delete(f"/api/hazards/{zid}").status_code == 404


def test_sync_replaces_only_dataset_zones(clients):
    a = clients["admin"]
    mine = a.post("/api/hazards", json=dict(name="Keep me", type="anomaly", severity="High", lat=20, lon=78, radius_km=20)).json()["id"]
    r = a.post("/api/hazards/sync", json={"date": "2022-06-03"}).json()
    assert r["created"] > 0 and any(h["id"] == mine for h in r["hazards"])
    a.delete(f"/api/hazards/{mine}")


def test_sse_pushes_on_change(clients):
    a = clients["admin"]

    class Req:
        n = 0
        async def is_disconnected(self):
            self.n += 1
            return self.n > 40

    async def run():
        gen = hazard_events(Req(), "tourist", interval=0.01)
        first = json.loads((await gen.__anext__())[6:])
        assert first["viewers"]["tourist"] == 1
        a.post("/api/hazards", json=dict(name="Live one", type="risk", severity="Low", lat=21, lon=79, radius_km=10))
        second = json.loads((await gen.__anext__())[6:])
        await gen.aclose()
        return first, second

    first, second = asyncio.run(run())
    assert second["version"] > first["version"] and any(h["name"] == "Live one" for h in second["hazards"])


# ------------------------------------------------------------------ route planner with a fake OSRM
def fake_osrm(request: httpx.Request) -> httpx.Response:
    coords = [tuple(map(float, p.split(","))) for p in request.url.path.split("/")[-1].split(";")]
    pts = [[lon, lat] for lon, lat in coords]
    km = sum(routing.haversine_km((a[1], a[0]), (b[1], b[0])) for a, b in zip(pts, pts[1:]))
    steps = [{"distance": km * 1000, "duration": km * 60, "name": "NH 44", "ref": "NH 44", "maneuver": {"type": "depart", "bearing_after": 10}},
             {"distance": 0, "duration": 0, "name": "", "maneuver": {"type": "arrive"}}]
    return httpx.Response(200, json={"code": "Ok", "routes": [{"distance": km * 1000, "duration": km * 60, "geometry": {"coordinates": pts},
                                                                 "legs": [{"steps": steps}]}]})


def zone(id_, lat, lon, r, **kw):
    return dict(id=id_, name=id_, type="heatwave", category="", severity="Extreme", lat=lat, lon=lon, radius_km=r, active=True, **kw)


def run_plan(zones, avoid=True, o=(28.61, 77.21), d=(26.91, 75.79)):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(fake_osrm)) as c:
            return await routing.plan({"lat": o[0], "lon": o[1]}, {"lat": d[0], "lon": d[1]}, "car", avoid, zones, client=c)
    routing._CACHE.clear()
    return asyncio.run(go())


def test_fast_route_crosses_zone_safe_route_does_not():
    r = run_plan([zone("mid", 27.76, 76.50, 25)])
    safe, fast = r["routes"]
    assert safe["kind"] == "safe" and fast["kind"] == "fast"
    assert fast["hazards"] and fast["hazard_km"] > 10 and fast["exposure"]
    assert safe["hazards"] == [] and safe["fully_avoided"] and safe["exposure"] == []
    assert 0 < safe["distance_km"] - fast["distance_km"] < 40      # a modest detour
    assert safe["via"] == "via NH 44"


def test_many_zones_all_avoided():
    zs = [zone("a", 28.20, 76.85, 15), zone("b", 27.60, 76.30, 18), zone("c", 27.10, 76.00, 12)]
    r = run_plan(zs)
    assert len(r["routes"][1]["hazards"]) == 3 and r["routes"][0]["hazards"] == []


def test_avoid_off_returns_fast_only_and_inactive_zones_ignored():
    r = run_plan([zone("mid", 27.76, 76.50, 25)], avoid=False)
    assert r["routes"][0]["kind"] == "fast" and r["routes"][0]["hazards"]
    z = zone("mid", 27.76, 76.50, 25); z["active"] = False
    r = run_plan([z])
    assert len(r["routes"]) == 1 and r["routes"][0]["hazards"] == []


def test_endpoint_zone_is_reported_not_avoided():
    r = run_plan([zone("delhi", 28.61, 77.21, 40)])
    assert r["endpoint_zones"] == ["delhi"] and len(r["routes"]) == 1 and r["routes"][0]["hazards"] == []
    assert any("can't be avoided" in n for n in r["notes"])


def test_same_point_rejected():
    with pytest.raises(routing.RoutingError):
        run_plan([], o=(28.61, 77.21), d=(28.611, 77.211))


def test_geometry_helpers():
    import numpy as np
    c = routing.densify(np.array([[0.0, 0.0], [0.0, 0.5]]), 1.0)
    assert len(c) > 50 and abs(routing.haversine_km((0, 0), (0, 1)) - 111.19) < 0.2
    assert abs(routing.haversine_km((10, 70), routing.offset((10, 70), 90, 30)) - 30) < 0.1
