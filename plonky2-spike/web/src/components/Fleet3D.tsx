import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ColorScheme } from "../lib/theme";
import type {
  DroneSummary,
  FileManifestEntry,
} from "../lib/types";
import { fmtKb, statusTone } from "../lib/util";

const COMMAND_POSITION = new THREE.Vector3(0, 1.62, 0);
const RECURSIVE_CORE = new THREE.Vector3(0, 0.58, 0);
const SWARM_FLOOR_Y = -1.08;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface ScenePalette {
  background: string;
  fog: string;
  good: string;
  bad: string;
  info: string;
  warn: string;
  muted: string;
  deck: string;
  grid: string;
  body: string;
  bodyActive: string;
  light: string;
}

const SCENE_PALETTES: Record<ColorScheme, ScenePalette> = {
  paper: {
    background: "#eef2f7",
    fog: "#eef2f7",
    good: "#0f766e",
    bad: "#dc2626",
    info: "#2563eb",
    warn: "#b45309",
    muted: "#6b7280",
    deck: "#dbe3ee",
    grid: "#a9b7c8",
    body: "#334155",
    bodyActive: "#1f3a44",
    light: "#ffffff",
  },
  graphite: {
    background: "#15181d",
    fog: "#15181d",
    good: "#5eead4",
    bad: "#fb7185",
    info: "#93c5fd",
    warn: "#fbbf24",
    muted: "#8b95a4",
    deck: "#222831",
    grid: "#3a4654",
    body: "#27313d",
    bodyActive: "#213941",
    light: "#dbeafe",
  },
  coast: {
    background: "#edf7f9",
    fog: "#edf7f9",
    good: "#0f766e",
    bad: "#be123c",
    info: "#0e7490",
    warn: "#c2410c",
    muted: "#607582",
    deck: "#d8edf1",
    grid: "#93bac5",
    body: "#274555",
    bodyActive: "#164e63",
    light: "#ffffff",
  },
  field: {
    background: "#f4f4ef",
    fog: "#f4f4ef",
    good: "#2f7d59",
    bad: "#b42318",
    info: "#315f78",
    warn: "#a16207",
    muted: "#667466",
    deck: "#e4e7dd",
    grid: "#a9b39e",
    body: "#31443a",
    bodyActive: "#28523d",
    light: "#ffffff",
  },
};

interface Props {
  drones: DroneSummary[];
  participants: number[];
  selectedId: number;
  onSelect: (id: number) => void;
  onInspect?: (selection: FleetInspectSelection) => void;
  alarm: boolean;
  files: FileManifestEntry[];
  colorScheme: ColorScheme;
  simulationActive: boolean;
  simulationStep: number;
}

export type FleetInspectSelection =
  | { type: "aggregator"; id: number; members: number[] }
  | { type: "core" }
  | { type: "commander" };

interface ProofGroup {
  id: string;
  index: number;
  position: THREE.Vector3;
  droneIds: number[];
}

interface ProofLinkData {
  id: string;
  points: THREE.Vector3[];
  color: string;
  speed: number;
  offset: number;
  phase: number;
}

export function Fleet3D({
  drones,
  participants,
  selectedId,
  onSelect,
  onInspect,
  alarm,
  files,
  colorScheme,
  simulationActive,
  simulationStep,
}: Props) {
  const palette = SCENE_PALETTES[colorScheme];

  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [4.25, 2.75, 6.65], fov: 40 }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(new THREE.Color(palette.background), 1);
        scene.fog = new THREE.Fog(palette.fog, 5.8, 10.5);
      }}
    >
      <SceneContents
        drones={drones}
        participants={participants}
        selectedId={selectedId}
        onSelect={onSelect}
        onInspect={onInspect}
        alarm={alarm}
        files={files}
        palette={palette}
        simulationActive={simulationActive}
        simulationStep={simulationStep}
      />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate={false}
        minDistance={4.8}
        maxDistance={8.8}
        minPolarAngle={Math.PI * 0.2}
        maxPolarAngle={Math.PI * 0.76}
      />
    </Canvas>
  );
}

function SceneContents({
  drones,
  participants,
  selectedId,
  onSelect,
  onInspect,
  alarm,
  files,
  palette,
  simulationActive,
  simulationStep,
}: {
  drones: DroneSummary[];
  participants: number[];
  selectedId: number;
  onSelect: (id: number) => void;
  onInspect?: (selection: FleetInspectSelection) => void;
  alarm: boolean;
  files: FileManifestEntry[];
  palette: ScenePalette;
  simulationActive: boolean;
  simulationStep: number;
}) {
  const positions = useMemo(() => computeDronePositions(drones.length), [drones.length]);
  const filesByDrone = useMemo(() => indexFilesByDrone(files), [files]);
  const participantSet = useMemo(() => new Set(participants), [participants]);
  const densityScale =
    drones.length > 80 ? 0.34 : drones.length > 55 ? 0.38 : drones.length > 36 ? 0.43 : 0.5;

  const selectedIndex = useMemo(() => {
    const byId = drones.findIndex((d) => d.id === selectedId);
    return byId >= 0 ? byId : selectedId;
  }, [drones, selectedId]);

  return (
    <>
      <color attach="background" args={[palette.background]} />
      <fog attach="fog" args={[palette.fog, 5.8, 10.5]} />
      <ambientLight intensity={0.52} />
      <directionalLight position={[2.8, 5.2, 3.4]} intensity={0.95} color={palette.light} />
      <pointLight position={[-3.2, 1.6, -2.5]} intensity={0.34} color={palette.info} />
      <pointLight
        position={[0, 1.7, 0]}
        intensity={alarm ? 0.9 : 0.5}
        color={alarm ? palette.bad : palette.good}
      />

      <GridDeck alarm={alarm} palette={palette} />
      <NetworkLinks
        positions={positions}
        drones={drones}
        selectedIndex={selectedIndex}
        palette={palette}
      />
      <ProofPipeline
        positions={positions}
        participants={participants}
        alarm={alarm}
        palette={palette}
        simulationActive={simulationActive}
        simulationStep={simulationStep}
        onInspect={onInspect}
      />

      {drones.map((drone, i) => {
        const participant = participantSet.has(drone.id) || participantSet.has(i);
        const isSelected = drone.id === selectedId || i === selectedIndex;
        return (
          <DroneUnit
            key={drone.id}
            drone={drone}
            position={positions[i] ?? new THREE.Vector3()}
            index={i}
            participant={participant}
            selected={isSelected}
            files={filesByDrone.get(drone.id) ?? filesByDrone.get(i) ?? []}
            showMicroLabel={isSelected || drones.length <= 12}
            showTelemetry={false}
            onSelect={onSelect}
            palette={palette}
            baseScale={densityScale}
          />
        );
      })}

      <RecursiveCore alarm={alarm} palette={palette} onInspect={onInspect} />
      <CommandCenter
        alarm={alarm}
        palette={palette}
        onInspect={onInspect}
      />
    </>
  );
}

function computeDronePositions(count: number): THREE.Vector3[] {
  if (count <= 0) return [];
  const maxRadius =
    count > 80 ? 4.15 : count > 55 ? 3.75 : count > 36 ? 3.35 : count <= 16 ? 2.35 : 2.95;
  const zScale = count > 55 ? 0.86 : count > 36 ? 0.8 : 0.74;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    const radius = 0.45 + Math.sqrt(t) * maxRadius;
    const angle = i * GOLDEN_ANGLE;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * zScale;
    const y = SWARM_FLOOR_Y + Math.sin(i * 1.71) * 0.08;
    return new THREE.Vector3(x, y, z);
  });
}

function indexFilesByDrone(files: FileManifestEntry[]): Map<number, FileManifestEntry[]> {
  const out = new Map<number, FileManifestEntry[]>();
  for (const file of files) {
    for (const droneId of file.expected_drones) {
      const entries = out.get(droneId) ?? [];
      entries.push(file);
      out.set(droneId, entries);
    }
  }
  return out;
}

function GridDeck({ alarm, palette }: { alarm: boolean; palette: ScenePalette }) {
  const color = alarm ? palette.bad : palette.good;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, SWARM_FLOOR_Y - 0.14, 0]}>
        <ringGeometry args={[0.75, 2.85, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, SWARM_FLOOR_Y - 0.15, 0]}>
        <circleGeometry args={[2.9, 72]} />
        <meshBasicMaterial color={palette.deck} transparent opacity={0.72} side={THREE.DoubleSide} />
      </mesh>
      {[-2, -1, 0, 1, 2].map((x) => (
        <Line
          key={`x-${x}`}
          points={[new THREE.Vector3(x, SWARM_FLOOR_Y - 0.12, -2.05), new THREE.Vector3(x, SWARM_FLOOR_Y - 0.12, 2.05)]}
          color={palette.grid}
          lineWidth={1}
          transparent
          opacity={0.42}
        />
      ))}
      {[-2, -1, 0, 1, 2].map((z) => (
        <Line
          key={`z-${z}`}
          points={[new THREE.Vector3(-2.7, SWARM_FLOOR_Y - 0.12, z), new THREE.Vector3(2.7, SWARM_FLOOR_Y - 0.12, z)]}
          color={palette.grid}
          lineWidth={1}
          transparent
          opacity={0.32}
        />
      ))}
    </group>
  );
}

function NetworkLinks({
  positions,
  drones,
  selectedIndex,
  palette,
}: {
  positions: THREE.Vector3[];
  drones: DroneSummary[];
  selectedIndex: number;
  palette: ScenePalette;
}) {
  const links = useMemo(() => {
    const out: Array<[THREE.Vector3, THREE.Vector3, string, number]> = [];
    if (positions.length < 2) return out;

    for (let i = 0; i < positions.length; i++) {
      if (i % Math.max(1, Math.ceil(positions.length / 36)) !== 0) continue;
      const next = positions[(i + 1) % positions.length];
      if (next) out.push([positions[i], next, palette.info, 0.13]);
    }

    const selected = positions[selectedIndex];
    if (selected) {
      for (let i = 0; i < positions.length; i++) {
        if (i === selectedIndex) continue;
        const drone = drones[i];
        const connected =
          drone?.status === "commanded" ||
          drone?.status === "file synced" ||
          i % Math.max(2, Math.ceil(positions.length / 12)) === 0;
        if (connected) out.push([selected, positions[i], palette.good, 0.2]);
      }
    }

    return out.slice(0, 110);
  }, [drones, palette.good, palette.info, positions, selectedIndex]);

  return (
    <group>
      {links.map(([a, b, color, opacity], i) => (
        <Line
          key={`${i}-${a.x}-${b.z}`}
          points={[a, b]}
          color={color}
          lineWidth={1}
          transparent
          opacity={opacity}
        />
      ))}
    </group>
  );
}

function ProofPipeline({
  positions,
  participants,
  alarm,
  palette,
  simulationActive,
  simulationStep,
  onInspect,
}: {
  positions: THREE.Vector3[];
  participants: number[];
  alarm: boolean;
  palette: ScenePalette;
  simulationActive: boolean;
  simulationStep: number;
  onInspect?: (selection: FleetInspectSelection) => void;
}) {
  const { groups, links } = useMemo(() => {
    const active = participants.filter((id) => positions[id]);
    if (active.length === 0) return { groups: [] as ProofGroup[], links: [] as ProofLinkData[] };

    const groupCount = Math.min(6, Math.max(1, Math.ceil(active.length / 4)));
    const groups: ProofGroup[] = [];
    const links: ProofLinkData[] = [];

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      const ids = active.filter((_, i) => i % groupCount === groupIndex);
      const angle = (groupIndex / groupCount) * Math.PI * 2 + Math.PI / 6;
      const position = new THREE.Vector3(
        Math.cos(angle) * 0.86,
        -0.12 + Math.sin(groupIndex * 1.9) * 0.04,
        Math.sin(angle) * 0.62,
      );
      groups.push({ id: `A${groupIndex + 1}`, index: groupIndex, position, droneIds: ids });

      ids.forEach((droneId, localIndex) => {
        links.push({
          id: `leaf-${droneId}-${groupIndex}`,
          points: makeArc(positions[droneId], position, 0.22),
          color: alarm ? palette.bad : palette.good,
          speed: 0.22 + (localIndex % 3) * 0.045,
          offset: (droneId * 0.113 + groupIndex * 0.09) % 1,
          phase: 1,
        });
      });

      links.push({
        id: `merge-${groupIndex}`,
        points: makeArc(position, RECURSIVE_CORE, 0.3),
        color: alarm ? palette.bad : palette.good,
        speed: 0.18,
        offset: (groupIndex * 0.2) % 1,
        phase: 2,
      });
    }

    links.push({
      id: "root-command",
      points: makeArc(RECURSIVE_CORE, COMMAND_POSITION, 0.18),
      color: alarm ? palette.bad : palette.info,
      speed: 0.16,
      offset: 0.35,
      phase: 3,
    });

    return { groups, links };
  }, [alarm, palette.bad, palette.good, palette.info, participants, positions]);

  const proofColor = alarm ? palette.bad : palette.good;
  const visiblePhase = simulationActive ? Math.max(1, simulationStep) : 0;

  return (
    <group>
      {links.filter((link) => link.phase <= visiblePhase).map((link) => (
        <AnimatedProofLink key={link.id} link={link} alarm={alarm} />
      ))}
      {groups.map((group) => (
        <ProofAggregator
          key={group.id}
          group={group}
          color={simulationActive && simulationStep >= 2 ? proofColor : palette.info}
          onInspect={onInspect}
        />
      ))}
    </group>
  );
}

function makeArc(a: THREE.Vector3, b: THREE.Vector3, lift: number): THREE.Vector3[] {
  const control = a.clone().lerp(b, 0.5);
  control.y = Math.max(a.y, b.y) + lift;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    points.push(quadraticPoint(a, control, b, t));
  }
  return points;
}

function quadraticPoint(
  a: THREE.Vector3,
  c: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const one = 1 - t;
  return new THREE.Vector3(
    one * one * a.x + 2 * one * t * c.x + t * t * b.x,
    one * one * a.y + 2 * one * t * c.y + t * t * b.y,
    one * one * a.z + 2 * one * t * c.z + t * t * b.z,
  );
}

function AnimatedProofLink({
  link,
  alarm,
}: {
  link: ProofLinkData;
  alarm: boolean;
}) {
  return (
    <group>
      <Line
        points={link.points}
        color={link.color}
        lineWidth={1}
        transparent
        opacity={alarm ? 0.52 : 0.46}
      />
      <Line
        points={link.points}
        color={link.color}
        lineWidth={4}
        transparent
        opacity={alarm ? 0.08 : 0.06}
      />
      <ProofPacket path={link.points} color={link.color} offset={link.offset} speed={link.speed} />
    </group>
  );
}

function ProofPacket({
  path,
  color,
  offset,
  speed,
}: {
  path: THREE.Vector3[];
  color: string;
  offset: number;
  speed: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const temp = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    if (!ref.current || path.length < 2) return;
    const t = (state.clock.elapsedTime * speed + offset) % 1;
    samplePolyline(path, t, temp);
    ref.current.position.copy(temp);
    ref.current.rotation.y += 0.08;
    ref.current.rotation.x += 0.05;
  });

  return (
    <mesh ref={ref}>
      <octahedronGeometry args={[0.035, 0]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function samplePolyline(points: THREE.Vector3[], t: number, target: THREE.Vector3) {
  const scaled = t * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  const local = scaled - index;
  target.lerpVectors(points[index], points[index + 1], local);
}

function ProofAggregator({
  group,
  color,
  onInspect,
}: {
  group: ProofGroup;
  color: string;
  onInspect?: (selection: FleetInspectSelection) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.45;
  });

  return (
    <group
      position={group.position}
      onClick={(event) => {
        event.stopPropagation();
        onInspect?.({ type: "aggregator", id: group.index, members: group.droneIds });
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <group ref={ref}>
        <mesh>
          <octahedronGeometry args={[0.13, 0]} />
          <meshStandardMaterial
            color="#0e1820"
            emissive={color}
            emissiveIntensity={0.72}
            metalness={0.45}
            roughness={0.32}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.22, 0.009, 10, 36]} />
          <meshBasicMaterial color={color} transparent opacity={0.82} toneMapped={false} />
        </mesh>
      </group>
      <Html center position={[0, 0.3, 0]} distanceFactor={4.8} style={{ pointerEvents: "none" }}>
        <div className="node-chip aggregate">
          <span>H1-{group.index}</span>
          <code>{group.droneIds.length} leaves</code>
        </div>
      </Html>
    </group>
  );
}

function DroneUnit({
  drone,
  position,
  index,
  participant,
  selected,
  files,
  showMicroLabel,
  showTelemetry,
  onSelect,
  palette,
  baseScale,
}: {
  drone: DroneSummary;
  position: THREE.Vector3;
  index: number;
  participant: boolean;
  selected: boolean;
  files: FileManifestEntry[];
  showMicroLabel: boolean;
  showTelemetry: boolean;
  onSelect: (id: number) => void;
  palette: ScenePalette;
  baseScale: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const tone = statusTone(drone.status);
  const color = palette[tone] ?? palette.muted;
  const hash = latestHash(files);
  const yaw = Math.atan2(position.x, position.z) + Math.PI;

  useFrame((state) => {
    if (!ref.current) return;
    const bob = Math.sin(state.clock.elapsedTime * 1.8 + index * 0.67) * 0.035;
    ref.current.position.set(position.x, position.y + bob, position.z);
    ref.current.rotation.y = yaw + Math.sin(state.clock.elapsedTime * 0.7 + index) * 0.04;
  });

  return (
    <group
      ref={ref}
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(drone.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      <group scale={selected ? baseScale * 1.36 : hovered ? baseScale * 1.16 : baseScale}>
        <DroneBody
          color={color}
          participant={participant}
          selected={selected || hovered}
          palette={palette}
        />
        <DroneStatusLights drone={drone} participant={participant} palette={palette} />
      </group>

      {(selected || hovered) && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.09, 0]}>
          <ringGeometry args={[0.18, 0.22, 42]} />
          <meshBasicMaterial
            color={drone.integrity_ok ? palette.good : palette.bad}
            transparent
            opacity={selected ? 0.72 : 0.42}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}

      {showTelemetry && (
        <DroneTelemetryCard
          drone={drone}
          files={files}
          hash={hash}
          participant={participant}
          selected={selected}
        />
      )}

      {!showTelemetry && (showMicroLabel || hovered) && (
        <Html center position={[0, 0.22, 0]} distanceFactor={4.6} style={{ pointerEvents: "none" }}>
          <div className={`drone-chip ${tone}`}>
            <span>{drone.callsign}</span>
            <code>{participant ? "proof leaf" : drone.status}</code>
          </div>
        </Html>
      )}
    </group>
  );
}

function DroneBody({
  color,
  participant,
  selected,
  palette,
}: {
  color: string;
  participant: boolean;
  selected: boolean;
  palette: ScenePalette;
}) {
  const bodyColor = participant ? palette.bodyActive : palette.body;
  const opacity = participant ? 1 : 0.72;

  return (
    <group>
      <mesh>
        <boxGeometry args={[0.2, 0.075, 0.3]} />
        <meshStandardMaterial
          color={bodyColor}
          emissive={color}
          emissiveIntensity={selected ? 0.26 : participant ? 0.12 : 0.04}
          metalness={0.65}
          roughness={0.26}
          transparent
          opacity={opacity}
        />
      </mesh>
      <mesh position={[0, 0.008, -0.18]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.075, 0.13, 4]} />
        <meshStandardMaterial color={palette.body} emissive={color} emissiveIntensity={0.08} />
      </mesh>

      <Arm rotation={[0, 0, Math.PI / 2]} color={color} palette={palette} />
      <Arm rotation={[Math.PI / 2, 0, 0]} color={color} palette={palette} />

      <Rotor position={[-0.23, 0.018, -0.19]} color={color} offset={0} />
      <Rotor position={[0.23, 0.018, -0.19]} color={color} offset={1.2} />
      <Rotor position={[-0.23, 0.018, 0.19]} color={color} offset={2.2} />
      <Rotor position={[0.23, 0.018, 0.19]} color={color} offset={3.1} />
    </group>
  );
}

function Arm({
  rotation,
  color,
  palette,
}: {
  rotation: [number, number, number];
  color: string;
  palette: ScenePalette;
}) {
  return (
    <mesh rotation={rotation}>
      <cylinderGeometry args={[0.012, 0.012, 0.52, 8]} />
      <meshStandardMaterial
        color={palette.body}
        emissive={color}
        emissiveIntensity={0.06}
        metalness={0.55}
        roughness={0.38}
      />
    </mesh>
  );
}

function Rotor({
  position,
  color,
  offset,
}: {
  position: [number, number, number];
  color: string;
  offset: number;
}) {
  const blades = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!blades.current) return;
    blades.current.rotation.y = state.clock.elapsedTime * 22 + offset;
  });

  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.072, 0.006, 8, 22]} />
        <meshBasicMaterial color={color} transparent opacity={0.62} toneMapped={false} />
      </mesh>
      <group ref={blades}>
        <mesh>
          <boxGeometry args={[0.14, 0.006, 0.018]} />
          <meshBasicMaterial color={color} transparent opacity={0.72} toneMapped={false} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[0.14, 0.006, 0.018]} />
          <meshBasicMaterial color={color} transparent opacity={0.52} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function DroneStatusLights({
  drone,
  participant,
  palette,
}: {
  drone: DroneSummary;
  participant: boolean;
  palette: ScenePalette;
}) {
  const proofColor = drone.proof_verified && participant ? palette.good : palette.warn;
  const integrityColor = drone.integrity_ok ? palette.info : palette.bad;
  return (
    <group>
      <mesh position={[-0.065, -0.045, -0.08]}>
        <sphereGeometry args={[0.018, 10, 10]} />
        <meshBasicMaterial color={proofColor} toneMapped={false} />
      </mesh>
      <mesh position={[0.065, -0.045, -0.08]}>
        <sphereGeometry args={[0.018, 10, 10]} />
        <meshBasicMaterial color={integrityColor} toneMapped={false} />
      </mesh>
    </group>
  );
}

function DroneTelemetryCard({
  drone,
  files,
  hash,
  participant,
  selected,
}: {
  drone: DroneSummary;
  files: FileManifestEntry[];
  hash: string;
  participant: boolean;
  selected: boolean;
}) {
  const tone = statusTone(drone.status);
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const command = drone.current_command || "idle";
  return (
    <Html
      center
      position={[0, selected ? 0.48 : 0.38, 0]}
      distanceFactor={selected ? 4.2 : 4.8}
      style={{ pointerEvents: "none" }}
    >
      <div className={`drone-card ${tone} ${selected ? "selected" : ""}`}>
        <div className="drone-card-head">
          <strong>{drone.callsign}</strong>
          <span>{participant ? "proof leaf" : "standby"}</span>
        </div>
        <div className="drone-card-grid">
          <span>Status</span>
          <b>{drone.status}</b>
          <span>Proof</span>
          <b>{drone.proof_verified ? "verified" : "pending"}</b>
          <span>Integrity</span>
          <b>{drone.integrity_ok ? "clean" : "fault"}</b>
          <span>Battery</span>
          <b>{drone.battery}%</b>
          <span>Link</span>
          <b>{drone.link}%</b>
          <span>Command</span>
          <b>{command}</b>
        </div>
        <div className="drone-card-foot">
          <span>{files.length} files / {fmtKb(bytes)}</span>
          <code>{hash}</code>
        </div>
      </div>
    </Html>
  );
}

function latestHash(files: FileManifestEntry[]): string {
  if (files.length === 0) return "no-manifest";
  const latest = files[files.length - 1];
  return latest.hash.length > 16
    ? `${latest.hash.slice(0, 8)}:${latest.hash.slice(-6)}`
    : latest.hash;
}

function RecursiveCore({
  alarm,
  palette,
  onInspect,
}: {
  alarm: boolean;
  palette: ScenePalette;
  onInspect?: (selection: FleetInspectSelection) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.26;
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.7) * 0.08;
  });

  const color = alarm ? palette.bad : palette.good;
  return (
    <group
      position={RECURSIVE_CORE}
      onClick={(event) => {
        event.stopPropagation();
        onInspect?.({ type: "core" });
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <group ref={ref}>
        <mesh>
          <icosahedronGeometry args={[0.16, 1]} />
          <meshStandardMaterial
            color={palette.body}
            emissive={color}
            emissiveIntensity={0.22}
            metalness={0.62}
            roughness={0.24}
            wireframe
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.25, 0.007, 8, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.75} toneMapped={false} />
        </mesh>
      </group>
      <Html center position={[0, 0.34, 0]} distanceFactor={4.8} style={{ pointerEvents: "none" }}>
        <div className="node-chip root">
          <span>ROOT</span>
          <code>fold proof</code>
        </div>
      </Html>
    </group>
  );
}

function CommandCenter({
  alarm,
  palette,
  onInspect,
}: {
  alarm: boolean;
  palette: ScenePalette;
  onInspect?: (selection: FleetInspectSelection) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.35) * 0.05;
  });

  const color = alarm ? palette.bad : palette.good;

  return (
    <group
      ref={ref}
      position={COMMAND_POSITION}
      onClick={(event) => {
        event.stopPropagation();
        onInspect?.({ type: "commander" });
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <mesh position={[0, -0.18, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.88, 0.12, 0.88]} />
        <meshStandardMaterial
          color={palette.body}
          emissive={color}
          emissiveIntensity={0.08}
          metalness={0.68}
          roughness={0.28}
        />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[0.56, 0.36, 0.18]} />
        <meshStandardMaterial
          color={palette.bodyActive}
          emissive={color}
          emissiveIntensity={0.14}
          metalness={0.5}
          roughness={0.2}
        />
      </mesh>
      <mesh position={[0, 0.04, -0.095]}>
        <planeGeometry args={[0.5, 0.29]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.31, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.34, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.52, 0]}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.88} toneMapped={false} />
      </mesh>
      <Html center position={[0, 0.72, 0]} distanceFactor={5.2} style={{ pointerEvents: "none" }}>
        <div className="node-chip commander">
          <span>CMD</span>
          <code>verdict</code>
        </div>
      </Html>
    </group>
  );
}
