from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .config import DATA_PATH, DISCLAIMER, REQUIRED, SEVERITY_ORDER, SOURCE_LABEL


def load_validate(path=DATA_PATH):
    df = pd.read_csv(path, parse_dates=["date"])
    missing_cols = [c for c in REQUIRED if c not in df.columns]
    if missing_cols:
        raise ValueError(f"Missing required columns: {missing_cols}")

    report = {
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "date_min": str(df.date.min().date()),
        "date_max": str(df.date.max().date()),
        "cities": int(df.city.nunique()),
        "duplicate_city_dates": int(df.duplicated(["city", "date"]).sum()),
        "missing_values": {c: int(v) for c, v in df.isna().sum().items() if v > 0},
        "missing_note": "anomaly_type is empty by design for non-anomalous rows.",
        "bad_lat_lon": int((~df.latitude.between(6, 38) | ~df.longitude.between(68, 98)).sum()),
        "unknown_severity": int((~df.heatwave_severity.isin(SEVERITY_ORDER)).sum()),
        "source": SOURCE_LABEL,
        "is_synthetic_all": bool(df["is_synthetic"].all()) if "is_synthetic" in df else True,
        "disclaimer": DISCLAIMER,
        "loaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schema": {c: str(t) for c, t in df.dtypes.items()},
    }
    report["valid"] = (
        report["duplicate_city_dates"] == 0 and report["bad_lat_lon"] == 0 and report["unknown_severity"] == 0
    )

    doy = df.date.dt.dayofyear
    df["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    df["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
    df["heatwave_severity"] = pd.Categorical(df.heatwave_severity, SEVERITY_ORDER, ordered=True)
    return df, report
