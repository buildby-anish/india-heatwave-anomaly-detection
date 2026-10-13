import asyncio
import json
from typing import Literal, Optional

import joblib
import numpy as np
import pandas as pd
import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import auth, hazards, ml, routing
from .config import ART, DISCLAIMER, HAZARD_PATH, SEVERITY_ORDER, SOURCE_LABEL, SVM_FEATURES
from .data import load_validate

PUBLIC = {"/api/health", "/api/auth/login", "/docs", "/redoc", "/openapi.json"}
USER_PATHS = {"/api/auth/me", "/api/cities", "/api/route", "/api/geocode", "/api/hazards/stream"}


def guard(request: Request):
    """Role check for every request. Public: health + login. Tourist or admin: hazards (read), routing, search.
    Everything else (dashboards, model, hazard edits) is admin only. The SSE stream can't send headers, so ?token= works too."""
    path = request.url.path
    if request.method == "OPTIONS" or path in PUBLIC:
        return
    h = request.headers.get("authorization", "")
    user = auth.read_token(h[7:] if h.lower().startswith("bearer ") else request.query_params.get("token"))
    if not user:
        raise HTTPException(401, "Sign in required")
    request.state.user = user
    user_level = path in USER_PATHS or (path == "/api/hazards" and request.method == "GET")
    if not user_level and user["role"] != "admin":
        raise HTTPException(403, "Admin access required")


app = FastAPI(title="India Heatwave Severity & Anomaly Detection API", version="2.0", dependencies=[Depends(guard)])
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

STATE: dict = {}
VIEWERS = {"tourist": 0, "admin": 0}


def _ensure_artifacts():
    if not (ART / "metrics.json").exists() or not (ART / "svm_pipeline.joblib").exists():
        ml.main()  # first run: train once, then cached on disk


@app.on_event("startup")
def startup():
    df, report = load_validate()
    _ensure_artifacts()
    scores = pd.read_csv(ART / "if_scores.csv")
    df = df.merge(scores, on="record_id", how="left")
    df["sev_rank"] = df.heatwave_severity.cat.codes
    STATE.update(df=df, report=report, metrics=json.loads((ART / "metrics.json").read_text()),
                 model=joblib.load(ART / "svm_pipeline.joblib"))
    flagged = df[df.heatwave_severity >= "High"].groupby("date").city.nunique()
    STATE["suggested_date"] = str(flagged.idxmax().date()) if len(flagged) else report["date_max"]
    STATE["hazard_date"] = hazards.pick_seed_date(df)
    STATE["hazards"] = hazards.HazardStore(HAZARD_PATH, lambda: hazards.dataset_zones(df, STATE["hazard_date"]) + hazards.demo_zones())


def _df(cities: Optional[str], start: Optional[str], end: Optional[str], severity: Optional[str] = None,
        region: Optional[str] = None) -> pd.DataFrame:
    df = STATE["df"]
    m = pd.Series(True, index=df.index)
    if cities:
        m &= df.city.isin([c.strip() for c in cities.split(",")])
    if region:
        m &= df.region == region
    if start:
        m &= df.date >= pd.to_datetime(start, errors="coerce")
    if end:
        m &= df.date <= pd.to_datetime(end, errors="coerce")
    if severity:
        m &= df.heatwave_severity.astype(str).isin(severity.split(","))
    return df[m]


@app.get("/api/health")
def health():
    return {"status": "ok", "rows": len(STATE["df"]), "source": SOURCE_LABEL}


@app.get("/api/dataset/summary")
def dataset_summary():
    df, r = STATE["df"], STATE["report"]
    return {**r, "source": SOURCE_LABEL, "cities_list": sorted(df.city.unique()),
            "regions": sorted(df.region.unique()), "severity_order": SEVERITY_ORDER,
            "suggested_alert_date": STATE["suggested_date"],
            "severity_counts": df.heatwave_severity.astype(str).value_counts().reindex(SEVERITY_ORDER).to_dict()}


@app.get("/api/map")
def map_points(start: Optional[str] = None, end: Optional[str] = None, cities: Optional[str] = None,
               region: Optional[str] = None):
    d = _df(cities, start, end, None, region)
    if d.empty:
        return {"points": [], "message": "No records for this selection."}
    out = []
    for city, g in d.groupby("city"):
        peak = g.loc[g.max_temp_c.idxmax()]
        out.append({
            "city": city, "state": g.state.iloc[0], "region": g.region.iloc[0],
            "lat": float(g.latitude.iloc[0]), "lon": float(g.longitude.iloc[0]), "days": int(len(g)),
            "peak_severity": SEVERITY_ORDER[int(g.sev_rank.max())], "peak_max_temp_c": float(peak.max_temp_c),
            "peak_date": str(peak.date.date()), "mean_max_temp_c": round(float(g.max_temp_c.mean()), 2),
            "mean_risk_score": round(float(g.heat_risk_score.mean()), 1),
            "max_risk_score": round(float(g.heat_risk_score.max()), 1),
            "heatwave_days": int(g.heatwave_flag.sum()),
            "labelled_anomalies": int(g.is_anomaly.sum()), "iforest_flags": int(g.if_flag.sum()),
            "agreement": int(((g.is_anomaly == 1) & (g.if_flag == 1)).sum()),
        })
    return {"points": out, "message": None, "source": SOURCE_LABEL}


@app.get("/api/cities/{city}")
def city_detail(city: str, start: Optional[str] = None, end: Optional[str] = None):
    d = _df(city, start, end)
    if d.empty:
        raise HTTPException(404, f"No data for city '{city}'")
    return {"city": city, "state": d.state.iloc[0], "region": d.region.iloc[0], "records": int(len(d)),
            "severity_counts": d.heatwave_severity.astype(str).value_counts().reindex(SEVERITY_ORDER, fill_value=0).to_dict(),
            "max_temp_c": float(d.max_temp_c.max()), "mean_risk_score": round(float(d.heat_risk_score.mean()), 1)}


@app.get("/api/analytics/trend")
def trend(cities: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
          freq: str = Query("M", pattern="^(D|W|M)$")):
    d = _df(cities, start, end)
    if d.empty:
        return {"series": [], "cities": []}
    sel = d.city.unique().tolist()
    if len(sel) > 6:  # keep charts legible
        sel = sel[:6]
        d = d[d.city.isin(sel)]
    p = (d.set_index("date").groupby("city").resample({"D": "D", "W": "W", "M": "ME"}[freq])
         .agg(max_temp=("max_temp_c", "max"), risk=("heat_risk_score", "mean")).reset_index())
    rows = {}
    for r in p.itertuples():
        row = rows.setdefault(str(r.date.date()), {"date": str(r.date.date())})
        row[r.city] = None if np.isnan(r.max_temp) else round(float(r.max_temp), 1)
        row[f"{r.city}__risk"] = None if np.isnan(r.risk) else round(float(r.risk), 1)
    return {"series": list(rows.values()), "cities": sel}


@app.get("/api/analytics/city-comparison")
def city_comparison(start: Optional[str] = None, end: Optional[str] = None, region: Optional[str] = None):
    d = _df(None, start, end, None, region)
    g = d.groupby("city").agg(
        mean_max_temp=("max_temp_c", "mean"), peak_temp=("max_temp_c", "max"), mean_risk=("heat_risk_score", "mean"),
        heatwave_days=("heatwave_flag", "sum"), anomalies=("is_anomaly", "sum"), if_flags=("if_flag", "sum"),
        humidity=("relative_humidity_pct", "mean")).round(2).reset_index()
    return {"rows": g.sort_values("mean_risk", ascending=False).to_dict("records")}


@app.get("/api/analytics/monthly")
def monthly(cities: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None):
    d = _df(cities, start, end)
    g = d.groupby(d.date.dt.month).agg(heatwave_days=("heatwave_flag", "sum"), mean_temp=("max_temp_c", "mean"),
                                       anomalies=("is_anomaly", "sum")).reset_index()
    g.columns = ["month", "heatwave_days", "mean_temp", "anomalies"]
    return {"rows": g.round(2).to_dict("records")}


@app.get("/api/analytics/severity-distribution")
def sev_dist(cities: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None):
    d = _df(cities, start, end)
    c = d.heatwave_severity.astype(str).value_counts().reindex(SEVERITY_ORDER, fill_value=0)
    return {"rows": [{"severity": k, "count": int(v)} for k, v in c.items()]}


@app.get("/api/analytics/scatter")
def scatter(cities: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
            limit: int = Query(1500, le=5000)):
    d = _df(cities, start, end)
    d = d.sample(min(limit, len(d)), random_state=0) if len(d) else d
    return {"rows": [{"temp": float(r.max_temp_c), "humidity": float(r.relative_humidity_pct),
                      "severity": str(r.heatwave_severity), "city": r.city} for r in d.itertuples()],
            "note": f"Random sample of up to {limit} records."}


@app.get("/api/analytics/correlation")
def correlation(cities: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None):
    cols = ["max_temp_c", "min_temp_c", "relative_humidity_pct", "rainfall_mm", "wind_speed_kmh", "uv_index",
            "heat_index_est_c"]
    d = _df(cities, start, end)
    if len(d) < 3:
        return {"cols": cols, "matrix": []}
    return {"cols": cols, "matrix": d[cols].corr().round(2).fillna(0).values.tolist()}


@app.get("/api/anomalies")
def anomalies(cities: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
              mode: str = Query("either", pattern="^(label|iforest|both|either)$"),
              anomaly_type: Optional[str] = None, page: int = Query(1, ge=1), page_size: int = Query(25, le=200),
              sort: str = Query("if_score")):
    d = _df(cities, start, end)
    L, F = d.is_anomaly == 1, d.if_flag == 1
    d = d[{"label": L, "iforest": F, "both": L & F, "either": L | F}[mode]]
    if anomaly_type:
        d = d[d.anomaly_type == anomaly_type]
    if sort not in ("if_score", "max_temp_c", "date", "anomaly_score_demo"):
        raise HTTPException(400, "Invalid sort field")
    d = d.sort_values(sort, ascending=False)
    total = len(d)
    page_d = d.iloc[(page - 1) * page_size: page * page_size]
    rows = [{"record_id": int(r.record_id), "date": str(r.date.date()), "city": r.city,
             "max_temp_c": r.max_temp_c, "humidity": r.relative_humidity_pct, "rainfall_mm": r.rainfall_mm,
             "wind_kmh": r.wind_speed_kmh, "labelled": bool(r.is_anomaly), "label_type": None if pd.isna(r.anomaly_type) else r.anomaly_type,
             "iforest_flag": bool(r.if_flag), "if_score": float(r.if_score), "severity": str(r.heatwave_severity)}
            for r in page_d.itertuples()]
    return {"total": int(total), "page": page, "page_size": page_size, "rows": rows}


@app.get("/api/alerts")
def alerts(date: Optional[str] = None, min_severity: str = "High", days: int = Query(1, ge=1, le=31)):
    if min_severity not in SEVERITY_ORDER:
        raise HTTPException(400, f"min_severity must be one of {SEVERITY_ORDER}")
    end = pd.to_datetime(date or STATE["suggested_date"], errors="coerce")
    if pd.isna(end):
        raise HTTPException(400, "Invalid date")
    d = _df(None, str((end - pd.Timedelta(days=days - 1)).date()), str(end.date()))
    d = d[(d.sev_rank >= SEVERITY_ORDER.index(min_severity)) | (d.if_flag == 1)]
    d = d.sort_values(["sev_rank", "heat_risk_score"], ascending=False)
    rows = [{"city": r.city, "date": str(r.date.date()), "severity": str(r.heatwave_severity),
             "max_temp_c": r.max_temp_c, "heat_index_c": r.heat_index_est_c, "risk_score": r.heat_risk_score,
             "iforest_flag": bool(r.if_flag), "lat": r.latitude, "lon": r.longitude,
             "advice": _advice(str(r.heatwave_severity))} for r in d.itertuples()]
    return {"date": str(end.date()), "count": len(rows), "alerts": rows, "disclaimer": DISCLAIMER}


def _advice(sev: str) -> str:
    return {"Extreme": "Avoid outdoor activity during daytime; hydrate and seek cooled spaces.",
            "Severe": "Limit outdoor exposure between late morning and late afternoon.",
            "High": "Reduce strenuous outdoor activity; drink water regularly.",
            "Moderate": "Take breaks in shade and stay hydrated.",
            "Low": "Normal precautions."}[sev]


@app.get("/api/model/metrics")
def model_metrics():
    return {**STATE["metrics"], "source": SOURCE_LABEL, "disclaimer": DISCLAIMER}


class PredictIn(BaseModel):
    min_temp_c: float = Field(ge=-10, le=45)
    relative_humidity_pct: float = Field(ge=0, le=100)
    rainfall_mm: float = Field(ge=0, le=500)
    wind_speed_kmh: float = Field(ge=0, le=150)
    uv_index: float = Field(ge=0, le=15)
    latitude: float = Field(ge=6, le=38)
    longitude: float = Field(ge=68, le=98)
    day_of_year: int = Field(ge=1, le=366)


@app.post("/api/model/predict")
def predict(p: PredictIn):
    row = p.model_dump()
    row["doy_sin"] = float(np.sin(2 * np.pi * row["day_of_year"] / 365.25))
    row["doy_cos"] = float(np.cos(2 * np.pi * row["day_of_year"] / 365.25))
    X = pd.DataFrame([row])[SVM_FEATURES]
    pred = STATE["model"].predict(X)[0]
    return {"predicted_severity": pred, "model": "RBF-SVM (temperature-free features)",
            "warning": "Trained on synthetic data with weak features; macro-F1 on hold-out is low. Illustrative only."}


# ------------------------------------------------------------------ auth
class LoginIn(BaseModel):
    username: str
    password: str
    role: Optional[Literal["admin", "tourist"]] = None


@app.post("/api/auth/login")
def login(body: LoginIn):
    u = auth.authenticate(body.username, body.password)
    if not u:
        raise HTTPException(401, "Wrong ID or password")
    if body.role and body.role != u["role"]:
        raise HTTPException(401, f"This is a {u['role']} account. Switch to the {u['role'].title()} tab to sign in.")
    return {"token": auth.make_token(u), **u}


@app.get("/api/auth/me")
def me(request: Request):
    return request.state.user


# ------------------------------------------------------------------ live hazard zones
def _store() -> hazards.HazardStore:
    return STATE["hazards"]


def _payload() -> dict:
    return {**_store().snapshot(), "viewers": dict(VIEWERS), "seed_date": STATE["hazard_date"]}


@app.get("/api/hazards")
def list_hazards():
    return _payload()


async def hazard_events(request: Request, role: str, interval: float = 0.5):
    """Server-sent events: pushes the full zone list whenever it (or the viewer count) changes."""
    VIEWERS[role] = VIEWERS.get(role, 0) + 1
    last, idle = None, 0.0
    try:
        while not await request.is_disconnected():
            p = _payload()
            sig = (p["version"], p["viewers"]["tourist"], p["viewers"]["admin"])
            if sig != last:
                last, idle = sig, 0.0
                yield f"data: {json.dumps(p)}\n\n"
            elif idle >= 15:
                idle = 0.0
                yield ": keep-alive\n\n"
            await asyncio.sleep(interval)
            idle += interval
    finally:
        VIEWERS[role] = max(0, VIEWERS.get(role, 1) - 1)


@app.get("/api/hazards/stream")
async def hazard_stream(request: Request):
    return StreamingResponse(hazard_events(request, request.state.user["role"]), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/hazards", status_code=201)
def create_hazard(body: hazards.HazardIn, request: Request):
    return _store().create(body, request.state.user["username"])


@app.put("/api/hazards/{hid}")
def update_hazard(hid: str, body: hazards.HazardIn, request: Request):
    z = _store().update(hid, body, request.state.user["username"])
    if not z:
        raise HTTPException(404, "Zone not found")
    return z


@app.delete("/api/hazards/{hid}")
def delete_hazard(hid: str):
    if not _store().delete(hid):
        raise HTTPException(404, "Zone not found")
    return {"deleted": hid}


class SyncIn(BaseModel):
    date: Optional[str] = None
    window_days: int = Field(7, ge=1, le=31)


@app.post("/api/hazards/sync")
def sync_hazards(body: SyncIn):
    """Rebuild the dataset-derived zones (heat + Isolation Forest anomalies) for a date. Admin-made zones are kept."""
    date = body.date or STATE["hazard_date"]
    if pd.isna(pd.to_datetime(date, errors="coerce")):
        raise HTTPException(400, "Invalid date")
    zones = hazards.dataset_zones(STATE["df"], date, body.window_days)
    _store().replace_dataset_zones(zones)
    return {"date": date, "created": len(zones), **_store().snapshot()}


@app.post("/api/hazards/reset")
def reset_hazards():
    _store().reset()
    return _payload()


# ------------------------------------------------------------------ tourist: cities, routing, place search
@app.get("/api/cities")
def cities():
    df = STATE["df"]
    day = df[df.date == pd.to_datetime(STATE["hazard_date"])]
    cond = {r.city: r for r in day.itertuples()}
    out = []
    for city, g in df.groupby("city"):
        r = cond.get(city)
        out.append({"city": city, "state": g.state.iloc[0], "region": g.region.iloc[0], "lat": float(g.latitude.iloc[0]),
                    "lon": float(g.longitude.iloc[0]),
                    "demo_date": STATE["hazard_date"], "max_temp_c": float(r.max_temp_c) if r else None,
                    "severity": str(r.heatwave_severity) if r else None})
    return {"cities": out}


class Pt(BaseModel):
    lat: float = Field(ge=5, le=38)
    lon: float = Field(ge=67, le=98)
    name: str = ""


class RouteIn(BaseModel):
    origin: Pt
    destination: Pt
    mode: Literal["car", "bike", "foot"] = "car"
    avoid: bool = True


@app.post("/api/route")
async def route(body: RouteIn):
    try:
        return await routing.plan(body.origin.model_dump(), body.destination.model_dump(), body.mode, body.avoid,
                                  _store().snapshot()["hazards"])
    except routing.RoutingError as e:
        raise HTTPException(502, str(e))


_GEO: dict = {}


@app.get("/api/geocode")
async def geocode(q: str = Query(min_length=2, max_length=80)):
    """Search any place in India (OpenStreetMap Nominatim). Returns [] if the service is unreachable."""
    key = q.strip().lower()
    if key not in _GEO:
        try:
            async with httpx.AsyncClient(timeout=8, headers=routing.UA) as c:
                r = await c.get("https://nominatim.openstreetmap.org/search",
                                params={"q": q, "format": "jsonv2", "countrycodes": "in", "limit": 5, "addressdetails": 0})
                _GEO[key] = [{"name": x["display_name"].split(",")[0], "display": x["display_name"],
                              "lat": float(x["lat"]), "lon": float(x["lon"])} for x in r.json()]
        except Exception:
            return {"results": []}
    return {"results": _GEO[key]}
