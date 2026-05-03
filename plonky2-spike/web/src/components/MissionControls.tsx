import type { FaultKind, Target } from "../lib/types";
import { PanelCorners } from "./PanelCorners";

const COMMANDS: Array<{ key: string; label: string }> = [
  { key: "hold_position", label: "HOLD" },
  { key: "survey_grid", label: "SURVEY" },
  { key: "tighten_formation", label: "TIGHTEN" },
  { key: "return_to_base", label: "RTB" },
  { key: "resume_mission", label: "RESUME" },
];

const FAULTS: Array<{ key: FaultKind; label: string }> = [
  { key: "rotating", label: "rotating dropout" },
  { key: "none", label: "none" },
  { key: "dropout", label: "dropout" },
  { key: "corrupt", label: "corrupt shard" },
  { key: "replay", label: "replay epoch" },
];

interface Props {
  drones: number;
  fault: FaultKind;
  target: Target;
  targetDrone: number;
  fileName: string;
  fileContents: string;
  onChange: (
    next: Partial<{
      drones: number;
      fault: FaultKind;
      target: Target;
      targetDrone: number;
      fileName: string;
      fileContents: string;
    }>,
  ) => void;
  onCommand: (cmd: string) => void;
  onPushFile: () => void;
  onCheckIntegrity: () => void;
  busy: boolean;
}

export function MissionControls(p: Props) {
  return (
    <>
      <div className="panel">
        <PanelCorners />
        <div className="panel-title">
          <h2>Mission Controls</h2>
        </div>
        <div className="form-grid">
          <label>
            <span>Drones</span>
            <input
              type="number"
              min={1}
              max={100}
              value={p.drones}
              onChange={(e) => p.onChange({ drones: clampInt(e.target.value, 1, 100) })}
            />
          </label>
          <label>
            <span>Fault Mode</span>
            <select
              value={p.fault}
              onChange={(e) => p.onChange({ fault: e.target.value as FaultKind })}
            >
              {FAULTS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Target</span>
            <select
              value={p.target}
              onChange={(e) => p.onChange({ target: e.target.value as Target })}
            >
              <option value="all">all drones</option>
              <option value="drone">selected drone</option>
            </select>
          </label>
          <label>
            <span>Drone ID</span>
            <input
              type="number"
              min={0}
              max={Math.max(p.drones - 1, 0)}
              value={p.targetDrone}
              onChange={(e) =>
                p.onChange({ targetDrone: clampInt(e.target.value, 0, Math.max(p.drones - 1, 0)) })
              }
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <PanelCorners />
        <div className="panel-title">
          <h2>Common Commands</h2>
        </div>
        <div className="toolbar">
          {COMMANDS.map((c) => (
            <button
              key={c.key}
              onClick={() => p.onCommand(c.key)}
              disabled={p.busy}
              title={c.key}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <PanelCorners />
        <div className="panel-title">
          <h2>File Push</h2>
        </div>
        <div className="stack">
          <label>
            <span>File Name</span>
            <input
              value={p.fileName}
              onChange={(e) => p.onChange({ fileName: e.target.value })}
            />
          </label>
          <label>
            <span>Contents</span>
            <textarea
              value={p.fileContents}
              onChange={(e) => p.onChange({ fileContents: e.target.value })}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <button className="primary" onClick={p.onPushFile} disabled={p.busy}>
              Push File
            </button>
            <button className="danger" onClick={p.onCheckIntegrity} disabled={p.busy}>
              Verify Manifest
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function clampInt(s: string, lo: number, hi: number): number {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
