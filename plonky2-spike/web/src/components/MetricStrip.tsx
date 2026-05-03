import type { VerifiedEpoch, SwarmState } from "../lib/types";
import { fmtKb, fmtMs } from "../lib/util";
import { Sparkline } from "./Sparkline";

export interface MetricSeries {
  totalMs: number[];
  proveMs: number[];
  verifyMs: number[];
  proofBytes: number[];
  verifiedRatio: number[];
}

interface Props {
  epoch: VerifiedEpoch | null;
  swarm: SwarmState | null;
  series: MetricSeries;
}

function tone(ok: boolean): "good" | "bad" {
  return ok ? "good" : "bad";
}

export function MetricStrip({ epoch, swarm, series }: Props) {
  const epochN = epoch?.epoch ?? null;
  const verifiedRatio = epoch
    ? epoch.verified_count / Math.max(epoch.drone_count, 1)
    : 0;
  const onlineRatio = swarm
    ? swarm.online_count / Math.max(swarm.drone_count, 1)
    : 0;

  return (
    <section className="metrics">
      <Metric
        name="Epoch"
        value={epochN === null ? "—" : `#${epochN}`}
        footer={epoch ? `${epoch.proof_system}` : "awaiting proof"}
      />
      <Metric
        name="Verified"
        value={epoch ? `${epoch.verified_count}/${epoch.drone_count}` : "—"}
        valueTone={epoch ? tone(epoch.accepted) : undefined}
        footer={`${(verifiedRatio * 100).toFixed(0)}% participation`}
        spark={series.verifiedRatio}
      />
      <Metric
        name="Online"
        value={swarm ? `${swarm.online_count}/${swarm.drone_count}` : "—"}
        valueTone={onlineRatio < 1 ? "bad" : "good"}
        footer={`${(onlineRatio * 100).toFixed(0)}% link-up`}
      />
      <Metric
        name="Integrity"
        value={swarm ? (swarm.integrity_clean ? "CLEAN" : "FAULT") : "—"}
        valueTone={swarm?.integrity_clean === false ? "bad" : "good"}
        footer={
          swarm?.last_integrity
            ? `${swarm.last_integrity.ok} ok · ${swarm.last_integrity.missing} miss · ${swarm.last_integrity.mismatched} mismatch`
            : "manifest unchecked"
        }
      />
      <Metric
        name="Total"
        value={epoch ? fmtMs(epoch.total_ms) : "—"}
        footer="prove + verify"
        spark={series.totalMs}
      />
      <Metric
        name="Prove"
        value={epoch ? fmtMs(epoch.prove_ms) : "—"}
        footer="recursive chain"
        spark={series.proveMs}
      />
      <Metric
        name="Step Verify"
        value={epoch ? fmtMs(epoch.verify_ms) : "—"}
        footer="step circuit"
        spark={series.verifyMs}
      />
      <Metric
        name="Proof"
        value={epoch ? fmtKb(epoch.proof_bytes) : "—"}
        footer={epoch ? `${epoch.public_inputs} public inputs` : "—"}
        spark={series.proofBytes}
      />
    </section>
  );
}

interface MetricProps {
  name: string;
  value: string;
  footer?: string;
  valueTone?: "good" | "bad" | "info" | "warn";
  spark?: number[];
}

function Metric({ name, value, footer, valueTone, spark }: MetricProps) {
  return (
    <div className="metric">
      <div className="name">{name}</div>
      <div className={`value ${valueTone ?? ""}`}>{value}</div>
      {spark && spark.length > 1 ? (
        <div style={{ color: "var(--phosphor)", marginTop: 2 }}>
          <Sparkline values={spark} />
        </div>
      ) : (
        <div className="footer">{footer ?? ""}</div>
      )}
      {spark && spark.length > 1 && footer ? (
        <div className="footer" style={{ marginTop: -2 }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
