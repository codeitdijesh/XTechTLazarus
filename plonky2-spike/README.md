# Aegis Laptop Verifier

This is the active Aegis Swarm proof path after the pivot to a laptop/backpack
edge verifier. Plonky2 is the recursive aggregation layer; Groth16 is the
required final command-center wrap:

- native Goldilocks/Poseidon proof,
- Poseidon Merkle shard-possession proof,
- recursive Plonky2 chain verification,
- BN254 Groth16 final-stage wrapper,
- verifier-approved JSON epoch state,
- static dashboard sourced only from verifier output.

Plonky2 currently requires nightly Rust because `plonky2_field` uses
specialization. This directory pins `nightly` via `rust-toolchain.toml`.

## Run Once

```sh
cd plonky2-spike
cargo run --release
cargo run --release -- --drones 10
cargo run --release -- --drones 100
```

Expected marker:

```text
AEGIS_PLONKY2_RECURSIVE_CHAIN_OK
```

The JSON reports both the final Groth16 payload (`proof_bytes`) and the
intermediate Plonky2 artifact (`plonky2_intermediate_proof_bytes`). The
Plonky2 proof is not the deliverable.

Current Groth16 scope: the backend first verifies the Plonky2 recursive proof
natively, then produces and verifies a BN254 Groth16 wrapper that binds the
Plonky2 proof artifact fingerprint, epoch, nonce, root, bitmap, and proof
length. This is a real Groth16 proof stage over an R1CS wrapper circuit; it is
not yet an in-circuit Plonky2 verifier implemented inside BN254 R1CS.

The 10-drone path is the intended live-demo size. A 100-drone run is supported
but took about 50.6s end to end in the current local measurement.

## Run The Dashboard

```sh
cd plonky2-spike
cargo run --release -- --serve
```

Open:

```text
http://127.0.0.1:8787/
```

The dashboard is a React + Three.js single-page app (`web/`) that is built into
a self-contained `web/dist/index.html` and embedded into the binary via
`include_str!`. The committed bundle is what `cargo run --release -- --serve`
serves; you do not need Node installed to run the demo.

To rebuild the dashboard after frontend changes:

```sh
cd plonky2-spike/web
npm install   # first time only
npm run build # produces web/dist/index.html
cd ..
cargo build --release
```

For frontend development with hot reload, `npm run dev` starts Vite on
`http://127.0.0.1:5173/` and proxies `/api/*` to the Rust server on `:8787`.

The dashboard polls `/api/epoch` and shows only verifier-approved state. Useful
manual checks:

```text
http://127.0.0.1:8787/api/epoch?drones=10
http://127.0.0.1:8787/api/epoch?drones=100
http://127.0.0.1:8787/api/epoch?fault=corrupt
http://127.0.0.1:8787/api/epoch?fault=replay
```

The dashboard also uses backend endpoints for command-center operations:

```text
GET  /api/swarm?drones=10
GET  /api/drone?id=2
POST /api/command
POST /api/files
POST /api/integrity
GET  /api/manet
```

`/api/command`, `/api/files`, `/api/integrity`, and dashboard epoch collection
route through the MANET controller. The runtime target is the real ns-3 sidecar
in `ns3/aegis-manet-sidecar.cc`, launched by `scripts/run-ns3-sidecar.sh`.

Install ns-3 externally and set:

```sh
export NS3_ROOT=/path/to/ns-3
scripts/check-ns3.sh
```

If ns-3 is unavailable, the server still starts and serves the dashboard, but
MANET actions are disabled and mutation endpoints return explicit errors. There
is no silent local fallback pretending MANET delivery happened.

When the sidecar runs, it writes research artifacts under
`plonky2-spike/runs/latest/` by default:

- `events.jsonl`
- `metrics.csv`
- `deliveries.csv`

## Public Inputs

Every step proof exposes the same public input layout so recursive proofs can
bind the next step to the previous one:

- epoch,
- command-center nonce,
- expected Poseidon Merkle root,
- input participation bitmap limbs `[u32; 4]`,
- output participation bitmap limbs `[u32; 4]`.

The four 32-bit limbs cover up to 128 drones while staying canonical in the
Goldilocks field. The demo clamps requests to 100 drones.

Each participating drone step proves:

- the shard witness hashes to a leaf in the expected Poseidon Merkle tree,
- the targeted participation bit was previously unset,
- the output bitmap sets exactly that bit,
- all other bitmap bits are unchanged,
- when present, the previous Plonky2 proof verifies recursively and its
  epoch/nonce/root/output bitmap equal this step's epoch/nonce/root/input
  bitmap.

Dropout is represented by an unset participation bit. Corrupt shards and replay
nonces are rejected. The server also rejects a reused `(epoch, nonce)` pair.

## Tests

```sh
cd plonky2-spike
cargo test --release -- --nocapture
```

Current tests cover a valid small chain, corrupt shard rejection, stale nonce
replay rejection, reused epoch nonce rejection, and dropout acceptance with the
missing bit preserved.

## ESP32 Status

ESP32 verification is no longer part of the v1 demo. The laptop is now the
field/backpack verifier.

Local findings:

- ESP-IDF is available after sourcing `/opt/esp-idf/export.sh`.
- Upstream Plonky2 works on the laptop host target.
- Upstream Plonky2 does not build for bare-metal ESP32-C3
  `riscv32imc-unknown-none-elf`; dependencies require `std`, OS randomness,
  threading/sync, and atomics unavailable on that target.
- A C/C++ Plonky2 verifier would be a porting project, not a quick integration.
