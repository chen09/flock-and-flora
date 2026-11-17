// Central tunable baselines. M1 values kept; M2 adds plants/enemies/birds/economy.
export const VIEW = {
  width: 1440,
  height: 900,
} as const;

// Final three-lane budget (PLAN section 2 + 2026-11-17 clarification section):
// 90px HUD reserve on top, then three 270px lane bands (each band = 240px air
// + 30px ground strip). M1 activated only the middle band; M2 activates all
// three bands with independent Matter worlds.
export const LAYOUT = {
  hudHeight: 90,
  laneHeight: 270,
  groundThickness: 30,
  laneCount: 3,
} as const;

export function laneBandTop(index: number): number {
  return LAYOUT.hudHeight + index * LAYOUT.laneHeight;
}
export function laneGroundTop(index: number): number {
  return laneBandTop(index) + LAYOUT.laneHeight - LAYOUT.groundThickness;
}
export function laneBottomY(index: number): number {
  return laneBandTop(index) + LAYOUT.laneHeight;
}

// M1 compatibility shims (middle band numbers, kept for tests/tools).
export const BAND_TOP_Y = laneBandTop(1);
export const LANE_BOTTOM_Y = laneBottomY(1);
export const GROUND_TOP_Y = laneGroundTop(1);
// Static ceiling at the top of a lane band: projectiles and debris bounce off
// it instead of entering the neighbour band. Bottom face sits a few px below
// the band line so trajectory previews stop visibly in-band.
export const CEILING_BOTTOM_Y = 8; // offset from band top (per-lane: bandTop + CEILING_BOTTOM_Y)

// Single fixed simulation step for the entire game (60 Hz).
export const FIXED_DT_MS = 1000 / 60;

export const CONFIG = {
  clock: {
    // Guard against spiral-of-death after long frame stalls; excess real time is dropped.
    maxStepsPerFrame: 5,
  },
  ammo: {
    // M1 trial baseline (single-lane prototype). M2 uses officialAmmo below.
    start: 5,
    max: 5,
  },
  officialAmmo: {
    // PLAN section 2 official rules (M2 baseline).
    start: 2,
    max: 3,
    regenIntervalMs: 12000, // battle time only; paused/aiming freezes it
  },
  sling: {
    anchor: { x: 170, y: 550 }, // M1 compatibility (middle band offset applied per lane)
    offsetFromGround: 50, // sling anchor y = laneGroundTop - offset
    grabRadius: 90,
    maxPull: 150,
    speedFactor: 0.15,
    maxSpeed: 20, // px per fixed step; capped to avoid tunneling through thin supports
    minSpeed: 3, // below this a release counts as cancel (no ammo spent)
    spawnAhead: 26,
  },
  projectile: {
    radius: 13,
    density: 0.006,
    frictionAir: 0, // baseline: no air drag (see IMPLEMENTATION.md M1 notes)
    friction: 0.4,
    restitution: 0.35,
  },
  damage: {
    minImpactSpeed: 2.0,
    impactK: 1.2,
    maxDamagePerHit: 400,
    pairCooldownMs: 100,
  },
  target: {
    // M1 trial targets; kept for M1 compatibility layers/tests.
    w: 26,
    h: 34,
    density: 0.0015,
    hp: 42,
  },
  projectileRetire: {
    slowSpeed: 0.6,
    slowMs: 500,
    maxAgeMs: 7000,
  },
  preview: {
    maxSteps: 150,
    dotEvery: 2,
    maxDots: 40,
  },
  // ---- M2: plants / enemies / birds / economy baselines (implementation-chosen) ----
  economy: {
    startResources: 100,
    baseIncomePerSecond: 4, // automatic trickle (M2 baseline rebalance)
    lives: 3,
    removeRefund: 0, // removal never refunds (PLAN section 2)
  },
  plants: {
    slotsPerLane: 6,
    slotXStart: 300,
    slotSpacing: 110,
    munchDpsBase: 6, // enemy chewing dps on plants (armor worms 8)
    peaShot: { dmg: 22, speed: 9, radius: 5, intervalMs: 1200, range: 520 },
    frost: { range: 380, slowFactor: 0.5, dps: 4 }, // 输出较低 (PLAN table)
    dawn: { produceMs: 10000, produceAmount: 25 },
    nest: { refillMs: 18000, maxPerRun: 2 },
  },
  enemies: {
    spawnX: 1360, // spawn near the right edge of a lane
    leakX: -20, // walked off the left edge
    walkContactEps: 0.5,
    crushSpeedThreshold: 2.0, // blocks/debris moving faster than this can hit enemies
    settleSpeed: 0.5, // below this (for 60 steps) blocks/debris stop colliding with enemies
    despawnSettledMs: 12000, // settled fragments are cleaned up after this
  },
} as const;
