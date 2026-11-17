import { laneGroundTop } from '../config';
import { LaneLevelDef } from './lane';
import { M2LevelDef, ReinforceSpawn, WaveSpawn } from './game';

// M2 three-lane fusion trial level. All three bands are live. Each lane hosts
// an enemy nest tower (legs + slab + core + crystals); enemies spawn at the
// far right and walk left, leaking off the left edge costs a life. The tower
// core reaching zero hp (or leaving the world) cancels only that tower's
// still-unsent reinforcements.

function towerFor(laneIndex: number): LaneLevelDef {
  const g = laneGroundTop(laneIndex);
  const s = String(laneIndex);
  return {
    laneIndex,
    sling: { x: CONFIG_SLING_X, y: g - SLING_GROUND_OFFSET },
    coreId: `core-l${s}`,
    blocks: [
      { id: `leg-l${s}-a`, x: 1030, y: g - 45, w: 24, h: 90, material: 'wood' },
      { id: `leg-l${s}-b`, x: 1170, y: g - 45, w: 24, h: 90, material: 'wood' },
      { id: `slab-l${s}`, x: 1100, y: g - 101, w: 220, h: 22, material: 'stone' },
      { id: `crystal-l${s}-a`, x: 1030, y: g - 134, w: 44, h: 44, material: 'crystal' },
      { id: `crystal-l${s}-b`, x: 1170, y: g - 134, w: 44, h: 44, material: 'crystal' },
      { id: `core-l${s}`, x: 1100, y: g - 144, w: 60, h: 64, material: 'stone' },
    ],
  };
}

const CONFIG_SLING_X = 170;
const SLING_GROUND_OFFSET = 50;

const BASE: WaveSpawn[] = [
  // lane 0 (top)
  { atMs: 35000, lane: 0, type: 'normal', count: 1 },
  { atMs: 70000, lane: 0, type: 'normal', count: 2 },
  { atMs: 100000, lane: 0, type: 'runner', count: 1 },
  { atMs: 135000, lane: 0, type: 'swarm', count: 3 },
  { atMs: 165000, lane: 0, type: 'normal', count: 2 },
  // lane 1 (middle)
  { atMs: 55000, lane: 1, type: 'normal', count: 1 },
  { atMs: 85000, lane: 1, type: 'runner', count: 1 },
  { atMs: 115000, lane: 1, type: 'normal', count: 2 },
  { atMs: 145000, lane: 1, type: 'swarm', count: 3 },
  { atMs: 170000, lane: 1, type: 'armor', count: 1 },
  // lane 2 (bottom)
  { atMs: 75000, lane: 2, type: 'normal', count: 1 },
  { atMs: 105000, lane: 2, type: 'runner', count: 2 },
  { atMs: 130000, lane: 2, type: 'normal', count: 2 },
  { atMs: 155000, lane: 2, type: 'armor', count: 1 },
  { atMs: 175000, lane: 2, type: 'swarm', count: 3 },
];

const REINFORCEMENTS: ReinforceSpawn[] = [
  { atMs: 120000, lane: 0, type: 'normal', count: 2, towerLane: 0 },
  { atMs: 150000, lane: 1, type: 'runner', count: 1, towerLane: 1 },
  { atMs: 175000, lane: 2, type: 'normal', count: 2, towerLane: 2 },
];

export function buildLevelM2(): M2LevelDef {
  // Deep-copy every entry: callers (scenario builders, tests) may push or
  // mutate baseWaves/reinforcements, and module-level shared arrays would
  // leak that state across levels (review M2_PRECHECK finding 1).
  return {
    lanes: [towerFor(0), towerFor(1), towerFor(2)],
    baseWaves: BASE.map((w) => ({ ...w })),
    reinforcements: REINFORCEMENTS.map((w) => ({ ...w })),
    startResources: 100,
    lives: 3,
  };
}
