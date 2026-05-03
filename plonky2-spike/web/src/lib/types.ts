export type ProofMode = "recursive_chain" | string;

export interface VerifiedEpoch {
  epoch: number;
  drone_count: number;
  accepted: boolean;
  reason: string;
  implemented_proof_mode: ProofMode;
  participation_bitmap: [number, number, number, number];
  participants: boolean[];
  dropouts: number[];
  verified_count: number;
  proof_bytes: number;
  public_inputs: number;
  prove_ms: number;
  verify_ms: number;
  total_ms: number;
  proof_system: string;
}

export interface DroneFile {
  name: string;
  hash: string;
  bytes: number;
  version: number;
}

export interface FileManifestEntry {
  name: string;
  hash: string;
  bytes: number;
  version: number;
  expected_drones: number[];
}

export interface CommandRecord {
  id: number;
  command: string;
  target: string;
  delivered: number;
}

export interface IntegrityReport {
  accepted: true;
  clean: boolean;
  checked_files: number;
  checked_drones: number;
  ok: number;
  missing: number;
  mismatched: number;
  bad: string[];
}

export interface DroneSummary {
  id: number;
  callsign: string;
  status: string;
  battery: number;
  link: number;
  last_seen_epoch: number;
  proof_verified: boolean;
  integrity_ok: boolean;
  current_command: string;
  file_count: number;
}

export interface DroneDetail {
  id: number;
  callsign: string;
  status: string;
  battery: number;
  link: number;
  last_seen_epoch: number;
  proof_verified: boolean;
  integrity_ok: boolean;
  current_command: string;
  files: DroneFile[];
  commands: CommandRecord[];
}

export interface SwarmState {
  drone_count: number;
  online_count: number;
  manifest_count: number;
  command_count: number;
  integrity_clean: boolean;
  last_integrity: IntegrityReport | null;
  files: FileManifestEntry[];
  commands: CommandRecord[];
  drones: DroneSummary[];
}

export type FaultKind =
  | "rotating"
  | "none"
  | "dropout"
  | "corrupt"
  | "replay";
