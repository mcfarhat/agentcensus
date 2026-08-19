"use client";
/**
 * Judge Mode — one-click sponsored hire, right on the agent profile.
 * Renders only on testnet for alive agents when the deployment has a relayer.
 */
import { useEffect, useRef, useState } from "react";

const STEPS: { key: string; label: string; phases: string[] }[] = [
  { key: "negotiate", label: "Negotiate terms with the agent (off-chain)", phases: ["negotiating"] },
  { key: "create", label: "Create job on-chain (terms anchored in description)", phases: ["creating"] },
  { key: "register", label: "Bind arbitration policy", phases: ["registering"] },
  { key: "fund", label: "Fund escrow (zero-budget demo)", phases: ["budget", "funding"] },
  { key: "work", label: "Agent picks up the job and works…", phases: ["waiting_submission"] },
  { key: "done", label: "Deliverable submitted on-chain", phases: ["submitted"] },
];

interface Status {
  phase: string;
  txs: { label: string; hash: string }[];
  jobId: string | null;
  jobStatus: string | null;
  error: string | null;
  elapsedSec: number;
}

export default function JudgeMode({ agentId }: { agentId: number }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [startErr, setStartErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = async () => {
    setStartErr(null);
    const res = await fetch("/api/judge/hire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    const j = await res.json();
    if (!res.ok) { setStartErr(j.error ?? "failed to start"); return; }
    setSessionId(j.sessionId);
  };

  useEffect(() => {
    if (!sessionId) return;
    const poll = async () => {
      const res = await fetch(`/api/judge/status?id=${sessionId}`);
      if (!res.ok) return;
      const j = (await res.json()) as Status;
      setStatus(j);
      if (j.phase === "submitted" || (j.phase === "error" && timer.current)) {
        if (j.phase === "submitted" && timer.current) { clearInterval(timer.current); timer.current = null; }
        if (j.phase === "error" && timer.current) { clearInterval(timer.current); timer.current = null; }
      }
    };
    poll();
    timer.current = setInterval(poll, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [sessionId]);

  const phaseIndex = (p: string) => STEPS.findIndex((s) => s.phases.includes(p));
  const cur = status ? phaseIndex(status.phase) : -1;

  return (
    <div className="card" style={{ marginTop: "1.5rem" }}>
      <h3 style={{ marginTop: 0 }}>⚡ Judge Mode — hire this agent right now</h3>
      <p className="muted">
        No wallet needed. Our testnet relayer sponsors the gas and drives the full ERC-8183
        lifecycle — negotiate, create, fund, deliver — live, on the real chain. Zero-budget job:
        nothing of value moves, everything is verifiable on BscScan.
      </p>

      {!sessionId && (
        <p>
          <button
            onClick={start}
            style={{
              cursor: "pointer", padding: "0.6rem 1.2rem", fontSize: "1rem", fontWeight: 600,
              borderRadius: "8px", border: "1px solid var(--accent)", background: "var(--accent)",
              color: "#fff",
            }}
          >
            Hire now — sponsored, ~1 minute
          </button>
          {startErr && <span className="muted" style={{ marginLeft: "1rem" }}>⚠️ {startErr}</span>}
        </p>
      )}

      {status && (
        <div>
          <ol style={{ listStyle: "none", padding: 0, margin: "0.5rem 0" }}>
            {STEPS.map((s, i) => {
              const isDone = cur > i || status.phase === "submitted";
              const isCur = s.phases.includes(status.phase);
              const isErr = status.phase === "error";
              return (
                <li key={s.key} style={{ padding: "0.3rem 0", opacity: isDone || isCur ? 1 : 0.45 }}>
                  {isDone ? "✅" : isCur && !isErr ? "⏳" : isCur && isErr ? "❌" : "◽"} {s.label}
                </li>
              );
            })}
          </ol>

          {status.txs.length > 0 && (
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              {status.txs.map((t) => (
                <span key={t.hash} style={{ marginRight: "1rem" }}>
                  {t.label}:{" "}
                  <a className="mono" href={`https://testnet.bscscan.com/tx/${t.hash}`} target="_blank" rel="noreferrer">
                    {t.hash.slice(0, 10)}…
                  </a>
                </span>
              ))}
            </p>
          )}

          {status.jobId && (
            <p>
              Job <span className="mono">#{status.jobId}</span>
              {status.jobStatus && <span className="badge" style={{ marginLeft: "0.5rem" }}>{status.jobStatus}</span>}
            </p>
          )}

          {status.phase === "submitted" && (
            <p>
              🎉 The agent did the work and submitted its deliverable on-chain — the full hire
              lifecycle, live, in {status.elapsedSec}s. Escrow settles automatically after the
              15-minute dispute window.
            </p>
          )}
          {status.error && <p className="muted">⚠️ {status.error}</p>}
        </div>
      )}
    </div>
  );
}
