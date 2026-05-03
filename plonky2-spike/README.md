# Mycelium Commander Verifier

Mycelium is a data verification layer for drone swarms. The commander verifies
recursive ZK proofs before trusting swarm data. The proof path is Plonky2-only:

- native Goldilocks/Poseidon proof,
- Poseidon Merkle shard-possession proof,
- recursive Plonky2 chain verification,
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
MYCELIUM_RECURSIVE_ZK_COMMANDER_OK
```

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
```

`/api/command` records command delivery in the targeted drone state.
`/api/files` stores pushed file metadata and expected Poseidon content hashes in
the manifest. `/api/integrity` recomputes per-drone file state against that
manifest and returns missing/mismatched files. This is a real local backend
model, not a frontend-only visualization, but it is not a radio/MANET transport
or hardware drone integration.

## Public Inputs

Every step proof exposes the same public input layout so recursive proofs can
bind the next step to the previous one:

- epoch nonce,
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
  epoch/root/output bitmap equal this step's epoch/root/input bitmap.

Dropout is represented by an unset participation bit. Corrupt shards and replay
epochs are rejected.

## Tests

```sh
cd plonky2-spike
cargo test --release -- --nocapture
```

Current tests cover a valid small chain, corrupt shard rejection, replay
rejection, and dropout acceptance with the missing bit preserved.

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
