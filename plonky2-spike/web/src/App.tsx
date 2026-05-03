import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDrone, fetchEpoch, fetchSwarm } from "./lib/api";
import type {
  DroneDetail,
  DroneSummary,
  FaultKind,
  SwarmState,
  VerifiedEpoch,
} from "./lib/types";
import { clamp, statusTone } from "./lib/util";
import { Fleet3D } from "./components/Fleet3D";
import { Header } from "./components/Header";

const POLL_MS = 5000;

const PROOF_PHASES = [
  {
    label: "Collecting leaves",
    detail: "Each drone contributes its shard witness and participation bit.",
  },
  {
    label: "Checking leaf proofs",
    detail: "Poseidon Merkle inclusion is checked for each participating drone.",
  },
  {
    label: "Merging recursively",
    detail: "Step proofs fold into one recursive Plonky2 proof.",
  },
  {
    label: "Binding public inputs",
    detail: "Epoch, root, and bitmap limbs are checked against verifier state.",
  },
  {
    label: "Proof accepted",
    detail: "Commander accepts one compact proof for the swarm.",
  },
] as const;

const TREE_HEIGHTS = [
  {
    height: 0,
    title: "Leaf exchange",
    from: "Drone node",
    to: "Height-1 aggregator",
    exchanged: [
      "epoch nonce",
      "shard hash",
      "Merkle path",
      "participation bit",
      "step proof",
    ],
    summary:
      "A leaf proves it owns the expected shard without sending the shard itself.",
  },
  {
    height: 1,
    title: "Recursive merge",
    from: "Aggregator",
    to: "Recursive core",
    exchanged: [
      "child proof digest",
      "public input limbs",
      "bitmap delta",
      "Merkle root",
    ],
    summary:
      "The parent verifies child proofs, folds their public inputs, and emits another proof with the same shape.",
  },
  {
    height: 2,
    title: "Root verification",
    from: "Recursive core",
    to: "Commander verifier",
    exchanged: [
      "root proof",
      "final bitmap",
      "epoch",
      "expected root",
      "proof size",
    ],
    summary:
      "The verifier checks one compact root proof instead of every drone proof individually.",
  },
] as const;

interface ControlState {
  drones: number;
  fault: FaultKind;
  targetDrone: number;
}

interface ProofSimulation {
  running: boolean;
  step: number;
  runId: number;
}

type InspectorSelection =
  | { type: "commander" }
  | { type: "drone"; id: number }
  | { type: "layer"; height: 0 | 1 | 2 }
  | { type: "aggregator"; id: number; members: number[] }
  | { type: "core" };

const INITIAL_CONTROL: ControlState = {
  drones: 10,
  fault: "none",
  targetDrone: 0,
};

const INITIAL_SIMULATION: ProofSimulation = {
  running: false,
  step: 0,
  runId: 0,
};

export function App() {
  const [control, setControl] = useState<ControlState>(INITIAL_CONTROL);
  const [epoch, setEpoch] = useState<VerifiedEpoch | null>(null);
  const [swarm, setSwarm] = useState<SwarmState | null>(null);
  const [drone, setDrone] = useState<DroneDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<InspectorSelection>({ type: "commander" });
  const [proofSimulation, setProofSimulation] =
    useState<ProofSimulation>(INITIAL_SIMULATION);

  const controlRef = useRef(control);
  controlRef.current = control;
  const inFlightRef = useRef(false);

  const updateControl = useCallback((patch: Partial<ControlState>) => {
    setControl((prev) => {
      const next = { ...prev, ...patch };
      if (patch.drones !== undefined) {
        next.drones = clamp(patch.drones, 1, 100);
        next.targetDrone = clamp(next.targetDrone, 0, next.drones - 1);
      }
      if (patch.targetDrone !== undefined) {
        next.targetDrone = clamp(patch.targetDrone, 0, next.drones - 1);
      }
      return next;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const c = controlRef.current;
    try {
      const ep = await fetchEpoch({
        drones: c.drones,
        fault: c.fault,
        drone: c.targetDrone,
      });
      setEpoch(ep);
      const [sw, dr] = await Promise.all([
        fetchSwarm(c.drones),
        fetchDrone(c.targetDrone),
      ]);
      setSwarm(sw);
      setDrone(dr);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    refreshAll();
    const id = setInterval(refreshAll, POLL_MS);
    return () => clearInterval(id);
  }, [refreshAll]);

  const lastReqRef = useRef({ drones: control.drones, fault: control.fault });
  useEffect(() => {
    const last = lastReqRef.current;
    if (last.drones === control.drones && last.fault === control.fault) return;
    lastReqRef.current = { drones: control.drones, fault: control.fault };
    refreshAll();
  }, [control.drones, control.fault, refreshAll]);

  useEffect(() => {
    fetchDrone(control.targetDrone)
      .then(setDrone)
      .catch(() => {});
  }, [control.targetDrone]);

  useEffect(() => {
    if (!proofSimulation.running) return;
    const id = window.setTimeout(() => {
      setProofSimulation((prev) => {
        if (!prev.running) return prev;
        if (prev.step >= PROOF_PHASES.length - 1) {
          return { ...prev, running: false };
        }
        return { ...prev, step: prev.step + 1 };
      });
    }, 1250);
    return () => window.clearTimeout(id);
  }, [proofSimulation.running, proofSimulation.step, proofSimulation.runId]);

  const displayDrones = useMemo(() => {
    const source =
      swarm?.drones.length === control.drones
        ? swarm.drones
        : makePlaceholderDrones(control.drones);
    return source.map((drone) => ({
      ...drone,
      callsign: `Drone ${drone.id + 1}`,
    }));
  }, [control.drones, swarm]);

  const participantIndices = useMemo(() => {
    const flags = epoch?.participants ?? [];
    const out: number[] = [];
    for (let i = 0; i < flags.length; i++) if (flags[i]) out.push(i);
    return out;
  }, [epoch]);

  const simulatedParticipants = useMemo(() => {
    if (participantIndices.length > 0) return participantIndices;
    if (proofSimulation.runId === 0) return [];
    return displayDrones.map((d) => d.id);
  }, [displayDrones, participantIndices, proofSimulation.runId]);

  const graphParticipants = useMemo(
    () => (simulatedParticipants.length ? simulatedParticipants : displayDrones.map((d) => d.id)),
    [displayDrones, simulatedParticipants],
  );

  const selectedSummary = useMemo(() => {
    return (
      displayDrones.find((d) => d.id === control.targetDrone) ??
      displayDrones[0] ??
      null
    );
  }, [control.targetDrone, displayDrones]);

  const accepted = epoch?.accepted ?? null;
  const alarm = accepted === false;
  const phase = PROOF_PHASES[proofSimulation.step];
  const proofActive = proofSimulation.runId > 0;
  const aggregatorCount = Math.max(1, Math.ceil(graphParticipants.length / 4));

  const selectDrone = useCallback(
    (id: number) => {
      updateControl({ targetDrone: id });
      setSelection({ type: "drone", id });
      fetchDrone(id)
        .then((detail) => {
          setDrone(detail);
          setError(null);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        });
    },
    [updateControl],
  );

  const startProofSimulation = useCallback(() => {
    setProofSimulation((prev) => ({
      running: true,
      step: 0,
      runId: prev.runId + 1,
    }));
  }, []);

  return (
    <div className="app">
      <Header
        epoch={epoch}
        online={swarm?.online_count ?? displayDrones.length}
        total={swarm?.drone_count ?? control.drones}
        integrityClean={swarm?.integrity_clean ?? true}
      />

      <main className="visual-full">
        <div className={`stage full ${alarm ? "alert" : ""}`}>
          <div className="stage-topbar">
            <div className="control-strip">
              <label>
                <span>Drones</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={control.drones}
                  onChange={(e) =>
                    updateControl({ drones: clampInt(e.target.value, 1, 100) })
                  }
                />
              </label>
              <button
                className="primary simulate-button"
                onClick={startProofSimulation}
                type="button"
              >
                {proofSimulation.running ? "Running proof..." : "Run proof flow"}
              </button>
            </div>

            <ProofProcessStrip
              active={proofActive}
              step={proofSimulation.step}
              onInspect={setSelection}
              selection={selection}
            />
          </div>

          <div className="visualization-frame">
            <Fleet3D
              drones={displayDrones}
              participants={graphParticipants}
              selectedId={control.targetDrone}
              onSelect={selectDrone}
              onInspect={(next) => setSelection(next)}
              alarm={alarm}
              files={swarm?.files ?? []}
              colorScheme="paper"
              simulationActive={proofActive}
              simulationStep={proofSimulation.step}
            />
          </div>

          <CommanderInspector
            selection={selection}
            drones={displayDrones}
            participants={graphParticipants}
            summary={selectedSummary}
            detail={drone?.id === selectedSummary?.id ? drone : null}
            epoch={epoch}
            participantCount={graphParticipants.length}
            aggregatorCount={aggregatorCount}
            phase={phase}
            simulationStep={proofSimulation.step}
            simulationActive={proofActive}
            backendError={Boolean(error)}
          />
        </div>
      </main>

      {error && (
        <div className="toast error" onClick={() => setError(null)}>
          API unavailable: showing local visualization data.
        </div>
      )}
    </div>
  );
}

function ProofProcessStrip({
  active,
  step,
  onInspect,
  selection,
}: {
  active: boolean;
  step: number;
  onInspect: (selection: InspectorSelection) => void;
  selection: InspectorSelection;
}) {
  const steps: Array<{
    label: string;
    title: string;
    detail: string;
    unlockStep: number;
    selection: InspectorSelection;
  }> = [
    {
      label: "H0",
      title: "Drone leaves",
      detail: "shard hash + bit",
      unlockStep: 0,
      selection: { type: "layer", height: 0 },
    },
    {
      label: "H1",
      title: "Aggregator fold",
      detail: "fold child proofs",
      unlockStep: 2,
      selection: { type: "layer", height: 1 },
    },
    {
      label: "H2",
      title: "Root proof",
      detail: "recursive root",
      unlockStep: 3,
      selection: { type: "core" },
    },
    {
      label: "CMD",
      title: "Commander verdict",
      detail: "one accepted proof",
      unlockStep: 4,
      selection: { type: "commander" },
    },
  ];

  return (
    <div className="process-strip" aria-label="Recursive proof process">
      {steps.map((item) => {
        const complete = active && step >= item.unlockStep;
        const selected =
          item.selection.type === selection.type &&
          (item.selection.type !== "layer" ||
            (selection.type === "layer" &&
              item.selection.height === selection.height));
        return (
          <button
            key={item.label}
            type="button"
            className={`${complete ? "complete" : ""} ${selected ? "selected" : ""}`.trim()}
            onClick={() => onInspect(item.selection)}
          >
            <small>{item.label}</small>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </button>
        );
      })}
    </div>
  );
}

function CommanderInspector({
  selection,
  drones,
  participants,
  summary,
  detail,
  epoch,
  participantCount,
  aggregatorCount,
  phase,
  simulationStep,
  simulationActive,
  backendError,
}: {
  selection: InspectorSelection;
  drones: DroneSummary[];
  participants: number[];
  summary: DroneSummary | null;
  detail: DroneDetail | null;
  epoch: VerifiedEpoch | null;
  participantCount: number;
  aggregatorCount: number;
  phase: (typeof PROOF_PHASES)[number];
  simulationStep: number;
  simulationActive: boolean;
  backendError: boolean;
}) {
  const selectedDrone =
    selection.type === "drone"
      ? drones.find((drone) => drone.id === selection.id) ?? summary
      : summary;

  let title = "Commander";
  let subtitle = "Mycelium verifier dashboard";
  let body: JSX.Element;

  if (selection.type === "drone" && selectedDrone) {
    body = (
      <DroneInspectorContent
        summary={selectedDrone}
        detail={detail?.id === selectedDrone.id ? detail : null}
        epoch={epoch}
        participant={participants.includes(selectedDrone.id)}
        participantCount={participantCount}
      />
    );
    title = selectedDrone.callsign;
    subtitle = `Drone ${selectedDrone.id + 1} leaf node`;
  } else if (selection.type === "layer") {
    const card = TREE_HEIGHTS.find((item) => item.height === selection.height);
    title = card?.title ?? "Proof layer";
    subtitle = `Height ${selection.height}`;
    body = (
      <LayerInspectorContent
        height={selection.height}
        participantCount={participantCount}
        epoch={epoch}
        active={simulationActive}
      />
    );
  } else if (selection.type === "aggregator") {
    title = `H1 aggregator ${selection.id}`;
    subtitle = `${selection.members.length} child leaves`;
    body = (
      <AggregatorInspectorContent
        id={selection.id}
        members={selection.members}
        drones={drones}
        epoch={epoch}
      />
    );
  } else if (selection.type === "core") {
    title = "Recursive root";
    subtitle = "Final merge node";
    body = (
      <CoreInspectorContent
        participantCount={participantCount}
        epoch={epoch}
        simulationActive={simulationActive}
      />
    );
  } else {
    body = (
      <CommanderInspectorContent
        drones={drones}
        participantCount={participantCount}
        aggregatorCount={aggregatorCount}
        epoch={epoch}
        phase={phase}
        simulationStep={simulationStep}
        simulationActive={simulationActive}
        backendError={backendError}
      />
    );
  }

  return (
    <aside className="commander-inspector" aria-label="Commander verifier dashboard">
      <div className="inspector-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <span className="inspector-pill">
          {selection.type === "commander" ? "CMD" : selection.type.toUpperCase()}
        </span>
      </div>
      {body}
    </aside>
  );
}

function CommanderInspectorContent({
  drones,
  participantCount,
  aggregatorCount,
  epoch,
  phase,
  simulationStep,
  simulationActive,
  backendError,
}: {
  drones: DroneSummary[];
  participantCount: number;
  aggregatorCount: number;
  epoch: VerifiedEpoch | null;
  phase: (typeof PROOF_PHASES)[number];
  simulationStep: number;
  simulationActive: boolean;
  backendError: boolean;
}) {
  const cleanCount = drones.filter((drone) => drone.integrity_ok).length;
  const onlineCount = drones.length;
  const dropouts = drones.filter((drone) => statusTone(drone.status) === "bad").length;
  const bitmap = formatBitmap(epoch);
  const proofSource = backendError ? "api offline" : epoch ? "live verifier" : "connecting";
  const proofVerdict = epoch ? (epoch.accepted ? "accepted" : "rejected") : "pending";
  const proofMode = epoch?.implemented_proof_mode.replaceAll("_", " ") ?? "pending";

  return (
    <>
      <ProofFlowSection
        step={simulationStep}
        active={simulationActive}
        participantCount={participantCount || drones.length}
        aggregatorCount={aggregatorCount}
        verdict={proofVerdict}
        phaseLabel={phase.label}
      />

      <CheckSection
        title="How it works"
        items={[
          "drones create leaf proofs for their shard hashes",
          "H1 aggregators fold child proofs into grouped public inputs",
          "the commander checks one recursive root proof and bitmap",
        ]}
      />

      <div className="info-grid">
        <InfoMetric label="Fleet" value={`${onlineCount} nodes`} />
        <InfoMetric
          label="Leaves"
          value={`${participantCount || 0} proving`}
          meter={((participantCount || 0) / Math.max(drones.length, 1)) * 100}
        />
        <InfoMetric
          label="Integrity"
          value={`${cleanCount}/${drones.length} clean`}
          meter={(cleanCount / Math.max(drones.length, 1)) * 100}
          tone={cleanCount === drones.length ? "good" : "warn"}
        />
        <InfoMetric label="Dropouts" value={String(dropouts)} tone={dropouts ? "bad" : "good"} />
        <InfoMetric label="Epoch" value={epoch ? `#${epoch.epoch}` : "pending"} />
        <InfoMetric
          label="Proof source"
          value={proofSource}
          tone={backendError ? "warn" : epoch ? "good" : "muted"}
        />
        <InfoMetric
          label="Verdict"
          value={proofVerdict}
          tone={epoch?.accepted ? "good" : epoch ? "bad" : "muted"}
        />
        <InfoMetric label="Proof bytes" value={epoch ? `${epoch.proof_bytes} B` : "pending"} />
      </div>

      <div className="exchange-route">
        <InfoMetric label="Current step" value={simulationActive ? phase.label : "idle"} />
        <InfoMetric label="Engine" value={epoch?.proof_system ?? "Plonky2 backend"} />
        <InfoMetric label="Mode" value={proofMode} />
        <InfoMetric label="Public inputs" value={epoch?.public_inputs ?? "pending"} />
        <InfoMetric label="Bitmap limbs" value={bitmap} />
        <InfoMetric
          label="Timing"
          value={epoch ? `${epoch.prove_ms} ms prove / ${epoch.verify_ms} ms verify` : "pending"}
        />
      </div>

      <PayloadSection
        title="Root proof input"
        subtitle="What reaches the commander"
        items={[
          "root proof",
          "final participation bitmap",
          "epoch nonce",
          "expected Poseidon root",
          "public input vector",
        ]}
      />
      <CheckSection
        title="Commander decision"
        items={[
          "Plonky2 root proof verifies",
          "final bitmap matches participating drones",
          "epoch and Poseidon root match policy",
          "accepted root proof authorizes commander state",
        ]}
      />
    </>
  );
}

function DroneInspectorContent({
  summary,
  detail,
  epoch,
  participant,
  participantCount,
}: {
  summary: DroneSummary;
  detail: DroneDetail | null;
  epoch: VerifiedEpoch | null;
  participant: boolean;
  participantCount: number;
}) {
  const files = detail?.files ?? [];
  const command = detail?.current_command || summary.current_command || "standby";
  const latestFile = files[files.length - 1];
  const parentGroup = Math.floor(summary.id / 4);
  const proofState = summary.proof_verified ? "verified" : participant ? "queued" : "excluded";
  const integrityState = summary.integrity_ok ? "root match" : "root mismatch";
  const shardDigest = latestFile?.hash
    ? `${latestFile.hash.slice(0, 12)}...${latestFile.hash.slice(-8)}`
    : `local-node-${summary.id}`;

  return (
    <>
      <div className="info-grid">
        <InfoMetric label="Proof" value={proofState} tone={summary.proof_verified ? "good" : "warn"} />
        <InfoMetric label="Integrity" value={integrityState} tone={summary.integrity_ok ? "good" : "bad"} />
        <InfoMetric label="Bitmap" value={participant ? "1 / included" : "0 / absent"} />
        <InfoMetric label="Parent" value={`H1-${parentGroup}`} />
        <InfoMetric label="Shard files" value={`${files.length || summary.file_count}`} />
        <InfoMetric label="Command" value={command} />
      </div>

      <DroneProofStack summary={summary} participant={participant} />

      <div className="exchange-route">
        <InfoMetric
          label="Route"
          value={`Drone ${summary.id + 1} -> H1-${parentGroup} -> root -> commander`}
        />
        <InfoMetric label="Participants" value={`${participantCount || 0} leaves`} />
        <InfoMetric label="Shard digest" value={shardDigest} />
      </div>

      <PayloadSection
        title="Node sends upward"
        subtitle="No raw shard leaves the node"
        items={[
          `node_id=${summary.id}`,
          `epoch=${epoch?.epoch ?? "pending"}`,
          `parent_group=H1-${parentGroup}`,
          `leaf_hash=${shardDigest}`,
          `merkle_path=${latestFile ? "manifest path" : "simulated path"}`,
          `step_proof=${summary.proof_verified ? "verified" : "pending"}`,
        ]}
      />
      <PayloadSection
        title="Local state"
        subtitle="Commander-visible telemetry"
        items={[
          `manifest_entries=${files.length || summary.file_count}`,
          `latest_file=${latestFile ? latestFile.name : "none"}`,
          `leaf_proof=${proofState}`,
          `integrity=${integrityState}`,
        ]}
      />
      <CheckSection
        title="Parent aggregator checks"
        items={[
          "leaf hash recomputes into expected root",
          "only this node's bitmap bit changes",
          "epoch/root match the recursive public inputs",
          "child proof verifies before folding into parent proof",
        ]}
      />
    </>
  );
}

function LayerInspectorContent({
  height,
  participantCount,
  epoch,
  active,
}: {
  height: 0 | 1 | 2;
  participantCount: number;
  epoch: VerifiedEpoch | null;
  active: boolean;
}) {
  const card = TREE_HEIGHTS[height];
  const counts = height === 0
    ? `${participantCount || 0} leaves`
    : height === 1
      ? `${Math.max(1, Math.ceil((participantCount || 0) / 4))} aggregators`
      : "1 root proof";

  return (
    <>
      <div className="info-grid">
        <InfoMetric label="Layer" value={`height ${height}`} />
        <InfoMetric label="Nodes" value={counts} />
        <InfoMetric label="State" value={active ? "active" : "topology"} />
        <InfoMetric label="From" value={card.from} />
        <InfoMetric label="To" value={card.to} />
        <InfoMetric label="Epoch" value={epoch ? `#${epoch.epoch}` : "pending"} />
      </div>
      <PayloadSection
        title="Information exchanged"
        subtitle={card.summary}
        items={[...card.exchanged]}
      />
      <CheckSection
        title="Why recursion works here"
        items={[
          "each level verifies the proof objects below it",
          "the public input shape stays stable across levels",
          "bitmap changes accumulate without re-opening raw node data",
          "the commander only needs the final root proof",
        ]}
      />
    </>
  );
}

function AggregatorInspectorContent({
  id,
  members,
  drones,
  epoch,
}: {
  id: number;
  members: number[];
  drones: DroneSummary[];
  epoch: VerifiedEpoch | null;
}) {
  const memberLabels = members
    .map((member) => drones.find((drone) => drone.id === member)?.callsign ?? `Drone ${member + 1}`)
    .slice(0, 8);

  return (
    <>
      <div className="info-grid">
        <InfoMetric label="Aggregator" value={`H1-${id}`} />
        <InfoMetric label="Children" value={`${members.length} leaves`} />
        <InfoMetric label="Epoch" value={epoch ? `#${epoch.epoch}` : "pending"} />
      </div>
      <PayloadSection
        title="Children included"
        subtitle="Leaf proofs folded by this height-1 node"
        items={memberLabels.length ? memberLabels : ["no leaves selected yet"]}
      />
      <MemberStrip members={members} drones={drones} />
      <PayloadSection
        title="Aggregator emits"
        subtitle="One parent proof with the same public input contract"
        items={[
          "child proof digests",
          "folded participation bitmap",
          "expected Merkle root",
          "aggregator proof",
        ]}
      />
    </>
  );
}

function CoreInspectorContent({
  participantCount,
  epoch,
  simulationActive,
}: {
  participantCount: number;
  epoch: VerifiedEpoch | null;
  simulationActive: boolean;
}) {
  return (
    <>
      <div className="info-grid">
        <InfoMetric label="Core" value="recursive root" />
        <InfoMetric label="Leaves" value={`${participantCount || 0}`} />
        <InfoMetric label="State" value={simulationActive ? "merging" : "idle"} />
        <InfoMetric label="Proof bytes" value={epoch ? `${epoch.proof_bytes} B` : "pending"} />
        <InfoMetric label="Prove" value={epoch ? `${epoch.prove_ms} ms` : "pending"} />
        <InfoMetric label="Verify" value={epoch ? `${epoch.verify_ms} ms` : "pending"} />
      </div>
      <PayloadSection
        title="Root proof contains"
        subtitle="The final compact object sent to the commander"
        items={[
          "recursive proof",
          "final bitmap limbs",
          "epoch nonce",
          "expected root",
          "public input vector",
        ]}
      />
    </>
  );
}

function InfoMetric({
  label,
  value,
  tone,
  meter,
}: {
  label: string;
  value: string | number;
  tone?: "good" | "bad" | "info" | "warn" | "muted";
  meter?: number;
}) {
  const width = meter === undefined ? null : `${clamp(meter, 0, 100)}%`;
  return (
    <div className={meter === undefined ? "" : "has-meter"}>
      <span>{label}</span>
      <b className={tone}>{value}</b>
      {width && (
        <span className="metric-meter" aria-hidden>
          <i className={tone} style={{ width }} />
        </span>
      )}
    </div>
  );
}

function ProofFlowSection({
  step,
  active,
  participantCount,
  aggregatorCount,
  verdict,
  phaseLabel,
}: {
  step: number;
  active: boolean;
  participantCount: number;
  aggregatorCount: number;
  verdict: string;
  phaseLabel: string;
}) {
  const items = [
    { label: "Leaves", value: `${participantCount}`, detail: "drone shard proofs" },
    { label: "H1 fold", value: `${aggregatorCount}`, detail: "aggregate groups" },
    { label: "Root", value: "1", detail: "recursive proof" },
    { label: "CMD", value: verdict, detail: "commander gate" },
  ];

  return (
    <section className="flow-viz" aria-label="Proof flow state">
      <div className="flow-viz-head">
        <strong>{active ? phaseLabel : "Live proof topology"}</strong>
        <span>{participantCount} leaves folded into one commander verdict</span>
      </div>
      <div className="flow-viz-grid">
        {items.map((item, i) => {
          const reached = active && i <= Math.min(step, items.length - 1);
          const fill = active
            ? i < step
              ? 100
              : i === step
                ? 68
                : 12
            : i === 0
              ? 28
              : 12;
          return (
            <div key={item.label} className={`flow-node ${reached ? "active" : ""}`}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.value}</span>
              </div>
              <span className="flow-meter" aria-hidden>
                <i style={{ width: `${fill}%` }} />
              </span>
              <small>{item.detail}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DroneProofStack({
  summary,
  participant,
}: {
  summary: DroneSummary;
  participant: boolean;
}) {
  return (
    <div className="vital-stack" aria-label="Drone proof state">
      <VisualMeter
        label="Leaf proof"
        value={summary.proof_verified ? "verified" : participant ? "queued" : "excluded"}
        tone={summary.proof_verified ? "good" : participant ? "warn" : "muted"}
      />
      <VisualMeter
        label="Merkle path"
        value={summary.file_count > 0 ? "manifest backed" : "simulated path"}
        tone={summary.file_count > 0 ? "info" : "muted"}
      />
      <VisualMeter
        label="Bitmap inclusion"
        value={participant ? "included" : "absent"}
        tone={participant ? "info" : "muted"}
      />
      <VisualMeter
        label="Shard root"
        value={summary.integrity_ok ? "matches manifest" : "mismatch"}
        tone={summary.integrity_ok ? "good" : "bad"}
      />
    </div>
  );
}

function VisualMeter({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "info" | "warn" | "muted";
}) {
  return (
    <div className="visual-meter">
      <div>
        <span>{label}</span>
        <b className={tone}>{value}</b>
      </div>
      <span aria-hidden>
        <i className={tone} />
      </span>
    </div>
  );
}

function MemberStrip({
  members,
  drones,
}: {
  members: number[];
  drones: DroneSummary[];
}) {
  return (
    <div className="member-strip" aria-label="Aggregator child drones">
      {members.map((member) => {
        const drone = drones.find((item) => item.id === member);
        const tone = statusTone(drone?.status ?? "standby");
        return (
          <div key={member} className={`member-chip ${tone}`}>
            <strong>{drone?.callsign ?? `Drone ${member + 1}`}</strong>
            <span>
              {drone?.proof_verified ? "leaf proof verified" : "leaf proof queued"}
            </span>
            <em aria-hidden>
              <i
                className={drone?.proof_verified ? "good" : tone}
                style={{ width: `${drone?.proof_verified ? 100 : 42}%` }}
              />
            </em>
          </div>
        );
      })}
    </div>
  );
}

function PayloadSection({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: string[];
}) {
  return (
    <div className="exchange-panel">
      <div className="exchange-panel-head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="exchange-list compact">
        {items.map((item) => (
          <code key={item}>{item}</code>
        ))}
      </div>
    </div>
  );
}

function CheckSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="exchange-panel">
      <div className="exchange-panel-head">
        <strong>{title}</strong>
      </div>
      <ul className="check-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function formatBitmap(epoch: VerifiedEpoch | null): string {
  if (!epoch) return "pending";
  return epoch.participation_bitmap
    .map((word) => `0x${(word >>> 0).toString(16).padStart(8, "0")}`)
    .join(" ");
}

function makePlaceholderDrones(count: number): DroneSummary[] {
  return Array.from({ length: count }, (_, id) => {
    const rotatingDropout = id % 7 === 3;
    const status = rotatingDropout ? "dropout" : id % 4 === 0 ? "verified" : "standby";
    return {
      id,
      callsign: `Drone ${id + 1}`,
      status,
      battery: clamp(92 - ((id * 9) % 54), 18, 98),
      link: clamp(96 - ((id * 7) % 38), 35, 99),
      last_seen_epoch: 0,
      proof_verified: status === "verified",
      integrity_ok: !rotatingDropout,
      current_command: "standby",
      file_count: id % 3 === 0 ? 1 : 0,
    };
  });
}

function clampInt(s: string, lo: number, hi: number): number {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
