export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtKb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

// Status -> semantic colour token name (matches CSS variables in styles.css).
export function statusTone(status: string): "good" | "bad" | "info" | "warn" | "muted" {
  switch (status) {
    case "verified":
      return "good";
    case "dropout":
    case "proof rejected":
      return "bad";
    case "commanded":
      return "warn";
    case "file synced":
      return "info";
    default:
      return "muted";
  }
}

export function bitmapHex(bitmap: [number, number, number, number]): string {
  return bitmap
    .map((w) => (w >>> 0).toString(16).padStart(8, "0"))
    .join(" ");
}

// Each u32 word, MSB-first, into an array of 0/1 booleans.
export function bitmapBits(bitmap: [number, number, number, number]): boolean[] {
  const out: boolean[] = [];
  for (const w of bitmap) {
    const u = w >>> 0;
    for (let i = 31; i >= 0; i--) out.push(((u >>> i) & 1) === 1);
  }
  return out;
}

// Fibonacci sphere: deterministic uniform points on a unit sphere.
// Returns [x, y, z] for index i in a population of n.
export function fibonacciPoint(i: number, n: number): [number, number, number] {
  const offset = 2 / Math.max(n, 1);
  const increment = Math.PI * (3 - Math.sqrt(5));
  const y = i * offset - 1 + offset / 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * increment;
  return [Math.cos(phi) * r, y, Math.sin(phi) * r];
}
