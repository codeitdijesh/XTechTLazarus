import type { FileManifestEntry } from "../lib/types";
import { PanelCorners } from "./PanelCorners";

interface Props {
  files: FileManifestEntry[];
}

export function Manifest({ files }: Props) {
  return (
    <div className="panel">
      <PanelCorners />
      <div className="panel-title">
        <h2>Manifest</h2>
        <span className="badge">{files.length} ENTRIES</span>
      </div>
      <div className="rows">
        {files.length === 0 ? (
          <div className="row muted">no files pushed</div>
        ) : (
          files.map((f) => (
            <div className="row" key={f.name + f.version}>
              <div className="lhs">
                <div className="v">{f.name}</div>
                <div className="meta">{f.bytes} B · v{f.version} · {f.expected_drones.length} drones</div>
                <div className="meta" style={{ color: "var(--ash-2)" }}>
                  <code>{f.hash.slice(0, 32)}…</code>
                </div>
              </div>
              <span className="badge good">poseidon</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
