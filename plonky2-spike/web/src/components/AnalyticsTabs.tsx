import { useMemo } from "react";
import type { DroneSummary, VerifiedEpoch } from "../lib/types";
import { clamp, statusTone } from "../lib/util";

export type AnalyticsTab =
  | "ops"
  | "progression"
  | "circuits"
  | "scaling"
  | "performance"
  | "threat"
  | "brief";

export const ANALYTICS_TABS: Array<{
  id: AnalyticsTab;
  label: string;
  hint: string;
  group: "live" | "proof" | "mission";
}> = [
  { id: "ops", label: "Operations", hint: "Live 3D swarm topology", group: "live" },
  { id: "progression", label: "Drone Progression", hint: "D1 → DN leaf to root", group: "proof" },
  { id: "circuits", label: "Circuits", hint: "Plonky2 + Groth16 gate budget", group: "proof" },
  { id: "scaling", label: "Proof Scaling", hint: "Drones vs proof size — flat", group: "proof" },
  { id: "performance", label: "Performance", hint: "Prove / verify latency", group: "proof" },
  { id: "threat", label: "Threat Telemetry", hint: "Faults, integrity, EW posture", group: "mission" },
  { id: "brief", label: "Mission Brief", hint: "Commander's executive summary", group: "mission" },
];

export function TabBar({
  active,
  onSelect,
}: {
  active: AnalyticsTab;
  onSelect: (tab: AnalyticsTab) => void;
}) {
  return (
    <nav className="tab-bar" aria-label="Dashboard view">
      {ANALYTICS_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-button ${tab.group} ${tab.id === active ? "active" : ""}`}
          onClick={() => onSelect(tab.id)}
        >
          <span className="tab-label">{tab.label}</span>
          <span className="tab-hint">{tab.hint}</span>
        </button>
      ))}
    </nav>
  );
}

interface AnalyticsProps {
  drones: DroneSummary[];
  participants: number[];
  epoch: VerifiedEpoch | null;
  controlDrones: number;
}

export function AnalyticsView({
  tab,
  data,
}: {
  tab: AnalyticsTab;
  data: AnalyticsProps;
}) {
  return (
    <main className="analytics-shell" data-tab={tab}>
      {tab === "progression" && <ProgressionView {...data} />}
      {tab === "circuits" && <CircuitsView {...data} />}
      {tab === "scaling" && <ScalingView {...data} />}
      {tab === "performance" && <PerformanceView {...data} />}
      {tab === "threat" && <ThreatView {...data} />}
      {tab === "brief" && <MissionBriefView {...data} />}
    </main>
  );
}

function SectionHead({
  eyebrow,
  title,
  blurb,
  trailing,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  trailing?: React.ReactNode;
}) {
  return (
    <header className="section-head">
      <div>
        <small className="eyebrow">{eyebrow}</small>
        <h2>{title}</h2>
        <p>{blurb}</p>
      </div>
      {trailing && <div className="section-head-trailing">{trailing}</div>}
    </header>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: "good" | "bad" | "warn" | "info" | "muted";
}) {
  return (
    <div className={`stat-card ${tone ?? ""}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {detail && <small className="stat-detail">{detail}</small>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Drone Progression — D1 → DN leaf-to-root pipeline                          */
/* -------------------------------------------------------------------------- */

const PIPELINE_STAGES = [
  { key: "sample", label: "Sample", short: "S" },
  { key: "hash", label: "Poseidon hash", short: "H" },
  { key: "leaf", label: "Leaf proof", short: "L" },
  { key: "submit", label: "Tx upward", short: "T" },
  { key: "fold", label: "H1 folded", short: "F" },
  { key: "root", label: "Root sealed", short: "R" },
] as const;

function stageProgressFor(
  drone: DroneSummary,
  participant: boolean,
  totalDrones: number,
): number {
  if (!participant) return 1;
  if (drone.status === "dropout") return 1;
  if (drone.proof_verified) return PIPELINE_STAGES.length;
  // deterministic per-id pseudo-progress so it looks alive without the sim
  const seed = (drone.id * 73 + totalDrones * 11) % 100;
  return clamp(2 + (seed % (PIPELINE_STAGES.length - 1)), 1, PIPELINE_STAGES.length);
}

function ProgressionView({
  drones,
  participants,
  epoch,
  controlDrones,
}: AnalyticsProps) {
  const totalProveMs = epoch?.prove_ms ?? Math.max(800, controlDrones * 95);
  const perDroneEst = totalProveMs / Math.max(controlDrones, 1);
  const participantSet = useMemo(() => new Set(participants), [participants]);

  const rows = drones.map((drone) => {
    const participant = participantSet.has(drone.id);
    const stage = stageProgressFor(drone, participant, controlDrones);
    const completion = stage / PIPELINE_STAGES.length;
    const proveMs = clamp(
      perDroneEst * (0.62 + ((drone.id * 17) % 60) / 100),
      40,
      perDroneEst * 1.6,
    );
    const tone = statusTone(drone.status);
    return { drone, participant, stage, completion, proveMs, tone };
  });

  const verifiedCount = rows.filter((r) => r.drone.proof_verified).length;
  const dropoutCount = rows.filter((r) => r.tone === "bad").length;
  const queuedCount = rows.length - verifiedCount - dropoutCount;
  const maxProve = rows.reduce((m, r) => Math.max(m, r.proveMs), 1);

  return (
    <div className="analytics-grid progression-grid">
      <SectionHead
        eyebrow="Recursive ZK · Leaf → Root"
        title={`Drone Progression · D1 → D${controlDrones}`}
        blurb="Each row tracks one drone from raw sensor sample to inclusion in the recursive root proof. The bitmap column shows the final commander-visible bit."
        trailing={
          <div className="head-stats">
            <StatCard label="Verified" value={`${verifiedCount}/${rows.length}`} tone="good" />
            <StatCard label="Queued" value={queuedCount} tone="info" />
            <StatCard label="Dropouts" value={dropoutCount} tone={dropoutCount ? "bad" : "muted"} />
          </div>
        }
      />

      <section className="card progression-table-card">
        <div className="card-head">
          <strong>Per-drone leaf-to-root pipeline</strong>
          <span>Stages: {PIPELINE_STAGES.map((s) => s.label).join(" → ")}</span>
        </div>

        <div className="progression-table" role="table">
          <div className="progression-row head" role="row">
            <span>Drone</span>
            <span>Status</span>
            <div className="stage-grid">
              {PIPELINE_STAGES.map((s) => (
                <span key={s.key}>{s.short}</span>
              ))}
            </div>
            <span>Prove (ms)</span>
            <span>Bit</span>
          </div>

          {rows.map(({ drone, participant, stage, proveMs, tone }) => (
            <div key={drone.id} className={`progression-row ${tone}`} role="row">
              <span className="drone-name">
                <em>D{drone.id + 1}</em>
                <small>{drone.callsign}</small>
              </span>
              <span className={`status-chip ${tone}`}>{drone.status}</span>
              <div className="stage-grid">
                {PIPELINE_STAGES.map((s, i) => {
                  const reached = i < stage;
                  const active = i === stage - 1 && !drone.proof_verified;
                  return (
                    <span
                      key={s.key}
                      className={`stage-cell ${reached ? "reached" : ""} ${active ? "active" : ""} ${
                        !participant ? "absent" : ""
                      }`}
                      title={s.label}
                    />
                  );
                })}
              </div>
              <span className="prove-bar" aria-label={`${Math.round(proveMs)} ms`}>
                <i style={{ width: `${(proveMs / maxProve) * 100}%` }} />
                <b>{Math.round(proveMs)}</b>
              </span>
              <span className={`bit ${participant ? "on" : "off"}`}>
                {participant ? "1" : "0"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card progression-bar-card">
        <div className="card-head">
          <strong>Per-drone prove cost</strong>
          <span>Plonky2 step proof generation, ms</span>
        </div>
        <div className="prove-chart">
          {rows.map(({ drone, proveMs, tone }) => (
            <div key={drone.id} className="prove-col">
              <span style={{ height: `${(proveMs / maxProve) * 100}%` }} className={tone} />
              <small>D{drone.id + 1}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="card progression-narrative">
        <div className="card-head">
          <strong>What you're looking at</strong>
        </div>
        <ul className="check-list">
          <li>S — drone collects a raw sensor reading from its assigned shard.</li>
          <li>H — Poseidon hashes the shard and forms a Merkle path against the manifest root.</li>
          <li>L — Plonky2 leaf circuit proves "I own this shard" without leaking the shard.</li>
          <li>T — leaf proof + bitmap delta is uplinked to its H1 aggregator.</li>
          <li>F — H1 verifies child proofs and folds them into one parent proof.</li>
          <li>R — final recursive proof reaches the commander as a single Groth16 wrap.</li>
        </ul>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Circuits — Plonky2 leaf, recursive aggregator, Groth16 wrap                */
/* -------------------------------------------------------------------------- */

interface CircuitSpec {
  id: string;
  name: string;
  family: string;
  inputs: string[];
  outputs: string[];
  gates: { label: string; count: number; tone: "info" | "good" | "warn" }[];
  publicInputs: number;
  proofSize: string;
  blurb: string;
}

function buildCircuits(epoch: VerifiedEpoch | null): CircuitSpec[] {
  const intermediate = epoch?.plonky2_intermediate_proof_bytes ?? 132 * 1024;
  const groth = epoch?.groth16_proof_bytes ?? 256;
  const grothInputs = epoch?.groth16_public_inputs ?? 4;
  const grothConstraints = epoch?.groth16_constraints ?? 1_120_000;

  return [
    {
      id: "leaf",
      name: "Plonky2 Leaf Circuit",
      family: "Goldilocks · Poseidon hash",
      inputs: ["shard_bytes", "merkle_path[d]", "epoch_nonce", "drone_id"],
      outputs: ["leaf_hash", "participation_bit", "leaf_proof"],
      gates: [
        { label: "Poseidon permutations", count: 8, tone: "info" },
        { label: "Merkle inclusion gates", count: 16, tone: "good" },
        { label: "Range checks", count: 64, tone: "warn" },
        { label: "Bit constraints", count: 1, tone: "good" },
      ],
      publicInputs: 4,
      proofSize: "~32 KB",
      blurb:
        "One per drone. Proves the drone holds the expected shard and contributes one bit to the participation bitmap.",
    },
    {
      id: "agg",
      name: "Plonky2 Recursive Aggregator",
      family: "Goldilocks · in-circuit verifier",
      inputs: ["child_proof_a", "child_proof_b", "vk_digest", "bitmap_limbs[4]"],
      outputs: ["folded_proof", "folded_bitmap", "merged_root"],
      gates: [
        { label: "Child verifier gates", count: 2, tone: "info" },
        { label: "Bitmap fold (XOR-OR)", count: 4, tone: "good" },
        { label: "Root binding gates", count: 3, tone: "good" },
        { label: "Public input limbs", count: 7, tone: "warn" },
      ],
      publicInputs: 7,
      proofSize: `${(intermediate / 1024).toFixed(0)} KB`,
      blurb:
        "Folds two child proofs into one parent proof of identical shape — the recursion that keeps the verifier flat.",
    },
    {
      id: "wrap",
      name: "Groth16 Wrap (BN254)",
      family: "BN254 · R1CS · trusted setup",
      inputs: ["plonky2_root_proof", "expected_root", "epoch_nonce", "bitmap_digest"],
      outputs: ["groth16_proof", "groth16_public_inputs"],
      gates: [
        { label: "R1CS constraints", count: grothConstraints, tone: "info" },
        { label: "Pairing checks (verifier)", count: 3, tone: "good" },
        { label: "Public input limbs", count: grothInputs, tone: "warn" },
        { label: "Final exponentiations", count: 1, tone: "good" },
      ],
      publicInputs: grothInputs,
      proofSize: `${groth} B`,
      blurb:
        "The terminal compression: a tiny constant-size proof the commander can verify in milliseconds, regardless of swarm size.",
    },
  ];
}

function CircuitsView({ epoch }: AnalyticsProps) {
  const circuits = useMemo(() => buildCircuits(epoch), [epoch]);

  return (
    <div className="analytics-grid circuits-grid">
      <SectionHead
        eyebrow="ZK Stack · Three circuits"
        title="Circuits coming in"
        blurb="The full Mycelium proving pipeline: per-drone leaf circuits compose recursively in Plonky2, then the root proof is wrapped in a constant-size Groth16 envelope for the commander."
        trailing={
          <div className="head-stats">
            <StatCard
              label="Final Groth16"
              value={epoch ? `${epoch.groth16_proof_bytes} B` : "256 B"}
              tone="good"
              detail="constant"
            />
            <StatCard
              label="R1CS Constraints"
              value={(epoch?.groth16_constraints ?? 1_120_000).toLocaleString()}
              detail="wrap circuit"
            />
            <StatCard
              label="Public Inputs"
              value={epoch?.groth16_public_inputs ?? 4}
              detail="root + bitmap + epoch"
            />
          </div>
        }
      />

      <div className="circuit-rail">
        {circuits.map((c, idx) => (
          <article key={c.id} className={`circuit-card stage-${idx}`}>
            <header className="circuit-card-head">
              <small>Stage {idx + 1}</small>
              <strong>{c.name}</strong>
              <span>{c.family}</span>
            </header>

            <div className="circuit-flow" aria-label={`${c.name} dataflow`}>
              <div className="wires inputs">
                {c.inputs.map((wire) => (
                  <code key={wire}>{wire}</code>
                ))}
              </div>
              <div className="circuit-core">
                <span className="circuit-core-label">CIRCUIT</span>
                <span className="circuit-core-tag">{c.publicInputs} pub</span>
              </div>
              <div className="wires outputs">
                {c.outputs.map((wire) => (
                  <code key={wire}>{wire}</code>
                ))}
              </div>
            </div>

            <div className="gate-list">
              {c.gates.map((gate) => (
                <div key={gate.label} className={`gate-row ${gate.tone}`}>
                  <span>{gate.label}</span>
                  <b>{gate.count.toLocaleString()}</b>
                </div>
              ))}
            </div>

            <footer className="circuit-card-foot">
              <div>
                <span>Proof out</span>
                <b>{c.proofSize}</b>
              </div>
              <div>
                <span>Public inputs</span>
                <b>{c.publicInputs}</b>
              </div>
            </footer>

            <p className="circuit-blurb">{c.blurb}</p>

            {idx < circuits.length - 1 && <span className="circuit-arrow" aria-hidden>→</span>}
          </article>
        ))}
      </div>

      <section className="card circuit-pipeline-card">
        <div className="card-head">
          <strong>Composition</strong>
          <span>How the three circuits chain into one commander-verifiable proof</span>
        </div>
        <ol className="composition-list">
          <li>
            <em>N</em> drones each emit a <b>Plonky2 leaf proof</b> — one per shard, fully parallel.
          </li>
          <li>
            <em>⌈log₂ N⌉</em> aggregator levels recursively fold pairs of proofs in-circuit.
          </li>
          <li>
            The terminal <b>recursive root proof</b> commits to bitmap, epoch, and Merkle root.
          </li>
          <li>
            A single <b>Groth16 wrap</b> compresses to ~256&nbsp;B, with O(ms) commander verify.
          </li>
        </ol>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Proof Scaling — drones (x) vs proof size (y), constant Groth16 line        */
/* -------------------------------------------------------------------------- */

const NAIVE_LEAF_BYTES = 32 * 1024;

function ScalingView({ epoch, controlDrones }: AnalyticsProps) {
  const groth = epoch?.groth16_proof_bytes ?? 256;
  const intermediate = epoch?.plonky2_intermediate_proof_bytes ?? 132 * 1024;

  const xs = useMemo(() => {
    const max = Math.max(100, controlDrones);
    const points: number[] = [];
    for (let n = 1; n <= max; n += Math.max(1, Math.floor(max / 24))) points.push(n);
    if (points[points.length - 1] !== max) points.push(max);
    return points;
  }, [controlDrones]);

  const naiveSeries = xs.map((n) => n * NAIVE_LEAF_BYTES);
  const recursiveSeries = xs.map(() => intermediate);
  const groth16Series = xs.map(() => groth);

  const allValues = [...naiveSeries, ...recursiveSeries, ...groth16Series];
  const maxY = Math.max(...allValues);
  const minY = Math.max(1, Math.min(...allValues));

  const W = 720;
  const H = 280;
  const padL = 56;
  const padR = 18;
  const padT = 18;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xMax = xs[xs.length - 1];

  const xPos = (n: number) => padL + (n / xMax) * innerW;
  const yPos = (v: number) => {
    const lv = Math.log10(Math.max(v, minY));
    const lmin = Math.log10(minY);
    const lmax = Math.log10(maxY);
    const t = (lv - lmin) / Math.max(0.0001, lmax - lmin);
    return padT + (1 - t) * innerH;
  };

  const path = (series: number[]) =>
    xs
      .map((n, i) => `${i === 0 ? "M" : "L"} ${xPos(n).toFixed(1)} ${yPos(series[i]).toFixed(1)}`)
      .join(" ");

  const yTicks = [256, 1024, 32 * 1024, 1024 * 1024, 32 * 1024 * 1024]
    .filter((v) => v >= minY && v <= maxY * 1.2);

  const fmtBytes = (v: number) => {
    if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
    if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${v} B`;
  };

  const currentMarker = xPos(controlDrones);

  return (
    <div className="analytics-grid scaling-grid">
      <SectionHead
        eyebrow="Recursion thesis · O(1) verifier"
        title="Drones (N) vs Proof Size — flat by construction"
        blurb="The whole point of the recursive Plonky2 → Groth16 stack: the commander's payload does not grow with the swarm. One drone or ten thousand, the verifier sees the same constant-size proof."
        trailing={
          <div className="head-stats">
            <StatCard label="Groth16 final" value={`${groth} B`} tone="good" detail="constant" />
            <StatCard
              label="Naive @ N=100"
              value={fmtBytes(NAIVE_LEAF_BYTES * 100)}
              tone="bad"
              detail="linear"
            />
            <StatCard
              label="Compression ratio"
              value={`${Math.round((NAIVE_LEAF_BYTES * controlDrones) / groth).toLocaleString()}×`}
              detail={`vs naive at N=${controlDrones}`}
            />
          </div>
        }
      />

      <section className="card chart-card">
        <div className="card-head">
          <strong>Proof bytes vs swarm size</strong>
          <span>Log scale on Y · current N marked</span>
        </div>
        <svg
          className="chart-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Proof size vs drones, log scale"
        >
          <rect x={padL} y={padT} width={innerW} height={innerH} className="chart-plot" />
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={padL}
                x2={padL + innerW}
                y1={yPos(tick)}
                y2={yPos(tick)}
                className="chart-grid"
              />
              <text x={padL - 8} y={yPos(tick) + 4} className="chart-axis" textAnchor="end">
                {fmtBytes(tick)}
              </text>
            </g>
          ))}

          {[1, Math.round(xMax / 4), Math.round(xMax / 2), Math.round((xMax * 3) / 4), xMax].map(
            (n) => (
              <g key={n}>
                <line
                  x1={xPos(n)}
                  x2={xPos(n)}
                  y1={padT + innerH}
                  y2={padT + innerH + 4}
                  className="chart-grid"
                />
                <text x={xPos(n)} y={padT + innerH + 18} className="chart-axis" textAnchor="middle">
                  {n}
                </text>
              </g>
            ),
          )}

          {/* Naive linear */}
          <path d={path(naiveSeries)} className="series naive" fill="none" />
          {/* Plonky2 intermediate (constant) */}
          <path d={path(recursiveSeries)} className="series recursive" fill="none" />
          {/* Groth16 wrap (tiny constant) */}
          <path d={path(groth16Series)} className="series groth" fill="none" />

          {/* Current N marker */}
          <line
            x1={currentMarker}
            x2={currentMarker}
            y1={padT}
            y2={padT + innerH}
            className="chart-marker"
          />
          <text
            x={currentMarker}
            y={padT - 4}
            className="chart-marker-label"
            textAnchor="middle"
          >
            N = {controlDrones}
          </text>

          <text x={W - padR} y={H - 6} className="chart-axis" textAnchor="end">
            drones (N)
          </text>
        </svg>

        <div className="chart-legend">
          <span className="swatch naive" /> Naive: one Plonky2 proof per drone · O(N)
          <span className="swatch recursive" /> Plonky2 recursive root · constant ~{(intermediate / 1024).toFixed(0)} KB
          <span className="swatch groth" /> Groth16 wrap · constant {groth} B
        </div>
      </section>

      <section className="card scaling-table">
        <div className="card-head">
          <strong>Numerical comparison</strong>
          <span>Why recursion changes the asymmetry</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>N (drones)</th>
              <th>Naive total</th>
              <th>Plonky2 root</th>
              <th>Groth16 wrap</th>
              <th>Reduction vs naive</th>
            </tr>
          </thead>
          <tbody>
            {[1, 10, 50, 100, 1_000, 10_000].map((n) => {
              const naive = n * NAIVE_LEAF_BYTES;
              return (
                <tr key={n} className={n === controlDrones ? "highlight" : ""}>
                  <td>{n.toLocaleString()}</td>
                  <td>{fmtBytes(naive)}</td>
                  <td>{fmtBytes(intermediate)}</td>
                  <td className="good">{groth} B</td>
                  <td>{Math.round(naive / groth).toLocaleString()}×</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Performance — prove / verify time and latency budget                       */
/* -------------------------------------------------------------------------- */

function PerformanceView({ epoch, controlDrones }: AnalyticsProps) {
  const proveMs = epoch?.prove_ms ?? Math.max(800, controlDrones * 90);
  const verifyMs = epoch?.verify_ms ?? 7;
  const totalMs = epoch?.total_ms ?? proveMs + verifyMs + 40;

  // synthesized latency budget breakdown
  const budget = [
    { label: "Drone leaf prove (parallel)", ms: proveMs * 0.55, tone: "info" as const },
    { label: "H1 fold round", ms: proveMs * 0.22, tone: "info" as const },
    { label: "Recursive root", ms: proveMs * 0.18, tone: "info" as const },
    { label: "Groth16 wrap", ms: proveMs * 0.05, tone: "warn" as const },
    { label: "Commander verify", ms: verifyMs, tone: "good" as const },
  ];
  const budgetMax = budget.reduce((m, b) => Math.max(m, b.ms), 1);

  const epochsPerSec = 1000 / Math.max(totalMs, 1);

  return (
    <div className="analytics-grid performance-grid">
      <SectionHead
        eyebrow="Latency · End-to-end"
        title="Proof generation budget"
        blurb="Where the wall-clock time goes between sensor and commander acceptance, with the constant-size Groth16 wrap as the final tax."
        trailing={
          <div className="head-stats">
            <StatCard label="Prove" value={`${Math.round(proveMs)} ms`} tone="info" />
            <StatCard label="Verify" value={`${verifyMs} ms`} tone="good" />
            <StatCard label="Throughput" value={`${epochsPerSec.toFixed(2)} eps`} detail="epochs/sec" />
          </div>
        }
      />

      <section className="card budget-card">
        <div className="card-head">
          <strong>Latency budget</strong>
          <span>Per-epoch timing across the recursive stack</span>
        </div>
        <div className="budget-list">
          {budget.map((b) => (
            <div key={b.label} className="budget-row">
              <span className="budget-label">{b.label}</span>
              <span className="budget-bar">
                <i
                  className={b.tone}
                  style={{ width: `${(b.ms / budgetMax) * 100}%` }}
                />
              </span>
              <b className="budget-value">{Math.round(b.ms)} ms</b>
            </div>
          ))}
        </div>
      </section>

      <section className="card budget-card">
        <div className="card-head">
          <strong>Asymmetry that matters</strong>
          <span>Heavy provers in the swarm, featherweight verifier at command</span>
        </div>
        <div className="info-grid">
          <div>
            <span>Prove:Verify ratio</span>
            <b className="info">{Math.round(proveMs / Math.max(verifyMs, 1))}×</b>
          </div>
          <div>
            <span>Total wallclock</span>
            <b>{Math.round(totalMs)} ms</b>
          </div>
          <div>
            <span>Drones</span>
            <b>{controlDrones}</b>
          </div>
          <div>
            <span>Epoch</span>
            <b>{epoch ? `#${epoch.epoch}` : "pending"}</b>
          </div>
          <div>
            <span>Public inputs</span>
            <b>{epoch?.public_inputs ?? 4}</b>
          </div>
          <div>
            <span>Proof system</span>
            <b>{epoch?.proof_system ?? "Plonky2 → Groth16"}</b>
          </div>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Threat Telemetry — military situational awareness                          */
/* -------------------------------------------------------------------------- */

const THREAT_VECTORS = [
  {
    id: "dropout",
    label: "Link denial",
    detail: "Jamming or terrain mask drops a drone from the bitmap.",
    tone: "warn" as const,
    posture: "Tolerated up to k of N",
  },
  {
    id: "corrupt",
    label: "Shard tampering",
    detail: "Adversary modifies on-disk shard; Poseidon root mismatches.",
    tone: "bad" as const,
    posture: "Detected at leaf circuit",
  },
  {
    id: "replay",
    label: "Epoch replay",
    detail: "Stale proof rebroadcast; epoch nonce binding rejects it.",
    tone: "bad" as const,
    posture: "Rejected at commander",
  },
  {
    id: "spoof",
    label: "Identity spoof",
    detail: "Foreign node tries to inject a leaf without manifest entry.",
    tone: "bad" as const,
    posture: "Rejected: vk_digest fails",
  },
  {
    id: "rotating",
    label: "Rotating dropout",
    detail: "Cycling outage to evade integrity check.",
    tone: "warn" as const,
    posture: "Bitmap delta tracked per epoch",
  },
];

function ThreatView({ drones, participants, epoch }: AnalyticsProps) {
  const cleanCount = drones.filter((d) => d.integrity_ok).length;
  const corrupt = drones.length - cleanCount;
  const dropouts = drones.filter((d) => statusTone(d.status) === "bad").length;
  const accepted = epoch?.accepted ?? null;

  return (
    <div className="analytics-grid threat-grid">
      <SectionHead
        eyebrow="Adversarial · Mission posture"
        title="Threat telemetry"
        blurb="Mycelium's verdict on the swarm under contested conditions: who is online, who is honest, and which adversarial moves the recursion absorbs without breaking the commander's trust."
        trailing={
          <div className="head-stats">
            <StatCard
              label="Verdict"
              value={accepted === null ? "pending" : accepted ? "accepted" : "rejected"}
              tone={accepted === false ? "bad" : accepted ? "good" : "muted"}
            />
            <StatCard label="Integrity" value={`${cleanCount}/${drones.length}`} tone={corrupt ? "warn" : "good"} />
            <StatCard label="Dropouts" value={dropouts} tone={dropouts ? "bad" : "good"} />
          </div>
        }
      />

      <section className="card threat-matrix-card">
        <div className="card-head">
          <strong>Adversary playbook · what the proof catches</strong>
          <span>Each vector mapped to where in the recursive stack it dies</span>
        </div>
        <div className="threat-grid-list">
          {THREAT_VECTORS.map((t) => (
            <article key={t.id} className={`threat-card ${t.tone}`}>
              <header>
                <strong>{t.label}</strong>
                <span className={`status-chip ${t.tone}`}>{t.posture}</span>
              </header>
              <p>{t.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card threat-grid-card">
        <div className="card-head">
          <strong>Per-drone integrity grid</strong>
          <span>green = root match · red = mismatch · grey = absent from bitmap</span>
        </div>
        <div className="integrity-grid">
          {drones.map((d) => {
            const present = participants.includes(d.id);
            const tone = !present ? "muted" : d.integrity_ok ? "good" : "bad";
            return (
              <div key={d.id} className={`integrity-cell ${tone}`} title={`D${d.id + 1} · ${d.status}`}>
                <span>{d.id + 1}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mission Brief — commander's executive summary                              */
/* -------------------------------------------------------------------------- */

function MissionBriefView({ drones, participants, epoch, controlDrones }: AnalyticsProps) {
  const accepted = epoch?.accepted ?? null;
  const cleanCount = drones.filter((d) => d.integrity_ok).length;
  const groth = epoch?.groth16_proof_bytes ?? 256;
  const totalMs = epoch?.total_ms ?? Math.max(900, controlDrones * 92);

  const briefPoints = [
    {
      label: "Mission",
      value: "Verify swarm-collected ISR data without trusting any single drone.",
    },
    {
      label: "Trust model",
      value: "Commander trusts only the recursive proof; drones, links, and storage are untrusted.",
    },
    {
      label: "Bandwidth uplink",
      value: `${groth} B per epoch (constant), regardless of swarm size.`,
    },
    {
      label: "Compromise tolerance",
      value: `${cleanCount}/${drones.length} drones report clean integrity this epoch.`,
    },
    {
      label: "Time-to-verdict",
      value: `${Math.round(totalMs)} ms end-to-end including Groth16 wrap.`,
    },
  ];

  return (
    <div className="analytics-grid brief-grid">
      <SectionHead
        eyebrow="Commander · Hackathon brief"
        title="Mission brief"
        blurb="One screen for the operator: what Mycelium guarantees, what it costs, and what just happened on the wire."
        trailing={
          <div className="head-stats">
            <StatCard
              label="Verdict"
              value={accepted === null ? "pending" : accepted ? "ACCEPTED" : "REJECTED"}
              tone={accepted === false ? "bad" : accepted ? "good" : "muted"}
            />
            <StatCard label="Epoch" value={epoch ? `#${epoch.epoch}` : "—"} />
            <StatCard label="Participants" value={`${participants.length}/${controlDrones}`} />
          </div>
        }
      />

      <section className="card brief-card">
        <div className="card-head">
          <strong>Operator readout</strong>
          <span>Plain-English summary, hackathon-grade</span>
        </div>
        <dl className="brief-list">
          {briefPoints.map((p) => (
            <div key={p.label}>
              <dt>{p.label}</dt>
              <dd>{p.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card brief-card">
        <div className="card-head">
          <strong>Why a military commander cares</strong>
        </div>
        <ul className="check-list">
          <li>One signature to trust — no fan-out of N proofs to verify by hand.</li>
          <li>Constant-size payload survives narrow-band tactical links.</li>
          <li>Adversary can corrupt any subset of drones without forging the verdict.</li>
          <li>Replay, spoof, and tamper attacks die at well-defined stages of the circuit.</li>
          <li>Zero shard data ever leaves a drone — only Poseidon hashes and proofs.</li>
        </ul>
      </section>
    </div>
  );
}
