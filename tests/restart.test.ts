import { describe, expect, it } from 'vitest';
import { makeGame, stepN } from './helpers';

describe('重开无残留（三路）', () => {
  it('混乱后重开：全部复位，旧世界清空且失效', () => {
    const g = makeGame();
    const initialBodies = g.lanes.map((l) => l.bodyCount());
    const initialBlocks = g.lanes.map((l) => l.blockCount());

    g.fireWithVelocity(1, 12, -7);
    stepN(g, 120);
    g.lanes[1].damageBlockById('leg-l1-a', 9999);
    stepN(g, 300);
    g.lanes[2].spawnEnemy('normal', 800); // stray walker (will leak or be reset)
    const oldLanes = g.lanes;
    expect(g.getLog().length).toBeGreaterThan(0);

    g.restart();

    g.lanes.forEach((lane, i) => {
      expect(lane.bodyCount()).toBe(initialBodies[i]);
      expect(lane.blockCount()).toBe(initialBlocks[i]);
      expect(lane.simTimeMs).toBe(0);
      expect(lane.projectile).toBeNull();
      expect(lane.enemiesAlive()).toBe(0);
      expect(lane.towerAlive).toBe(true);
    });
    expect(g.regulator.ammo).toBe(2); // official start
    expect(g.lives).toBe(CONFIG_LIVES);
    expect(g.getLog().length).toBe(0);
    expect(g.phase).toBe('running');

    // Old lanes fully disposed and inert.
    for (const lane of oldLanes) {
      expect(lane.bodyCount()).toBe(0);
      const t = lane.simTimeMs;
      lane.step(16.666);
      expect(lane.simTimeMs).toBe(t);
    }
  });

  it('重开后的世界再次静置稳定', () => {
    const g = makeGame();
    stepN(g, 300);
    g.restart();
    const before = g.lanes.map((l) => l.blockSnapshot());
    stepN(g, 600);
    g.lanes.forEach((lane, i) => {
      const after = lane.blockSnapshot();
      for (const [id, p] of after) {
        const ref = before[i].get(id)!;
        expect(Math.hypot(p.x - ref.x, p.y - ref.y)).toBeLessThan(1);
      }
      expect(lane.isQuiet()).toBe(true);
    });
  });
});

const CONFIG_LIVES = 3;
