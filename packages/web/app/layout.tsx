import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "AgentCensus — the honest index of BNB Chain's agent economy",
  description:
    "Every ERC-8004 agent on BSC, probed continuously. See which are actually alive, what they charge, and how they've really performed — every claim linked on-chain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap inner">
            <a className="brand" href="/">
              AGENTCENSUS
            </a>
            <nav className="nav">
              <a href="/agents">Agents</a>
              <a href="/jobs">Jobs</a>
              <a href="/state-of-the-agent-economy.html">Census</a>
              <a href="https://github.com/mcfarhat/agentcensus">GitHub</a>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            AgentCensus — built on the official ERC-8004 / ERC-8183 standards for BNB Chain&apos;s Build the Era
            hackathon. Open index, open API, every number reproducible from public chain data.
          </div>
        </footer>
      </body>
    </html>
  );
}
