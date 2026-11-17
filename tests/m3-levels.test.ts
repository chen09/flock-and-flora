import { describe, expect, it } from "vitest";
import { buildLevel, LEVEL_FACTORIES } from "../src/sim/levels";
import { laneBandTop, laneGroundTop } from "../src/config";
import { GameSimulation } from "../src/sim/game";

describe("M3 campaign contracts", () => {
  it("builds eight independent finite scenarios with progressive lanes and units", () => {
    expect(LEVEL_FACTORIES).toHaveLength(8);
    expect(LEVEL_FACTORIES.map((_, i) => buildLevel(i).lanes.length)).toEqual([
      1, 1, 2, 3, 3, 3, 3, 3,
    ]);
    for (let i = 0; i < 8; i++) {
      const a = buildLevel(i);
      const b = buildLevel(i);
      expect(a.baseWaves.length).toBeGreaterThan(0);
      a.baseWaves[0].count = 999;
      expect(b.baseWaves[0].count).not.toBe(999);
      expect(a.star.special.zh.length).toBeGreaterThan(0);
      expect(a.tutorial.length).toBeGreaterThan(0);
    }
  });

  it("keeps the nest car inside its lane and stable through real engine warm-up", () => {
    const level = buildLevel(7);
    for (const lane of level.lanes) {
      for (const b of lane.blocks) {
        expect(b.y - b.h / 2).toBeGreaterThanOrEqual(
          laneBandTop(lane.laneIndex) + 8,
        );
        expect(b.y + b.h / 2).toBeLessThanOrEqual(
          laneGroundTop(lane.laneIndex),
        );
      }
    }
    const sim = new GameSimulation(level);
    const before = sim.lanes[1].getBlockViews();
    sim.stepFixed(600);
    const after = sim.lanes[1].getBlockViews();
    expect(after.length).toBe(before.length);
    expect(sim.lanes[1].towerAlive).toBe(true);
    expect(
      after.every((b) => b.hp === b.maxHp && Math.abs(b.angle) < 0.04),
    ).toBe(true);
    expect(sim.nestCarPhase).toBe(1);
    sim.dispose();
  });

  it("all eight authored structures survive ten seconds without input or spontaneous damage", () => {
    for (let i = 0; i < 8; i++) {
      const sim = new GameSimulation(buildLevel(i));
      const before = sim.lanes.map((lane) => lane.getBlockViews().length);
      sim.stepFixed(600);
      sim.lanes.forEach((lane, index) => {
        expect(
          lane.getBlockViews().length,
          `level ${i + 1} lane ${index}`,
        ).toBe(before[index]);
        expect(
          lane.getBlockViews().every((b) => b.hp === b.maxHp),
          `level ${i + 1} spontaneous damage`,
        ).toBe(true);
        expect(lane.towerAlive).toBe(true);
      });
      sim.dispose();
    }
  });

  it("does not award the gantry challenge for merely waiting; actual breaks reset on retry", () => {
    const level = buildLevel(7);
    level.baseWaves = [];
    level.reinforcements = [];
    const sim = new GameSimulation(level);
    sim.stepFixed(7501);
    expect(sim.nestCarPhase).toBe(2);
    expect(level.star.special.check(sim.stats)).toBe(false);
    // Fixture damage verifies event accounting, not a legal player win.
    for (const id of level.nestCar!.parts)
      sim.lanes[1].damageBlockById(id, 9999);
    expect(sim.stats.nestCarPartsBroken).toBe(2);
    expect(level.star.special.check(sim.stats)).toBe(true);
    sim.restart();
    expect(sim.nestCarPhase).toBe(1);
    expect(sim.stats.nestCarPartsBroken).toBe(0);
    expect(level.star.special.check(sim.stats)).toBe(false);
    sim.dispose();
  });

  it("rejects authored presets exceeding the shared nest limit", () => {
    const level = buildLevel(7);
    level.presetPlants = [0, 1, 2].map((lane) => ({
      lane,
      slot: 0,
      plant: "nest",
    }));
    expect(() => new GameSimulation(level)).toThrow(
      "Preset nest count exceeds",
    );
  });

  it("rejects locked units in rule APIs, not only in the UI", () => {
    const sim = new GameSimulation(buildLevel(0));
    expect(sim.selectBird("owlbomb")).toBe(false);
    expect(sim.selectPlant("pea")).toBe(false);
    expect(sim.selectBird("woodpecker")).toBe(true);
    sim.dispose();
  });

  it("places preset defenders without charging or counting player purchases; restart restores them", () => {
    const level = buildLevel(0);
    const sim = new GameSimulation(level);
    expect(sim.lanes[0].getPlantViews().length).toBe(level.presetPlants.length);
    expect(sim.stats.plantsPlanted).toBe(0);
    expect(sim.resources).toBe(level.startResources);
    sim.restart();
    expect(sim.lanes[0].getPlantViews().length).toBe(level.presetPlants.length);
    expect(sim.stats.plantsPlanted).toBe(0);
    sim.dispose();
  });
});
