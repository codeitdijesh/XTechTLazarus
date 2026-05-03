export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtKb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

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

