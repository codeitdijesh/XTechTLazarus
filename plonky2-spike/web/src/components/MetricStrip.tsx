import type { SwarmState, VerifiedEpoch } from "../lib/types";
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
  const verifiedRatio = epoch
    ? epoch.verified_count / Math.max(epoch.drone_count, 1)
    : 0;
  const onlineRatio = swarm
    ? swarm.online_count / Math.max(swarm.drone_count, 1)
    : 0;

  return (
    <section className="metrics" aria-label="Proof metrics">
      <Metric
        name="Epoch"
        value={epoch ? `#${epoch.epoch}` : "-"}
        footer={epoch ? epoch.proof_system : "Awaiting proof"}
      />
      <Metric
        name="Verified"
        value={epoch ? `${epoch.verified_count}/${epoch.drone_count}` : "-"}
        valueTone={epoch ? tone(epoch.accepted) : undefined}
        footer={`${(verifiedRatio * 100).toFixed(0)}% participation`}
        spark={series.verifiedRatio}
      />
      <Metric
        name="Online"
        value={swarm ? `${swarm.online_count}/${swarm.drone_count}` : "-"}
        valueTone={onlineRatio < 1 ? "bad" : "good"}
        footer={`${(onlineRatio * 100).toFixed(0)}% link-up`}
      />
      <Metric
        name="Integrity"
        value={swarm ? (swarm.integrity_clean ? "Clean" : "Fault") : "-"}
        valueTone={swarm?.integrity_clean === false ? "bad" : "good"}
        footer={
          swarm?.last_integrity
            ? `${swarm.last_integrity.ok} ok, ${swarm.last_integrity.missing} missing`
            : "Manifest unchecked"
        }
      />
      <Metric
        name="Prove"
        value={epoch ? fmtMs(epoch.prove_ms) : "-"}
        footer="Recursive chain"
        spark={series.proveMs}
      />
      <Metric
        name="Verify"
        value={epoch ? fmtMs(epoch.verify_ms) : "-"}
        footer={epoch ? `${fmtKb(epoch.proof_bytes)} proof` : "Step circuit"}
        spark={series.verifyMs}
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
  const hasSpark = spark && spark.length > 1;

  return (
    <div className="metric">
      <div className="name">{name}</div>
      <div className={`value ${valueTone ?? ""}`}>{value}</div>
      {hasSpark ? (
        <div className="spark-wrap">
          <Sparkline values={spark} />
        </div>
      ) : null}
      <div className="footer">{footer ?? ""}</div>
    </div>
  );
}
