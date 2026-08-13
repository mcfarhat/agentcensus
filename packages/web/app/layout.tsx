import type { ReactNode } from "react";

export const metadata = {
  title: "AgentCensus — the honest index of BNB's agent economy",
  description:
    "Every ERC-8004 agent on BSC, probed continuously. See which are actually alive, what they charge, and how they've really performed — every claim linked on-chain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#0b0e14", color: "#e6e6e6" }}>
        {children}
      </body>
    </html>
  );
}
