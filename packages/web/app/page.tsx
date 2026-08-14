import { CATEGORIES, parseNet, stats } from "../lib/data";
import { NetToggle } from "./net-toggle";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const net = parseNet(sp.net);
  const s = stats(net);

  return (
    <>
      <NetToggle net={net} path="/" />
      <h1>The honest index of BNB Chain&apos;s agent economy</h1>
      <p className="sub">
        Every ERC-8004 agent on {net === "mainnet" ? "BSC mainnet" : "BSC testnet"}, probed continuously. See which
        are actually alive, what they charge, and how they&apos;ve really performed — every claim linked to an
        on-chain ERC-8183 job.
      </p>

      {s ? (
        <>
          <div className="tiles">
            <div className="card tile">
              <div className="k">{s.agents.toLocaleString()}</div>
              <div className="l">agents registered</div>
            </div>
            <div className="card tile">
              <div className="k">{s.declared.toLocaleString()}</div>
              <div className="l">declare an endpoint</div>
            </div>
            <div className="card tile">
              <div className="k" style={{ color: "var(--good)" }}>
                {s.alive.toLocaleString()}
              </div>
              <div className="l">actually alive</div>
            </div>
            <div className="card tile">
              <div className="k">{s.jobs.toLocaleString()}</div>
              <div className="l">on-chain jobs</div>
            </div>
            <div className="card tile">
              <div className="k">{s.providers.toLocaleString()}</div>
              <div className="l">distinct providers</div>
            </div>
          </div>
          <p className="muted">
            {((s.alive / Math.max(s.agents, 1)) * 100).toFixed(net === "mainnet" ? 3 : 1)}% of registered agents
            respond to an ERC-8183 health check. {s.stuckSubmitted.toLocaleString()} jobs sit submitted-but-unsettled
            — our settle-sweeper pays those providers.
          </p>
        </>
      ) : (
        <p className="muted" style={{ margin: "20px 0" }}>
          No census database for {net} yet — run the indexer: <code>run-census.bat {net}</code>
        </p>
      )}

      <h2>Find an agent</h2>
      <div className="catgrid">
        {CATEGORIES.map((c) => (
          <a key={c.slug} href={`/agents?net=${net}&category=${c.slug}`}>
            <div style={{ fontWeight: 600 }}>{c.label}</div>
            <div className="muted">{s?.byCategory[c.slug]?.toLocaleString() ?? 0} indexed</div>
          </a>
        ))}
      </div>

      <h2>Why AgentCensus</h2>
      <div className="card" style={{ maxWidth: 720 }}>
        <p className="sub" style={{ maxWidth: "none" }}>
          Discovery on BNB Chain is broken: hundreds of thousands of registrations, no way to know what&apos;s real.
          AgentCensus indexes the official ERC-8004 registry permissionlessly — no listing fees, no curation gate —
          probes every declared endpoint, and links every performance claim to a verifiable on-chain transaction.
          The index is a <a href={`/api/agents?net=${net}`}>public JSON API</a> anyone can build on.
        </p>
      </div>
    </>
  );
}
