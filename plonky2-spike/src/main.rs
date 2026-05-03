use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::field::types::{Field, PrimeField64};
use plonky2::hash::hash_types::{HashOut, HashOutTarget};
use plonky2::hash::merkle_proofs::MerkleProofTarget;
use plonky2::hash::poseidon::PoseidonHash;
use plonky2::iop::target::{BoolTarget, Target};
use plonky2::iop::witness::{PartialWitness, WitnessWrite};
use plonky2::plonk::circuit_builder::CircuitBuilder;
use plonky2::plonk::circuit_data::{CircuitConfig, CircuitData, VerifierCircuitData};
use plonky2::plonk::config::{Hasher, PoseidonGoldilocksConfig};
use plonky2::plonk::proof::{ProofWithPublicInputs, ProofWithPublicInputsTarget};

const D: usize = 2;
const DEFAULT_ADDR: &str = "127.0.0.1:8787";
const MAX_DRONES: usize = 100;
const MERKLE_HEIGHT: usize = 7;
const MERKLE_LEAVES: usize = 1 << MERKLE_HEIGHT;

const PI_EPOCH: usize = 0;
const PI_ROOT_START: usize = 1;
const PI_BITMAP_OUT_START: usize = 9;
const PI_LEN: usize = 13;

type F = GoldilocksField;
type C = PoseidonGoldilocksConfig;
type Proof = ProofWithPublicInputs<F, C, D>;

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|arg| arg == "--serve") {
        let addr = value_after(&args, "--addr").unwrap_or(DEFAULT_ADDR);
        serve(addr)
    } else {
        let drone_count = parse_usize_arg(&args, "--drones", 10).clamp(1, MAX_DRONES);
        let fault = value_after(&args, "--fault")
            .map(FaultKind::from_str)
            .unwrap_or(FaultKind::None);
        let fault_drone = parse_usize_arg(&args, "--drone", drone_count.saturating_sub(1))
            .min(drone_count.saturating_sub(1));

        let engine = VerifierEngine::new();
        let epoch = engine.verify_epoch(EpochRequest {
            epoch: 1,
            drone_count,
            fault: Fault {
                kind: fault,
                drone: fault_drone,
            },
        });
        println!("{}", epoch.to_json());
        if epoch.accepted {
            println!("AEGIS_PLONKY2_RECURSIVE_CHAIN_OK");
            Ok(())
        } else {
            Err(anyhow!("verifier epoch was rejected: {}", epoch.reason))
        }
    }
}

fn serve(addr: &str) -> Result<()> {
    let engine = Arc::new(VerifierEngine::new());
    let epoch = Arc::new(AtomicU64::new(0));
    let listener = TcpListener::bind(addr).with_context(|| format!("bind {addr}"))?;
    println!("AEGIS_PLONKY2_RECURSIVE_CHAIN_SERVING http://{addr}");
    println!("Open http://{addr}/ for the verifier-only dashboard");

    for stream in listener.incoming() {
        let Ok(mut stream) = stream else {
            continue;
        };
        let engine = Arc::clone(&engine);
        let epoch = Arc::clone(&epoch);
        thread::spawn(move || {
            if let Err(err) = handle_stream(engine.as_ref(), &epoch, &mut stream) {
                let body = format!(
                    r#"{{"accepted":false,"error":"{}"}}"#,
                    json_escape(&err.to_string())
                );
                let _ = write_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "application/json",
                    &body,
                );
            }
        });
    }

    Ok(())
}

fn handle_stream(engine: &VerifierEngine, epoch: &AtomicU64, stream: &mut TcpStream) -> Result<()> {
    let request = read_http_request(stream)?;
    let path = request.path.as_str();

    if request.method == "GET" && path == "/" {
        write_response(
            stream,
            "200 OK",
            "text/html; charset=utf-8",
            include_str!("../web/dist/index.html"),
        )?;
        return Ok(());
    }

    if request.method == "GET" && path.starts_with("/api/epoch") {
        let current_epoch = epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let query = path.split_once('?').map(|(_, query)| query).unwrap_or("");
        let drone_count = query_param(query, "drones")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(10)
            .clamp(1, MAX_DRONES);
        let fault_kind = query_param(query, "fault")
            .map(FaultKind::from_str)
            .unwrap_or(FaultKind::RotatingDropout);
        let default_fault_drone = ((current_epoch as usize / 5).max(1) - 1) % drone_count;
        let fault_drone = query_param(query, "drone")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(default_fault_drone)
            .min(drone_count - 1);

        let state = engine.verify_epoch(EpochRequest {
            epoch: current_epoch,
            drone_count,
            fault: Fault {
                kind: fault_kind,
                drone: fault_drone,
            },
        });
        write_response(stream, "200 OK", "application/json", &state.to_json())?;
        return Ok(());
    }

    if request.method == "GET" && path.starts_with("/api/swarm") {
        let query = path.split_once('?').map(|(_, query)| query).unwrap_or("");
        let drone_count = query_param(query, "drones")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(10)
            .clamp(1, MAX_DRONES);
        let body = engine.swarm_json(drone_count)?;
        write_response(stream, "200 OK", "application/json", &body)?;
        return Ok(());
    }

    if request.method == "GET" && path.starts_with("/api/drone") {
        let query = path.split_once('?').map(|(_, query)| query).unwrap_or("");
        let id = query_param(query, "id")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0)
            .min(MAX_DRONES - 1);
        let body = engine.drone_json(id)?;
        write_response(stream, "200 OK", "application/json", &body)?;
        return Ok(());
    }

    if request.method == "POST" && path == "/api/command" {
        let params = parse_form(&request.body);
        let drone_count = form_usize(&params, "drones", 10).clamp(1, MAX_DRONES);
        let command = form_value(&params, "command").unwrap_or("hold_position");
        let target = SwarmTarget::from_form(&params, drone_count);
        let body = engine.dispatch_command(drone_count, target, command)?;
        write_response(stream, "200 OK", "application/json", &body)?;
        return Ok(());
    }

    if request.method == "POST" && path == "/api/files" {
        let params = parse_form(&request.body);
        let drone_count = form_usize(&params, "drones", 10).clamp(1, MAX_DRONES);
        let name = form_value(&params, "name").unwrap_or("mission.txt");
        let contents = form_value(&params, "contents").unwrap_or("");
        let target = SwarmTarget::from_form(&params, drone_count);
        let body = engine.push_file(drone_count, target, name, contents)?;
        write_response(stream, "200 OK", "application/json", &body)?;
        return Ok(());
    }

    if request.method == "POST" && path == "/api/integrity" {
        let params = parse_form(&request.body);
        let drone_count = form_usize(&params, "drones", 10).clamp(1, MAX_DRONES);
        let body = engine.check_integrity(drone_count)?;
        write_response(stream, "200 OK", "application/json", &body)?;
        return Ok(());
    }

    write_response(
        stream,
        "404 Not Found",
        "text/plain; charset=utf-8",
        "not found",
    )?;
    Ok(())
}

struct VerifierEngine {
    data: DemoData,
    swarm: Mutex<SwarmState>,
}

impl VerifierEngine {
    fn new() -> Self {
        Self {
            data: DemoData::new(),
            swarm: Mutex::new(SwarmState::new()),
        }
    }

    fn verify_epoch(&self, request: EpochRequest) -> VerifiedEpoch {
        let start = Instant::now();
        let result = self.prove_chain(&request);
        let total_ms = start.elapsed().as_millis();

        match result {
            Ok(stats) => {
                let stale_epoch = stats.public_epoch != request.epoch;
                let root_matches = stats.public_root == self.data.root;
                let accepted = !stale_epoch && root_matches;
                let reason = if accepted {
                    "verified recursive shard-possession chain"
                } else if stale_epoch {
                    "rejected stale epoch public input"
                } else {
                    "rejected unexpected Merkle root public input"
                };
                let _ = self.record_epoch(&request, &stats, accepted);

                VerifiedEpoch {
                    epoch: request.epoch,
                    drone_count: request.drone_count,
                    accepted,
                    reason,
                    participation_bitmap: stats.public_bitmap_out,
                    verified_count: count_participants(stats.public_bitmap_out),
                    dropouts: request.dropouts(),
                    proof_bytes: stats.proof_bytes,
                    public_inputs: stats.public_inputs,
                    prove_ms: stats.prove_ms,
                    verify_ms: stats.verify_ms,
                    total_ms,
                    proof_system: "Plonky2",
                    implemented_proof_mode: "recursive_chain",
                }
            }
            Err(err) => VerifiedEpoch {
                epoch: request.epoch,
                drone_count: request.drone_count,
                accepted: false,
                reason: Box::leak(
                    format!("proof failed: {}", json_escape(&err.to_string())).into_boxed_str(),
                ),
                participation_bitmap: [0; 4],
                verified_count: 0,
                dropouts: request.dropouts(),
                proof_bytes: 0,
                public_inputs: PI_LEN,
                prove_ms: total_ms,
                verify_ms: 0,
                total_ms,
                proof_system: "Plonky2",
                implemented_proof_mode: "recursive_chain",
            },
        }
    }

    fn prove_chain(&self, request: &EpochRequest) -> Result<ChainStats> {
        let proof_epoch = if matches!(request.fault.kind, FaultKind::Replay) {
            request.epoch.saturating_sub(1)
        } else {
            request.epoch
        };
        let proof_epoch_f = F::from_canonical_u64(proof_epoch);
        let root = self.data.root;
        let mut bitmap = [0u32; 4];
        let mut previous: Option<(Proof, VerifierCircuitData<F, C, D>)> = None;
        let mut final_stats = None;
        let mut prove_ms = 0u128;
        let mut verify_ms = 0u128;

        for drone_index in request.participating_drones() {
            let previous_data = previous.as_ref().map(|(_, verifier_data)| verifier_data);
            let circuit = build_step_circuit(drone_index, previous_data);
            let bitmap_in = bitmap;
            let mut bitmap_out = bitmap;
            set_participant(&mut bitmap_out, drone_index, true);
            let shard = self.witness_shard(request, drone_index);
            let proof = self.data.merkle.proof(drone_index);

            let mut witness = PartialWitness::new();
            witness.set_target(circuit.shard, shard)?;
            witness.set_target(circuit.epoch, proof_epoch_f)?;
            witness.set_hash_target(circuit.expected_root, root)?;
            for (target, limb) in circuit.bitmap_in.iter().zip(bitmap_in.iter()) {
                witness.set_target(*target, F::from_canonical_u32(*limb))?;
            }
            for (target, limb) in circuit.bitmap_out.iter().zip(bitmap_out.iter()) {
                witness.set_target(*target, F::from_canonical_u32(*limb))?;
            }
            for (target, sibling) in circuit.merkle_siblings.iter().zip(proof.iter()) {
                witness.set_hash_target(*target, *sibling)?;
            }
            if let (Some(previous_target), Some((previous_proof, _))) =
                (&circuit.previous_proof, &previous)
            {
                witness.set_proof_with_pis_target(previous_target, previous_proof)?;
            }

            let prove_start = Instant::now();
            let step_proof = circuit
                .data
                .prove(witness)
                .with_context(|| format!("prove drone {drone_index} step"))?;
            prove_ms += prove_start.elapsed().as_millis();

            let verify_start = Instant::now();
            circuit
                .data
                .verify(step_proof.clone())
                .with_context(|| format!("verify drone {drone_index} step"))?;
            verify_ms += verify_start.elapsed().as_millis();

            bitmap = bitmap_out;
            final_stats = Some(ProofStats::from_proof(&step_proof));
            previous = Some((step_proof, circuit.data.verifier_data()));
        }

        let final_stats = final_stats.context("no participating drones produced a proof")?;
        Ok(ChainStats {
            public_epoch: final_stats.public_epoch,
            public_root: final_stats.public_root,
            public_bitmap_out: final_stats.public_bitmap_out,
            public_inputs: final_stats.public_inputs,
            proof_bytes: final_stats.proof_bytes,
            prove_ms,
            verify_ms,
        })
    }

    fn witness_shard(&self, request: &EpochRequest, drone_index: usize) -> F {
        if matches!(request.fault.kind, FaultKind::CorruptShard)
            && request.fault.drone == drone_index
        {
            self.data.shards[drone_index] + F::ONE
        } else {
            self.data.shards[drone_index]
        }
    }

    fn record_epoch(
        &self,
        request: &EpochRequest,
        stats: &ChainStats,
        accepted: bool,
    ) -> Result<()> {
        let mut swarm = self
            .swarm
            .lock()
            .map_err(|_| anyhow!("swarm state lock poisoned"))?;
        swarm.record_epoch(request, stats.public_bitmap_out, accepted);
        Ok(())
    }

    fn swarm_json(&self, drone_count: usize) -> Result<String> {
        let mut swarm = self
            .swarm
            .lock()
            .map_err(|_| anyhow!("swarm state lock poisoned"))?;
        swarm.ensure_drone_count(drone_count);
        Ok(swarm.to_json(drone_count))
    }

    fn drone_json(&self, id: usize) -> Result<String> {
        let mut swarm = self
            .swarm
            .lock()
            .map_err(|_| anyhow!("swarm state lock poisoned"))?;
        swarm.ensure_drone_count(id + 1);
        Ok(swarm.drone_json(id))
    }

    fn dispatch_command(
        &self,
        drone_count: usize,
        target: SwarmTarget,
        command: &str,
    ) -> Result<String> {
        let mut swarm = self
            .swarm
            .lock()
            .map_err(|_| anyhow!("swarm state lock poisoned"))?;
        swarm.ensure_drone_count(drone_count);
        let receipt = swarm.dispatch_command(drone_count, target, command);
        Ok(receipt.to_json())
    }

    fn push_file(
        &self,
        drone_count: usize,
        target: SwarmTarget,
        name: &str,
        contents: &str,
    ) -> Result<String> {
        let mut swarm = self
            .swarm
            .lock()
            .map_err(|_| anyhow!("swarm state lock poisoned"))?;
        swarm.ensure_drone_count(drone_count);
        let receipt = swarm.push_file(drone_count, target, name, contents)?;
        Ok(receipt.to_json())
    }

    fn check_integrity(&self, drone_count: usize) -> Result<String> {
        let mut swarm = self
            .swarm
            .lock()
            .map_err(|_| anyhow!("swarm state lock poisoned"))?;
        swarm.ensure_drone_count(drone_count);
        let report = swarm.check_integrity(drone_count);
        Ok(report.to_json())
    }
}

struct StepCircuit {
    data: CircuitData<F, C, D>,
    shard: Target,
    epoch: Target,
    expected_root: HashOutTarget,
    bitmap_in: [Target; 4],
    bitmap_out: [Target; 4],
    merkle_siblings: Vec<HashOutTarget>,
    previous_proof: Option<ProofWithPublicInputsTarget<D>>,
}

fn build_step_circuit(
    drone_index: usize,
    previous: Option<&VerifierCircuitData<F, C, D>>,
) -> StepCircuit {
    let config = CircuitConfig::standard_recursion_config();
    let mut builder = CircuitBuilder::<F, D>::new(config);

    let shard = builder.add_virtual_target();
    let epoch = builder.add_virtual_public_input();
    let expected_root = builder.add_virtual_hash_public_input();
    let bitmap_in = builder.add_virtual_public_input_arr::<4>();
    let bitmap_out = builder.add_virtual_public_input_arr::<4>();

    let leaf_hash = builder.hash_n_to_hash_no_pad::<PoseidonHash>(vec![shard]);
    let merkle_siblings = builder.add_virtual_hashes(MERKLE_HEIGHT);
    let index_bits = merkle_index_bits(&mut builder, drone_index);
    let proof = MerkleProofTarget {
        siblings: merkle_siblings.clone(),
    };
    builder.verify_merkle_proof::<PoseidonHash>(
        leaf_hash.elements.to_vec(),
        &index_bits,
        expected_root,
        &proof,
    );
    constrain_bitmap_transition(&mut builder, drone_index, bitmap_in, bitmap_out);

    let previous_proof = previous.map(|previous| {
        let previous_proof = builder.add_virtual_proof_with_pis(&previous.common);
        let previous_verifier = builder.constant_verifier_data(&previous.verifier_only);
        builder.verify_proof::<C>(&previous_proof, &previous_verifier, &previous.common);
        connect_previous_public_inputs(
            &mut builder,
            &previous_proof.public_inputs,
            epoch,
            expected_root,
            bitmap_in,
        );
        previous_proof
    });

    let data = builder.build::<C>();
    StepCircuit {
        data,
        shard,
        epoch,
        expected_root,
        bitmap_in,
        bitmap_out,
        merkle_siblings,
        previous_proof,
    }
}

fn connect_previous_public_inputs(
    builder: &mut CircuitBuilder<F, D>,
    previous_public_inputs: &[Target],
    epoch: Target,
    expected_root: HashOutTarget,
    bitmap_in: [Target; 4],
) {
    debug_assert_eq!(previous_public_inputs.len(), PI_LEN);
    builder.connect(previous_public_inputs[PI_EPOCH], epoch);
    for i in 0..4 {
        builder.connect(
            previous_public_inputs[PI_ROOT_START + i],
            expected_root.elements[i],
        );
        builder.connect(
            previous_public_inputs[PI_BITMAP_OUT_START + i],
            bitmap_in[i],
        );
    }
}

fn merkle_index_bits(builder: &mut CircuitBuilder<F, D>, index: usize) -> Vec<BoolTarget> {
    (0..MERKLE_HEIGHT)
        .map(|bit| builder.constant_bool(((index >> bit) & 1) == 1))
        .collect()
}

fn constrain_bitmap_transition(
    builder: &mut CircuitBuilder<F, D>,
    drone_index: usize,
    bitmap_in: [Target; 4],
    bitmap_out: [Target; 4],
) {
    let target_limb = drone_index / 32;
    let target_bit = drone_index % 32;
    let zero = builder.zero();
    let one = builder.one();

    for limb in 0..4 {
        let in_bits = builder.split_le(bitmap_in[limb], 32);
        let out_bits = builder.split_le(bitmap_out[limb], 32);
        for bit in 0..32 {
            if limb == target_limb && bit == target_bit {
                builder.connect(in_bits[bit].target, zero);
                builder.connect(out_bits[bit].target, one);
            } else {
                builder.connect(in_bits[bit].target, out_bits[bit].target);
            }
        }
    }
}

struct DemoData {
    shards: Vec<F>,
    root: HashOut<F>,
    merkle: DemoMerkleTree,
}

impl DemoData {
    fn new() -> Self {
        let shards = (0..MAX_DRONES)
            .map(|index| F::from_canonical_u64(0xae615_0000_u64 + index as u64 + 1))
            .collect::<Vec<_>>();
        let mut leaves = shards
            .iter()
            .map(|shard| PoseidonHash::hash_no_pad(&[*shard]))
            .collect::<Vec<_>>();
        let zero_leaf = PoseidonHash::hash_no_pad(&[F::ZERO]);
        leaves.resize(MERKLE_LEAVES, zero_leaf);
        let merkle = DemoMerkleTree::new(leaves);
        let root = merkle.root();
        Self {
            shards,
            root,
            merkle,
        }
    }
}

struct DemoMerkleTree {
    levels: Vec<Vec<HashOut<F>>>,
}

impl DemoMerkleTree {
    fn new(leaves: Vec<HashOut<F>>) -> Self {
        assert_eq!(leaves.len(), MERKLE_LEAVES);
        let mut levels = vec![leaves];
        while levels.last().unwrap().len() > 1 {
            let previous = levels.last().unwrap();
            let next = previous
                .chunks_exact(2)
                .map(|pair| PoseidonHash::two_to_one(pair[0], pair[1]))
                .collect::<Vec<_>>();
            levels.push(next);
        }
        Self { levels }
    }

    fn root(&self) -> HashOut<F> {
        self.levels.last().unwrap()[0]
    }

    fn proof(&self, index: usize) -> Vec<HashOut<F>> {
        let mut proof = Vec::with_capacity(MERKLE_HEIGHT);
        let mut current = index;
        for level in &self.levels[..MERKLE_HEIGHT] {
            proof.push(level[current ^ 1]);
            current >>= 1;
        }
        proof
    }
}

#[derive(Clone)]
struct DroneRuntime {
    id: usize,
    callsign: String,
    status: String,
    battery: u8,
    link: u8,
    last_seen_epoch: u64,
    proof_verified: bool,
    integrity_ok: bool,
    current_command: String,
    files: Vec<DroneFile>,
    command_log: Vec<CommandRecord>,
}

impl DroneRuntime {
    fn new(id: usize) -> Self {
        Self {
            id,
            callsign: format!("Aegis-{:02}", id + 1),
            status: "standby".to_string(),
            battery: 96u8.saturating_sub((id % 17) as u8),
            link: 88u8.saturating_sub((id % 11) as u8),
            last_seen_epoch: 0,
            proof_verified: false,
            integrity_ok: true,
            current_command: "standby".to_string(),
            files: Vec::new(),
            command_log: Vec::new(),
        }
    }

    fn to_summary_json(&self) -> String {
        format!(
            concat!(
                "{{",
                r#""id":{},"#,
                r#""callsign":"{}","#,
                r#""status":"{}","#,
                r#""battery":{},"#,
                r#""link":{},"#,
                r#""last_seen_epoch":{},"#,
                r#""proof_verified":{},"#,
                r#""integrity_ok":{},"#,
                r#""current_command":"{}","#,
                r#""file_count":{}"#,
                "}}"
            ),
            self.id,
            json_escape(&self.callsign),
            json_escape(&self.status),
            self.battery,
            self.link,
            self.last_seen_epoch,
            self.proof_verified,
            self.integrity_ok,
            json_escape(&self.current_command),
            self.files.len()
        )
    }

    fn to_detail_json(&self) -> String {
        format!(
            concat!(
                "{{",
                r#""id":{},"#,
                r#""callsign":"{}","#,
                r#""status":"{}","#,
                r#""battery":{},"#,
                r#""link":{},"#,
                r#""last_seen_epoch":{},"#,
                r#""proof_verified":{},"#,
                r#""integrity_ok":{},"#,
                r#""current_command":"{}","#,
                r#""files":[{}],"#,
                r#""commands":[{}]"#,
                "}}"
            ),
            self.id,
            json_escape(&self.callsign),
            json_escape(&self.status),
            self.battery,
            self.link,
            self.last_seen_epoch,
            self.proof_verified,
            self.integrity_ok,
            json_escape(&self.current_command),
            self.files
                .iter()
                .map(DroneFile::to_json)
                .collect::<Vec<_>>()
                .join(","),
            self.command_log
                .iter()
                .rev()
                .take(12)
                .map(CommandRecord::to_json)
                .collect::<Vec<_>>()
                .join(",")
        )
    }
}

#[derive(Clone)]
struct DroneFile {
    name: String,
    hash: String,
    bytes: usize,
    version: u64,
}

impl DroneFile {
    fn to_json(&self) -> String {
        format!(
            r#"{{"name":"{}","hash":"{}","bytes":{},"version":{}}}"#,
            json_escape(&self.name),
            json_escape(&self.hash),
            self.bytes,
            self.version
        )
    }
}

#[derive(Clone)]
struct FileManifest {
    name: String,
    hash: String,
    bytes: usize,
    version: u64,
    expected_drones: Vec<usize>,
}

impl FileManifest {
    fn to_json(&self) -> String {
        format!(
            concat!(
                "{{",
                r#""name":"{}","#,
                r#""hash":"{}","#,
                r#""bytes":{},"#,
                r#""version":{},"#,
                r#""expected_drones":[{}]"#,
                "}}"
            ),
            json_escape(&self.name),
            json_escape(&self.hash),
            self.bytes,
            self.version,
            self.expected_drones
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        )
    }
}

#[derive(Clone)]
struct CommandRecord {
    id: u64,
    command: String,
    target: String,
    delivered: usize,
}

impl CommandRecord {
    fn to_json(&self) -> String {
        format!(
            r#"{{"id":{},"command":"{}","target":"{}","delivered":{}}}"#,
            self.id,
            json_escape(&self.command),
            json_escape(&self.target),
            self.delivered
        )
    }
}

struct CommandReceipt {
    accepted: bool,
    command: CommandRecord,
}

impl CommandReceipt {
    fn to_json(&self) -> String {
        format!(
            r#"{{"accepted":{},"command":{}}}"#,
            self.accepted,
            self.command.to_json()
        )
    }
}

struct FileReceipt {
    accepted: bool,
    name: String,
    hash: String,
    bytes: usize,
    version: u64,
    delivered: usize,
    expected_drones: Vec<usize>,
}

impl FileReceipt {
    fn to_json(&self) -> String {
        format!(
            concat!(
                "{{",
                r#""accepted":{},"#,
                r#""name":"{}","#,
                r#""hash":"{}","#,
                r#""bytes":{},"#,
                r#""version":{},"#,
                r#""delivered":{},"#,
                r#""expected_drones":[{}]"#,
                "}}"
            ),
            self.accepted,
            json_escape(&self.name),
            json_escape(&self.hash),
            self.bytes,
            self.version,
            self.delivered,
            self.expected_drones
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        )
    }
}

#[derive(Clone)]
struct IntegrityReport {
    checked_files: usize,
    checked_drones: usize,
    ok: usize,
    missing: usize,
    mismatched: usize,
    bad: Vec<String>,
}

impl IntegrityReport {
    fn is_clean(&self) -> bool {
        self.missing == 0 && self.mismatched == 0
    }

    fn to_json(&self) -> String {
        format!(
            concat!(
                "{{",
                r#""accepted":true,"#,
                r#""clean":{},"#,
                r#""checked_files":{},"#,
                r#""checked_drones":{},"#,
                r#""ok":{},"#,
                r#""missing":{},"#,
                r#""mismatched":{},"#,
                r#""bad":[{}]"#,
                "}}"
            ),
            self.is_clean(),
            self.checked_files,
            self.checked_drones,
            self.ok,
            self.missing,
            self.mismatched,
            self.bad
                .iter()
                .map(|entry| format!(r#""{}""#, json_escape(entry)))
                .collect::<Vec<_>>()
                .join(",")
        )
    }
}

#[derive(Clone, Copy)]
enum SwarmTarget {
    All,
    Drone(usize),
}

impl SwarmTarget {
    fn from_form(params: &[(String, String)], drone_count: usize) -> Self {
        match form_value(params, "target") {
            Some("drone") => Self::Drone(form_usize(params, "drone", 0).min(drone_count - 1)),
            _ => Self::All,
        }
    }

    fn drones(self, drone_count: usize) -> Vec<usize> {
        match self {
            Self::All => (0..drone_count).collect(),
            Self::Drone(id) => vec![id.min(drone_count - 1)],
        }
    }

    fn label(self, drone_count: usize) -> String {
        match self {
            Self::All => format!("all:{drone_count}"),
            Self::Drone(id) => format!("drone:{id}"),
        }
    }
}

struct SwarmState {
    drones: Vec<DroneRuntime>,
    manifest: Vec<FileManifest>,
    commands: Vec<CommandRecord>,
    next_command_id: u64,
    next_file_version: u64,
    last_integrity: Option<IntegrityReport>,
}

impl SwarmState {
    fn new() -> Self {
        let mut state = Self {
            drones: Vec::new(),
            manifest: Vec::new(),
            commands: Vec::new(),
            next_command_id: 1,
            next_file_version: 1,
            last_integrity: None,
        };
        state.ensure_drone_count(10);
        state
    }

    fn ensure_drone_count(&mut self, drone_count: usize) {
        while self.drones.len() < drone_count {
            let id = self.drones.len();
            self.drones.push(DroneRuntime::new(id));
        }
    }

    fn record_epoch(&mut self, request: &EpochRequest, bitmap: [u32; 4], accepted: bool) {
        self.ensure_drone_count(request.drone_count);
        for id in 0..request.drone_count {
            let participated = accepted && participant_at(bitmap, id);
            let drone = &mut self.drones[id];
            drone.proof_verified = participated;
            if participated {
                drone.last_seen_epoch = request.epoch;
                drone.status = "verified".to_string();
                drone.link = 82 + ((request.epoch as usize + id) % 16) as u8;
                drone.battery = drone
                    .battery
                    .saturating_sub(((request.epoch + id as u64) % 2) as u8);
            } else if request.dropouts().contains(&id) {
                drone.status = "dropout".to_string();
            } else if !accepted {
                drone.status = "proof rejected".to_string();
            }
        }
    }

    fn dispatch_command(
        &mut self,
        drone_count: usize,
        target: SwarmTarget,
        command: &str,
    ) -> CommandReceipt {
        let command = normalize_command(command);
        let target_ids = target.drones(drone_count);
        let record = CommandRecord {
            id: self.next_command_id,
            command: command.clone(),
            target: target.label(drone_count),
            delivered: target_ids.len(),
        };
        self.next_command_id += 1;
        for id in target_ids {
            let drone = &mut self.drones[id];
            drone.current_command = command.clone();
            drone.status = "commanded".to_string();
            drone.command_log.push(record.clone());
        }
        self.commands.push(record.clone());
        if self.commands.len() > 24 {
            self.commands.remove(0);
        }
        CommandReceipt {
            accepted: true,
            command: record,
        }
    }

    fn push_file(
        &mut self,
        drone_count: usize,
        target: SwarmTarget,
        name: &str,
        contents: &str,
    ) -> Result<FileReceipt> {
        let name = sanitize_file_name(name)?;
        let hash = content_hash_hex(contents);
        let bytes = contents.as_bytes().len();
        let version = self.next_file_version;
        self.next_file_version += 1;
        let target_ids = target.drones(drone_count);
        let file = DroneFile {
            name: name.clone(),
            hash: hash.clone(),
            bytes,
            version,
        };

        for id in &target_ids {
            let drone = &mut self.drones[*id];
            drone.files.retain(|existing| existing.name != name);
            drone.files.push(file.clone());
            drone.integrity_ok = true;
            drone.status = "file synced".to_string();
        }

        self.manifest.retain(|entry| entry.name != name);
        self.manifest.push(FileManifest {
            name: name.clone(),
            hash: hash.clone(),
            bytes,
            version,
            expected_drones: target_ids.clone(),
        });

        Ok(FileReceipt {
            accepted: true,
            name,
            hash,
            bytes,
            version,
            delivered: target_ids.len(),
            expected_drones: target_ids,
        })
    }

    fn check_integrity(&mut self, drone_count: usize) -> IntegrityReport {
        for drone in self.drones.iter_mut().take(drone_count) {
            drone.integrity_ok = true;
        }

        let mut report = IntegrityReport {
            checked_files: self.manifest.len(),
            checked_drones: drone_count,
            ok: 0,
            missing: 0,
            mismatched: 0,
            bad: Vec::new(),
        };

        for manifest in &self.manifest {
            for id in manifest
                .expected_drones
                .iter()
                .copied()
                .filter(|id| *id < drone_count)
            {
                let drone = &mut self.drones[id];
                match drone.files.iter().find(|file| file.name == manifest.name) {
                    Some(file) if file.hash == manifest.hash && file.bytes == manifest.bytes => {
                        report.ok += 1;
                    }
                    Some(file) => {
                        report.mismatched += 1;
                        drone.integrity_ok = false;
                        report.bad.push(format!(
                            "{}:{} hash {} expected {}",
                            drone.callsign, manifest.name, file.hash, manifest.hash
                        ));
                    }
                    None => {
                        report.missing += 1;
                        drone.integrity_ok = false;
                        report
                            .bad
                            .push(format!("{}:{} missing", drone.callsign, manifest.name));
                    }
                }
            }
        }
        self.last_integrity = Some(report.clone());
        report
    }

    fn to_json(&self, drone_count: usize) -> String {
        let drones = self
            .drones
            .iter()
            .take(drone_count)
            .map(DroneRuntime::to_summary_json)
            .collect::<Vec<_>>()
            .join(",");
        let files = self
            .manifest
            .iter()
            .map(FileManifest::to_json)
            .collect::<Vec<_>>()
            .join(",");
        let commands = self
            .commands
            .iter()
            .rev()
            .take(8)
            .map(CommandRecord::to_json)
            .collect::<Vec<_>>()
            .join(",");
        let online_count = self
            .drones
            .iter()
            .take(drone_count)
            .filter(|drone| drone.status != "dropout" && drone.status != "proof rejected")
            .count();
        let integrity_clean = self
            .last_integrity
            .as_ref()
            .map(IntegrityReport::is_clean)
            .unwrap_or(true);
        format!(
            concat!(
                "{{",
                r#""drone_count":{},"#,
                r#""online_count":{},"#,
                r#""manifest_count":{},"#,
                r#""command_count":{},"#,
                r#""integrity_clean":{},"#,
                r#""last_integrity":{},"#,
                r#""files":[{}],"#,
                r#""commands":[{}],"#,
                r#""drones":[{}]"#,
                "}}"
            ),
            drone_count,
            online_count,
            self.manifest.len(),
            self.commands.len(),
            integrity_clean,
            self.last_integrity
                .as_ref()
                .map(IntegrityReport::to_json)
                .unwrap_or_else(|| "null".to_string()),
            files,
            commands,
            drones
        )
    }

    fn drone_json(&self, id: usize) -> String {
        self.drones[id].to_detail_json()
    }
}

#[derive(Clone, Copy)]
struct Fault {
    kind: FaultKind,
    drone: usize,
}

#[derive(Clone, Copy)]
enum FaultKind {
    None,
    RotatingDropout,
    Dropout,
    CorruptShard,
    Replay,
}

impl FaultKind {
    fn from_str(value: &str) -> Self {
        match value {
            "none" => Self::None,
            "dropout" => Self::Dropout,
            "corrupt" => Self::CorruptShard,
            "replay" => Self::Replay,
            _ => Self::RotatingDropout,
        }
    }
}

struct EpochRequest {
    epoch: u64,
    drone_count: usize,
    fault: Fault,
}

impl EpochRequest {
    fn participating_drones(&self) -> Vec<usize> {
        (0..self.drone_count)
            .filter(|&drone| !self.dropouts().contains(&drone))
            .collect()
    }

    fn dropouts(&self) -> Vec<usize> {
        match self.fault.kind {
            FaultKind::Dropout => vec![self.fault.drone],
            FaultKind::RotatingDropout if self.epoch % 5 == 0 => vec![self.fault.drone],
            _ => Vec::new(),
        }
    }
}

struct ProofStats {
    public_epoch: u64,
    public_root: HashOut<F>,
    public_bitmap_out: [u32; 4],
    public_inputs: usize,
    proof_bytes: usize,
}

impl ProofStats {
    fn from_proof(proof: &Proof) -> Self {
        let public_inputs = &proof.public_inputs;
        debug_assert_eq!(public_inputs.len(), PI_LEN);
        let public_root = HashOut {
            elements: [
                public_inputs[PI_ROOT_START],
                public_inputs[PI_ROOT_START + 1],
                public_inputs[PI_ROOT_START + 2],
                public_inputs[PI_ROOT_START + 3],
            ],
        };
        let public_bitmap_out = [
            public_inputs[PI_BITMAP_OUT_START].to_canonical_u64() as u32,
            public_inputs[PI_BITMAP_OUT_START + 1].to_canonical_u64() as u32,
            public_inputs[PI_BITMAP_OUT_START + 2].to_canonical_u64() as u32,
            public_inputs[PI_BITMAP_OUT_START + 3].to_canonical_u64() as u32,
        ];
        Self {
            public_epoch: public_inputs[PI_EPOCH].to_canonical_u64(),
            public_root,
            public_bitmap_out,
            public_inputs: public_inputs.len(),
            proof_bytes: proof.to_bytes().len(),
        }
    }
}

struct ChainStats {
    public_epoch: u64,
    public_root: HashOut<F>,
    public_bitmap_out: [u32; 4],
    public_inputs: usize,
    proof_bytes: usize,
    prove_ms: u128,
    verify_ms: u128,
}

struct VerifiedEpoch {
    epoch: u64,
    drone_count: usize,
    accepted: bool,
    reason: &'static str,
    participation_bitmap: [u32; 4],
    verified_count: u64,
    dropouts: Vec<usize>,
    proof_bytes: usize,
    public_inputs: usize,
    prove_ms: u128,
    verify_ms: u128,
    total_ms: u128,
    proof_system: &'static str,
    implemented_proof_mode: &'static str,
}

impl VerifiedEpoch {
    fn to_json(&self) -> String {
        format!(
            concat!(
                "{{",
                r#""epoch":{},"#,
                r#""drone_count":{},"#,
                r#""accepted":{},"#,
                r#""reason":"{}","#,
                r#""implemented_proof_mode":"{}","#,
                r#""participation_bitmap":[{},{},{},{}],"#,
                r#""participants":[{}],"#,
                r#""dropouts":[{}],"#,
                r#""verified_count":{},"#,
                r#""proof_bytes":{},"#,
                r#""public_inputs":{},"#,
                r#""prove_ms":{},"#,
                r#""verify_ms":{},"#,
                r#""total_ms":{},"#,
                r#""proof_system":"{}""#,
                "}}"
            ),
            self.epoch,
            self.drone_count,
            self.accepted,
            self.reason,
            self.implemented_proof_mode,
            self.participation_bitmap[0],
            self.participation_bitmap[1],
            self.participation_bitmap[2],
            self.participation_bitmap[3],
            participants_json(self.drone_count, self.participation_bitmap),
            dropouts_json(&self.dropouts),
            self.verified_count,
            self.proof_bytes,
            self.public_inputs,
            self.prove_ms,
            self.verify_ms,
            self.total_ms,
            self.proof_system
        )
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &str,
) -> Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .context("write response")
}

struct HttpRequest {
    method: String,
    path: String,
    body: String,
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .context("set request read timeout")?;
    let mut bytes = Vec::new();
    let mut buf = [0u8; 8192];
    let mut header_end = None;
    let mut content_length = 0usize;

    loop {
        let read = stream.read(&mut buf).context("read request")?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..read]);
        if header_end.is_none() {
            header_end = find_header_end(&bytes);
            if let Some((end, _)) = header_end {
                let header = std::str::from_utf8(&bytes[..end]).context("parse request headers")?;
                content_length = header
                    .lines()
                    .find_map(|line| {
                        let (key, value) = line.split_once(':')?;
                        key.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
            }
        }
        if let Some((end, delimiter_len)) = header_end {
            if bytes.len() >= end + delimiter_len + content_length {
                break;
            }
        }
        if bytes.len() > 128 * 1024 {
            return Err(anyhow!("request too large"));
        }
    }

    let (end, delimiter_len) = header_end.context("request missing header terminator")?;
    let header = std::str::from_utf8(&bytes[..end]).context("parse request headers")?;
    let mut first_line = header.lines().next().unwrap_or("").split_whitespace();
    let method = first_line.next().unwrap_or("").to_string();
    let path = first_line.next().unwrap_or("/").to_string();
    let body_start = end + delimiter_len;
    let body_end = (body_start + content_length).min(bytes.len());
    let body = String::from_utf8_lossy(&bytes[body_start..body_end]).to_string();
    Ok(HttpRequest { method, path, body })
}

fn find_header_end(bytes: &[u8]) -> Option<(usize, usize)> {
    if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
        Some((position, 4))
    } else {
        bytes
            .windows(2)
            .position(|window| window == b"\n\n")
            .map(|position| (position, 2))
    }
}

fn count_participants(limbs: [u32; 4]) -> u64 {
    limbs.iter().map(|limb| limb.count_ones() as u64).sum()
}

fn participant_at(limbs: [u32; 4], index: usize) -> bool {
    let limb = index / 32;
    let bit = index % 32;
    ((limbs[limb] >> bit) & 1) == 1
}

fn set_participant(limbs: &mut [u32; 4], index: usize, value: bool) {
    let limb = index / 32;
    let bit = index % 32;
    if value {
        limbs[limb] |= 1u32 << bit;
    } else {
        limbs[limb] &= !(1u32 << bit);
    }
}

fn participants_json(drone_count: usize, bitmap: [u32; 4]) -> String {
    (0..drone_count)
        .map(|index| {
            if participant_at(bitmap, index) {
                "true"
            } else {
                "false"
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn dropouts_json(dropouts: &[usize]) -> String {
    dropouts
        .iter()
        .map(|drone| drone.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then_some(v)
    })
}

fn parse_form(body: &str) -> Vec<(String, String)> {
    body.split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            Some((percent_decode(key)?, percent_decode(value)?))
        })
        .collect()
}

fn percent_decode(input: &str) -> Option<String> {
    let mut out = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let high = hex_value(bytes[i + 1])?;
                let low = hex_value(bytes[i + 2])?;
                out.push((high << 4) | low);
                i += 3;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn form_value<'a>(params: &'a [(String, String)], key: &str) -> Option<&'a str> {
    params
        .iter()
        .find_map(|(k, v)| (k == key).then_some(v.as_str()))
}

fn form_usize(params: &[(String, String)], key: &str, default: usize) -> usize {
    form_value(params, key)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
}

fn value_after<'a>(args: &'a [String], key: &str) -> Option<&'a str> {
    args.windows(2)
        .find_map(|window| (window[0] == key).then_some(window[1].as_str()))
}

fn parse_usize_arg(args: &[String], key: &str, default: usize) -> usize {
    value_after(args, key)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
}

fn json_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

fn normalize_command(command: &str) -> String {
    match command {
        "hold_position" => "hold_position",
        "return_to_base" => "return_to_base",
        "survey_grid" => "survey_grid",
        "tighten_formation" => "tighten_formation",
        "resume_mission" => "resume_mission",
        _ => "hold_position",
    }
    .to_string()
}

fn sanitize_file_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("file name is required"));
    }
    let safe = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        .take(64)
        .collect::<String>();
    if safe.is_empty() {
        Err(anyhow!("file name has no safe characters"))
    } else {
        Ok(safe)
    }
}

fn content_hash_hex(contents: &str) -> String {
    let mut inputs = vec![F::from_canonical_usize(contents.len())];
    for chunk in contents.as_bytes().chunks(7) {
        let mut value = 0u64;
        for (shift, byte) in chunk.iter().enumerate() {
            value |= (*byte as u64) << (shift * 8);
        }
        inputs.push(F::from_canonical_u64(value));
    }
    let hash = PoseidonHash::hash_no_pad(&inputs);
    hash.elements
        .iter()
        .map(|element| format!("{:016x}", element.to_canonical_u64()))
        .collect::<Vec<_>>()
        .join("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_small_chain_verifies() {
        let engine = VerifierEngine::new();
        let state = engine.verify_epoch(EpochRequest {
            epoch: 7,
            drone_count: 3,
            fault: Fault {
                kind: FaultKind::None,
                drone: 0,
            },
        });
        assert!(state.accepted, "{}", state.to_json());
        assert_eq!(state.verified_count, 3);
    }

    #[test]
    fn corrupt_shard_rejects() {
        let engine = VerifierEngine::new();
        let state = engine.verify_epoch(EpochRequest {
            epoch: 7,
            drone_count: 3,
            fault: Fault {
                kind: FaultKind::CorruptShard,
                drone: 1,
            },
        });
        assert!(!state.accepted);
    }

    #[test]
    fn replay_rejects() {
        let engine = VerifierEngine::new();
        let state = engine.verify_epoch(EpochRequest {
            epoch: 7,
            drone_count: 3,
            fault: Fault {
                kind: FaultKind::Replay,
                drone: 0,
            },
        });
        assert!(!state.accepted);
        assert!(state.reason.contains("stale epoch"));
    }

    #[test]
    fn dropout_verifies_with_missing_bit() {
        let engine = VerifierEngine::new();
        let state = engine.verify_epoch(EpochRequest {
            epoch: 7,
            drone_count: 4,
            fault: Fault {
                kind: FaultKind::Dropout,
                drone: 2,
            },
        });
        assert!(state.accepted, "{}", state.to_json());
        assert_eq!(state.verified_count, 3);
        assert!(!participant_at(state.participation_bitmap, 2));
    }

    #[test]
    fn command_dispatch_updates_drone_state() {
        let engine = VerifierEngine::new();
        let body = engine
            .dispatch_command(4, SwarmTarget::Drone(2), "return_to_base")
            .unwrap();
        assert!(body.contains(r#""accepted":true"#));
        let detail = engine.drone_json(2).unwrap();
        assert!(detail.contains("return_to_base"));
        assert!(detail.contains("commanded"));
    }

    #[test]
    fn file_push_and_integrity_check_are_backed_by_state() {
        let engine = VerifierEngine::new();
        let pushed = engine
            .push_file(
                4,
                SwarmTarget::All,
                "mission.json",
                r#"{"route":"alpha","altitude":120}"#,
            )
            .unwrap();
        assert!(pushed.contains(r#""delivered":4"#));

        let report = engine.check_integrity(4).unwrap();
        assert!(report.contains(r#""clean":true"#));
        assert!(report.contains(r#""ok":4"#));

        let detail = engine.drone_json(1).unwrap();
        assert!(detail.contains("mission.json"));
    }
}
