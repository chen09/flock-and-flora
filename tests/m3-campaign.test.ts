import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildLevel } from "../src/sim/levels";
import { GameSimulation } from "../src/sim/game";
import { BIRDS, PLANTS, type BirdId, type PlantId } from "../src/sim/entities";

type PlayerInput =
  | { at: number; kind: "plant"; lane: number; slot: number; plant: PlantId }
  | {
      at: number;
      kind: "bird";
      lane: number;
      bird: BirdId;
      x: number;
      y: number;
    };

// Production simulation with only the public player path. Bounded aiming
// candidates use the same preview the player sees; no HP/economy writes,
// direct launches, manual events or save manipulation.
function play(index: number) {
  const level = buildLevel(index);
  const sim = new GameSimulation(level);
  const inputs: PlayerInput[] = [];
  const destroyed: { at: number; lane: number; id: string }[] = [];
  sim.events.blockDestroyed.on((event) => {
    destroyed.push({
      at: sim.lanes[0].simTimeMs,
      lane: event.laneIndex,
      id: event.blockId,
    });
  });
  const plans: { lane: number; slot: number; plant: PlantId; done: boolean }[] =
    [];
  const add = (lane: number, slot: number, plant: PlantId) => {
    if (
      level.availablePlants.includes(plant) &&
      !level.presetPlants.some((p) => p.lane === lane && p.slot === slot)
    )
      plans.push({ lane, slot, plant, done: false });
  };
  for (let lane = 0; lane < level.laneCount; lane++) {
    add(lane, 2, "dawn");
    add(lane, 5, "shell");
  }
  for (const slot of [4, 3])
    for (let lane = 0; lane < level.laneCount; lane++) add(lane, slot, "pea");
  for (let lane = 0; lane < level.laneCount; lane++) add(lane, 1, "frost");
  add(1, 0, "nest");
  let lastAim = -10000;
  let towerLane = 0;
  while (sim.phase === "running" && sim.lanes[0].simTimeMs < 300000) {
    const now = sim.lanes[0].simTimeMs;
    for (const plan of plans) {
      if (plan.done || plan.lane >= level.laneCount) continue;
      if (!sim.selectPlant(plan.plant)) continue;
      if (
        sim.tryPlant({
          x: 300 + plan.slot * 110,
          y: sim.lanes[plan.lane].geo.groundTop - 12,
        })
      ) {
        plan.done = true;
        inputs.push({
          at: now,
          kind: "plant",
          lane: plan.lane,
          slot: plan.slot,
          plant: plan.plant,
        });
      }
    }
    if (now - lastAim >= 2000 && !sim.lanes.some((l) => l.projectile)) {
      lastAim = now;
      const enemies = sim.lanes
        .flatMap((lane, i) =>
          lane.getEnemyViews().map((e) => ({ ...e, lane: i })),
        )
        .sort((a, b) => a.x - b.x);
      const danger = enemies.find((e) => e.x < 800);
      const targetLane = danger?.lane ?? towerLane++ % level.laneCount;
      const lane = sim.lanes[targetLane];
      const blocks = lane.getBlockViews();
      const target =
        danger ??
        blocks.find((b) => b.id.includes("leg") || b.id.includes("post")) ??
        blocks[0];
      const bird: BirdId =
        level.availableBirds.includes("owlbomb") && sim.regulator.ammo >= 2
          ? "owlbomb"
          : "woodpecker";
      if (
        target &&
        sim.regulator.ammo >= BIRDS[bird].ammoCost &&
        sim.selectBird(bird) &&
        sim.tryStartAim(lane.slingAnchor())
      ) {
        let best: { x: number; y: number; d: number } | null = null;
        const anchor = lane.slingAnchor();
        for (const dx of [50, 70, 90, 110, 130, 145, 150])
          for (const dy of [0, 10, 20, 30, 40, 50]) {
            const point = { x: anchor.x - dx, y: anchor.y + dy };
            sim.updateAim(point);
            const launch = sim.currentAimLaunch();
            if (!launch?.strongEnough) continue;
            const hit = lane.previewTrajectory(
              launch.spawn,
              launch.velocity,
            ).hit;
            if (!hit) continue;
            const d = Math.hypot(hit.x - target.x, hit.y - target.y);
            if (!best || d < best.d) best = { ...point, d };
          }
        if (best) {
          sim.updateAim(best);
          if (sim.releaseAim().launched)
            inputs.push({
              at: now,
              kind: "bird",
              lane: targetLane,
              bird,
              x: best.x,
              y: best.y,
            });
        } else sim.cancelAim("manual");
      }
    }
    sim.advance(50);
  }
  const result = {
    id: index + 1,
    phase: sim.phase,
    timeMs: sim.lanes[0].simTimeMs,
    lives: sim.lives,
    stats: { ...sim.stats },
    nestCarPhase: sim.nestCarPhase,
    stars: [
      sim.phase === "won",
      sim.phase === "won" && sim.stats.leaks === 0,
      sim.phase === "won" && level.star.special.check(sim.stats),
    ],
    specialGoal: level.star.special.zh,
    inputs,
    destroyed,
  };
  sim.dispose();
  return result;
}

describe("eight-level legal campaign playthroughs (simulation, not browser)", () => {
  for (let index = 0; index < 8; index++) {
    it(
      `level ${index + 1}: records legal inputs and completes within five minutes`,
      { timeout: 120000 },
      () => {
        const result = play(index);
        mkdirSync("evidence/m3-campaign", { recursive: true });
        writeFileSync(
          `evidence/m3-campaign/level-${index + 1}.json`,
          JSON.stringify(result, null, 2),
        );
        expect(
          result.phase,
          JSON.stringify({ ...result, inputs: result.inputs.length }),
        ).toBe("won");
        // Independent fresh-instance replay consumes only recorded inputs, with
        // no preview search or adaptive decisions in the replay pass.
        const replay = new GameSimulation(buildLevel(index));
        let cursor = 0;
        while (
          replay.phase === "running" &&
          replay.lanes[0].simTimeMs < 300000
        ) {
          const now = replay.lanes[0].simTimeMs;
          while (
            cursor < result.inputs.length &&
            result.inputs[cursor].at <= now + 0.001
          ) {
            const action = result.inputs[cursor++];
            if (action.kind === "plant") {
              expect(replay.selectPlant(action.plant)).toBe(true);
              expect(
                replay.tryPlant({
                  x: 300 + action.slot * 110,
                  y: replay.lanes[action.lane].geo.groundTop - 12,
                }),
              ).toBe(true);
            } else {
              expect(replay.selectBird(action.bird)).toBe(true);
              expect(
                replay.tryStartAim(replay.lanes[action.lane].slingAnchor()),
              ).toBe(true);
              replay.updateAim({ x: action.x, y: action.y });
              expect(replay.releaseAim().launched).toBe(true);
            }
          }
          replay.advance(50);
        }
        expect(replay.phase).toBe("won");
        expect(replay.stats.leaks).toBe(result.stats.leaks);
        expect(cursor).toBe(result.inputs.length);
        replay.dispose();
        expect(result.inputs.some((i) => i.kind === "bird")).toBe(true);
        expect(
          result.destroyed.some((b) => /leg|pier|post/.test(b.id)),
          "legal shots must demonstrate reachable structural supports",
        ).toBe(true);
        if (index > 0)
          expect(
            result.inputs.some(
              (i) => i.kind === "plant" && PLANTS[i.plant].cost > 0,
            ),
          ).toBe(true);
      },
    );
  }
});
