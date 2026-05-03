import type { VerifiedEpoch } from "../lib/types";
import { pad2 } from "../lib/util";

interface Props {
  epoch: VerifiedEpoch | null;
}

export function Ticker({ epoch }: Props) {
  const dropouts = epoch?.dropouts ?? [];
  return (
    <div className="ticker">
      <span className="label">DROPOUTS</span>
      <div className="chips">
        {dropouts.length === 0 ? (
          <span className="chip empty">NONE</span>
        ) : (
          dropouts.slice(0, 24).map((d) => (
            <span className="chip" key={d}>
              DR-{pad2(d + 1)}
            </span>
          ))
        )}
      </div>
      <span className="meta">
        {epoch ? `${epoch.proof_system.toUpperCase()} · ${epoch.implemented_proof_mode.toUpperCase()} · ${epoch.public_inputs} PI · NONCE ${epoch.nonce.slice(-8).toUpperCase()}` : "AWAITING TELEMETRY"}
      </span>
    </div>
  );
}
