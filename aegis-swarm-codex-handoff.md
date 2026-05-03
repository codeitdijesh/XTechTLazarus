# Aegis Swarm — Current Build Handoff

## Current Direction

Aegis Swarm is now a **Plonky2-only laptop/backpack verifier demo**.

The ESP32/Groth16 path has been removed from the active implementation. Do not
reintroduce ESP32 verification, BN254 wrapping, Groth16, Circom, or snarkjs
without an explicit architecture decision.

## Active Demo

- Proving system: Plonky2.
- Native field: Goldilocks.
- Hash function: Plonky2 Poseidon over Goldilocks.
- Verifier device: laptop, framed as a field/backpack edge computer.
- Dashboard source of truth: verifier-approved JSON from the laptop verifier.

The active code is in `plonky2-spike/`.

## What Works Today

The laptop verifier:

- builds native Plonky2 step circuits,
- proves each participating drone shard is included in the expected Poseidon
  Merkle root,
- binds epoch, command-center nonce, Merkle root, input bitmap, and output
  bitmap as public inputs,
- recursively verifies the previous step proof inside Plonky2,
- enforces bitmap continuity and no double-attesting for the current drone bit,
- serves JSON at `/api/epoch`,
- serves a static dashboard at `/`.
- maintains local swarm state for command dispatch, file pushes, per-drone
  inspection, and manifest integrity checks.
- attempts to launch a real ns-3 MANET sidecar for command/file/integrity and
  proof-attestation delivery.

The participation bitmap is encoded as four `u32` limbs, covering up to 128
drones while staying canonical in Goldilocks. The demo clamps to 100 drones.

Fault handling is implemented:

- dropout leaves the drone bit unset and the epoch can still verify,
- corrupt shard fails proof generation/verification,
- replay produces a stale nonce public input and is rejected by the verifier.
- repeated `(epoch, nonce)` pairs are rejected by the verifier.

Command-center backend endpoints:

- `GET /api/swarm?drones=N` returns fleet state, manifest, and recent commands.
- `GET /api/drone?id=N` returns one drone's files and command history.
- `GET /api/manet` returns ns-3 availability, recent events, and last metrics.
- `POST /api/command` routes a common command through the MANET sidecar and
  records state only for delivered drones.
- `POST /api/files` routes file delivery through the MANET sidecar and stores
  expected Poseidon file digests only for delivered drones.
- `POST /api/integrity` probes over MANET and recomputes expected file state for
  responding drones.

The sidecar source is `plonky2-spike/ns3/aegis-manet-sidecar.cc`; the runner is
`plonky2-spike/scripts/run-ns3-sidecar.sh`. ns-3 is expected as an external
install via `NS3_ROOT` or `AEGIS_NS3_SIDECAR`. If unavailable, the dashboard
stays up but MANET mutations return explicit errors.

## Run

```sh
cd plonky2-spike
cargo run --release
cargo run --release -- --drones 100
cargo run --release -- --serve
```

Dashboard:

```text
http://127.0.0.1:8787/
```

Useful API checks:

```text
http://127.0.0.1:8787/api/epoch?drones=10
http://127.0.0.1:8787/api/epoch?drones=100
http://127.0.0.1:8787/api/epoch?fault=corrupt
http://127.0.0.1:8787/api/epoch?fault=replay
```

## Next Work

- Make proving less expensive for N=100 if that needs to be interactive.
- Add explicit benchmark output or Criterion-style benchmark tests for N=10 and
  N=100.
- Add tests for repeated API epochs.
- Replace deterministic demo shard data with whatever real mission/shard input
  format is chosen.

## Verified Locally

Commands run successfully:

```sh
cd plonky2-spike
cargo test --release -- --nocapture
cargo run --release -- --drones 3
cargo run --release -- --drones 10
cargo run --release -- --drones 100
```

Measured one-shot results on the current laptop:

- 3 drones: accepted, 13 public inputs, 127296-byte final proof, about 1.0s
  total.
- 10 drones: accepted, 13 public inputs, 127296-byte final proof, about 4.3s
  total.
- 100 drones: accepted, 13 public inputs, 127296-byte final proof, about 50.6s
  total.

Use N=10 for live dashboard demos. Use N=100 as a capability/benchmark run.

## Pitch Framing

Say:

- "recursive STARK aggregation via Plonky2"
- "field laptop/backpack verifier"
- "verifier-approved edge view"

Do not claim:

- ESP32 verification,
- Groth16 wrapping,
- hardware impersonation defense,
- real MANET implementation,
- real drone communication,
- production shard source integration.
