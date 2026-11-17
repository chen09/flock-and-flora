import { describe, expect, it } from "vitest";
import { FIXED_DT_MS, laneGroundTop } from "../src/config";
import { makeLane } from "./helpers";

describe("frost area lifetime (real lane physics)", () => {
  it("slows a later entrant only while the impact area exists", () => {
    const lane = makeLane([]);
    lane.frostAt(700, laneGroundTop(1) - 20, 140, 4000);
    for (let i = 0; i < 60; i++) lane.step(FIXED_DT_MS);
    lane.spawnEnemy("runner", 780);
    lane.step(FIXED_DT_MS);
    expect(lane.getEnemyViews()[0].slowed).toBe(true);
    expect(lane.getFrostViews()).toHaveLength(1);
    for (let i = 0; i < 190; i++) lane.step(FIXED_DT_MS);
    expect(lane.getFrostViews()).toHaveLength(0);
    expect(lane.getEnemyViews()[0].slowed).toBe(false);
    lane.dispose();
  });
});
