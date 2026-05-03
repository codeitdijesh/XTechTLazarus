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

  let stampClass = "stamp";
  let stampLabel = "STANDBY";
  let stampVerdict = "•••";
  if (accepted === true) {
    stampClass = "stamp";
    stampLabel = "VERIFIER OUTCOME";
    stampVerdict = "VERIFIED";
  } else if (accepted === false) {
    stampClass = "stamp bad";
    stampLabel = "VERIFIER OUTCOME";
    stampVerdict = "REJECTED";
  }

  const epochNum = epoch ? `E-${String(epoch.epoch).padStart(6, "0")}` : "E-------";
  const proofMode = epoch?.implemented_proof_mode ?? "—";
  const verifiedCount = epoch ? `${epoch.verified_count}/${epoch.drone_count}` : "—";

  return (
    <header className="header">
      <div className="brand">
        <div className="eyebrow-row eyebrow">
          <span>AEGIS</span>
          <span style={{ color: "var(--ash-2)" }}>//</span>
          <span>PLONKY-2 RECURSIVE VERIFIER</span>
          <span style={{ color: "var(--ash-2)" }}>//</span>
          <span>{epochNum}</span>
        </div>
        <h1>BACKPACK COMMAND CENTER</h1>
        <div className="sub">
          poseidon-merkle inclusion · recursive proof chain · backpack-edge attestation
        </div>
      </div>

      <div className={stampClass}>
        <span className="seal" aria-hidden />
        <span className="label">{stampLabel}</span>
        <span className="verdict">{stampVerdict}</span>
      </div>

      <div className="mode-row">
        <div className="top">
          <span>
            <span className={`pulse-dot ${accepted === false ? "bad" : ""}`} />
            BACKPACK VERIFIER ONLINE
          </span>
          <span className="clock num">{clock}</span>
        </div>
        <div className="bot">
          <span>MODE · {proofMode.toUpperCase()}</span>
          <span>FLEET · {verifiedCount}</span>
          <span>NET · {online}/{total} ONLINE</span>
          <span style={{ color: integrityClean ? "var(--phosphor)" : "var(--blood)" }}>
            INTEGRITY · {integrityClean ? "CLEAN" : "FAULT"}
          </span>
        </div>
      </div>
    </header>
  );
}
