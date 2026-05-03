import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkIntegrity,
  dispatchCommand,
  fetchDrone,
  fetchEpoch,
  fetchSwarm,
  pushFile,
} from "./lib/api";
import type {
  DroneDetail,
  FaultKind,
  SwarmState,
  Target,
  VerifiedEpoch,
} from "./lib/types";
import { clamp } from "./lib/util";
import { BitmapRibbon } from "./components/BitmapRibbon";
import { CommandLog } from "./components/CommandLog";
import { Dossier } from "./components/Dossier";
import { Fleet3D } from "./components/Fleet3D";
import { Header } from "./components/Header";
import { Manifest } from "./components/Manifest";
import { MetricStrip, type MetricSeries } from "./components/MetricStrip";
import { MissionControls } from "./components/MissionControls";
import { Roster } from "./components/Roster";
import { Ticker } from "./components/Ticker";

const POLL_MS = 5000;
const SERIES_LEN = 32;

interface ControlState {
  drones: number;
  fault: FaultKind;
  target: Target;
  targetDrone: number;
  fileName: string;
  fileContents: string;
}

const INITIAL_CONTROL: ControlState = {
  drones: 10,
  fault: "rotating",
  target: "all",
  targetDrone: 0,
  fileName: "mission_update.json",
  fileContents:
    '{"route":"alpha","altitude":120,"rules":["hold-on-dropout","verify-before-act"]}',
};

const EMPTY_SERIES: MetricSeries = {
  totalMs: [],
  proveMs: [],
  verifyMs: [],
  proofBytes: [],
  verifiedRatio: [],
};

export function App() {
  const [control, setControl] = useState<ControlState>(INITIAL_CONTROL);
  const [epoch, setEpoch] = useState<VerifiedEpoch | null>(null);
  const [swarm, setSwarm] = useState<SwarmState | null>(null);
  const [drone, setDrone] = useState<DroneDetail | null>(null);
  const [series, setSeries] = useState<MetricSeries>(EMPTY_SERIES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always-fresh ref for the polling closure.
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

  const pushSeries = useCallback((ep: VerifiedEpoch) => {
    setSeries((prev) => {
      const push = (arr: number[], v: number) => {
        const next = arr.length >= SERIES_LEN ? arr.slice(arr.length - SERIES_LEN + 1) : arr.slice();
        next.push(v);
        return next;
      };
      return {
        totalMs: push(prev.totalMs, ep.total_ms),
        proveMs: push(prev.proveMs, ep.prove_ms),
        verifyMs: push(prev.verifyMs, ep.verify_ms),
        proofBytes: push(prev.proofBytes, ep.proof_bytes),
        verifiedRatio: push(
          prev.verifiedRatio,
          ep.verified_count / Math.max(ep.drone_count, 1),
        ),
      };
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
      pushSeries(ep);
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
  }, [pushSeries]);

  const refreshLight = useCallback(async () => {
    const c = controlRef.current;
    try {
      const [sw, dr] = await Promise.all([
        fetchSwarm(c.drones),
        fetchDrone(c.targetDrone),
      ]);
      setSwarm(sw);
      setDrone(dr);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, []);

  // Initial fetch + polling.
  useEffect(() => {
    refreshAll();
    const id = setInterval(refreshAll, POLL_MS);
    return () => clearInterval(id);
  }, [refreshAll]);

  // Re-fetch epoch when drone count or fault changes (skip first render via dep).
  const lastReqRef = useRef({ drones: control.drones, fault: control.fault });
  useEffect(() => {
    const last = lastReqRef.current;
    if (last.drones === control.drones && last.fault === control.fault) return;
    lastReqRef.current = { drones: control.drones, fault: control.fault };
    refreshAll();
  }, [control.drones, control.fault, refreshAll]);

  // Re-fetch dossier when target drone changes.
  useEffect(() => {
    fetchDrone(control.targetDrone)
      .then(setDrone)
      .catch(() => {});
  }, [control.targetDrone]);

  const onCommand = useCallback(
    async (cmd: string) => {
      setBusy(true);
      try {
        await dispatchCommand(
          { drones: control.drones, target: control.target, drone: control.targetDrone },
          cmd,
        );
        await refreshLight();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [control.drones, control.target, control.targetDrone, refreshLight],
  );

  const onPushFile = useCallback(async () => {
    setBusy(true);
    try {
      await pushFile(
        { drones: control.drones, target: control.target, drone: control.targetDrone },
        control.fileName,
        control.fileContents,
      );
      await refreshLight();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [control, refreshLight]);

  const onCheckIntegrity = useCallback(async () => {
    setBusy(true);
    try {
      await checkIntegrity(control.drones);
      await refreshLight();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [control.drones, refreshLight]);

  const drones = swarm?.drones ?? [];
  const participantIndices = useMemo(() => {
    const flags = epoch?.participants ?? [];
    const out: number[] = [];
    for (let i = 0; i < flags.length; i++) if (flags[i]) out.push(i);
    return out;
  }, [epoch]);
  const accepted = epoch?.accepted ?? null;
  const alarm = accepted === false;

  const reasonText = useMemo(() => {
    if (!epoch) return "awaiting verifier signal";
    return `${epoch.proof_system}: ${epoch.reason}`;
  }, [epoch]);

  return (
    <div className="app">
      <Header
        epoch={epoch}
        online={swarm?.online_count ?? 0}
        total={swarm?.drone_count ?? control.drones}
        integrityClean={swarm?.integrity_clean ?? true}
      />

      <MetricStrip epoch={epoch} swarm={swarm} series={series} />

      <div className="app-body">
        <div className="column scroll">
          <MissionControls
            drones={control.drones}
            fault={control.fault}
            target={control.target}
            targetDrone={control.targetDrone}
            fileName={control.fileName}
            fileContents={control.fileContents}
            onChange={updateControl}
            onCommand={onCommand}
            onPushFile={onPushFile}
            onCheckIntegrity={onCheckIntegrity}
            busy={busy}
          />
          <Roster
            drones={drones}
            selected={control.targetDrone}
            onSelect={(id) => updateControl({ targetDrone: id })}
          />
        </div>

        <div
          className="column center"
          style={{ display: "grid", gridTemplateRows: "1fr auto", gap: 12, minHeight: 0 }}
        >
          <div className={`stage panel flush ${alarm ? "alert" : ""}`}>
            <span className="stage-label tl">FLEET TOPOLOGY · LIVE</span>
            <span className="stage-label tr">
              {epoch ? `E-${String(epoch.epoch).padStart(6, "0")}` : "—"}
            </span>
            <span className="stage-label bl">RECURSIVE PROOF CHAIN</span>
            <span className="stage-label br">
              {epoch ? `${epoch.verified_count}/${epoch.drone_count} VERIFIED` : ""}
            </span>
            <div className="stage-overlay">
              <div className="crosshair" />
            </div>
            <div className="scanline" />
            <Fleet3D
              drones={drones}
              participants={participantIndices}
              selectedId={control.targetDrone}
              onSelect={(id) => updateControl({ targetDrone: id })}
              alarm={alarm}
            />
            <div className="stage-reason">
              <span className={`badge ${accepted === false ? "bad" : accepted ? "good" : ""}`}>
                {accepted === null ? "STANDBY" : accepted ? "VERIFIED" : "REJECTED"}
              </span>
              <span className="reason-text">{reasonText}</span>
            </div>
          </div>

          <BitmapRibbon epoch={epoch} droneCount={control.drones} />
        </div>

        <div className="column scroll">
          <Dossier drone={drone} />
          <Manifest files={swarm?.files ?? []} />
          <CommandLog commands={swarm?.commands ?? []} />
        </div>
      </div>

      <Ticker epoch={epoch} />

      {error && (
        <div
          style={{
            position: "fixed",
            bottom: 64,
            right: 16,
            padding: "10px 14px",
            border: "1px solid var(--blood)",
            background: "var(--blood-soft)",
            color: "var(--blood)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            zIndex: 10,
          }}
          onClick={() => setError(null)}
        >
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
