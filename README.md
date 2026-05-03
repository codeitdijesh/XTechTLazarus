# Mycelium

Mycelium is a lightweight data verification layer for swarm drone networks. It lets a commander trust distributed mission data without downloading every shard: drones prove shard possession with Poseidon Merkle inclusion proofs, H1 aggregators fold those leaf proofs, and a recursive Plonky2 proof compresses the swarm state into one commander-verifiable verdict.

The current repo is the local proof-of-concept for that protocol. A laptop acts as the field edge verifier, the backend is a Rust service, the proof stack is native Plonky2 over Goldilocks/Poseidon, the dashboard is served from the verifier binary, and MANET delivery is modeled through an ns-3 sidecar when available.

## Core Protocol

- Drone leaves prove they hold expected data shards without exposing raw shard data.
- H1 aggregator nodes fold groups of drone proofs into a smaller proof state.
- A recursive Plonky2 root proof binds epoch, manifest root, nonce, and participation bitmap.
- The commander checks one compact proof instead of auditing every drone directly.
- Dropouts stay visible as unset bitmap bits, while corrupt or replayed data is rejected.

## Protocol Path

```text
drone shard -> Poseidon Merkle proof -> H1 aggregate fold
            -> recursive Plonky2 root proof -> commander verdict
```

Every proof step carries a stable public input shape:

- epoch nonce,
- expected Poseidon Merkle root,
- input participation bitmap limbs `[u32; 4]`,
- output participation bitmap limbs `[u32; 4]`.

The four bitmap limbs cover up to 128 drones. The demo clamps requests to 100 drones.

## Run Once

```sh
cd plonky2-spike
cargo run --release
cargo run --release -- --drones 10
cargo run --release -- --drones 100
```

The one-shot command prints verifier-approved JSON and a success marker. Use 10 drones for the live demo. The 100-drone path works, but it is better treated as a benchmark run on this laptop.

## Run The Dashboard

```sh
cd plonky2-spike
cargo run --release -- --serve
```

Open:

```text
http://127.0.0.1:8787/
```

The dashboard is a React + Three.js single-page app built into `plonky2-spike/web/dist/index.html` and embedded in the Rust binary with `include_str!`. The served page polls verifier-approved JSON from `/api/epoch`; it is not reading simulator ground truth.

## Dashboard Focus

- Rotatable swarm topology for the active drone count.
- Clickable drone, H1 aggregator, root, and commander nodes.
- Proof-focused side panel showing leaf proof state, shard/root integrity, bitmap inclusion, parent aggregator, and folded proof payload.
- Epoch metrics for accepted/rejected state, verified count, proof size, and timing.
- MANET status, command delivery, file placement, and integrity checks when the ns-3 sidecar is configured.

The dashboard is not meant to look like a generic telemetry cockpit. Its job is to explain the protocol path: leaf proof, aggregate fold, recursive root, commander decision.

## MANET Sidecar

Command, file, and integrity mutations are routed through the configured ns-3 MANET sidecar. Install ns-3 externally and set:

```sh
export NS3_ROOT=/path/to/ns-3
```

Then check and run:

```sh
cd plonky2-spike
scripts/check-ns3.sh
cargo run --release -- --serve
```

If ns-3 is unavailable, the dashboard still loads, but MANET actions are disabled and API mutations return explicit errors. There is no silent local fallback pretending MANET delivery happened.

When ns-3 runs, the sidecar writes `events.jsonl`, `metrics.csv`, and `deliveries.csv` under `plonky2-spike/runs/latest/` by default.

## API Endpoints

Read endpoints:

```text
GET /api/epoch?drones=10
GET /api/epoch?drones=100
GET /api/swarm?drones=10
GET /api/drone?id=2
GET /api/manet
```

Mutation endpoints used by the dashboard:

```text
POST /api/command
POST /api/files
POST /api/integrity
```

`/api/command` dispatches common commands to all drones or one selected drone through the MANET sidecar and records per-drone command history only for delivered drones. `/api/files` pushes file contents into the selected swarm target and updates the expected file manifest with a Poseidon digest after MANET delivery. `/api/integrity` probes over MANET, then recomputes responding drone/file state against the manifest and reports missing or mismatched files. `/api/manet` returns ns-3 availability, recent events, and last delivery metrics.

## Fault Modes

Manual checks:

```text
http://127.0.0.1:8787/api/epoch?drones=10
http://127.0.0.1:8787/api/epoch?fault=dropout
http://127.0.0.1:8787/api/epoch?fault=corrupt
http://127.0.0.1:8787/api/epoch?fault=replay
```

Dropout is represented by an unset participation bit and can still produce an accepted epoch. Corrupt shard and replay faults are rejected.

## Rebuild The Frontend

The committed bundle is enough to run the demo from Rust. Rebuild only after changing files under `plonky2-spike/web`.

```sh
cd plonky2-spike/web
npm install
npm run build
cd ..
cargo build --release
```

For frontend development with hot reload:

```sh
cd plonky2-spike/web
npm run dev
```

Vite serves the app on `http://127.0.0.1:5173/` and proxies `/api/*` to the Rust server on `:8787`.

## Tests

```sh
cd plonky2-spike
cargo test --release -- --nocapture
```

The tests cover a valid small chain, corrupt shard rejection, replay rejection, and dropout acceptance with the missing bit preserved.

## Local Measurements

Measured locally with `cargo run --release`:

- 3 drones: accepted, about 1.0s end to end.
- 10 drones: accepted, about 4.3s end to end.
- 100 drones: accepted, about 50.6s end to end.

These numbers are laptop-local measurements, not production performance claims.

## Project Layout

```text
plonky2-spike/
  src/main.rs          Rust verifier, API server, proof logic, demo state
  web/                 React + Three.js dashboard source
  web/dist/index.html  Built dashboard embedded by the Rust server
  runs/latest/         ns-3 sidecar event and metric outputs
  rust-toolchain.toml  Nightly Rust pin for Plonky2
```

Plonky2 currently requires nightly Rust because `plonky2_field` uses specialization. This repo pins the required toolchain in `plonky2-spike/rust-toolchain.toml`.

## Scope

This project demonstrates Mycelium's proof and verifier path for swarm-drone data integrity. It is a local protocol prototype with recursive proofs, manifests, MANET simulation hooks, commands, and integrity checks. It does not claim physical drone hardware integration, production radio firmware, or an ESP32 verifier in v1.
