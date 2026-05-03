import { Canvas, useFrame } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { DroneSummary } from "../lib/types";
import { fibonacciPoint, statusTone } from "../lib/util";

const RADIUS = 1.7;
const SHELL_OUTER = 2.0;
const SHELL_INNER = 1.35;

const TONE_COLORS: Record<string, string> = {
  good: "#5cffd0",
  bad: "#ff2d55",
  info: "#6ad4ff",
  warn: "#ffb547",
  muted: "#48555f",
};

interface Props {
  drones: DroneSummary[];
  participants: number[];
  selectedId: number;
  onSelect: (id: number) => void;
  alarm: boolean;
}

export function Fleet3D({ drones, participants, selectedId, onSelect, alarm }: Props) {
  return (
    <>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 0.9, 5.1], fov: 36 }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor(new THREE.Color("#04060a"), 1);
          scene.fog = new THREE.Fog("#04060a", 5.5, 10);
        }}
      >
        <SceneContents
          drones={drones}
          participants={participants}
          selectedId={selectedId}
          onSelect={onSelect}
          alarm={alarm}
        />
        <EffectComposer multisampling={0}>
          <Bloom
            mipmapBlur
            intensity={1.4}
            luminanceThreshold={0.18}
            luminanceSmoothing={0.2}
            radius={0.85}
          />
        </EffectComposer>
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          autoRotate
          autoRotateSpeed={0.55}
          minPolarAngle={Math.PI * 0.28}
          maxPolarAngle={Math.PI * 0.78}
        />
      </Canvas>
    </>
  );
}

function SceneContents({
  drones,
  participants,
  selectedId,
  onSelect,
  alarm,
}: Props) {
  const positions = useMemo(() => {
    const n = drones.length;
    return drones.map((_, i) => {
      const [x, y, z] = fibonacciPoint(i, n);
      return new THREE.Vector3(x * RADIUS, y * RADIUS, z * RADIUS);
    });
  }, [drones]);

  const chain = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (const id of participants) {
      const p = positions[id];
      if (p) pts.push(p);
    }
    return pts;
  }, [participants, positions]);

  return (
    <>
      <ambientLight intensity={0.25} />
      <pointLight position={[5, 4, 6]} intensity={0.6} color={"#5cffd0"} />
      <pointLight position={[-5, -3, -4]} intensity={0.3} color={"#6ad4ff"} />

      <Shells alarm={alarm} />

      <Equators />

      <DroneCloud
        positions={positions}
        drones={drones}
        selectedId={selectedId}
        onSelect={onSelect}
      />

      {chain.length >= 2 && <ProofChain points={chain} alarm={alarm} />}

      <SelectionRing positions={positions} selectedId={selectedId} />

      {chain.length > 0 && <ActiveBeacon position={chain[chain.length - 1]} alarm={alarm} />}
    </>
  );
}

function Shells({ alarm }: { alarm: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 0.04;
    ref.current.rotation.x += dt * 0.012;
  });
  const color = alarm ? "#ff2d55" : "#5cffd0";
  return (
    <group ref={ref}>
      <mesh>
        <icosahedronGeometry args={[SHELL_OUTER, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.18} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[SHELL_OUTER * 1.001, 2]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.045} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[SHELL_INNER, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.08} />
      </mesh>
    </group>
  );
}

function Equators() {
  const eq = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const n = 96;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS));
    }
    return pts;
  }, []);
  const meridian = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const n = 96;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 0));
    }
    return pts;
  }, []);
  return (
    <>
      <Line points={eq} color={"#1d3a33"} lineWidth={1} transparent opacity={0.6} />
      <Line points={meridian} color={"#1d3a33"} lineWidth={1} transparent opacity={0.4} />
    </>
  );
}

interface CloudProps {
  positions: THREE.Vector3[];
  drones: DroneSummary[];
  selectedId: number;
  onSelect: (id: number) => void;
}

function DroneCloud({ positions, drones, selectedId, onSelect }: CloudProps) {
  return (
    <group>
      {drones.map((d, i) => {
        const tone = statusTone(d.status);
        const color = TONE_COLORS[tone] ?? TONE_COLORS.muted;
        const isSelected = d.id === selectedId;
        const radius = isSelected ? 0.07 : tone === "muted" ? 0.028 : 0.038;
        return (
          <DroneNode
            key={d.id}
            position={positions[i] ?? new THREE.Vector3()}
            color={color}
            radius={radius}
            tone={tone}
            onClick={() => onSelect(d.id)}
          />
        );
      })}
    </group>
  );
}

interface NodeProps {
  position: THREE.Vector3;
  color: string;
  radius: number;
  tone: ReturnType<typeof statusTone>;
  onClick: () => void;
}

function DroneNode({ position, color, radius, tone, onClick }: NodeProps) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    if (tone === "good" || tone === "bad" || tone === "info" || tone === "warn") {
      const t = state.clock.elapsedTime;
      const pulse = 1 + Math.sin(t * 3 + position.x * 4 + position.y * 2) * 0.1;
      ref.current.scale.setScalar(pulse);
    } else {
      ref.current.scale.setScalar(1);
    }
  });
  return (
    <mesh
      ref={ref}
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <sphereGeometry args={[radius, 12, 12]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function ProofChain({
  points,
  alarm,
}: {
  points: THREE.Vector3[];
  alarm: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.LineBasicMaterial | null>(null);
  useFrame((state) => {
    if (matRef.current) {
      const t = state.clock.elapsedTime;
      matRef.current.opacity = alarm
        ? 0.6 + Math.sin(t * 6) * 0.2
        : 0.85 + Math.sin(t * 1.6) * 0.1;
    }
  });
  return (
    <group ref={ref}>
      <Line
        points={points}
        color={alarm ? "#ff2d55" : "#5cffd0"}
        lineWidth={2}
        transparent
        opacity={0.85}
        toneMapped={false}
      />
      <Line
        points={points}
        color={alarm ? "#ff2d55" : "#9affe6"}
        lineWidth={6}
        transparent
        opacity={0.18}
        toneMapped={false}
      />
    </group>
  );
}

function SelectionRing({
  positions,
  selectedId,
}: {
  positions: THREE.Vector3[];
  selectedId: number;
}) {
  const target = positions[selectedId];
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current || !target) return;
    ref.current.position.copy(target);
    ref.current.lookAt(0, 0, 0);
    const t = state.clock.elapsedTime;
    const s = 1 + Math.sin(t * 4) * 0.08;
    ref.current.scale.setScalar(s);
  });
  if (!target) return null;
  return (
    <mesh ref={ref}>
      <ringGeometry args={[0.085, 0.115, 32]} />
      <meshBasicMaterial color={"#5cffd0"} transparent opacity={0.9} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function ActiveBeacon({ position, alarm }: { position: THREE.Vector3; alarm: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const s = 0.14 + Math.sin(t * 5) * 0.05;
    ref.current.scale.setScalar(s);
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial
        color={alarm ? "#ff2d55" : "#aaffea"}
        transparent
        opacity={0.3}
        toneMapped={false}
      />
    </mesh>
  );
}
