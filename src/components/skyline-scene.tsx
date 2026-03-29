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

type CompoundTower = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
};

const hashValue = (seed: number) => {
  const value = Math.sin(seed) * 43758.5453123;

  return value - Math.floor(value);
};

function buildFillerTowers(): FillerTower[] {
  const filler: FillerTower[] = [];

  for (let index = 0; index < 34; index += 1) {
    const leftSeed = 500 + index * 3.1;
    const rightSeed = 700 + index * 2.7;
    const backSeed = 900 + index * 2.3;
    const frontSeed = 1100 + index * 2.1;

    filler.push({
      key: `belt-left-${index}`,
      color: "#7faef8",
      x: Number((-214 + hashValue(leftSeed) * 28).toFixed(1)),
      z: Number((-182 + index * 11.6 + hashValue(leftSeed + 1.5) * 6).toFixed(1)),
      width: Number((5.8 + hashValue(leftSeed + 2.6) * 6.4).toFixed(1)),
      depth: Number((5.4 + hashValue(leftSeed + 3.4) * 6.2).toFixed(1)),
      height: Number((22 + hashValue(leftSeed + 4.8) * 62).toFixed(1)),
      lightStrength: Number((0.12 + hashValue(leftSeed + 5.9) * 0.5).toFixed(2)),
    });
    filler.push({
      key: `belt-right-${index}`,
      color: "#9be4c7",
      x: Number((214 - hashValue(rightSeed) * 28).toFixed(1)),
      z: Number((-182 + index * 11.4 + hashValue(rightSeed + 1.6) * 6).toFixed(1)),
      width: Number((5.8 + hashValue(rightSeed + 2.3) * 6.6).toFixed(1)),
      depth: Number((5.2 + hashValue(rightSeed + 3.2) * 6.2).toFixed(1)),
      height: Number((22 + hashValue(rightSeed + 4.7) * 64).toFixed(1)),
      lightStrength: Number((0.14 + hashValue(rightSeed + 5.6) * 0.52).toFixed(2)),
    });
    filler.push({
      key: `belt-back-${index}`,
      color: "#8b9cff",
      x: Number((-192 + index * 11.8 + hashValue(backSeed + 0.8) * 6).toFixed(1)),
      z: Number((-222 + hashValue(backSeed + 1.7) * 18).toFixed(1)),
      width: Number((5.4 + hashValue(backSeed + 2.8) * 5.8).toFixed(1)),
      depth: Number((5.4 + hashValue(backSeed + 3.9) * 5.8).toFixed(1)),
      height: Number((18 + hashValue(backSeed + 4.5) * 48).toFixed(1)),
      lightStrength: Number((0.12 + hashValue(backSeed + 5.8) * 0.48).toFixed(2)),
    });
    filler.push({
      key: `belt-front-${index}`,
      color: "#c9b46a",
      x: Number((-192 + index * 11.8 + hashValue(frontSeed + 0.9) * 6).toFixed(1)),
      z: Number((222 - hashValue(frontSeed + 1.8) * 18).toFixed(1)),
      width: Number((5.2 + hashValue(frontSeed + 2.7) * 5.4).toFixed(1)),
      depth: Number((5.2 + hashValue(frontSeed + 3.7) * 5.4).toFixed(1)),
      height: Number((18 + hashValue(frontSeed + 4.6) * 40).toFixed(1)),
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
        position={[0, -0.16, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[district.size.width * 0.54, 1, district.size.depth * 0.48]}
      >
        <circleGeometry args={[1, 48]} />
        <meshBasicMaterial
          color={district.color}
          transparent
          depthWrite={false}
          opacity={palette.isNight ? 0.07 : 0.04}
        />
      </mesh>

      <mesh
        position={[0, -0.14, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[district.size.width * 0.3, 1, district.size.depth * 0.26]}
      >
        <ringGeometry args={[0.72, 1, 52]} />
        <meshBasicMaterial
          color={district.color}
          transparent
          depthWrite={false}
          opacity={palette.isNight ? 0.2 : 0.12}
        />
      </mesh>

      <Text
        color="#eef6ff"
        fontSize={1.22}
        maxWidth={18}
        position={[0, -0.12, district.size.depth * 0.22]}
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
  rotationY = 0,
  onClearSelection,
}: {
  position: [number, number, number];
  size: [number, number];
  color: string;
  rotationY?: number;
  onClearSelection: () => void;
}) {
  return (
    <mesh
      onClick={(event) => {
        event.stopPropagation();
        onClearSelection();
      }}
      position={position}
      rotation={[-Math.PI / 2, rotationY, 0]}
    >
      <planeGeometry args={size} />
      <meshStandardMaterial color={color} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

function getCompoundBounds(repo: RepoRecord, annexTowers: CompoundTower[]) {
  let minX = -repo.width / 2;
  let maxX = repo.width / 2;
  let minZ = -repo.depth / 2;
  let maxZ = repo.depth / 2;
  let maxHeight = repo.height;

  for (const tower of annexTowers) {
    minX = Math.min(minX, tower.x - tower.width / 2);
    maxX = Math.max(maxX, tower.x + tower.width / 2);
    minZ = Math.min(minZ, tower.z - tower.depth / 2);
    maxZ = Math.max(maxZ, tower.z + tower.depth / 2);
    maxHeight = Math.max(maxHeight, tower.height);
  }

  return {
    width: maxX - minX + 1.6,
    depth: maxZ - minZ + 1.6,
    height: maxHeight + 4,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
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
  const crownRef = useRef<THREE.Mesh>(null);
  const roofHaloRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const annexTowers = useMemo(() => {
    const towers: CompoundTower[] = [];

    towers.push({
      x: -repo.width * 0.42,
      z: repo.depth * 0.08,
      width: repo.width * 0.4,
      depth: repo.depth * 0.56,
      height: repo.height * 0.52,
    });
    towers.push({
      x: repo.width * 0.38,
      z: repo.depth * 0.14,
      width: repo.width * 0.34,
      depth: repo.depth * 0.5,
      height: repo.height * 0.46,
    });

    if (repo.score > 20 || repo.updateEvents7d > 18) {
      towers.push({
        x: -repo.width * 0.08,
        z: -repo.depth * 0.46,
        width: repo.width * 0.3,
        depth: repo.depth * 0.34,
        height: repo.height * 0.32,
      });
    }

    if (repo.score > 26 || repo.updateEvents7d > 24) {
      towers.push({
        x: repo.width * 0.46,
        z: -repo.depth * 0.12,
        width: repo.width * 0.44,
        depth: repo.depth * 0.52,
        height: repo.height * 0.58,
      });
    }

    if (repo.score > 30 || repo.starDelta7d > 90) {
      towers.push({
        x: repo.width * 0.08,
        z: repo.depth * 0.44,
        width: repo.width * 0.34,
        depth: repo.depth * 0.4,
        height: repo.height * 0.38,
      });
    }

    if (repo.score > 36 || repo.starDelta7d > 180 || repo.updateEvents7d > 38) {
      towers.push({
        x: -repo.width * 0.54,
        z: -repo.depth * 0.34,
        width: repo.width * 0.28,
        depth: repo.depth * 0.34,
        height: repo.height * 0.28,
      });
    }

    if (repo.score > 42 || repo.starDelta7d > 320) {
      towers.push({
        x: repo.width * 0.6,
        z: repo.depth * 0.44,
        width: repo.width * 0.24,
        depth: repo.depth * 0.3,
        height: repo.height * 0.22,
      });
    }

    return towers;
  }, [repo.depth, repo.height, repo.score, repo.starDelta7d, repo.updateEvents7d, repo.width]);
  const compoundBounds = useMemo(
    () => getCompoundBounds(repo, annexTowers),
    [annexTowers, repo],
  );

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
        repo.height * 0.34 + 0.22 + (hovered ? 0.18 : 0),
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

    if (crownRef.current) {
      const material = crownRef.current.material as THREE.MeshStandardMaterial;
      const targetGlow = palette.isNight
        ? (0.28 + repo.lightStrength * 1.85) * pulse
        : (0.18 + repo.lightStrength * 0.92) * pulse;

      material.emissiveIntensity = THREE.MathUtils.lerp(
        material.emissiveIntensity,
        targetGlow,
        0.08,
      );
      material.opacity = THREE.MathUtils.lerp(
        material.opacity,
        palette.isNight ? 0.88 : 0.58,
        0.08,
      );
    }

    if (roofHaloRef.current) {
      const material = roofHaloRef.current.material as THREE.MeshBasicMaterial;
      const targetOpacity = palette.isNight
        ? 0.12 + repo.lightStrength * 0.22
        : 0.08 + repo.lightStrength * 0.18;
      const targetScale = palette.isNight
        ? 1.02 + repo.lightStrength * 0.4 * pulse
        : 0.92 + repo.lightStrength * 0.32 * pulse;

      material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, 0.08);
      roofHaloRef.current.scale.x = THREE.MathUtils.lerp(
        roofHaloRef.current.scale.x,
        targetScale,
        0.08,
      );
      roofHaloRef.current.scale.y = THREE.MathUtils.lerp(
        roofHaloRef.current.scale.y,
        targetScale,
        0.08,
      );
      roofHaloRef.current.scale.z = THREE.MathUtils.lerp(
        roofHaloRef.current.scale.z,
        targetScale,
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
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        position={[
          compoundBounds.centerX,
          compoundBounds.height / 2 + 0.25,
          compoundBounds.centerZ,
        ]}
        renderOrder={0}
      >
        <boxGeometry args={[compoundBounds.width, compoundBounds.height, compoundBounds.depth]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(repo.id);
        }}
        position={[0, 0.22, 0]}
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
        renderOrder={1}
      >
        <boxGeometry args={[repo.width, repo.height * 0.68, repo.depth]} />
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

      {annexTowers.map((tower, index) => (
        <group key={`${repo.id}-annex-${index}`} position={[tower.x, 0, tower.z]}>
          <mesh
            onClick={(event) => {
              event.stopPropagation();
              onSelect(repo.id);
            }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            position={[0, tower.height / 2 + 0.22, 0]}
            renderOrder={1}
          >
            <boxGeometry args={[tower.width, tower.height, tower.depth]} />
            <meshStandardMaterial
              color={repo.color}
              emissive={repo.color}
              emissiveIntensity={palette.isNight ? 0.04 : 0.018}
              metalness={0.1}
              roughness={0.24}
              transparent
              opacity={palette.isNight ? 0.44 : 0.3}
            />
            {(selected || hovered) && <Edges color="#ffffff" scale={1.01} />}
          </mesh>

          <mesh
            onClick={(event) => {
              event.stopPropagation();
              onSelect(repo.id);
            }}
            position={[0, tower.height / 2 + 0.22, 0]}
            renderOrder={3}
          >
            <boxGeometry
              args={[tower.width * 0.66, Math.max(tower.height - 2.2, 2), tower.depth * 0.66]}
            />
            <meshStandardMaterial
              color={repo.color}
              emissive={repo.color}
              emissiveIntensity={palette.isNight ? 0.16 + repo.lightStrength * 0.84 : 0.05}
              transparent
              depthWrite={false}
              opacity={palette.isNight ? 0.52 : 0.18}
            />
          </mesh>

          <mesh
            onClick={(event) => {
              event.stopPropagation();
              onSelect(repo.id);
            }}
            position={[0, tower.height + 0.58, 0]}
            renderOrder={4}
          >
            <boxGeometry
              args={[tower.width * 0.8, Math.max(tower.height * 0.04, 0.9), tower.depth * 0.8]}
            />
            <meshStandardMaterial
              color={repo.color}
              emissive={repo.color}
              emissiveIntensity={palette.isNight ? 0.24 : 0.1 + repo.lightStrength * 0.36}
              transparent
              depthWrite={false}
              opacity={palette.isNight ? 0.72 : 0.42}
            />
          </mesh>
        </group>
      ))}

      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(repo.id);
        }}
        position={[0, repo.height * 0.81, 0]}
        renderOrder={2}
      >
        <boxGeometry args={[repo.width * 0.76, Math.max(repo.height * 0.15, 3.8), repo.depth * 0.76]} />
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
        position={[0, repo.height * 0.35 + 0.25, 0]}
        renderOrder={3}
      >
        <boxGeometry
          args={[repo.width * 0.62, Math.max(repo.height * 0.58, 4), repo.depth * 0.62]}
        />
        <meshStandardMaterial
          color={repo.color}
          emissive={repo.color}
          emissiveIntensity={0.1}
          transparent
          depthWrite={false}
          opacity={palette.isNight ? 0.88 : 0.28}
        />
      </mesh>

      <mesh
        ref={crownRef}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(repo.id);
        }}
        position={[0, repo.height * 0.91, 0]}
        renderOrder={4}
      >
        <boxGeometry
          args={[repo.width * 0.84, Math.max(repo.height * 0.03, 1.2), repo.depth * 0.84]}
        />
        <meshStandardMaterial
          color={repo.color}
          emissive={repo.color}
          emissiveIntensity={0.18}
          transparent
          depthWrite={false}
          opacity={palette.isNight ? 0.86 : 0.56}
        />
      </mesh>

      <mesh
        ref={roofHaloRef}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(repo.id);
        }}
        position={[0, repo.height + 1.1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={5}
      >
        <circleGeometry args={[Math.max(repo.width, repo.depth) * 0.42, 36]} />
        <meshBasicMaterial color={repo.color} depthWrite={false} transparent opacity={0.14} />
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
  const crownRef = useRef<THREE.Mesh>(null);

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

    if (crownRef.current) {
      const crownMaterial = crownRef.current.material as THREE.MeshStandardMaterial;
      const crownGlow = palette.isNight
        ? 0.08 + tower.lightStrength * 0.62 * pulse
        : 0.05 + tower.lightStrength * 0.24 * pulse;

      crownMaterial.emissiveIntensity = THREE.MathUtils.lerp(
        crownMaterial.emissiveIntensity,
        crownGlow,
        0.08,
      );
    }
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

      <mesh ref={glowRef} position={[0, tower.height / 2, 0]} renderOrder={2}>
        <boxGeometry
          args={[tower.width * 0.72, Math.max(tower.height - 1.6, 2), tower.depth * 0.72]}
        />
        <meshStandardMaterial
          color={tower.color}
          emissive={tower.color}
          emissiveIntensity={0.03}
          transparent
          depthWrite={false}
          opacity={palette.isNight ? 0.28 : 0.09}
        />
      </mesh>

      <mesh ref={crownRef} position={[0, tower.height * 0.84, 0]} renderOrder={3}>
        <boxGeometry
          args={[tower.width * 0.82, Math.max(tower.height * 0.032, 0.9), tower.depth * 0.82]}
        />
        <meshStandardMaterial
          color={tower.color}
          emissive={tower.color}
          emissiveIntensity={0.08}
          transparent
          depthWrite={false}
          opacity={palette.isNight ? 0.5 : 0.22}
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
  const fillerTowers = useMemo(() => buildFillerTowers(), []);

  return (
    <>
      <fog attach="fog" args={[palette.fog, 260, 2200]} />
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
        position={[0, -0.5, 0]}
      >
        <planeGeometry args={[2600, 2600]} />
        <meshStandardMaterial color={palette.ground} />
      </mesh>

      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[0, -0.2, 0]}
        size={[1180, 18]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[0, -0.2, -182]}
        size={[1180, 14]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[0, -0.2, 182]}
        size={[1180, 14]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[-228, -0.2, 0]}
        size={[14, 1180]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[228, -0.2, 0]}
        size={[14, 1180]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[0, -0.2, 0]}
        size={[18, 1180]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[0, -0.2, 20]}
        rotationY={Math.PI / 5.4}
        size={[860, 14]}
      />
      <RoadStrip
        color={palette.street}
        onClearSelection={onClearSelection}
        position={[8, -0.2, 4]}
        rotationY={-Math.PI / 4.8}
        size={[760, 12]}
      />

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
          depth={420}
          factor={4}
          fade
          radius={280}
          saturation={0}
          speed={0.2}
        />
      ) : null}

      <OrbitControls
        enablePan={false}
        maxDistance={7600}
        maxPolarAngle={Math.PI / 2.08}
        minDistance={18}
        minPolarAngle={Math.PI / 5.8}
        target={[0, 24, 16]}
      />
    </>
  );
}

export function SkylineScene(props: SkylineSceneProps) {
  return (
    <Canvas
      camera={{ fov: 18, near: 1, position: [0, 88, 364], far: 9000 }}
      gl={{ antialias: true, alpha: true }}
    >
      <SceneContent {...props} />
    </Canvas>
  );
}
