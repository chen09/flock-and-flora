import { describe, expect, it } from 'vitest';
import { FIXED_DT_MS, CONFIG, laneGroundTop } from '../src/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PLANTS, type PlantId } from '../src/sim/entities';
import { GameSimulation, M2LevelDef } from '../src/sim/game';
import { buildLevelM2 } from '../src/sim/levelM2';
import { type Vec } from '../src/sim/events';

// Reproducible strategy comparison on identical scenarios and starting
// resources. Strategies drive ONLY the legal player path
// (selectBird/selectPlant/tryPlant/tryRemove/tryStartAim/updateAim/releaseAim)
// plus advance(); no direct HP/resource mutation, no debug launch helpers.

interface StrategyPlan {
  name: string;
  shoots: boolean;
  shootTarget: 'tower' | 'enemies';
  bird: 'woodpecker' | 'owlbomb';
  useNest: boolean;
  plants: PlantId[]; // plant mix used by the schedule
}

const STRATEGIES: StrategyPlan[] = [
  { name: 'purePlants', shoots: false, shootTarget: 'enemies', bird: 'woodpecker', useNest: false,
    plants: ['pea', 'shell', 'frost', 'pea', 'shell', 'frost', 'pea', 'dawn', 'pea', 'dawn'] },
  { name: 'pureShots', shoots: true, shootTarget: 'enemies', bird: 'woodpecker', useNest: false, plants: [] },
  { name: 'towerFirst', shoots: true, shootTarget: 'tower', bird: 'owlbomb', useNest: false,
    plants: ['pea', 'shell', 'pea', 'frost', 'pea'] },
  { name: 'defendFirst', shoots: true, shootTarget: 'enemies', bird: 'woodpecker', useNest: false,
    plants: ['shell', 'frost', 'shell', 'frost', 'shell', 'frost'] },
  { name: 'mixed', shoots: true, shootTarget: 'enemies', bird: 'woodpecker', useNest: false,
    plants: ['pea', 'pea', 'pea', 'shell', 'pea', 'frost', 'shell', 'pea', 'dawn', 'pea', 'pea'] },
];

function scenarioTrial(): M2LevelDef {
  return buildLevelM2();
}

function scenarioRush(): M2LevelDef {
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

const SHOT_PULLS: [number, number][] = [
  [140, 50], [120, 35], [120, 50], [100, 50], [80, 50], [140, 35],
  [120, 65], [100, 65], [150, 50], [90, 35], [70, 50], [110, 35],
];

interface StrategyDef {
  name: string;
  scenario: string;
  phase: string;
  timedOut: boolean;
  steps: number;
  simSeconds: number;
  lives: number;
  leaks: number;
  kills: number;
  launched: number;
  aimCancels: number;
  towersDown: number;
  reinforcementsCancelled: number;
  nestPlanted: number;
  nestRefills: number;
  plantsPlanted: number;
  plantGiveUps: number;
  plantPendingAtEnd: number;
  resourcesSpent: number;
  resourcesEnd: number;
  ammoEnd: number;
  enemiesRemaining: number;
}

function runStrategy(strategy: StrategyPlan, level: M2LevelDef, maxSteps = 13200): StrategyDef {
  const sim = new GameSimulation(level);
  sim.selectBird(strategy.bird);
  // Build the planting schedule: spread the strategy's plant mix over time and
  // lanes (round-robin), cheapest-first ordering to mimic natural play.
  const lanes = [1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2];
  const slots = [0, 1, 2, 3, 4, 5];
  const schedule: { atMs: number; lane: number; slot: number; plant: PlantId }[] = [];
  let t = 1500;
  let li = 0;
  let si = 0;
  for (const plant of strategy.plants) {
    schedule.push({ atMs: t, lane: lanes[li % 3], slot: slots[si % 6], plant });
    t += 11000;
    li++;
    si++;
    if (si % 6 === 0) si = (si + 1) % 6;
  }

  let steps = 0;
  let scheduleIdx = 0;
  let plantGiveUps = 0;
  let lastShotAtMs = -Infinity;

  while (sim.phase === 'running' && steps < maxSteps) {
    sim.advance(FIXED_DT_MS);
    steps++;
    const now = sim.lanes[1].simTimeMs;

    // Planting: retry while resources/cooldown are missing, give up after 30s.
    if (scheduleIdx < schedule.length && now >= schedule[scheduleIdx].atMs) {
      const entry = schedule[scheduleIdx];
      const def = PLANTS[entry.plant];
      const point: Vec = {
        x: CONFIG.plants.slotXStart + entry.slot * CONFIG.plants.slotSpacing,
        y: laneGroundTop(entry.lane) - def.h / 2 - 2,
      };
      sim.selectPlant(entry.plant);
      const ok = sim.tryPlant(point);
      if (ok) {
        scheduleIdx++;
      } else if (now - entry.atMs > 30000) {
        plantGiveUps++;
        scheduleIdx++;
      }
      // else: keep retrying on later ticks (adaptive budget).
    }

    // Shooting: every 30 steps, try the pull grid via the legal preview path.
    if (strategy.shoots && steps % 30 === 0) {
      if (!sim.lanes.some((l) => l.projectile) && sim.regulator.ammo >= 1 && now - lastShotAtMs >= 2000) {
        let laneIdx = -1;
        if (strategy.shootTarget === 'tower') {
          laneIdx = sim.lanes.findIndex((l) => l.towerAlive);
        } else {
          let best = 0;
          for (let i = 0; i < 3; i++) {
            const n = sim.lanes[i].enemiesAlive();
            if (n > best) {
              best = n;
              laneIdx = i;
            }
          }
        }
        // Late game: with spare ammo, also chip the towers to cancel future
        // reinforcements (mixed behaviour).
        if (strategy.shootTarget === 'enemies' && laneIdx < 0 && now > 150000) {
          laneIdx = sim.lanes.findIndex((l) => l.towerAlive);
        }
        if (laneIdx >= 0) {
          const lane = sim.lanes[laneIdx];
          const anchor = lane.slingAnchor();
          for (const [px, py] of SHOT_PULLS) {
            const aim: Vec = { x: anchor.x - px, y: anchor.y + py };
            sim.tryStartAim({ x: anchor.x, y: anchor.y });
            sim.updateAim(aim);
            const plan = sim.currentAimLaunch();
            if (!plan || !plan.strongEnough) {
              sim.cancelAim('manual');
              continue;
            }
            const traj = lane.previewTrajectory(plan.spawn, plan.velocity);
            if (!traj.hit) {
              sim.cancelAim('manual');
              continue;
            }
            let accept = false;
            if (strategy.shootTarget === 'tower') {
              accept = traj.hit.x >= 990 && traj.hit.x <= 1230;
            } else {
              // Precision accept: the preview landing point must be within 35px
              // of some enemy, so each launched bird realistically kills one.
              for (const e of lane.getEnemyViews()) {
                if (Math.abs(traj.hit.x - e.x) <= 35 && traj.hit.y > 400) {
                  accept = true;
                  break;
                }
              }
            }
            if (accept) {
              sim.releaseAim();
              lastShotAtMs = now;
              break;
            }
            sim.cancelAim('manual');
          }
        }
      }
    }
  }

  return {
    name: strategy.name,
    scenario: '',
    phase: sim.phase === 'running' && steps >= maxSteps ? 'timeout' : sim.phase,
    timedOut: sim.phase === 'running' && steps >= maxSteps,
    steps,
    simSeconds: Math.round(sim.lanes[1].simTimeMs / 100) / 10,
    lives: sim.lives,
    leaks: sim.stats.leaks,
    kills: sim.stats.kills,
    launched: sim.stats.launched,
    aimCancels: sim.stats.aimCancels,
    towersDown: sim.stats.towersDown,
    reinforcementsCancelled: sim.stats.reinforcementsCancelled,
    plantsPlanted: sim.stats.plantsPlanted,
    plantGiveUps,
    plantPendingAtEnd: schedule.length - scheduleIdx,
    resourcesSpent: Math.round(sim.stats.resourcesSpent),
    resourcesEnd: Math.floor(sim.resources),
    ammoEnd: sim.regulator.ammo,
    enemiesRemaining: sim.lanes.reduce((s, l) => s + l.enemiesAlive(), 0),
    nestPlanted: 0, // schedule-based runner never reserves the nest entry here
    nestRefills: sim.stats.nestRefills,
  };
}

const SCENARIOS = [
  { name: 'trial', make: scenarioTrial },
  { name: 'trial-rush', make: scenarioRush },
];

describe('策略比较（相同场景与初始资源，合法玩家路径）', () => {
  const results: StrategyDef[] = [];

  for (const scenario of SCENARIOS) {
    for (const strategy of STRATEGIES) {
      it(`${strategy.name} @ ${scenario.name} 完整运行并记录`, { timeout: 420000 }, () => {
        const level = scenario.make();
        const r = runStrategy(strategy, level);
        r.scenario = scenario.name;
        results.push(r);
        expect(['running', 'won', 'lost', 'timeout']).toContain(r.phase);
        // Every strategy must actually execute its own definition: pure-plant
        // variants plant, shooting variants launch.
        if (strategy.plants.length > 0) {
          expect(r.plantsPlanted + r.plantGiveUps).toBeGreaterThan(0);
        }
        if (strategy.name.startsWith('purePlants')) {
          expect(r.launched).toBe(0);
        }
        if (strategy.shoots) {
          expect(r.launched).toBeGreaterThan(0);
        }
        if (strategy.useNest) {
          expect(results.filter((x) => x.name === strategy.name).length > 1 ? true : r.plantsPlanted > 0).toBe(true);
        }
      });
    }
  }

  it('汇总：写入原始数据；混合策略必须在标准场景合法通关', { timeout: 10000 }, () => {
    expect(results.length).toBe(STRATEGIES.length * SCENARIOS.length);
    mkdirSync('evidence/m2-strategy', { recursive: true });
    writeFileSync(
      'evidence/m2-strategy/results.json',
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note: 'sim-side strategy comparison; legal player paths only; not a substitute for human playtesting',
          results,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      'evidence/m2-strategy/summary.md',
      `# M2 strategy comparison (simulated, legal paths only)\n\n| strategy | scenario | result | timedOut | simSec | lives | leaks | kills | launched | cancels | towersDown | reinfCancel | planted | giveUps | pendingEnd | spent | resEnd | ammoEnd |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n` +
        results
          .map(
            (r) =>
              `| ${r.name} | ${r.scenario} | ${r.phase} | ${r.timedOut} | ${r.simSeconds} | ${r.lives} | ${r.leaks} | ${r.kills} | ${r.launched} | ${r.aimCancels} | ${r.towersDown} | ${r.reinforcementsCancelled} | ${r.plantsPlanted} | ${r.plantGiveUps} | ${r.plantPendingAtEnd} | ${r.resourcesSpent} | ${r.resourcesEnd} | ${r.ammoEnd} |`,
          )
          .join('\n') +
        `\n\nwins: ${results.filter((r) => r.phase === 'won').length}/${results.length}\n`,
    );
    // At least one legal mixed run must clear the standard trial level.
    const mixedWon = results.some((r) => r.name === 'mixed' && r.scenario === 'trial' && r.phase === 'won');
    expect(mixedWon, 'a legal mixed strategy must clear the trial level').toBe(true);
    // Comparison data must differ between strategies.
    const outcomes = new Set(results.map((r) => `${r.scenario}:${r.phase}`));
    expect(outcomes.size).toBeGreaterThan(1);
  });
});
