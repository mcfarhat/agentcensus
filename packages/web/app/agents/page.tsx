import { CATEGORIES, ago, listAgents, parseNet, short } from "../../lib/data";
import { NetToggle } from "../net-toggle";

export const dynamic = "force-dynamic";

const STATUSES = [
  { slug: "all", label: "All" },
  { slug: "alive", label: "● Alive" },
  { slug: "degraded", label: "◐ Degraded" },
  { slug: "dead", label: "○ Dead" },
  { slug: "declared", label: "Has endpoint" },
] as const;

export default async function Agents({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const net = parseNet(sp.net);
  const category = sp.category ?? "all";
  const status = (sp.status ?? "all") as "alive" | "degraded" | "dead" | "declared" | "all";
  const q = sp.q ?? "";
  const page = Math.max(parseInt(sp.page ?? "1", 10) || 1, 1);
  const { rows, total } = listAgents(net, { category, status, q, page, pageSize: 25 });
  const pages = Math.max(Math.ceil(total / 25), 1);
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ net, category, status, q, page: String(page), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    if (!p.get("q")) p.delete("q");
    return `/agents?${p.toString()}`;
  };

  return (
    <>
      <NetToggle net={net} path="/agents" extra={`&category=${category}&status=${status}`} />
      <h1>Agents</h1>
      <p className="sub">
        {total.toLocaleString()} agents match. Sorted by liveness — verified-alive agents first, dead registrations
        last. Every status carries its probe time.
      </p>

      <div className="filters">
        <a className={`f ${category === "all" ? "on" : ""}`} href={qs({ category: "all", page: 1 })}>
          All categories
        </a>
        {CATEGORIES.map((c) => (
          <a key={c.slug} className={`f ${category === c.slug ? "on" : ""}`} href={qs({ category: c.slug, page: 1 })}>
            {c.label}
          </a>
        ))}
      </div>
      <div className="filters">
        {STATUSES.map((s) => (
          <a key={s.slug} className={`f ${status === s.slug ? "on" : ""}`} href={qs({ status: s.slug, page: 1 })}>
            {s.label}
          </a>
        ))}
        <form action="/agents" method="get" style={{ marginLeft: "auto" }}>
          <input type="hidden" name="net" value={net} />
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="status" value={status} />
          <input className="searchbox" name="q" placeholder="Search name, id, owner…" defaultValue={q} />
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Agent</th>
              <th>Category</th>
              <th>Owner</th>
              <th>Latency</th>
              <th>Probed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.agent_id}>
                <td>
                  <span className={`dot ${a.probe_status ?? "unknown"}`} />
                  <span className="muted">{a.probe_status ?? (a.service_endpoints ? "not probed" : "no endpoint")}</span>
                </td>
                <td>
                  <a href={`/agent/${net}/${a.agent_id}`}>
                    <strong>{a.name?.slice(0, 48) || `Agent #${a.agent_id}`}</strong>
                  </a>
                  <div className="muted">
                    #{a.agent_id}
                    {a.description ? ` · ${a.description.slice(0, 90)}` : ""}
                  </div>
                </td>
                <td>
                  <span className="badge">{a.category}</span>
                </td>
                <td className="mono">{short(a.owner)}</td>
                <td>{a.probe_latency_ms != null ? `${a.probe_latency_ms}ms` : "—"}</td>
                <td className="muted">{ago(a.last_probed_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 24 }}>
                  No agents match — or the {net} census hasn&apos;t been generated yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        {page > 1 && <a href={qs({ page: page - 1 })}>← Prev</a>}
        <span className="muted">
          page {page} / {pages}
        </span>
        {page < pages && <a href={qs({ page: page + 1 })}>Next →</a>}
      </div>
    </>
  );
}
