import { describe, expect, it } from 'vitest';
import { FIXED_DT_MS, laneGroundTop } from '../src/config';
import { makeLane } from './helpers';
import { MATERIALS } from '../src/materials';

// Impact damage carried over from M1, now lane-level via makeLane.

describe('撞击伤害（碰撞冲量驱动）', () => {
  it('高速弹丸直接击碎脆晶', () => {
    const crystalLane = makeLane([
      { id: 'cr', x: 600, w: 48, h: 48, material: 'crystal' },
    ]);
    crystalLane.wakeAll();
    const damaged: number[] = [];
    crystalLane.simEvents.blockDamaged.on((i) => damaged.push(i.hp));
    const destroyed: string[] = [];
    crystalLane.simEvents.blockDestroyed.on((i) => destroyed.push(i.blockId));
    crystalLane.launch({ x: 196, y: 524 }, { x: 18, y: -0.79 });
    for (let i = 0; i < 120 && crystalLane.projectile; i++) crystalLane.step(FIXED_DT_MS);
    expect(destroyed).toContain('cr');
    expect(damaged.length).toBeGreaterThan(0);
    expect(damaged.length).toBeLessThanOrEqual(3); // no per-frame pile-ups
  });

  it('低速命中木材：造成伤害但不击碎', () => {
    const lane = makeLane([{ id: 'wd', x: 380, w: 24, h: 130, material: 'wood' }]);
    lane.wakeAll();
    lane.launch({ x: 196, y: laneGroundTop(1) - 76 }, { x: 5, y: -4 });
    for (let i = 0; i < 90 && lane.projectile; i++) lane.step(FIXED_DT_MS);
    const wd = lane.getBlockViews().find((b) => b.id === 'wd');
    expect(wd).toBeDefined();
    expect(wd!.hp).toBeGreaterThan(0);
    expect(wd!.hp).toBeLessThan(MATERIALS.wood.hp);
    for (let i = 0; i < 300; i++) lane.step(FIXED_DT_MS);
    const wd2 = lane.getBlockViews().find((b) => b.id === 'wd');
    expect(wd2!.hp).toBe(wd!.hp); // resting contact never chips further
  });

  it('高速弹丸不无声穿过薄支撑（超上限压力）', () => {
    const lane = makeLane([{ id: 'panel', x: 600, w: 20, h: 120, material: 'wood' }]);
    lane.wakeAll();
    lane.launch({ x: 196, y: laneGroundTop(1) - 76 }, { x: 24, y: 0 });
    let violation = false;
    for (let i = 0; i < 120; i++) {
      lane.step(FIXED_DT_MS);
      const pv = lane.getBlockViews().find((b) => b.id === 'panel');
      const bird = lane.projectile;
      if (pv && pv.hp > 0 && bird && bird.body.position.x > 640) violation = true;
    }
    expect(violation).toBe(false);
    for (let i = 0; i < 400; i++) lane.step(FIXED_DT_MS);
  });
});
