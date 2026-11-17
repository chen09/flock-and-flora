import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { PLANTS, type PlantId } from '../src/sim/entities';
import { GameSimulation, M2LevelDef } from '../src/sim/game';
import { buildLevelM2 } from '../src/sim/levelM2';

// Bounded, reproducible mixed-policy candidate. It uses only legal player APIs:
// selectPlant/tryPlant/selectBird/tryStartAim/updateAim/releaseAim/advance.
// No direct HP/resource/wave writes, no fireWithVelocity, no manual events.
// The no-tree and tree variants share the same plant/bird timeline; the tree
// variant adds one nest at t=102s and must actually plant and refill it.

const SLOT_X = (slot: number) => CONFIG.plants.slotXStart + slot * CONFIG.plants.slotSpacing;

interface Action { at: number; lane: number; type: PlantId; x: number; done?: boolean; }
interface PlantLog { plannedAt: number; actualAt: number; delayMs: number; lane: number; x: number; type: PlantId; cost: number; resourcesAfter: number; }
interface BirdLog { at: number; lane: number; bird: string; targetKind: 'tower' | 'enemy'; target: { x: number; y: number }; aim: { x: number; y: number }; ammoAfter: number; }
type PolicyVariant = 'no-tree' | 'tree' | 'no-tree-no-birds';

interface PendingView {
  atMs: number;
  lane: number;
  type: string;
  count: number;
  towerLane: number | null;
  done: boolean;
  cancelled: boolean;
}

interface PolicyResult {
  variant: PolicyVariant;
  useBirds: boolean;
  scenario: string;
  phase: string;
  lives: number;
  leaks: number;
  timeMs: number;
  plants: number;
  birds: number;
  kills: number;
  nestPlanted: number;
  nestRefills: number;
  towersDown: number;
  reinforcementsCancelled: number;
  resourcesSpent: number;
  resourcesEnd: number;
  ammoEnd: number;
  plantFailures: number;
  plantLog: PlantLog[];
  birdLog: BirdLog[];
  pendingSpawns: PendingView[];
}

const BASE_PLAN: Action[] = [
  { at: 0, lane: 0, type: 'dawn', x: SLOT_X(2) },
  { at: 0, lane: 1, type: 'dawn', x: SLOT_X(2) },
  { at: 0, lane: 2, type: 'dawn', x: SLOT_X(2) },
  { at: 18_000, lane: 0, type: 'shell', x: SLOT_X(5) },
  { at: 30_000, lane: 0, type: 'pea', x: SLOT_X(4) },
  { at: 38_000, lane: 1, type: 'shell', x: SLOT_X(5) },
  { at: 48_000, lane: 1, type: 'pea', x: SLOT_X(4) },
  { at: 56_000, lane: 2, type: 'shell', x: SLOT_X(5) },
  { at: 66_000, lane: 2, type: 'pea', x: SLOT_X(4) },
  { at: 76_000, lane: 0, type: 'pea', x: SLOT_X(3) },
  { at: 86_000, lane: 1, type: 'pea', x: SLOT_X(3) },
  { at: 96_000, lane: 2, type: 'pea', x: SLOT_X(3) },
  { at: 110_000, lane: 0, type: 'frost', x: SLOT_X(1) },
  { at: 120_000, lane: 1, type: 'frost', x: SLOT_X(1) },
  { at: 130_000, lane: 2, type: 'frost', x: SLOT_X(1) },
];
const NEST_ACTION: Action = { at: 102_000, lane: 0, type: 'nest', x: SLOT_X(0) };

function rushLevel(): M2LevelDef {
  const lv = buildLevelM2();
  lv.baseWaves = lv.baseWaves.map((w) => ({
    ...w,
    atMs: Math.round(w.atMs * 0.7),
    count: (w.count ?? 1) + 1,
  }));
  lv.reinforcements = lv.reinforcements.map((w) => ({
    ...w,
    atMs: Math.round(w.atMs * 0.7),
    count: (w.count ?? 1) + 1,
  }));
  return lv;
}

function allEnemies(sim: GameSimulation): { lane: number; x: number; y: number }[] {
  const out: { lane: number; x: number; y: number }[] = [];
  sim.lanes.forEach((lane, i) => {
    for (const e of lane.getEnemyViews()) out.push({ lane: i, x: e.x, y: e.y });
  });
  return out;
}

function bestAim(sim: GameSimulation, laneIndex: number, tx: number, ty: number): { x: number; y: number } | null {
  const lane = sim.lanes[laneIndex];
  const anchor = lane.slingAnchor();
  let best: { x: number; y: number; d: number } | null = null;
  for (const dx of [50, 70, 90, 110, 130, 145, 150]) {
    for (const dy of [0, 10, 20, 30, 40, 50]) {
      const aim = { x: anchor.x - dx, y: anchor.y + dy };
      if (aim.y > lane.geo.groundTop) continue;
      sim.updateAim(aim);
      const plan = sim.currentAimLaunch();
      if (!plan || !plan.strongEnough) continue;
      const traj = lane.previewTrajectory(plan.spawn, plan.velocity);
      if (!traj.hit) continue;
      const d = Math.hypot(traj.hit.x - tx, traj.hit.y - ty);
      if (!best || d < best.d) best = { x: aim.x, y: aim.y, d };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

function fireAt(
  sim: GameSimulation,
  laneIndex: number,
  tx: number,
  ty: number,
  kind: 'tower' | 'enemy',
  logs: BirdLog[],
): boolean {
  if (sim.phase !== 'running' || sim.lanes.some((l) => l.projectile)) return false;
  const bird = 'woodpecker' as const;
  if (sim.regulator.ammo < 1) return false;
  if (!sim.selectBird(bird)) return false;
  const anchor = sim.lanes[laneIndex].slingAnchor();
  if (!sim.tryStartAim({ x: anchor.x, y: anchor.y })) return false;
  const aim = bestAim(sim, laneIndex, tx, ty);
  if (!aim) {
    sim.cancelAim('manual');
    return false;
  }
  sim.updateAim(aim);
  const result = sim.releaseAim();
  if (!result.launched) return false;
  logs.push({
    at: Math.round(sim.lanes[0].simTimeMs),
    lane: laneIndex,
    bird,
    targetKind: kind,
    target: { x: Math.round(tx), y: Math.round(ty) },
    aim,
    ammoAfter: sim.regulator.ammo,
  });
  return true;
}

type BirdMode = 'late' | 'early' | 'rescue' | 'none';

function runPolicy(level: M2LevelDef, variant: PolicyVariant, scenario: string, birdMode: BirdMode = 'late', immediate = false): PolicyResult {
  const sim = new GameSimulation(level);
  const useBirds = variant !== 'no-tree-no-birds' && birdMode !== 'none';
  const plan = BASE_PLAN.map((a) => ({ ...a, at: immediate ? 0 : a.at }));
  if (variant === 'tree') plan.push({ ...NEST_ACTION });
  const plantLog: PlantLog[] = [];
  const birdLog: BirdLog[] = [];
  let plantFailures = 0;
  let nestPlanted = 0;
  let lastFireCheck = -1;
  let steps = 0;

  while (sim.phase === 'running' && sim.lanes[0].simTimeMs < 190_000 && steps < 5000) {
    const now = sim.lanes[0].simTimeMs;
    for (const entry of plan) {
      if (entry.done || now < entry.at) continue;
      if (!sim.selectPlant(entry.type)) {
        plantFailures++;
        continue;
      }
      const y = sim.lanes[entry.lane].geo.groundTop - 12;
      if (sim.tryPlant({ x: entry.x, y })) {
        entry.done = true;
        if (entry.type === 'nest') nestPlanted++;
        plantLog.push({
          plannedAt: entry.at,
          actualAt: Math.round(now),
          delayMs: Math.round(now - entry.at),
          lane: entry.lane,
          x: entry.x,
          type: entry.type,
          cost: PLANTS[entry.type].cost,
          resourcesAfter: Math.floor(sim.resources),
        });
      } else {
        plantFailures++;
      }
    }

    if (useBirds && sim.phase === 'running' && !sim.lanes.some((l) => l.projectile) && now - lastFireCheck >= 500) {
      lastFireCheck = now;
      const enemies = allEnemies(sim).sort((a, b) => a.x - b.x);
      const danger = enemies.find((e) => e.x < 650);
      if (birdMode === 'rescue') {
        const target = enemies.find((e) => e.x < 700);
        if (target) fireAt(sim, target.lane, target.x, target.y, 'enemy', birdLog);
      } else if (birdMode === 'early') {
        if (now >= 15_000 && sim.lanes[0].towerAlive) {
          const core = sim.lanes[0].getBlockViews().find((b) => b.id === 'core-l0');
          if (core) fireAt(sim, 0, core.x, core.y, 'tower', birdLog);
        }
      } else if (danger) {
        fireAt(sim, danger.lane, danger.x, danger.y, 'enemy', birdLog);
      } else if (now > 95_000 && sim.regulator.ammo >= 2) {
        for (let lane = 0; lane < 3; lane++) {
          if (!sim.lanes[lane].towerAlive) continue;
          const core = sim.lanes[lane].getBlockViews().find((b) => b.id === `core-l${lane}`);
          if (core && fireAt(sim, lane, core.x, core.y, 'tower', birdLog)) break;
        }
      }
    }
    sim.advance(50);
    steps++;
  }

  return {
    variant,
    useBirds,
    scenario,
    phase: sim.phase,
    pendingSpawns: sim.pendingSpawns().map((p) => ({ ...p })),
    lives: sim.lives,
    leaks: sim.stats.leaks,
    timeMs: Math.round(sim.lanes[0].simTimeMs),
    plants: sim.lanes.reduce((s, l) => s + l.getPlantViews().length, 0),
    birds: sim.stats.launched,
    kills: sim.stats.kills,
    nestPlanted,
    nestRefills: sim.stats.nestRefills,
    towersDown: sim.stats.towersDown,
    reinforcementsCancelled: sim.stats.reinforcementsCancelled,
    resourcesSpent: sim.stats.resourcesSpent,
    resourcesEnd: Math.floor(sim.resources),
    ammoEnd: sim.regulator.ammo,
    plantFailures,
    plantLog,
    birdLog,
  };
}

function pressureCancelLevel(): M2LevelDef {
  const lv = buildLevelM2();
  lv.reinforcements.push({ atMs: 100_000, lane: 0, type: 'armor', count: 24, towerLane: 0 });
  return lv;
}

const scenarios = [
  { name: 'trial', make: buildLevelM2 },
  { name: 'trial-rush', make: rushLevel },
];


describe('M2 可复现混合策略候选：早生产 + 布防 + 拆塔', () => {
  const results: PolicyResult[] = [];

  for (const scenario of scenarios) {
    for (const variant of ['no-tree', 'tree', 'no-tree-no-birds'] as const) {
      it(`${scenario.name} / ${variant} 使用合法玩家 API 完整运行`, { timeout: 120_000 }, () => {
        const result = runPolicy(scenario.make(), variant, scenario.name);
        results.push(result);
        expect(result.plantLog.length).toBeGreaterThan(10);
        expect(result.plantLog.some((p) => p.plannedAt !== p.actualAt)).toBe(true);
        if (variant === 'no-tree-no-birds') {
          expect(result.birds, 'no-birds variant must not launch').toBe(0);
          expect(result.birdLog.length).toBe(0);
        } else {
          expect(result.phase, 'candidate must clear the scene').toBe('won');
          expect(result.lives).toBeGreaterThan(0);
          expect(result.leaks).toBe(0);
          expect(result.birdLog.length).toBeGreaterThan(3);
        }
        if (variant === 'tree') {
          expect(result.nestPlanted).toBe(1);
          expect(result.nestRefills).toBeGreaterThanOrEqual(1);
          expect(result.plantLog.some((p) => p.type === 'nest')).toBe(true);
        } else {
          expect(result.nestPlanted).toBe(0);
          expect(result.nestRefills).toBe(0);
        }
      });
    }
  }

  it('写入策略明细；无树与有树均为有效混合通关，且树实际补弹', { timeout: 10_000 }, () => {
    expect(results.length).toBe(6);
    mkdirSync('evidence/m2-strategy', { recursive: true });
    writeFileSync('evidence/m2-strategy/policy-results.json', JSON.stringify({ results }, null, 2));
    writeFileSync(
      'evidence/m2-strategy/policy-summary.md',
      `# M2 mixed policy details\n\n| scenario | variant | phase | sec | lives | leaks | plants | birds | nest | refills | towersDown | reinfCancel | spent | resEnd |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n` +
        results
          .map(
            (r) =>
              `| ${r.scenario} | ${r.variant}${r.useBirds ? '' : ' (no birds)'} | ${r.phase} | ${(r.timeMs / 1000).toFixed(1)} | ${r.lives} | ${r.leaks} | ${r.plants} | ${r.birds} | ${r.nestPlanted} | ${r.nestRefills} | ${r.towersDown} | ${r.reinforcementsCancelled} | ${r.resourcesSpent} | ${r.resourcesEnd} |`,
          )
          .join('\n') +
        `\n\nNo-tree and tree variants share the same base plan; tree adds one nest at t=102s. The no-tree-no-birds variant keeps the exact same plant plan/resources/waves but launches zero birds.\n\n` +
        `Same-plan no-birds comparison: ${results
          .filter((r) => r.variant === 'no-tree-no-birds')
          .map((r) => `${r.scenario}=${r.phase}, lives=${r.lives}, leaks=${r.leaks}, time=${(r.timeMs / 1000).toFixed(1)}s`)
          .join('; ')}. If no-birds clears with the same lives/time, birds are optional in this scene; tower count is the only observed difference.\n`,
    );
    const trial = results.filter((r) => r.scenario === 'trial');
    expect(trial.filter((r) => r.variant !== 'no-tree-no-birds').map((r) => r.phase)).toEqual(['won', 'won']);
    expect(trial.find((r) => r.variant === 'no-tree-no-birds')!.birds).toBe(0);
    expect(trial.find((r) => r.variant === 'tree')!.nestRefills).toBeGreaterThan(0);
    expect(trial.find((r) => r.variant === 'no-tree')!.nestRefills).toBe(0);
  });
});

describe('M2 援军压力案例（固定一例，不再扩大搜索）', () => {
  const all: { scenario: string; mode: BirdMode; r: PolicyResult }[] = [];
  const make = pressureCancelLevel;
  const scenario = 'pressure-cancel';

  for (const mode of ['none', 'early', 'rescue'] as BirdMode[]) {
    it(`${scenario} / ${mode}`, { timeout: 120_000 }, () => {
      const r = runPolicy(make(), 'no-tree', scenario, mode, true);
      all.push({ scenario, mode, r });
      expect(r.plantLog.length).toBeGreaterThan(10);
      if (mode === 'none') {
        expect(r.birds).toBe(0);
        expect(r.phase).toBe('won');
      }
      if (mode === 'early') {
        expect(r.phase).toBe('won');
        expect(r.reinforcementsCancelled).toBeGreaterThan(0);
        expect(r.towersDown).toBeGreaterThan(0);
      }
      if (mode === 'rescue') {
        // Rescue is attempted against living enemies, but this script does not
        // claim it succeeds against this pressure; record the actual outcome.
        expect(r.birds).toBeGreaterThan(0);
        expect(r.birdLog.some((b) => b.targetKind === 'enemy')).toBe(true);
        expect(r.kills).toBeGreaterThan(0);
      }
    });
  }

  it('写入压力案例原始数据；固定案例有合法通关与可解释差异', { timeout: 10_000 }, () => {
    mkdirSync('evidence/m2-strategy', { recursive: true });
    writeFileSync('evidence/m2-strategy/pressure-results.json', JSON.stringify({ case: scenario, results: all }, null, 2));
    const none = all.find((x) => x.mode === 'none')!.r;
    const early = all.find((x) => x.mode === 'early')!.r;
    writeFileSync(
      'evidence/m2-strategy/pressure-summary.md',
      `# M2 reinforcement pressure case (fixed, not expanded)\n\n| case | mode | phase | lives | leaks | time | birds | kills | towers | cancel | spent | shots-at |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n` +
        all.map((x) => `| ${x.scenario} | ${x.mode} | ${x.r.phase} | ${x.r.lives} | ${x.r.leaks} | ${(x.r.timeMs / 1000).toFixed(1)} | ${x.r.birds} | ${x.r.kills} | ${x.r.towersDown} | ${x.r.reinforcementsCancelled} | ${x.r.resourcesSpent} | ${x.r.birdLog.map((b) => b.targetKind).join(',') || '-'} |`).join('\n') +
        `\n\nCase: armor24@100s from the lane-0 tower, standard structures/resources, same 15-plant baseline. One fixed case, not a balance sweep. Verdicts are generated from actual results in this file; no hardcoded win/fail claim.\n` +
        `\n\nStrict-benefit check: early-tower must have fewer leaks than no-birds with no fewer lives (or more lives). Actual: none lives=${none.lives} leaks=${none.leaks}; early lives=${early.lives} leaks=${early.leaks}; early cancelled=${early.reinforcementsCancelled} future reinforcement schedule entries (of which 1 is the injected armor24@100s).\n`,
    );
    // Tightened per review: early tower shooting must be STRICTLY better than
    // the no-bird baseline (fewer leaks with no fewer lives, or more lives) -
    // equality no longer passes as "real benefit".
    const strictlyBetter =
      (early.leaks < none.leaks && early.lives >= none.lives) || early.lives > none.lives;
    expect(strictlyBetter, 'early-tower must strictly beat no-birds').toBe(true);
    expect(early.reinforcementsCancelled).toBeGreaterThan(0);
    // Injection accounting from the early run's read-only schedule view: the
    // injected schedule ENTRY (count=24 units) must be cancelled, never
    // spawned; per-call deep copies keep the count exact (isolation test).
    const armorPending = early.pendingSpawns.filter(
      (p) => p.type === 'armor' && p.towerLane === 0,
    );
    // One schedule entry carrying count=24 (24 units would spawn at 100s).
    expect(armorPending.length).toBe(1);
    expect(armorPending[0].count).toBe(24);
    expect(armorPending[0].cancelled).toBe(true);
    expect(armorPending[0].done).toBe(false);
    expect(all.filter((x) => x.r.phase === 'won').length).toBeGreaterThanOrEqual(2);
  });
});
