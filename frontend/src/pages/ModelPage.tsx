import { useState } from "react";
import { api, errMsg } from "../api";
import Confusion from "../components/Confusion";
import { ErrorBox, Loading, Panel, Stat, useFetch } from "../components/ui";

interface M { accuracy: number; macro_f1: number; weighted_f1: number; per_class: { class: string; precision: number; recall: number; f1: number; support: number }[]; confusion_matrix: number[][]; labels: string[] }
const f3 = (x: number) => x.toFixed(3);
export default function ModelPage() {
  const { data, loading, error } = useFetch(() => api.get("/api/model/metrics").then((r) => r.data), []);
  const [form, setForm] = useState({ min_temp_c: 26, relative_humidity_pct: 35, rainfall_mm: 0, wind_speed_kmh: 10, uv_index: 9, latitude: 26.9, longitude: 75.8, day_of_year: 140 });
  const [pred, setPred] = useState(""); const [perr, setPerr] = useState("");
  if (loading) return <Loading />; if (error || !data) return <ErrorBox msg={error || "No metrics"} />;
  const s = data.svm; const rbf: M = s.rbf_svm_test; const lin: M = s.linear_svm_test; const maj: M = s.majority_baseline_test;
  const run = async () => { setPerr(""); setPred(""); try { const r = await api.post("/api/model/predict", form); setPred(r.data.predicted_severity); } catch (e) { setPerr(errMsg(e)); } };
  return (
    <div className="space-y-3">
      <div className="card border-amber-300 bg-amber-50 text-sm"><b>Read this first.</b> Severity in this dataset is a fixed threshold on max temperature. A model given temperature scores ~{f3(s.leakage_audit.macro_f1)} macro-F1 by re-learning that rule, which says nothing about real forecasting. The main model therefore excludes all temperature-derived columns. {data.disclaimer}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="RBF-SVM macro-F1 (hold-out)" value={f3(rbf.macro_f1)} sub={`accuracy ${f3(rbf.accuracy)}`} />
        <Stat label="Linear SVM macro-F1" value={f3(lin.macro_f1)} sub="baseline" />
        <Stat label="Majority-class macro-F1" value={f3(maj.macro_f1)} sub="always predict Low" />
        <Stat label="Leakage audit macro-F1" value={f3(s.leakage_audit.macro_f1)} sub="not a real result" />
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
        <Panel title="Method" note="All numbers below come from the held-out 20% test set.">
          <ul className="text-sm list-disc pl-5 space-y-1">
            <li>Split: {s.split.type}, {s.split.train_rows.toLocaleString()} train / {s.split.test_rows.toLocaleString()} test (seed {s.split.seed}).</li>
            <li>StandardScaler is inside the pipeline, fit on training rows only.</li>
            <li>Tuning: {s.tuning.method}; best C={s.tuning.best_params.svm__C}, gamma={s.tuning.best_params.svm__gamma}; CV macro-F1 {f3(s.tuning.cv_macro_f1)}.</li>
            <li>class_weight=balanced to counter imbalance.</li>
            <li>Features used: {s.features_used.join(", ")}.</li>
          </ul>
          <details className="text-xs mt-2"><summary className="cursor-pointer">Excluded features and why</summary><ul className="list-disc pl-5 mt-1">{Object.entries(s.features_excluded).map(([k, v]) => <li key={k}><b>{k}</b>: {v as string}</li>)}</ul></details>
        </Panel>
        <Panel title="Leakage audit" note={s.leakage_audit.explanation}><p className="text-sm">Features: {s.leakage_audit.features.join(", ")}<br />Accuracy {f3(s.leakage_audit.accuracy)}, macro-F1 {f3(s.leakage_audit.macro_f1)}.</p></Panel>
        <Panel title="RBF-SVM confusion matrix (test)"><Confusion m={rbf.confusion_matrix} labels={rbf.labels} /></Panel>
        <Panel title="Per-class results (test)"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th><th>Support</th></tr></thead>
          <tbody>{rbf.per_class.map((c) => <tr key={c.class} className="border-t border-slate-100"><td>{c.class}</td><td>{f3(c.precision)}</td><td>{f3(c.recall)}</td><td>{f3(c.f1)}</td><td>{c.support}</td></tr>)}</tbody></table>
          <p className="text-xs text-slate-500 mt-2">Severe has {rbf.per_class[3].support} and Extreme {rbf.per_class[4].support} test samples, so their scores are very noisy.</p></Panel>
      </div>
      <Panel title="Limitations">
        <ul className="text-sm list-disc pl-5 space-y-1">{s.notes.map((n: string) => <li key={n}>{n}</li>)}<li>Random (not chronological) split on daily records: neighbouring days can fall in train and test.</li><li>One dataset, one seed; no confidence intervals.</li></ul>
      </Panel>
      <Panel title="Try the model" note="Illustrative only. Inputs are validated by the API (returns 422 if out of range).">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">{Object.entries(form).map(([k, v]) => <label key={k}>{k.replace(/_/g, " ")}<input className="inp w-full" type="number" step="any" value={v} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} /></label>)}</div>
        <button className="btn btn-on mt-3" onClick={run}>Predict severity</button>
        {pred && <span className="ml-3 text-sm">Predicted: <b>{pred}</b> (low-confidence model)</span>}{perr && <div className="mt-2"><ErrorBox msg={perr} /></div>}
      </Panel>
    </div>
  );
}
