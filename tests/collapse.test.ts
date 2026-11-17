import { describe, expect, it } from 'vitest';
import { makeGame, stepN } from './helpers';

// Load-bearing collapse semantics carried over from M1: destroying supports
// makes the slab fall through the real engine and the tower core goes down
// with it (displaced or destroyed) - no scripted animations.
describe('承重倒塌（真实物理计算）', () => {
  it('拆掉中路段腿后平台坠落，核心随之位移或被毁', () => {
    const g = makeGame();
    const lane = g.lanes[1];
    const before = lane.blockSnapshot();
    const slabBefore = before.get('slab-l1')!;
    const coreBefore = before.get('core-l1')!;

    expect(lane.damageBlockById('leg-l1-a', 9999)).toBe(true);
    expect(lane.damageBlockById('leg-l1-b', 9999)).toBe(true);
    stepN(g, 240);

    const after = lane.blockSnapshot();
    const slab = after.get('slab-l1');
    expect(slab, 'slab still exists').toBeDefined();
    expect(slab!.y).toBeGreaterThan(slabBefore.y + 40);
    const core = after.get('core-l1');
    expect(core === undefined || core.y > coreBefore.y + 30, 'core follows collapse').toBe(true);
    expect(g.phase).toBe('running'); // no waves: nothing to win/lose here
  });

  it('仅拆单根腿：结构失衡位移', () => {
    const g = makeGame();
    const lane = g.lanes[1];
    const slabBefore = lane.blockSnapshot().get('slab-l1')!;
    expect(lane.damageBlockById('leg-l1-a', 9999)).toBe(true);
    stepN(g, 240);
    const slab = lane.blockSnapshot().get('slab-l1');
    expect(slab).toBeDefined();
    expect(slab!.y).toBeGreaterThan(slabBefore.y + 25);
    expect(g.phase).toBe('running');
  });
});
