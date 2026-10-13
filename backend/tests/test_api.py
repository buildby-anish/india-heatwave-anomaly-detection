import pytest
from fastapi.testclient import TestClient
from app.main import app, STATE


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        tok = c.post("/api/auth/login", json={"username": "admin", "password": "admin123"}).json()["token"]
        c.headers["Authorization"] = f"Bearer {tok}"
        yield c


def test_health_and_summary(client):
    assert client.get("/api/health").json()["rows"] == 58440
    s = client.get("/api/dataset/summary").json()
    assert s["cities"] == 20 and s["source"] == "Synthetic Demo Data" and s["valid"]
    assert "not real historical weather data" in s["disclaimer"]


def test_map_has_all_cities(client):
    pts = client.get("/api/map").json()["points"]
    assert len(pts) == 20 and all(-90 < p["lat"] < 90 for p in pts)


def test_map_empty_range(client):
    r = client.get("/api/map?start=2030-01-01").json()
    assert r["points"] == [] and r["message"]


def test_anomalies_pagination_and_validation(client):
    r = client.get("/api/anomalies?page_size=10&mode=label").json()
    assert len(r["rows"]) == 10 and r["total"] == 1165
    assert client.get("/api/anomalies?sort=bogus").status_code == 400
    assert client.get("/api/anomalies?page_size=9999").status_code == 422


def test_metrics_no_leakage_and_heldout(client):
    m = client.get("/api/model/metrics").json()
    used = set(m["svm"]["features_used"])
    assert not used & {"max_temp_c", "mean_temp_c", "temp_range_c", "heat_index_est_c", "heat_risk_score"}
    sp = m["svm"]["split"]
    assert sp["train_rows"] + sp["test_rows"] == 58440
    assert m["svm"]["leakage_audit"]["macro_f1"] > m["svm"]["rbf_svm_test"]["macro_f1"]


def test_alerts_and_predict(client):
    assert client.get("/api/alerts?min_severity=Nope").status_code == 400
    assert "alerts" in client.get("/api/alerts").json()
    body = dict(min_temp_c=25, relative_humidity_pct=40, rainfall_mm=0, wind_speed_kmh=10, uv_index=9,
                latitude=26.9, longitude=75.8, day_of_year=140)
    assert client.post("/api/model/predict", json=body).json()["predicted_severity"] in STATE["metrics"]["svm"]["rbf_svm_test"]["labels"]
    body["relative_humidity_pct"] = 500
    assert client.post("/api/model/predict", json=body).status_code == 422


def test_analytics(client):
    assert client.get("/api/analytics/trend?cities=Delhi,Jaipur&freq=M").json()["series"]
    assert len(client.get("/api/analytics/city-comparison").json()["rows"]) == 20
    assert client.get("/api/cities/Atlantis").status_code == 404
