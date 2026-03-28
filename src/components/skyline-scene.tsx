"use client";

import { Edges, OrbitControls, Stars, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { DistrictRecord, RepoRecord } from "@/lib/skyline-data";

type LabeledDistrict = DistrictRecord & {
  label: string;
};

type SkyPalette = {
  ambient: number;
  fog: string;
  ground: string;
  street: string;
  districtEdge: string;
  horizon: string;
  dayFactor: number;
  isNight: boolean;
};

type SkylineSceneProps = {
  repos: RepoRecord[];
  districts: LabeledDistrict[];
  palette: SkyPalette;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
};

type FillerTower = {
  key: string;
  color: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  lightStrength: number;
};

const hashValue = (seed: number) => {
  const value = Math.sin(seed) * 43758.5453123;

  return value - Math.floor(value);
};

function buildFillerTowers(
  districts: LabeledDistrict[],
  repos: RepoRecord[],
): FillerTower[] {
  const filler: FillerTower[] = [];

  for (const district of districts) {
    const columns = Math.max(7, Math.round(district.size.width / 4.8));
    const rows = Math.max(6, Math.round(district.size.depth / 4.8));
    const stepX = district.size.width / columns;
    const stepZ = district.size.depth / rows;

    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const worldX =
          district.center.x - district.size.width / 2 + stepX / 2 + column * stepX;
        const worldZ =
          district.center.z - district.size.depth / 2 + stepZ / 2 + row * stepZ;
        const nearRepo = repos.some((repo) => {
          const dx = repo.x - worldX;
          const dz = repo.z - worldZ;

          return Math.sqrt(dx * dx + dz * dz) < 8.2;
        });

        if (nearRepo) {
          continue;
        }

        const seedBase = worldX * 11.83 + worldZ * 6.07;
        const offsetX = (hashValue(seedBase) - 0.5) * 1.8;
        const offsetZ = (hashValue(seedBase + 4.7) - 0.5) * 1.8;
        const centerDistance = Math.hypot(worldX - district.center.x, worldZ - district.center.z);
        const centrality = Math.max(
          0,
          1 - centerDistance / (Math.max(district.size.width, district.size.depth) * 0.74),
        );
        const width = 3.6 + hashValue(seedBase + 8.1) * 3.8;
        const depth = 3.6 + hashValue(seedBase + 12.9) * 4.1;
        const height =
          8 + centrality * 18 + hashValue(seedBase + 17.4) * 14 + (hashValue(seedBase + 24.1) > 0.8 ? 9 : 0);
        const lightStrength = 0.16 + hashValue(seedBase + 30.3) * 0.58;

        filler.push({
          key: `${district.id}-${column}-${row}`,
          color: district.color,
          x: Number((worldX + offsetX).toFixed(1)),
          z: Number((worldZ + offsetZ).toFixed(1)),
          width: Number(width.toFixed(1)),
          depth: Number(depth.toFixed(1)),
          height: Number(height.toFixed(1)),
          lightStrength: Number(lightStrength.toFixed(2)),
        });
      }
    }
  }

  for (let index = 0; index < 20; index += 1) {
    const leftSeed = 500 + index * 3.1;
    const rightSeed = 700 + index * 2.7;
    const backSeed = 900 + index * 2.3;
    const frontSeed = 1100 + index * 2.1;

    filler.push({
      key: `belt-left-${index}`,
      color: "#7faef8",
      x: Number((-134 + hashValue(leftSeed) * 18).toFixed(1)),
      z: Number((-102 + index * 10.8 + hashValue(leftSeed + 1.5) * 5).toFixed(1)),
      width: Number((5.2 + hashValue(leftSeed + 2.6) * 5).toFixed(1)),
      depth: Number((5 + hashValue(leftSeed + 3.4) * 5).toFixed(1)),
      height: Number((18 + hashValue(leftSeed + 4.8) * 52).toFixed(1)),
      lightStrength: Number((0.12 + hashValue(leftSeed + 5.9) * 0.5).toFixed(2)),
    });
    filler.push({
      key: `belt-right-${index}`,
      color: "#9be4c7",
      x: Number((134 - hashValue(rightSeed) * 18).toFixed(1)),
      z: Number((-102 + index * 10.5 + hashValue(rightSeed + 1.6) * 5).toFixed(1)),
      width: Number((5.4 + hashValue(rightSeed + 2.3) * 5.4).toFixed(1)),
      depth: Number((5 + hashValue(rightSeed + 3.2) * 5.4).toFixed(1)),
      height: Number((20 + hashValue(rightSeed + 4.7) * 54).toFixed(1)),
      lightStrength: Number((0.14 + hashValue(rightSeed + 5.6) * 0.52).toFixed(2)),
    });
    filler.push({
      key: `belt-back-${index}`,
      color: "#8b9cff",
      x: Number((-112 + index * 11.6 + hashValue(backSeed + 0.8) * 5).toFixed(1)),
      z: Number((-136 + hashValue(backSeed + 1.7) * 14).toFixed(1)),
      width: Number((5 + hashValue(backSeed + 2.8) * 5).toFixed(1)),
      depth: Number((5 + hashValue(backSeed + 3.9) * 5).toFixed(1)),
      height: Number((18 + hashValue(backSeed + 4.5) * 42).toFixed(1)),
      lightStrength: Number((0.12 + hashValue(backSeed + 5.8) * 0.48).toFixed(2)),
    });
    filler.push({
      key: `belt-front-${index}`,
      color: "#c9b46a",
      x: Number((-112 + index * 11.4 + hashValue(frontSeed + 0.9) * 5).toFixed(1)),
      z: Number((136 - hashValue(frontSeed + 1.8) * 14).toFixed(1)),
      width: Number((4.8 + hashValue(frontSeed + 2.7) * 4.8).toFixed(1)),
      depth: Number((4.8 + hashValue(frontSeed + 3.7) * 4.8).toFixed(1)),
      height: Number((16 + hashValue(frontSeed + 4.6) * 36).toFixed(1)),
      lightStrength: Number((0.1 + hashValue(frontSeed + 5.5) * 0.44).toFixed(2)),
    });
  }

  return filler;
}

function DistrictPlate({
  district,
  palette,
  onClearSelection,
}: {
  district: LabeledDistrict;
  palette: SkyPalette;
  onClearSelection: () => void;
}) {
  return (
    <group position={[district.center.x, 0, district.center.z]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onClearSelection();
        }}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[district.size.width, district.size.depth]} />
        <meshStandardMaterial
          color={district.color}
          emissive={district.color}
          emissiveIntensity={palette.isNight ? 0.09 : 0.03}
          transparent
          opacity={0.08}
        />
      </mesh>

      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry
          args={[
            Math.min(district.size.width, district.size.depth) * 0.24,
            Math.min(district.size.width, district.size.depth) * 0.28,
            40,
          ]}
        />
        <meshBasicMaterial
          color={district.color}
          transparent
          opacity={palette.isNight ? 0.22 : 0.14}
        />
      </mesh>

      <Text
        color="#eef6ff"
        fontSize={1.55}
        maxWidth={18}
        position={[0, 0.12, district.size.depth / 2 + 3.2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        {district.label}
      </Text>
    </group>
  );
}

function RoadStrip({
  position,
  size,
  color,
  onClearSelection,
}: {
  position: [number, number, number];
  size: [number, number];
  color: string;
  onClearSelection: () => void;
}) {
  return (
    <mesh
      onClick={(event) => {
        event.stopPropagation();
        onClearSelection();
      }}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function Building({
  repo,
  palette,
  selected,
  onSelect,
}: {
  repo: RepoRecord;
  palette: SkyPalette;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const shellRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "default";

    return () => {
      document.body.style.cursor = "default";
    };
  }, [hovered]);

  useFrame((state) => {
    const pulse = 0.92 + Math.sin(state.clock.elapsedTime * 1.2 + repo.x * 0.11) * 0.08;

    if (shellRef.current) {
      shellRef.current.position.y = THREE.MathUtils.lerp(
        shellRef.current.position.y,
        repo.height * 0.37 + 0.2 + (hovered ? 0.18 : 0),
        0.08,
      );
    }

    if (glowRef.current) {
      const material = glowRef.current.material as THREE.MeshStandardMaterial;
      const targetGlow = palette.isNight
        ? (0.18 + repo.lightStrength * 2.5) * pulse
        : repo.lightStrength * 0.08;

      material.emissiveIntensity = THREE.MathUtils.lerp(
        material.emissiveIntensity,
        targetGlow,
        0.08,
      );
      material.opacity = THREE.MathUtils.lerp(
        material.opacity,
        palette.isNight ? 0.9 : 0.28,
        0.08,
      );
    }
  });

  return (
    <group position={[repo.x, 0, repo.z]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(repo.id);
        }}
        position={[0, 0.16, 0]}
      >
        <boxGeometry args={[repo.lotWidth * 1.04, 0.3, repo.lotDepth * 1.04]} />
        <meshStandardMaterial
          color={palette.street}
          emissive={repo.color}
          emissiveIntensity={selected ? 0.12 : 0.03}
          transparent
          opacity={0.96}
        />
      </mesh>

      <mesh
        ref={shellRef}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(repo.id);
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <boxGeometry args={[repo.width, repo.height * 0.74, repo.depth]} />
        <meshStandardMaterial
          color={repo.color}
          emissive={repo.color}
          emissiveIntensity={palette.isNight ? 0.05 : 0.02}
          metalness={0.12}
          roughness={0.24}
          transparent
          opacity={palette.isNight ? 0.48 : 0.34}
        />
        {(selected || hovered) && <Edges color="#ffffff" scale={1.01} />}
      </mesh>

      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(repo.id);
        }}
        position={[0, repo.height * 0.84, 0]}
      >
        <boxGeometry args={[repo.width * 0.78, repo.height * 0.26, repo.depth * 0.78]} />
        <meshStandardMaterial
          color={repo.color}
          emissive={repo.color}
          emissiveIntensity={palette.isNight ? 0.04 : 0.015}
          metalness={0.14}
          roughness={0.22}
          transparent
          opacity={palette.isNight ? 0.42 : 0.3}
        />
      </mesh>

      <mesh
        ref={glowRef}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(repo.id);
        }}
        position={[0, repo.height / 2 + 0.25, 0]}
      >
        <boxGeometry
          args={[repo.width * 0.64, Math.max(repo.height - 3.8, 4), repo.depth * 0.64]}
        />
        <meshStandardMaterial
          color={repo.color}
          emissive={repo.color}
          emissiveIntensity={0.1}
          transparent
          opacity={palette.isNight ? 0.88 : 0.28}
        />
      </mesh>

      {selected ? (
        <Text
          color="#ffffff"
          fontSize={1.08}
          maxWidth={14}
          anchorX="center"
          position={[0, repo.height + 3.2, 0]}
        >
          {repo.name}
        </Text>
      ) : null}
    </group>
  );
}

function FillerBuilding({
  tower,
  palette,
}: {
  tower: FillerTower;
  palette: SkyPalette;
}) {
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!glowRef.current) {
      return;
    }

    const material = glowRef.current.material as THREE.MeshStandardMaterial;
    const pulse = 0.95 + Math.sin(state.clock.elapsedTime * 0.85 + tower.x * 0.07) * 0.05;
    const targetGlow = palette.isNight
      ? (0.09 + tower.lightStrength * 0.95) * pulse
      : tower.lightStrength * 0.02;

    material.emissiveIntensity = THREE.MathUtils.lerp(
      material.emissiveIntensity,
      targetGlow,
      0.08,
    );
  });

  return (
    <group position={[tower.x, 0, tower.z]}>
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[tower.width * 1.16, 0.18, tower.depth * 1.16]} />
        <meshStandardMaterial
          color={tower.color}
          emissive={tower.color}
          emissiveIntensity={palette.isNight ? 0.07 : 0.02}
          transparent
          opacity={0.18}
        />
      </mesh>

      <mesh position={[0, tower.height / 2, 0]}>
        <boxGeometry args={[tower.width, tower.height, tower.depth]} />
        <meshStandardMaterial
          color={tower.color}
          emissive={tower.color}
          emissiveIntensity={palette.isNight ? 0.03 : 0.01}
          roughness={0.34}
          metalness={0.08}
          transparent
          opacity={palette.isNight ? 0.24 : 0.14}
        />
      </mesh>

      <mesh ref={glowRef} position={[0, tower.height / 2, 0]}>
        <boxGeometry
          args={[tower.width * 0.72, Math.max(tower.height - 1.6, 2), tower.depth * 0.72]}
        />
        <meshStandardMaterial
          color={tower.color}
          emissive={tower.color}
          emissiveIntensity={0.03}
          transparent
          opacity={palette.isNight ? 0.28 : 0.09}
        />
      </mesh>
    </group>
  );
}

function SceneContent({
  repos,
  districts,
  palette,
  selectedId,
  onSelect,
  onClearSelection,
}: SkylineSceneProps) {
  const fillerTowers = useMemo(() => buildFillerTowers(districts, repos), [districts, repos]);

  return (
    <>
      <fog attach="fog" args={[palette.fog, 120, 900]} />
      <ambientLight intensity={palette.ambient} color="#ffffff" />
      <hemisphereLight args={["#dbeeff", "#09111d", 0.82 + palette.dayFactor * 0.32]} />
      <directionalLight
        color={palette.isNight ? "#83b9ff" : "#ffe6b5"}
        intensity={0.52 + palette.dayFactor * 1.08}
        position={[60, 72, 34]}
      />
      <pointLight
        color={palette.horizon}
        intensity={palette.isNight ? 7.8 : 1.1}
        distance={260}
        position={[0, 34, 0]}
      />

      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onClearSelection();
        }}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.18, 0]}
      >
        <planeGeometry args={[720, 720]} />
        <meshStandardMaterial color={palette.ground} />
      </mesh>

      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[0, -0.05, 0]}
        size={[720, 16]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[0, -0.05, -112]}
        size={[720, 12]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[0, -0.05, 112]}
        size={[720, 12]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[-146, -0.05, 0]}
        size={[12, 720]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[146, -0.05, 0]}
        size={[12, 720]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[0, -0.05, 0]}
        size={[16, 720]}
      />

      <gridHelper args={[720, 90, palette.districtEdge, palette.districtEdge]} position={[0, 0.02, 0]} />

      {districts.map((district) => (
        <DistrictPlate
          key={district.id}
          district={district}
          onClearSelection={onClearSelection}
          palette={palette}
        />
      ))}

      {fillerTowers.map((tower) => (
        <FillerBuilding key={tower.key} palette={palette} tower={tower} />
      ))}

      {repos.map((repo) => (
        <Building
          key={repo.id}
          onSelect={onSelect}
          palette={palette}
          repo={repo}
          selected={selectedId === repo.id}
        />
      ))}

      {palette.dayFactor < 0.58 ? (
        <Stars
          count={1600}
          depth={280}
          factor={4}
          fade
          radius={180}
          saturation={0}
          speed={0.2}
        />
      ) : null}

      <OrbitControls
        enablePan={false}
        maxDistance={1800}
        maxPolarAngle={Math.PI / 2.08}
        minDistance={18}
        minPolarAngle={Math.PI / 5.8}
        target={[0, 12, 8]}
      />
    </>
  );
}

export function SkylineScene(props: SkylineSceneProps) {
  return (
    <Canvas
      camera={{ fov: 24, position: [0, 30, 130], far: 3000 }}
      gl={{ antialias: true, alpha: true }}
    >
      <SceneContent {...props} />
    </Canvas>
  );
}
