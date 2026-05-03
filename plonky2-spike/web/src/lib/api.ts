import type { DroneDetail, FaultKind, SwarmState, VerifiedEpoch } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
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
