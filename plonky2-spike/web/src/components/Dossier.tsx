import type { DroneDetail } from "../lib/types";
import { statusTone } from "../lib/util";
import { PanelCorners } from "./PanelCorners";

interface Props {
  drone: DroneDetail | null;
}

export function Dossier({ drone }: Props) {
  return (
    <div className="panel">
      <PanelCorners />
      <div className="panel-title">
        <h2>Selected Dossier</h2>
        <span className="badge">
          {drone ? drone.callsign : "—"}
        </span>
      </div>

      {!drone ? (
        <div className="row muted">awaiting telemetry</div>
      ) : (
        <>
          <div className="detail-grid">
            <div className="kv">
              <div className="k">Status</div>
              <div className="v">
                <span className={`badge ${statusTone(drone.status)}`}>{drone.status}</span>
              </div>
            </div>
            <div className="kv">
              <div className="k">Last Proof</div>
              <div className="v">{drone.last_seen_epoch ? `#${drone.last_seen_epoch}` : "—"}</div>
            </div>
            <div className="kv">
              <div className="k">Battery</div>
              <div className="v">
                <div className={`bar ${drone.battery < 25 ? "bad" : drone.battery < 60 ? "warn" : ""}`}>
                  <span style={{ width: `${drone.battery}%` }} />
                </div>
                <div style={{ marginTop: 4 }}>{drone.battery}%</div>
              </div>
            </div>
            <div className="kv">
              <div className="k">Link</div>
              <div className="v">
                <div className={`bar info ${drone.link < 30 ? "bad" : ""}`}>
                  <span style={{ width: `${drone.link}%` }} />
                </div>
                <div style={{ marginTop: 4 }}>{drone.link}%</div>
              </div>
            </div>
            <div className="kv">
              <div className="k">Command</div>
              <div className="v">{drone.current_command || "—"}</div>
            </div>
            <div className="kv">
              <div className="k">Integrity</div>
              <div className="v">
                <span className={`badge ${drone.integrity_ok ? "good" : "bad"}`}>
                  {drone.integrity_ok ? "clean" : "fault"}
                </span>
              </div>
            </div>
          </div>

          <div className="section-head">Files</div>
          <div className="rows">
            {drone.files.length === 0 ? (
              <div className="row muted">no files on drone</div>
            ) : (
              drone.files.map((f) => (
                <div className="row" key={f.name + f.version}>
                  <div className="lhs">
                    <div className="v">{f.name}</div>
                    <div className="meta">{f.bytes} B · v{f.version}</div>
                    <div className="meta" style={{ color: "var(--ash)" }}>
                      <code>{f.hash.slice(0, 28)}…</code>
                    </div>
                  </div>
                  <span className="badge good">hash</span>
                </div>
              ))
            )}
          </div>

          <div className="section-head">Commands</div>
          <div className="rows">
            {drone.commands.length === 0 ? (
              <div className="row muted">no command history</div>
            ) : (
              drone.commands.map((c) => (
                <div className="row" key={c.id}>
                  <div className="lhs">
                    <div className="v">{c.command}</div>
                    <div className="meta">{c.target}</div>
                  </div>
                  <span className="badge info">×{c.delivered}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
