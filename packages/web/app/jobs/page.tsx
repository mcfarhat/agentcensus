import { EXPLORER, JOB_STATUS, ago, fmtU, listJobs, parseNet, short } from "../../lib/data";
import { NetToggle } from "../net-toggle";

export const dynamic = "force-dynamic";

export default async function Jobs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const net = parseNet(sp.net);
  const provider = sp.provider ?? "";
  const status = sp.status !== undefined && sp.status !== "" ? parseInt(sp.status, 10) : undefined;
  const page = Math.max(parseInt(sp.page ?? "1", 10) || 1, 1);
  const { rows, total } = listJobs(net, { provider: provider || undefined, status, page, pageSize: 30 });
  const pages = Math.max(Math.ceil(total / 30), 1);
  const explorer = EXPLORER[net];
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ net, provider, status: status?.toString() ?? "", page: String(page), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    if (!p.get("provider")) p.delete("provider");
    if (p.get("status") === "") p.delete("status");
    return `/jobs?${p.toString()}`;
  };

  return (
    <>
      <NetToggle net={net} path="/jobs" />
      <h1>Job explorer</h1>
      <p className="sub">
        Every ERC-8183 job on {net}, straight from the AgenticCommerce kernel. {total.toLocaleString()} match.
        SUBMITTED jobs past their dispute window are stuck escrow — anyone can settle them (our sweeper does).
      </p>

      <div className="filters">
        <a className={`f ${status === undefined ? "on" : ""}`} href={qs({ status: "", page: 1 })}>
          All
        </a>
        {JOB_STATUS.map((s, i) => (
          <a key={s} className={`f ${status === i ? "on" : ""}`} href={qs({ status: i, page: 1 })}>
            {s}
          </a>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Client</th>
              <th>Budget (U)</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.job_id}>
                <td>#{j.job_id}</td>
                <td>
                  <span className={`badge st-${j.status}`}>{JOB_STATUS[j.status]}</span>
                </td>
                <td className="mono">
                  <a href={qs({ provider: j.provider, page: 1 })} title="filter by provider">
                    {short(j.provider)}
                  </a>
                </td>
                <td className="mono">
                  <a href={`${explorer}/address/${j.client}`}>{short(j.client)}</a>
                </td>
                <td>{fmtU(j.budget_wei)}</td>
                <td className="muted">{j.submitted_at ? ago(j.submitted_at) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 24 }}>
                  No jobs match — or the {net} census hasn&apos;t been generated yet.
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
        {provider && (
          <a className="muted" href={qs({ provider: "", page: 1 })}>
            clear provider filter ({short(provider)})
          </a>
        )}
      </div>
    </>
  );
}
