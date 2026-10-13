"""Training and evaluation.  Run:  python -m app.ml   (writes backend/artifacts/*)"""
import json
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (accuracy_score, average_precision_score, confusion_matrix, f1_score,
                             precision_recall_fscore_support, precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC, LinearSVC

from .config import (ART, IF_CONTAMINATION, IF_FEATURES, LEAKY_FEATURES, RANDOM_STATE, SEVERITY_ORDER,
                     SVM_FEATURES)
from .data import load_validate


def split(df):
    """Stratified 80/20 hold-out. Test rows are never used for tuning or scaler fitting."""
    return train_test_split(df, test_size=0.2, stratify=df.heatwave_severity.astype(str), random_state=RANDOM_STATE)


def metrics(y, p):
    labels = SEVERITY_ORDER
    pr, rc, f1, sup = precision_recall_fscore_support(y, p, labels=labels, zero_division=0)
    return {
        "accuracy": float(accuracy_score(y, p)),
        "macro_f1": float(f1_score(y, p, average="macro", labels=labels, zero_division=0)),
        "weighted_f1": float(f1_score(y, p, average="weighted", labels=labels, zero_division=0)),
        "per_class": [
            {"class": l, "precision": float(a), "recall": float(b), "f1": float(c), "support": int(d)}
            for l, a, b, c, d in zip(labels, pr, rc, f1, sup)
        ],
        "confusion_matrix": confusion_matrix(y, p, labels=labels).tolist(),
        "labels": labels,
    }


def train_svm(df):
    tr, te = split(df)
    ytr, yte = tr.heatwave_severity.astype(str), te.heatwave_severity.astype(str)
    out = {
        "split": {
            "train_rows": int(len(tr)), "test_rows": int(len(te)), "type": "stratified random 80/20",
            "seed": RANDOM_STATE,
            "train_class_counts": ytr.value_counts().to_dict(), "test_class_counts": yte.value_counts().to_dict(),
        },
        "features_used": SVM_FEATURES,
        "features_excluded": {
            "max_temp_c, mean_temp_c, temp_range_c, heat_index_est_c":
                "severity is a threshold on max_temp_c; these columns reveal it directly or algebraically",
            "heat_risk_score, heatwave_flag, anomaly_score_demo, is_anomaly, anomaly_type":
                "generated together with / from the label",
        },
    }
    # Grid search on a stratified train-only subsample (<=2500 per class) to keep runtime reasonable.
    sub = tr.groupby(tr.heatwave_severity.astype(str), group_keys=False, observed=True).apply(
        lambda g: g.sample(min(len(g), 2500), random_state=1))
    pipe = Pipeline([("scaler", StandardScaler()), ("svm", SVC(kernel="rbf", class_weight="balanced"))])
    grid = {"svm__C": [1, 10, 100], "svm__gamma": ["scale", 0.01, 0.1]}
    t = time.time()
    gs = GridSearchCV(pipe, grid, scoring="f1_macro",
                      cv=StratifiedKFold(5, shuffle=True, random_state=RANDOM_STATE), n_jobs=-1)
    gs.fit(sub[SVM_FEATURES], sub.heatwave_severity.astype(str))
    best = gs.best_params_
    final = Pipeline([
        ("scaler", StandardScaler()),
        ("svm", SVC(kernel="rbf", class_weight="balanced", C=best["svm__C"], gamma=best["svm__gamma"])),
    ]).fit(tr[SVM_FEATURES], ytr)
    out["tuning"] = {
        "method": "GridSearchCV, 5-fold macro-F1, on a stratified TRAIN-only subsample",
        "best_params": {k: str(v) for k, v in best.items()},
        "cv_macro_f1": float(gs.best_score_), "seconds": round(time.time() - t, 1),
    }
    out["rbf_svm_test"] = metrics(yte, final.predict(te[SVM_FEATURES]))

    lin = Pipeline([("scaler", StandardScaler()), ("svm", LinearSVC(class_weight="balanced", max_iter=5000))])
    lin.fit(tr[SVM_FEATURES], ytr)
    out["linear_svm_test"] = metrics(yte, lin.predict(te[SVM_FEATURES]))
    out["majority_baseline_test"] = metrics(yte, np.array(["Low"] * len(yte)))

    leak = Pipeline([("scaler", StandardScaler()),
                     ("svm", SVC(kernel="rbf", C=10, gamma="scale", class_weight="balanced"))])
    leak.fit(tr[LEAKY_FEATURES], ytr)
    lm = metrics(yte, leak.predict(te[LEAKY_FEATURES]))
    out["leakage_audit"] = {
        "features": LEAKY_FEATURES, "macro_f1": lm["macro_f1"], "accuracy": lm["accuracy"],
        "explanation": ("Near-perfect because severity is DEFINED by max_temp_c cut-offs (37/40/42/45 C). "
                        "The model only re-learns the labelling rule. This is not forecasting skill and is "
                        "not used anywhere else in the app."),
    }
    out["notes"] = [
        "Test set was never used for tuning or for fitting the scaler.",
        "Labels are synthetic rule outputs; scores are not evidence of real-world accuracy.",
        "With temperature inputs removed, the remaining variables carry little information about severity, "
        "so weak minority-class scores are expected and are reported as-is.",
    ]
    joblib.dump(final, ART / "svm_pipeline.joblib")
    return out


def run_iforest(df):
    """Isolation Forest on per-city, per-month standardised deviations. Labels are NOT used to fit it."""
    X = df[IF_FEATURES].copy()
    key = [df.city, df.date.dt.month]
    for c in IF_FEATURES:
        g = df.groupby(key)[c]
        X[c] = (df[c] - g.transform("median")) / g.transform("std").replace(0, np.nan)
    X = X.fillna(0)
    iso = IsolationForest(n_estimators=300, contamination=IF_CONTAMINATION,
                          random_state=RANDOM_STATE, n_jobs=-1).fit(X)
    raw = -iso.score_samples(X)
    score = 100 * (raw - raw.min()) / (raw.max() - raw.min())
    pred = (iso.predict(X) == -1).astype(int)
    y = df.is_anomaly.values
    m = {
        "contamination_assumed": IF_CONTAMINATION, "features": IF_FEATURES,
        "baseline": "per-city, per-calendar-month median and std",
        "flagged": int(pred.sum()), "labelled_anomalies": int(y.sum()),
        "precision": float(precision_score(y, pred)), "recall": float(recall_score(y, pred)),
        "f1": float(f1_score(y, pred)), "roc_auc": float(roc_auc_score(y, raw)),
        "pr_auc": float(average_precision_score(y, raw)),
        "confusion_matrix": confusion_matrix(y, pred).tolist(), "confusion_labels": ["normal", "anomaly"],
        "by_type": {},
        "caveat": ("Contamination (2%) is a fixed assumption that happens to be close to the label rate (~2.0%); "
                   "it was not tuned on labels. Labels are synthetic injected outliers, so agreement is a "
                   "sanity check, not real-world validation."),
    }
    for t, idx in df[df.is_anomaly == 1].groupby("anomaly_type").groups.items():
        pos = df.index.get_indexer(idx)
        m["by_type"][t] = {"count": int(len(pos)), "recall": float(pred[pos].mean())}
    return m, score, pred


def main():
    df, rep = load_validate()
    svm = train_svm(df)
    iso, score, pred = run_iforest(df)
    (ART / "metrics.json").write_text(json.dumps({"svm": svm, "isolation_forest": iso, "validation": rep}, indent=1))
    pd.DataFrame({"record_id": df.record_id, "if_score": score.round(2), "if_flag": pred}).to_csv(
        ART / "if_scores.csv", index=False)
    print(json.dumps({
        "svm_macro_f1": svm["rbf_svm_test"]["macro_f1"], "linear_macro_f1": svm["linear_svm_test"]["macro_f1"],
        "majority_macro_f1": svm["majority_baseline_test"]["macro_f1"], "leak_macro_f1": svm["leakage_audit"]["macro_f1"],
        "best": svm["tuning"]["best_params"],
        "iforest": {k: iso[k] for k in ("precision", "recall", "f1", "roc_auc")}, "by_type": iso["by_type"],
    }, indent=1))


if __name__ == "__main__":
    main()
