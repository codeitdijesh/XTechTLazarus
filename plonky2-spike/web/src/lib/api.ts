import type {
  CommandRecord,
  DroneDetail,
  FaultKind,
  FileReceipt,
  IntegrityReport,
  SwarmState,
  Target,
  VerifiedEpoch,
} from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function postForm<T>(url: string, fields: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface EpochQuery {
  drones: number;
  fault: FaultKind;
  drone: number;
}

export function fetchEpoch(q: EpochQuery): Promise<VerifiedEpoch> {
  const params = new URLSearchParams({
    drones: String(q.drones),
    fault: q.fault,
    drone: String(q.drone),
  });
  return getJson<VerifiedEpoch>(`/api/epoch?${params}`);
}

export function fetchSwarm(drones: number): Promise<SwarmState> {
  return getJson<SwarmState>(`/api/swarm?drones=${drones}`);
}

export function fetchDrone(id: number): Promise<DroneDetail> {
  return getJson<DroneDetail>(`/api/drone?id=${id}`);
}

export interface MutationBase {
  drones: number;
  target: Target;
  drone: number;
}

export function dispatchCommand(
  base: MutationBase,
  command: string,
): Promise<CommandRecord & { accepted: boolean }> {
  return postForm("/api/command", {
    drones: String(base.drones),
    target: base.target,
    drone: String(base.drone),
    command,
  });
}

export function pushFile(
  base: MutationBase,
  name: string,
  contents: string,
): Promise<FileReceipt> {
  return postForm("/api/files", {
    drones: String(base.drones),
    target: base.target,
    drone: String(base.drone),
    name,
    contents,
  });
}

export function checkIntegrity(drones: number): Promise<IntegrityReport> {
  return postForm("/api/integrity", { drones: String(drones) });
}
