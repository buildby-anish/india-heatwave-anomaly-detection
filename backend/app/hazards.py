"""Hazard zones (heatwave / AI anomaly / other risk): persistent store + seed data.

A zone is a circle on the map. Every *active* zone is something the route planner avoids.
Sources: "dataset" (derived from the synthetic CSV + Isolation Forest flags), "demo" (hand placed so the
routing demo has something to avoid), "admin" (created/edited in the admin panel).
"""
import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

import pandas as pd
from pydantic import BaseModel, Field

from .config import SEVERITY_ORDER

Severity = Literal["Low", "Moderate", "High", "Severe", "Extreme"]
HazardType = Literal["heatwave", "anomaly", "risk"]
RADIUS_BY_SEV = {"High": 25, "Severe": 35, "Extreme": 50}


class HazardIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: HazardType
    category: str = Field(default="", max_length=40)  # free label, e.g. "Flood", "Dust storm"
    severity: Severity = "High"
    lat: float = Field(ge=5, le=38)
    lon: float = Field(ge=67, le=98)
    radius_km: float = Field(ge=3, le=300)
    active: bool = True
    note: str = Field(default="", max_length=400)


# Hand-placed zones along real highway corridors so the "route avoids hazards" demo has visible detours.
DEMO_ZONES = [
    ("demo-behror", "Behror-Kotputli heat belt", "heatwave", "Extreme", 27.80, 76.25, 28, "On the Delhi-Jaipur highway corridor."),
    ("demo-mathura", "Mathura-Agra corridor heat", "heatwave", "Severe", 27.55, 77.70, 22, "Delhi-Agra expressway corridor."),
    ("demo-ludhiana", "Ludhiana unusual-weather flag", "anomaly", "Severe", 30.88, 75.90, 22, "Isolation Forest style anomaly on the Delhi-Amritsar corridor."),
    ("demo-adilabad", "Adilabad-Nirmal heat belt", "heatwave", "Severe", 19.40, 78.40, 30, "Nagpur-Hyderabad corridor."),
    ("demo-gooty", "Gooty-Kurnool heat belt", "heatwave", "Extreme", 15.25, 77.75, 30, "Hyderabad-Bengaluru corridor."),
    ("demo-vellore", "Vellore-Ambur anomaly", "anomaly", "High", 12.80, 78.85, 22, "Chennai-Bengaluru corridor."),
    ("demo-belagavi", "Kolhapur-Belagavi heat belt", "heatwave", "Severe", 16.45, 74.45, 28, "Pune-Bengaluru corridor."),
    ("demo-ajmer", "Ajmer-Beawar dust storm", "risk", "High", 26.20, 74.35, 25, "Jaipur-Jodhpur corridor. Example of a non-heat risk."),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def pick_seed_date(df: pd.DataFrame, window: int = 7) -> str:
    """Date whose trailing window has the most High+ cities plus Isolation Forest flags."""
    hi = (df.heatwave_severity >= "High").astype(int)
    p = pd.DataFrame({"date": df.date, "city": df.city, "s": hi + df.if_flag.fillna(0).astype(int).clip(0, 1)})
    piv = p.pivot_table(index="date", columns="city", values="s", aggfunc="max").fillna(0).rolling(window, min_periods=1).max()
    return str(piv.sum(axis=1).idxmax().date())


def dataset_zones(df: pd.DataFrame, date: str, window: int = 7) -> list[dict]:
    end = pd.to_datetime(date)
    d = df[(df.date > end - pd.Timedelta(days=window)) & (df.date <= end)]
    out = []
    for city, g in d.groupby("city"):
        lat, lon = float(g.latitude.iloc[0]), float(g.longitude.iloc[0])
        peak = SEVERITY_ORDER[int(g.sev_rank.max())] if "sev_rank" in g else str(g.heatwave_severity.max())
        if peak in RADIUS_BY_SEV:
            t = float(g.max_temp_c.max())
            out.append(_zone(f"ds-heat-{city}", f"{city} heat zone", "heatwave", "", peak, lat, lon, RADIUS_BY_SEV[peak],
                             f"Peak {t:.1f} C in the {window} days to {date} (synthetic dataset).", "dataset"))
        flags = int(g.if_flag.fillna(0).sum())
        if flags:
            out.append(_zone(f"ds-anom-{city}", f"{city} anomaly", "anomaly", "AI anomaly", "High" if flags < 3 else "Severe", lat, lon,
                             min(18 + 4 * flags, 38), f"Isolation Forest flagged {flags} day(s) in the {window} days to {date} (synthetic dataset).", "dataset"))
    return out


def _zone(id_, name, type_, category, severity, lat, lon, r, note, source, active=True) -> dict:
    return {"id": id_, "name": name, "type": type_, "category": category, "severity": severity, "lat": lat, "lon": lon,
            "radius_km": r, "active": active, "note": note, "source": source, "updated_at": _now(), "updated_by": "system"}


def demo_zones() -> list[dict]:
    return [_zone(i, n, t, "", s, la, lo, r, note, "demo") for i, n, t, s, la, lo, r, note in DEMO_ZONES]


class HazardStore:
    def __init__(self, path, seed_fn):
        self.path, self.seed_fn, self.lock = path, seed_fn, threading.RLock()
        self.version, self.hazards = 0, []
        if path.exists():
            d = json.loads(path.read_text())
            self.version, self.hazards = d["version"], d["hazards"]
        else:
            self.reset()

    def _save(self):
        self.version += 1
        self.path.write_text(json.dumps({"version": self.version, "hazards": self.hazards}, indent=1))

    def reset(self):
        with self.lock:
            self.hazards = self.seed_fn()
            self._save()

    def snapshot(self) -> dict:
        with self.lock:
            return {"version": self.version, "hazards": list(self.hazards)}

    def active(self) -> list[dict]:
        with self.lock:
            return [h for h in self.hazards if h["active"]]

    def create(self, data: HazardIn, user: str) -> dict:
        with self.lock:
            z = {**data.model_dump(), "id": "hz-" + uuid.uuid4().hex[:8], "source": "admin", "updated_at": _now(), "updated_by": user}
            self.hazards.append(z)
            self._save()
            return z

    def update(self, id_: str, data: HazardIn, user: str) -> Optional[dict]:
        with self.lock:
            for i, h in enumerate(self.hazards):
                if h["id"] == id_:
                    src = h["source"] if h["source"] == "admin" else h["source"] + "+edited"
                    self.hazards[i] = {**h, **data.model_dump(), "source": src, "updated_at": _now(), "updated_by": user}
                    self._save()
                    return self.hazards[i]
        return None

    def delete(self, id_: str) -> bool:
        with self.lock:
            n = len(self.hazards)
            self.hazards = [h for h in self.hazards if h["id"] != id_]
            if len(self.hazards) != n:
                self._save()
            return len(self.hazards) != n

    def replace_dataset_zones(self, zones: list[dict]):
        with self.lock:
            self.hazards = [h for h in self.hazards if h["source"] != "dataset"] + zones
            self._save()
