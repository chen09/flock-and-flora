import { expect } from 'vitest';
import { CONFIG, FIXED_DT_MS, laneBandTop, laneGroundTop } from '../src/config';
import { MaterialId } from '../src/materials';
import { GameSimulation, M2LevelDef, WaveSpawn } from '../src/sim/game';
import { LaneLevelDef, LaneSimulation } from '../src/sim/lane';
import { SimEvents } from '../src/sim/events';
import { buildLevelM2 } from '../src/sim/levelM2';
import { Vec } from '../src/sim/events';

const SLOT_XS = Array.from(
  { length: CONFIG.plants.slotsPerLane },
  (_, i) => CONFIG.plants.slotXStart + i * CONFIG.plants.slotSpacing,
);
export { SLOT_XS };

// M2 trial level with empty waves (generic stable battlefield for tests).
export function makeGame(): GameSimulation {
  return new GameSimulation(emptyLevel());
}

export function makeTrialGame(): GameSimulation {
  return new GameSimulation(buildLevelM2());
}

// Minimal M2 level: three towers, no waves (generic M1-heritage tests).
export function emptyLevel(): M2LevelDef {
  return {
    lanes: [towerLane(0), towerLane(1), towerLane(2)],
    baseWaves: [],
    reinforcements: [],
    startResources: 100,
    lives: CONFIG.economy.lives,
  };
}

export function emptyLevelWithWaves(waves: WaveSpawn[]): M2LevelDef {
  const lv = emptyLevel();
  lv.baseWaves = waves;
  return lv;
}

function towerLane(laneIndex: number): LaneLevelDef {
  const g = laneGroundTop(laneIndex);
  const s = String(laneIndex);
  return {
    laneIndex,
    sling: { x: 170, y: g - 50 },
    coreId: `core-l${s}`,
    blocks: [
      { id: `leg-l${s}-a`, x: 1030, y: g - 45, w: 24, h: 90, material: 'wood' },
      { id: `leg-l${s}-b`, x: 1170, y: g - 45, w: 24, h: 90, material: 'wood' },
      { id: `slab-l${s}`, x: 1100, y: g - 101, w: 220, h: 22, material: 'stone' },
      { id: `core-l${s}`, x: 1100, y: g - 144, w: 60, h: 64, material: 'stone' },
    ],
  };
}

// Direct lane-level construction for physics-focused tests. Blocks default to
// standing on the current lane's ground surface.
export function makeLane(
  blocks: { id: string; x: number; w: number; h: number; material: MaterialId; y?: number }[],
  laneIndex = 1,
): LaneSimulation {
  const g = laneGroundTop(laneIndex);
  const level: LaneLevelDef = {
    laneIndex,
    sling: { x: 170, y: g - 50 },
    blocks: blocks.map((b) => ({ ...b, y: b.y ?? g - b.h / 2 })),
  };
  return new LaneSimulation(
    laneIndex,
    { bandTop: laneBandTop(laneIndex), groundTop: g, laneBottom: laneBandTop(laneIndex) + 270 },
    level,
    new SimEvents(),
    SLOT_XS,
  );
}

// Deterministic fixed-step runner.
export function stepN(sim: GameSimulation, n: number): void {
  for (let i = 0; i < n; i++) sim.advance(FIXED_DT_MS);
}

// Advance until no bird is active and every lane is physically quiet.
export function stepUntilSettled(sim: GameSimulation, maxSteps = 2400): void {
  for (let i = 0; i < maxSteps; i++) {
    if (!sim.lanes.some((l) => l.projectile) && sim.lanes.every((l) => l.isQuiet())) break;
    sim.advance(FIXED_DT_MS);
  }
}

// Input fixtures derived from the LIVE config.
export function grabPoint(): Vec {
  return { x: CONFIG.sling.anchor.x - 60, y: CONFIG.sling.anchor.y + 35 };
}
export function strongAimPoint(): Vec {
  const a = CONFIG.sling.anchor;
  return { x: a.x - 112, y: a.y + 32 };
}
export function weakAimPoint(): Vec {
  const a = CONFIG.sling.anchor;
  return { x: a.x - 2, y: a.y - 2 };
}

void expect;
