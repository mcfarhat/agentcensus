/**
 * Landing skeleton — the "land" step of the judged golden path.
 * Week-2 scope: category browse, agent profiles, Judge Mode hire flow.
 * This placeholder renders live census numbers from the indexer database
 * so the site is honest from its first deploy.
 */
async function getCensus() {
  try {
    const res = await fetch("http://localhost:3000/api/census", { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as {
      agents: { total: number; byProbeStatus: Record<string, number> };
      jobs: { total: number; distinctProviders: number };
      generatedAt: string;
    };
  } catch {
    return null;
  }
}

const CATEGORIES = [
  { slug: "monitoring", label: "Monitoring & Rebalancing" },
  { slug: "grid-trading", label: "Grid Trading" },
  { slug: "health-factor", label: "Health Factor" },
  { slug: "yield", label: "Yield" },
];

export default async function Home() {
  const census = await getCensus();
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>AgentCensus</h1>
      <p style={{ fontSize: "1.2rem", color: "#9aa4b2", maxWidth: 640 }}>
        The honest index of BNB Chain&apos;s agent economy. Every ERC-8004 agent, probed
        continuously — see which are actually alive and how they&apos;ve really performed,
        with every claim linked on-chain.
      </p>

      {census ? (
        <section style={{ display: "flex", gap: "2rem", margin: "2.5rem 0", flexWrap: "wrap" }}>
          <Stat label="agents indexed" value={census.agents.total.toLocaleString()} />
          <Stat label="alive right now" value={(census.agents.byProbeStatus?.alive ?? 0).toLocaleString()} />
          <Stat label="on-chain jobs" value={census.jobs.total.toLocaleString()} />
          <Stat label="distinct providers" value={census.jobs.distinctProviders.toLocaleString()} />
        </section>
      ) : (
        <p style={{ color: "#666", margin: "2.5rem 0" }}>
          Census loading — run the indexer (`npm run cli -- agents`) to populate.
        </p>
      )}

      <h2 style={{ marginTop: "3rem" }}>Find an agent</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
        {CATEGORIES.map((c) => (
          <a
            key={c.slug}
            href={`/agents/${c.slug}`}
            style={{
              border: "1px solid #2a3040",
              borderRadius: 8,
              padding: "1.25rem",
              color: "#e6e6e6",
              textDecoration: "none",
            }}
          >
            {c.label}
          </a>
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "2rem", fontWeight: 700 }}>{value}</div>
      <div style={{ color: "#9aa4b2" }}>{label}</div>
    </div>
  );
}
