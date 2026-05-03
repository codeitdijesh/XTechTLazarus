# Aegis Swarm

Active demo path: Plonky2-only laptop/backpack verifier.

The original ESP32 verifier idea has been set aside for v1. The current demo
uses the laptop as the field edge device and keeps the proof path native
Plonky2: Goldilocks, Poseidon, and recursive Plonky2 verification.

## Run

```sh
cd plonky2-spike
cargo run --release
cargo run --release -- --drones 10
cargo run --release -- --drones 100
```

The one-shot command prints verifier-approved JSON and the success marker:

```text
AEGIS_PLONKY2_RECURSIVE_CHAIN_OK
```

The implemented proof path is a recursive Plonky2 chain. Each participating
drone step proves possession of its shard with a Poseidon Merkle inclusion
proof, carries epoch/root/bitmap public inputs, and recursively verifies the
previous step proof.

## Dashboard

```sh
cd plonky2-spike
cargo run --release -- --serve
```

Then open:

```text
http://127.0.0.1:8787/
```

The dashboard polls verifier-approved JSON from `/api/epoch`; it does not read
simulator ground truth.

The command-center controls are backed by local service state:

- `POST /api/command` dispatches common commands to all drones or one selected
  drone and records per-drone command history.
- `POST /api/files` pushes file contents into the selected swarm target and
  updates the expected file manifest with a Poseidon digest.
- `POST /api/integrity` recomputes every expected drone/file digest against the
  manifest and reports missing or mismatched files.
- `GET /api/drone?id=N` returns individual drone status, files, and command
  history.

This is still a laptop-local swarm backend. It does not claim radio transport,
MANET delivery, or real drone hardware integration.

Measured locally with `cargo run --release`:

- 3 drones: accepted, about 1.0s end to end.
- 10 drones: accepted, about 4.3s end to end.
- 100 drones: accepted, about 50.6s end to end.

Use 10 drones for a live demo. The 100-drone path works, but it is a benchmark
run rather than an interactive dashboard size on this laptop.

## Fault URLs

```text
http://127.0.0.1:8787/api/epoch?drones=10
http://127.0.0.1:8787/api/epoch?drones=100
http://127.0.0.1:8787/api/epoch?fault=corrupt
http://127.0.0.1:8787/api/epoch?fault=replay
```
