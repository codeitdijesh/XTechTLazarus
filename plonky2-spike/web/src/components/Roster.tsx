import type { DroneSummary } from "../lib/types";
import { pad2, statusTone } from "../lib/util";
import { PanelCorners } from "./PanelCorners";

interface Props {
  drones: DroneSummary[];
  selected: number;
  onSelect: (id: number) => void;
}

export function Roster({ drones, selected, onSelect }: Props) {
  return (
    <div className="panel">
      <PanelCorners />
      <div className="panel-title">
        <h2>Fleet Roster</h2>
        <span className="badge">{drones.length} UNITS</span>
      </div>
      <div className="roster">
        {drones.map((d) => {
          const tone = statusTone(d.status);
          const bad = tone === "bad";
          return (
            <button
              key={d.id}
              className={`tile ${bad ? "bad" : ""} ${d.id === selected ? "selected" : ""}`}
              onClick={() => onSelect(d.id)}
              title={d.callsign}
            >
              <div className="id">DR-{pad2(d.id + 1)}</div>
              <div className={`st ${tone}`}>{d.status}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
