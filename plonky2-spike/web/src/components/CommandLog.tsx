import type { CommandRecord } from "../lib/types";
import { PanelCorners } from "./PanelCorners";

interface Props {
  commands: CommandRecord[];
}

export function CommandLog({ commands }: Props) {
  return (
    <div className="panel">
      <PanelCorners />
      <div className="panel-title">
        <h2>Command Log</h2>
        <span className="badge">{commands.length} EVENTS</span>
      </div>
      <div className="rows">
        {commands.length === 0 ? (
          <div className="row muted">no commands sent</div>
        ) : (
          commands.map((c) => (
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
    </div>
  );
}
