import { useEffect, useState } from "react";

type Matched = {
  sku: string;
  storeId: string;
  clover: { id: string; name: string; price: number; sku: string; code: string };
  zkong: { barCode: string; itemTitle: string; price: string };
};

export default function App() {
  const [matched, setMatched] = useState<Matched[]>([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({ clover: 0, zkong: 0, matched: 0 });
  const [promos, setPromos] = useState<any[]>([]);
  const [form, setForm] = useState({
    barCode: "",
    promoPrice: "500",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    startTime: "00:00",
    endTime: "23:59",
  });
  const [msg, setMsg] = useState("");

  const fetchMatched = async () => {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/products/matched");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMatched(j.matched);
      setCounts(j.counts);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPromos = async () => {
    try {
      const r = await fetch("/admin/promos");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setPromos(j.promos);
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const sync = async () => {
    await fetchMatched();
    await fetchPromos();
    setMsg("Synced — showing only where SKU == barCode and storeId matches");
  };

  const createPromo = async () => {
    setMsg("");
    try {
      const r = await fetch("/admin/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsg(`Promo created for ${j.barCode}: ${j.promoPrice} from ${j.startDate} ${j.startTime}`);
      fetchPromos();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  useEffect(() => {
    fetchMatched();
    fetchPromos();
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1>Clover ↔ Zkong — POC Console</h1>
      <div className="card">
        <button className="primary" onClick={sync} disabled={loading}>
          {loading ? "Syncing..." : "Sync products (Clover ↔ Zkong)"}
        </button>{" "}
        <span style={{ marginLeft: 12, color: "#666" }}>
          Clover: {counts.clover} | Zkong: {counts.zkong} | Matched: {counts.matched}
        </span>
        {msg && <div style={{ marginTop: 8, color: "#b00" }}>{msg}</div>}
      </div>

      <div className="card">
        <h3>Matched products (SKU == barCode, same store)</h3>
        {matched.length === 0 ? (
          <p style={{ color: "#888" }}>No matches — ensure SKU in Clover equals barCode in Zkong and both are in the same store.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU / barCode</th>
                <th>Clover name</th>
                <th>Clover price (cents)</th>
                <th>Zkong title</th>
                <th>Zkong price</th>
              </tr>
            </thead>
            <tbody>
              {matched.map((m) => (
                <tr key={m.sku}>
                  <td>{m.sku}</td>
                  <td>{m.clover.name}</td>
                  <td>{m.clover.price}</td>
                  <td>{m.zkong.itemTitle}</td>
                  <td>{m.zkong.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Create promo (POST /admin/promos → repricingList)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxWidth: 600 }}>
          <label>barCode (sku) <input value={form.barCode} onChange={(e) => setForm({ ...form, barCode: e.target.value })} placeholder="ASRX79016G" /></label>
          <label>promoPrice (cents) <input value={form.promoPrice} onChange={(e) => setForm({ ...form, promoPrice: e.target.value })} /></label>
          <label>startDate <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
          <label>endDate <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          <label>startTime <input value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} placeholder="00:00" /></label>
          <label>endTime <input value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} placeholder="23:59" /></label>
        </div>
        <button style={{ marginTop: 12 }} className="primary" onClick={createPromo}>
          Create promo
        </button>
        <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>Uses storeId from env (default 1787791370298), repricingType 1, unitName 1 (cents).</div>
      </div>

      <div className="card">
        <h3>Active promos (from Zkong repricingList)</h3>
        {promos.length === 0 ? (
          <p style={{ color: "#888" }}>No active repricingList entries found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>barCode</th>
                <th>title</th>
                <th>base price</th>
                <th>promo</th>
                <th>window</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((p, i) => (
                <tr key={i}>
                  <td>{p.barCode}</td>
                  <td>{p.itemTitle}</td>
                  <td>{p.price}</td>
                  <td>{p.promoPrice}</td>
                  <td>
                    {p.startDate} {p.startTime} → {p.endDate} {p.endTime}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
