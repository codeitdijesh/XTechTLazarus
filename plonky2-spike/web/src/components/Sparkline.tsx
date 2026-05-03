interface Props {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({ values, width = 120, height = 22, className }: Props) {
  if (values.length < 2) {
    return (
      <svg className={`spark ${className ?? ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return [x, y] as const;
  });

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  const fillPath = `${linePath} L${width.toFixed(2)},${height} L0,${height} Z`;

  return (
    <svg
      className={`spark ${className ?? ""}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path className="fill" d={fillPath} />
      <path className="line" d={linePath} />
    </svg>
  );
}
