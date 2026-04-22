"use client";

import { Edges, OrbitControls, Stars, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import skylineLayoutConfig from "../../config/skyline-layout.json";
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

type SceneContentProps = SkylineSceneProps & {
  cameraTargetY: number;
  isCompactView: boolean;
  scene: SceneMetrics;
};

type GlowCalibration = {
  floorLog: number;
  midLog: number;
  peakLog: number;
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

type SceneMetrics = {
  centerX: number;
  centerZ: number;
  extent: number;
  fillerInnerRadius: number;
  fillerOuterRadius: number;
  groundRadius: number;
  innerRadius: number;
  maxVisibleHeight: number;
  outerRadius: number;
};

const sceneConfig = skylineLayoutConfig.scene;

const hashValue = (seed: number) => {
  const value = Math.sin(seed) * 43758.5453123;

  return value - Math.floor(value);
};

function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function pickQuantile(values: number[], quantile: number) {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * quantile)));

  return values[index]!;
}

function buildGlowCalibration(repos: RepoRecord[]): GlowCalibration {
  const values = repos
    .map((repo) => Math.max(0, repo.starDelta7d))
    .sort((left, right) => left - right);
  const floor = Math.max(1, pickQuantile(values, 0.12));
  const mid = Math.max(floor + 1, pickQuantile(values, 0.72));
  const peak = Math.max(mid + 1, pickQuantile(values, 0.97));

  return {
    floorLog: Math.log1p(floor),
    midLog: Math.log1p(mid),
    peakLog: Math.log1p(peak),
  };
}

function normalizeStaticGlowStrength(lightStrength: number) {
  return clamp01((lightStrength - 0.1) / 0.9);
}

function computeDynamicGlowFactor(starDelta7d: number, calibration: GlowCalibration) {
  const valueLog = Math.log1p(Math.max(0, starDelta7d));
  const lowBand = clamp01(
    THREE.MathUtils.mapLinear(valueLog, calibration.floorLog, calibration.midLog, 0, 1),
  );
  const highBand = clamp01(
    THREE.MathUtils.mapLinear(valueLog, calibration.midLog, calibration.peakLog, 0, 1),
  );

  return clamp01(
    Math.pow(lowBand, 1.45) * 0.46 +
      Math.pow(highBand, 1.08) * 0.54,
  );
}

function getRepoTowerDimensions(repo: RepoRecord) {
  const towerWidth = THREE.MathUtils.clamp(
    repo.width * 0.78,
    10.2,
    Math.min(repo.lotWidth * 0.82, 17.8),
  );
  const towerDepth = THREE.MathUtils.clamp(
    Math.max(repo.depth * 1.28, towerWidth * 0.72),
    10.2,
    Math.min(repo.lotDepth * 0.82, 16.2),
  );
  const podiumWidth = THREE.MathUtils.clamp(
    towerWidth * 1.2,
    towerWidth + 1.8,
    repo.lotWidth * 0.94,
  );
  const podiumDepth = THREE.MathUtils.clamp(
    towerDepth * 1.18,
    towerDepth + 1.8,
    repo.lotDepth * 0.94,
  );
  const upperHeight = THREE.MathUtils.clamp(repo.height * 0.18, 3.4, 18);
  const upperWidth = towerWidth * 0.82;
  const upperDepth = towerDepth * 0.82;

  return {
    coreDepth: towerDepth * 0.62,
    coreUpperDepth: upperDepth * 0.62,
    coreUpperWidth: upperWidth * 0.62,
    coreWidth: towerWidth * 0.62,
    podiumDepth,
    podiumHeight: THREE.MathUtils.clamp(repo.height * 0.14, 2.8, 12),
    podiumWidth,
    towerDepth,
    towerWidth,
    upperDepth,
    upperHeight,
    upperWidth,
  };
}

function getFillerTowerDimensions(tower: FillerTower) {
  const towerWidth = THREE.MathUtils.clamp(tower.width * 0.82, 4.8, 10.8);
  const towerDepth = THREE.MathUtils.clamp(Math.max(tower.depth * 1.14, towerWidth * 0.72), 4.8, 10.2);
  const upperHeight = THREE.MathUtils.clamp(tower.height * 0.18, 1.8, 9.6);

  return {
    coreDepth: towerDepth * 0.64,
    coreUpperDepth: towerDepth * 0.82 * 0.64,
    coreUpperWidth: towerWidth * 0.82 * 0.64,
    coreWidth: towerWidth * 0.64,
    podiumDepth: towerDepth * 1.16,
    podiumHeight: THREE.MathUtils.clamp(tower.height * 0.12, 1.2, 4.6),
    podiumWidth: towerWidth * 1.18,
    towerDepth,
    towerWidth,
    upperDepth: towerDepth * 0.82,
    upperHeight,
    upperWidth: towerWidth * 0.82,
  };
}

function computeSceneMetrics(districts: LabeledDistrict[], repos: RepoRecord[]): SceneMetrics {
  const repoOuterRadius = repos.reduce(
    (result, repo) => Math.max(result, Math.hypot(repo.x, repo.z) + Math.max(repo.lotWidth, repo.lotDepth) * 0.62),
    0,
  );
  const maxVisibleHeight = repos.reduce(
    (result, repo) => Math.max(result, repo.height + 3.2),
    64,
  );
  const outerRadius = Math.max(
    ...districts.map((district) => district.outerRadius ?? repoOuterRadius),
    repoOuterRadius,
  );
  const innerRadius = Math.min(
    ...districts.map((district) => district.innerRadius ?? Math.max(34, outerRadius * 0.16)),
  );
  const groundRadius = Number((outerRadius + sceneConfig.groundPadding * 0.42).toFixed(1));
  const extent = Number((groundRadius * 2).toFixed(1));

  return {
    centerX: 0,
    centerZ: 0,
    extent,
    fillerInnerRadius: Number((outerRadius + sceneConfig.fillerGap * 0.78).toFixed(1)),
    fillerOuterRadius: Number((outerRadius + sceneConfig.fillerGap * 1.92).toFixed(1)),
    groundRadius,
    innerRadius: Number(innerRadius.toFixed(1)),
    maxVisibleHeight: Number(maxVisibleHeight.toFixed(1)),
    outerRadius: Number(outerRadius.toFixed(1)),
  };
}

function buildFillerTowers(scene: SceneMetrics, densityScale = 1): FillerTower[] {
  const filler: FillerTower[] = [];
  const ringSpecs = [
    { count: 54, radius: scene.fillerInnerRadius, tint: "#7faef8" },
    { count: 70, radius: scene.fillerOuterRadius, tint: "#9be4c7" },
  ];

  for (const [ringIndex, ring] of ringSpecs.entries()) {
    const ringCount = Math.max(18, Math.round(ring.count * densityScale));

    for (let index = 0; index < ringCount; index += 1) {
      const seed = 500 + ringIndex * 200 + index * 3.17;
      const angle = (index / ringCount) * Math.PI * 2 + (hashValue(seed + 0.4) - 0.5) * 0.08;
      const radius = ring.radius + (hashValue(seed + 1.1) - 0.5) * 12;

      filler.push({
        key: `ring-${ringIndex}-${index}`,
        color: ring.tint,
        x: Number((Math.cos(angle) * radius).toFixed(1)),
        z: Number((Math.sin(angle) * radius).toFixed(1)),
        width: Number((5.6 + hashValue(seed + 2.2) * 6.2).toFixed(1)),
        depth: Number((5.4 + hashValue(seed + 3.3) * 5.8).toFixed(1)),
        height: Number((18 + hashValue(seed + 4.4) * (ringIndex === 0 ? 52 : 42)).toFixed(1)),
        lightStrength: Number((0.12 + hashValue(seed + 5.5) * 0.46).toFixed(2)),
      });
    }
  }

  return filler;
}

const DistrictPlate = memo(function DistrictPlate({
  district,
  palette,
  onClearSelection,
}: {
  district: LabeledDistrict;
  palette: SkyPalette;
  onClearSelection: () => void;
}) {
  const outerRadius = district.outerRadius ?? Math.max(48, Math.max(district.size.width, district.size.depth) * 0.5);
  const thetaStart = district.angleStart ?? 0;
  const thetaLength = Math.max(0.001, (district.angleEnd ?? Math.PI * 2) - thetaStart);

  return (
    <>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onClearSelection();
        }}
        position={[0, -0.16, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[outerRadius, 96, thetaStart, thetaLength]} />
        <meshBasicMaterial
          color={district.color}
          transparent
          depthWrite={false}
          opacity={palette.isNight ? 0.045 : 0.026}
        />
      </mesh>

      <mesh
        position={[0, -0.14, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry
          args={[
            outerRadius * 0.42,
            outerRadius * 0.48,
            88,
            1,
            thetaStart,
            thetaLength,
          ]}
        />
        <meshBasicMaterial
          color={district.color}
          transparent
          depthWrite={false}
          opacity={palette.isNight ? 0.09 : 0.05}
        />
      </mesh>

      <Text
        color="#f1f7ff"
        fontSize={1.08}
        maxWidth={20}
        position={[district.center.x, -0.12, district.center.z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        {district.label}
      </Text>
    </>
  );
});

const Building = memo(function Building({
  repo,
  palette,
  selected,
  onSelect,
  glowCalibration,
}: {
  repo: RepoRecord;
  palette: SkyPalette;
  selected: boolean;
  onSelect: (id: string) => void;
  glowCalibration: GlowCalibration;
}) {
  const shellRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const upperShellRef = useRef<THREE.Mesh>(null);
  const upperCoreRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const glowFactor = computeDynamicGlowFactor(repo.starDelta7d, glowCalibration);
  const dimensions = getRepoTowerDimensions(repo);
  const shellGlowColor = useMemo(
    () =>
      new THREE.Color(repo.color).lerp(
        new THREE.Color("#d8ecff"),
        0.26,
      ),
    [repo.color],
  );
  const coreGlowColor = useMemo(
    () =>
      new THREE.Color("#8ebeff")
        .lerp(new THREE.Color(repo.color), 0.24)
        .lerp(new THREE.Color("#fbfeff"), Math.pow(glowFactor, 0.78) * 0.54),
    [glowFactor, repo.color],
  );
  const coreColor = useMemo(
    () =>
      new THREE.Color("#121b2a").lerp(
        new THREE.Color("#eff8ff"),
        THREE.MathUtils.clamp(Math.pow(glowFactor, 1.18), 0, 1),
      ),
    [glowFactor],
  );
  const upperCoreColor = useMemo(
    () =>
      new THREE.Color("#182233").lerp(
        new THREE.Color("#fbfdff"),
        THREE.MathUtils.clamp(Math.pow(glowFactor, 1.26), 0, 1),
      ),
    [glowFactor],
  );

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "default";

    return () => {
      document.body.style.cursor = "default";
    };
  }, [hovered]);

  useFrame((state) => {
    const pulse = 0.92 + Math.sin(state.clock.elapsedTime * 1.12 + repo.x * 0.11) * 0.08;

    if (shellRef.current) {
      shellRef.current.position.y = THREE.MathUtils.lerp(
        shellRef.current.position.y,
        repo.height / 2 + 0.28 + (hovered ? 0.18 : 0),
        0.08,
      );
    }

    if (coreRef.current) {
      const material = coreRef.current.material as THREE.MeshStandardMaterial;
      const targetGlow = (0.004 + Math.pow(glowFactor, 2.55) * 2.9 + (selected ? 0.12 : 0)) * pulse;

      material.emissiveIntensity = THREE.MathUtils.lerp(
        material.emissiveIntensity,
        targetGlow,
        0.08,
      );
    }

    if (upperShellRef.current) {
      const material = upperShellRef.current.material as THREE.MeshStandardMaterial;
      const targetGlow = 0.03 + Math.pow(glowFactor, 1.85) * 0.24;

      material.emissiveIntensity = THREE.MathUtils.lerp(
        material.emissiveIntensity,
        targetGlow,
        0.08,
      );
    }

    if (upperCoreRef.current) {
      const material = upperCoreRef.current.material as THREE.MeshStandardMaterial;
      const targetGlow = (0.003 + Math.pow(glowFactor, 2.35) * 1.75 + (selected ? 0.08 : 0)) * pulse;

      material.emissiveIntensity = THREE.MathUtils.lerp(
        material.emissiveIntensity,
        targetGlow,
        0.08,
      );
    }
  });

  return (
    <group position={[repo.x, 0, repo.z]}>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[dimensions.podiumWidth * 1.06, 0.3, dimensions.podiumDepth * 1.06]} />
        <meshStandardMaterial
          color={palette.street}
          emissive={shellGlowColor}
          emissiveIntensity={selected ? 0.12 : 0.015 + Math.pow(glowFactor, 1.9) * 0.06}
          transparent
          opacity={0.96}
        />
      </mesh>

      <mesh position={[0, dimensions.podiumHeight / 2, 0]} renderOrder={1}>
        <boxGeometry args={[dimensions.podiumWidth, dimensions.podiumHeight, dimensions.podiumDepth]} />
        <meshStandardMaterial
          color={repo.color}
          emissive={shellGlowColor}
          emissiveIntensity={0.01 + Math.pow(glowFactor, 1.8) * 0.11}
          metalness={0.1}
          roughness={0.26}
          transparent
          opacity={0.22}
        />
      </mesh>

      <mesh
        ref={shellRef}
        renderOrder={1}
      >
        <boxGeometry args={[dimensions.towerWidth, repo.height, dimensions.towerDepth]} />
        <meshStandardMaterial
          color={repo.color}
          emissive={shellGlowColor}
          emissiveIntensity={0.015 + Math.pow(glowFactor, 1.9) * 0.13}
          metalness={0.12}
          roughness={0.18}
          transparent
          opacity={0.24}
        />
        {(selected || hovered) && <Edges color="#ffffff" scale={1.01} />}
      </mesh>

      <mesh
        ref={upperShellRef}
        position={[0, repo.height - dimensions.upperHeight / 2, 0]}
        renderOrder={2}
      >
        <boxGeometry
          args={[dimensions.upperWidth, dimensions.upperHeight, dimensions.upperDepth]}
        />
        <meshStandardMaterial
          color={repo.color}
          emissive={shellGlowColor}
          emissiveIntensity={0.01 + Math.pow(glowFactor, 1.8) * 0.1}
          metalness={0.12}
          roughness={0.18}
          transparent
          opacity={0.22}
        />
      </mesh>

      <mesh
        ref={coreRef}
        position={[0, repo.height / 2 + 0.28, 0]}
        renderOrder={3}
      >
        <boxGeometry
          args={[
            dimensions.coreWidth,
            Math.max(repo.height - 3.4, 4.8),
            dimensions.coreDepth,
          ]}
        />
        <meshStandardMaterial
          color={coreColor}
          emissive={coreGlowColor}
          emissiveIntensity={0.004 + Math.pow(glowFactor, 2.55) * 0.42}
          metalness={0.02}
          roughness={0.26}
        />
      </mesh>

      <mesh
        ref={upperCoreRef}
        position={[0, repo.height - dimensions.upperHeight / 2, 0]}
        renderOrder={4}
      >
        <boxGeometry
          args={[
            dimensions.coreUpperWidth,
            Math.max(dimensions.upperHeight - 1.2, 1.8),
            dimensions.coreUpperDepth,
          ]}
        />
        <meshStandardMaterial
          color={upperCoreColor}
          emissive={coreGlowColor}
          emissiveIntensity={0.003 + Math.pow(glowFactor, 2.35) * 0.26}
          metalness={0.02}
          roughness={0.24}
        />
      </mesh>

      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(repo.id);
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        position={[0, Math.max(repo.height * 0.52, 8), 0]}
      >
        <boxGeometry
          args={[
            repo.lotWidth * 1.08,
            Math.max(repo.height + 5.2, 12),
            repo.lotDepth * 1.08,
          ]}
        />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
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
});

const FillerBuilding = memo(function FillerBuilding({
  tower,
  palette,
}: {
  tower: FillerTower;
  palette: SkyPalette;
}) {
  const glowRef = useRef<THREE.Mesh>(null);
  const upperGlowRef = useRef<THREE.Mesh>(null);
  const dimensions = getFillerTowerDimensions(tower);
  const glowFactor = normalizeStaticGlowStrength(tower.lightStrength);
  const fillerShellGlowColor = useMemo(
    () =>
      new THREE.Color(tower.color).lerp(
        new THREE.Color("#d6ebff"),
        0.22,
      ),
    [tower.color],
  );
  const fillerCoreGlowColor = useMemo(
    () =>
      new THREE.Color("#93c6ff")
        .lerp(new THREE.Color(tower.color), 0.2)
        .lerp(new THREE.Color("#f7fcff"), Math.pow(glowFactor, 0.78) * 0.48),
    [glowFactor, tower.color],
  );
  const fillerCoreColor = useMemo(
    () =>
      new THREE.Color("#131d2b").lerp(
        new THREE.Color("#dceeff"),
        THREE.MathUtils.clamp(Math.pow(glowFactor, 1.16), 0, 1),
      ),
    [glowFactor],
  );

  useFrame((state) => {
    if (!glowRef.current) {
      return;
    }

    const material = glowRef.current.material as THREE.MeshStandardMaterial;
    const pulse = 0.95 + Math.sin(state.clock.elapsedTime * 0.85 + tower.x * 0.07) * 0.05;
    const targetGlow = palette.isNight
      ? (0.015 + Math.pow(glowFactor, 1.65) * 1.05) * pulse
      : 0.004 + Math.pow(glowFactor, 1.7) * 0.035;

    material.emissiveIntensity = THREE.MathUtils.lerp(
      material.emissiveIntensity,
      targetGlow,
      0.08,
    );

    if (upperGlowRef.current) {
      const crownMaterial = upperGlowRef.current.material as THREE.MeshStandardMaterial;
      const crownGlow = palette.isNight
        ? (0.012 + Math.pow(glowFactor, 1.55) * 0.72) * pulse
        : 0.008 + Math.pow(glowFactor, 1.55) * 0.08;

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
        <boxGeometry args={[dimensions.podiumWidth * 1.04, 0.18, dimensions.podiumDepth * 1.04]} />
        <meshStandardMaterial
          color={tower.color}
          emissive={fillerShellGlowColor}
          emissiveIntensity={palette.isNight ? 0.07 : 0.02}
          transparent
          opacity={0.18}
        />
      </mesh>

      <mesh position={[0, dimensions.podiumHeight / 2, 0]}>
        <boxGeometry args={[dimensions.podiumWidth, dimensions.podiumHeight, dimensions.podiumDepth]} />
        <meshStandardMaterial
          color={tower.color}
          emissive={fillerShellGlowColor}
          emissiveIntensity={palette.isNight ? 0.1 + tower.lightStrength * 0.18 : 0.04 + tower.lightStrength * 0.08}
          roughness={0.26}
          metalness={0.08}
          transparent
          opacity={0.18}
        />
      </mesh>

      <mesh position={[0, tower.height / 2, 0]}>
        <boxGeometry args={[dimensions.towerWidth, tower.height, dimensions.towerDepth]} />
        <meshStandardMaterial
          color={tower.color}
          emissive={fillerShellGlowColor}
          emissiveIntensity={palette.isNight ? 0.03 : 0.01}
          roughness={0.22}
          metalness={0.08}
          transparent
          opacity={palette.isNight ? 0.24 : 0.14}
        />
      </mesh>

      <mesh ref={glowRef} position={[0, tower.height / 2, 0]} renderOrder={2}>
        <boxGeometry
          args={[
            dimensions.coreWidth,
            Math.max(tower.height - 1.6, 2),
            dimensions.coreDepth,
          ]}
        />
        <meshStandardMaterial
          color={fillerCoreColor}
          emissive={fillerCoreGlowColor}
          emissiveIntensity={0.01 + Math.pow(glowFactor, 1.65) * 0.12}
          transparent
          depthWrite={false}
          opacity={palette.isNight ? 0.28 : 0.09}
        />
      </mesh>

      <mesh ref={upperGlowRef} position={[0, tower.height - dimensions.upperHeight / 2, 0]} renderOrder={3}>
        <boxGeometry
          args={[
            dimensions.coreUpperWidth,
            Math.max(dimensions.upperHeight, 1.2),
            dimensions.coreUpperDepth,
          ]}
        />
        <meshStandardMaterial
          color={fillerCoreColor}
          emissive={fillerCoreGlowColor}
          emissiveIntensity={0.01 + Math.pow(glowFactor, 1.55) * 0.08}
          transparent
          opacity={palette.isNight ? 0.34 : 0.16}
        />
      </mesh>
    </group>
  );
});

function SceneContent({
  repos,
  districts,
  palette,
  selectedId,
  onSelect,
  onClearSelection,
  cameraTargetY,
  isCompactView,
  scene,
}: SceneContentProps) {
  const fillerTowers = useMemo(
    () => buildFillerTowers(scene, isCompactView ? 0.72 : 1),
    [isCompactView, scene],
  );
  const glowCalibration = useMemo(() => buildGlowCalibration(repos), [repos]);

  return (
    <>
      <fog attach="fog" args={[palette.fog, scene.extent * 0.38, scene.extent * 2.9]} />
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
        position={[scene.centerX, -0.5, scene.centerZ]}
      >
        <circleGeometry args={[scene.groundRadius, 120]} />
        <meshStandardMaterial color={palette.ground} />
      </mesh>

      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onClearSelection();
        }}
        position={[scene.centerX, -0.18, scene.centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[Math.max(1.2, scene.innerRadius * 0.06), 48]} />
        <meshStandardMaterial color={palette.ground} />
      </mesh>

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
          glowCalibration={glowCalibration}
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
          depth={Math.max(420, scene.extent * 0.75)}
          factor={4}
          fade
          radius={Math.max(280, scene.extent * 0.52)}
          saturation={0}
          speed={0.2}
        />
      ) : null}

      <OrbitControls
        makeDefault
        enablePan
        enableDamping
        maxDistance={Math.max(12000, scene.extent * 4.8)}
        maxPolarAngle={Math.PI / 2.08}
        minDistance={isCompactView ? 14 : 28}
        minPolarAngle={isCompactView ? Math.PI / 8.4 : Math.PI / 5.8}
        panSpeed={0.72}
        rotateSpeed={isCompactView ? 0.68 : 0.58}
        screenSpacePanning={false}
        target={[scene.centerX, cameraTargetY, scene.centerZ]}
        zoomSpeed={0.72}
      />
    </>
  );
}

export function SkylineScene(props: SkylineSceneProps) {
  const [isCompactView, setIsCompactView] = useState(false);
  const scene = useMemo(
    () => computeSceneMetrics(props.districts, props.repos),
    [props.districts, props.repos],
  );
  const cameraSettings = useMemo(
    () =>
      isCompactView
        ? {
            far: Math.max(12000, scene.extent * 6),
            fov: 46,
            near: 1,
            position: [
              scene.centerX,
              Math.max(88, scene.outerRadius * 0.24, scene.maxVisibleHeight * 1.02),
              scene.centerZ + Math.max(360, scene.outerRadius * 1.08, scene.maxVisibleHeight * 2.1),
            ] as [number, number, number],
            targetY: THREE.MathUtils.clamp(scene.maxVisibleHeight * 0.24, 34, 78),
          }
        : {
            far: Math.max(12000, scene.extent * 6),
            fov: 20,
            near: 1,
            position: [
              scene.centerX,
              Math.max(210, scene.outerRadius * 0.38, scene.maxVisibleHeight * 1.24),
              scene.centerZ + Math.max(940, scene.outerRadius * 1.34, scene.maxVisibleHeight * 4.6),
            ] as [number, number, number],
            targetY: THREE.MathUtils.clamp(scene.maxVisibleHeight * 0.22, 46, 94),
          },
    [isCompactView, scene.centerX, scene.centerZ, scene.extent, scene.maxVisibleHeight, scene.outerRadius],
  );

  useEffect(() => {
    const syncViewport = () => {
      const compact =
        window.innerWidth <= 920 &&
        window.innerHeight >= window.innerWidth * 1.12;

      setIsCompactView(compact);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);

    return () => {
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  return (
    <Canvas
      camera={cameraSettings}
      dpr={[1, 1.5]}
      frameloop="always"
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ touchAction: "none" }}
    >
      <SceneContent
        {...props}
        cameraTargetY={cameraSettings.targetY}
        isCompactView={isCompactView}
        scene={scene}
      />
    </Canvas>
  );
}
