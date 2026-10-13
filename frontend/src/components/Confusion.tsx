export default function Confusion({ m, labels }: { m: number[][]; labels: string[] }) {
  const rowMax = m.map((r) => Math.max(1, r.reduce((a, b) => a + b, 0)));
  return (
    <div className="overflow-x-auto"><table className="text-xs border-separate border-spacing-0.5"><thead><tr><th className="text-slate-500 font-normal">true ↓ / predicted →</th>{labels.map((l) => <th key={l} className="font-medium px-1">{l}</th>)}</tr></thead>
      <tbody>{m.map((row, i) => <tr key={i}><td className="pr-2 font-medium">{labels[i]}</td>{row.map((v, j) => <td key={j} className="w-16 h-9 text-center rounded" style={{ background: `rgba(15,31,51,${(v / rowMax[i]) * 0.9})`, color: v / rowMax[i] > 0.45 ? "#fff" : "#0f1f33" }}>{v.toLocaleString()}</td>)}</tr>)}</tbody></table>
      <p className="text-[11px] text-slate-500 mt-1">Cell shade = share of that true class (row-normalised); numbers are raw counts.</p></div>
  );
}
