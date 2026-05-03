import { useMemo } from "react";
import type { VerifiedEpoch } from "../lib/types";
import { bitmapBits, bitmapHex } from "../lib/util";
import { PanelCorners } from "./PanelCorners";

interface Props {
  epoch: VerifiedEpoch | null;
  droneCount: number;
}

export function BitmapRibbon({ epoch, droneCount }: Props) {
  const dropoutSet = useMemo(() => new Set(epoch?.dropouts ?? []), [epoch]);
  const bits = useMemo(
    () => (epoch ? bitmapBits(epoch.participation_bitmap) : []),
    [epoch],
  );
  const sliced = bits.slice(0, droneCount);

  return (
    <div className="panel">
      <PanelCorners />
      <div className="panel-title">
        <h2>Participation Bitmap</h2>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", color: "var(--ash)" }}>
          {epoch ? bitmapHex(epoch.participation_bitmap) : "00000000 00000000 00000000 00000000"}
        </span>
      </div>
      <div className="ribbon" style={{ gridTemplateColumns: `repeat(${Math.max(droneCount, 1)}, minmax(6px, 1fr))` }}>
        {Array.from({ length: Math.max(droneCount, 1) }).map((_, i) => {
          const on = sliced[i];
          const isDropout = dropoutSet.has(i);
          const cls = on ? "on" : isDropout ? "dropout" : "idle";
          return <span className={`cell ${cls}`} key={i} title={`drone ${i}`} />;
        })}
      </div>
    </div>
  );
}
