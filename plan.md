# EdgeCuda Hackathon Plan

## Objective

Build an end-to-end tactical data-sharing simulation that proves the core story: BitTorrent-style chunk distribution over a MANET saves bandwidth, while ZK-style proof verification lets the commander trust swarm integrity without pulling file chunks back over the radio.

## V1 Scope

- End-to-end demo first.
- React/Vite commander dashboard.
- Synthetic moving swarm data.
- Simulated P2P routing logic representing BitTorrent-over-MANET behavior.
- Groth16/Circom-compatible leaf proof interfaces.
- ESP32/Wokwi verifier artifact.
- Palantir/AIP out of scope for v1.

## Technical Boundaries

- Recursive SNARK aggregation is represented as protocol simulation in v1.
- The Circom circuit is included as the real cryptographic integration point.
- The default artifact generator uses deterministic hashes so the demo works before installing Circom/SnarkJS.
- The ESP32 artifact demonstrates constrained verification logic, not proof generation.

## Acceptance Criteria

- Demo runs offline with deterministic synthetic data.
- Dashboard shows at least 20 moving nodes.
- Chunk propagation visibly reduces commander bandwidth versus naive broadcast.
- At least one invalid proof or corrupted chunk causes quarantine.
- Final screen shows bandwidth saved, verified nodes, quarantined nodes, and proof status.
