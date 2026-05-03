import { useEffect, useState } from "react";
import type { VerifiedEpoch } from "../lib/types";
import { pad2 } from "../lib/util";

interface Props {
  epoch: VerifiedEpoch | null;
  online: number;
  total: number;
  integrityClean: boolean;
}

function useClock(): string {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const h = pad2(t.getUTCHours());
  const m = pad2(t.getUTCMinutes());
  const s = pad2(t.getUTCSeconds());
  return `${h}:${m}:${s}Z`;
}

export function Header({ epoch, online, total, integrityClean }: Props) {
  const clock = useClock();
  const accepted = epoch?.accepted ?? null;
  const outcome = accepted === null ? "Standby" : accepted ? "Verified" : "Rejected";
  const outcomeTone = accepted === false ? "bad" : accepted ? "good" : "";
  const epochNum = epoch ? `#${epoch.epoch}` : "-";
  const verifiedCount = epoch ? `${epoch.verified_count}/${epoch.drone_count}` : "-";

  return (
    <header className="header">
      <div className="brand">
        <h1>Mycelium</h1>
        <span>Data verification layer for drone swarms using recursive ZK proofs</span>
      </div>

      <div className="status-summary" aria-label="Verifier status">
        <div className={`status-pill ${outcomeTone}`}>
          <span className={`pulse-dot ${accepted === false ? "bad" : ""}`} />
          {outcome}
        </div>
        <div>
          <span>Epoch</span>
          <strong>{epochNum}</strong>
        </div>
        <div>
          <span>Verified</span>
          <strong>{verifiedCount}</strong>
        </div>
        <div>
          <span>Online</span>
          <strong>{online}/{total}</strong>
        </div>
        <div>
          <span>Integrity</span>
          <strong className={integrityClean ? "good" : "bad"}>
            {integrityClean ? "Clean" : "Fault"}
          </strong>
        </div>
        <div>
          <span>UTC</span>
          <strong className="num">{clock}</strong>
        </div>
      </div>
    </header>
  );
}
