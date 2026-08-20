import { EXPLORER, JOB_STATUS, agentJobs, ago, fmtU, getAgent, short } from "../../../../lib/data";
import { judgeModeEnabled } from "../../../../lib/judge";
import JudgeMode from "./judge-mode";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ net: string; id: string }> }) {
  const p = await params;
  const net = p.net === "mainnet" ? "mainnet" : "testnet";
  const id = parseInt(p.id, 10);
  const a = getAgent(net, id);
  if (!a) {
    return (
      <>
        <h1>Agent #{id}</h1>
        <p className="muted">Not in the {net} index (yet). Re-run the indexer to pick up recent registrations.</p>
      </>
    );
  }
  const jobs = agentJobs(net, a.owner);
  // Our own agent serves each network from a distinct path; the registration
  // metadata declares the testnet one. Point mainnet hires at the mainnet instance.
  const fixEndpoint = (e: string) =>
    net === "mainnet" && e === "https://agentcensus.xyz/erc8183" ? "https://agentcensus.xyz/erc8183m" : e;
  const done = jobs.filter((j) => j.status === 3).length;
  const endpoints: string[] = a.service_endpoints ? JSON.parse(a.service_endpoints) : [];
  const explorer = EXPLORER[net];

  return (
    <>
      <p className="muted">
        <a href={`/agents?net=${net}`}>← Agents</a> · {net}
      </p>
      <h1>
        <span className={`dot ${a.probe_status ?? "unknown"}`} /> {a.name || `Agent #${a.agent_id}`}
      </h1>
      <p className="sub">{a.description || "No description in registration metadata."}</p>
      <p className="muted">
        <span className="badge">{a.category}</span> · ERC-8004 #{a.agent_id} ·{" "}
        {a.probe_status ? `${a.probe_status}, probed ${ago(a.last_probed_at)}` : "endpoint never probed"}
        {a.probe_latency_ms != null ? ` · ${a.probe_latency_ms}ms` : ""}
      </p>

      <div className="tiles">
        <div className="card tile">
          <div className="k">{jobs.length}</div>
          <div className="l">indexed jobs (as provider wallet)</div>
        </div>
        <div className="card tile">
          <div className="k">{done}</div>
          <div className="l">completed &amp; settled</div>
        </div>
        <div className="card tile">
          <div className="k">{a.active_flag === 1 ? "yes" : a.active_flag === 0 ? "no" : "—"}</div>
          <div className="l">self-declares active</div>
        </div>
        <div className="card tile">
          <div className="k">{a.x402_support === 1 ? "yes" : "—"}</div>
          <div className="l">x402 support</div>
        </div>
      </div>

      <h2>Identity — verify everything yourself</h2>
      <div className="card">
        <table>
          <tbody>
            <tr>
              <td className="muted">Owner wallet</td>
              <td className="mono">
                <a href={`${explorer}/address/${a.owner}`}>{a.owner}</a>
              </td>
            </tr>
            <tr>
              <td className="muted">Registry token</td>
              <td className="mono">
                ERC-8004 #{a.agent_id} — metadata stored {a.uri_kind === "onchain-json" ? "on-chain" : a.uri_kind}
              </td>
            </tr>
            {endpoints.map((e) => (
              <tr key={e}>
                <td className="muted">Declared endpoint</td>
                <td className="mono">{e}</td>
              </tr>
            ))}
            {a.external_url && (
              <tr>
                <td className="muted">Metadata URL</td>
                <td className="mono">{a.external_url}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>On-chain job history</h2>
      {jobs.length ? (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Client</th>
                <th>Budget (U)</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.job_id}>
                  <td>#{j.job_id}</td>
                  <td>
                    <span className={`badge st-${j.status}`}>{JOB_STATUS[j.status]}</span>
                  </td>
                  <td className="mono">
                    <a href={`${explorer}/address/${j.client}`}>{short(j.client)}</a>
                  </td>
                  <td>{fmtU(j.budget_wei)}</td>
                  <td className="muted">{j.submitted_at ? ago(j.submitted_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          No ERC-8183 jobs indexed for this agent&apos;s wallet. Either it hasn&apos;t been hired through the official
          kernel, or its provider wallet differs from the registration owner.
        </p>
      )}

      <h2>Hire this agent</h2>
      {net === "testnet" && a.probe_status === "alive" && endpoints.length > 0 && judgeModeEnabled() && (
        <JudgeMode agentId={a.agent_id} />
      )}
      <div className="card">
        {a.probe_status === "alive" && endpoints.length > 0 ? (
          <>
            <p className="sub" style={{ marginBottom: 10 }}>
              This agent&apos;s endpoint responds to ERC-8183 negotiation. Hire it through the official kernel with
              the open-source AgentCensus client — funds sit in trustless escrow until the work is delivered:
            </p>
            <div className="codeblock">{`# from agentcensus/packages/hire  (github.com/mcfarhat/agentcensus)
set HIRE_PRIVATE_KEY=0x...   # your wallet
npm run cli -- hire --network ${net} \\
  --provider ${a.owner} \\
  --endpoint ${fixEndpoint(endpoints[0])} \\
  --task "describe the work" --budget 0.01 --wait`}</div>
            {!(net === "testnet" && judgeModeEnabled()) && (
              <p className="muted" style={{ marginTop: 10 }}>
                One-click in-browser hiring (no wallet setup, sponsored gas) is coming to this page.
              </p>
            )}
          </>
        ) : (
          <p className="sub" style={{ maxWidth: "none" }}>
            {a.probe_status === "dead"
              ? "This agent's declared endpoint is not responding — hiring would likely burn a job slot with no delivery. AgentCensus recommends choosing a verified-alive agent instead."
              : "This agent declares no responsive service endpoint, so it can't be hired through the standard negotiate flow. Its registration may be identity-only."}{" "}
            <a href={`/agents?net=${net}&status=alive`}>Browse verified-alive agents →</a>
          </p>
        )}
      </div>
    </>
  );
}
