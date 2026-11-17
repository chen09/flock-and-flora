import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { PLANTS } from '../src/sim/entities';
import { makeGame, stepN } from './helpers';
import { FIXED_DT_MS } from '../src/config';

// Game-level rule regressions explicitly requested by the M2 dispatch:
// official ammo wired into the REAL GameSimulation clock, slot-0 planting,
// nest run-limit freed by removal, tower-down cancels future reinforcements
// immediately (victory must not wait for cancelled far-future spawns).

describe('M2 游戏级规则回归', () => {
  it('正式弹药在 Game 内按 12 秒战斗时间恢复', () => {
    const g = makeGame();
    g.selectBird('owlbomb'); // costs 2: drains the 2/3 start to exactly 0
    expect(g.fireWithVelocity(1, 18, -2)).toBe(true);
    expect(g.regulator.ammo).toBe(0);
    stepN(g, 719);
    expect(g.regulator.ammo).toBe(0);
    stepN(g, 1);
    expect(g.regulator.ammo).toBe(1);
  });

  it('slot0 可种植；已占格拒绝且不扣资源（白盒 fixture：直接注资源仅限单元测试）', () => {
    const g = makeGame();
    g.selectPlant('pea'); // cost 100 == starting resources
    const y = 600 - 20;
    expect(g.tryPlant({ x: CONFIG.plants.slotXStart, y })).toBe(true);
    expect(g.resources).toBe(0);
    // slot 0 now occupied: another pea cannot be planted there.
    g.resources = 500; // test fixture refill for the second attempt
    expect(g.tryPlant({ x: CONFIG.plants.slotXStart, y })).toBe(false);
    expect(g.lanes[1].hasPlantAt(0)).toBe(true);
    expect(g.lanes[1].getPlantViews()[0].plantId).toBe('pea');
  });

  it('栖羽树全场最多 2 株；铲除/被啃后限额释放', () => {
    const g = makeGame();
    g.resources = 1000;
    g.selectPlant('nest');
    const spots = [
      { lane: 0, x: CONFIG.plants.slotXStart, y: 360 - 20 },
      { lane: 1, x: CONFIG.plants.slotXStart + 110, y: 600 - 20 },
      { lane: 2, x: CONFIG.plants.slotXStart + 220, y: 840 - 20 },
    ];
    for (const [i, spot] of spots.entries()) {
      if (i < 2) {
        expect(g.tryPlant(spot), `nest #${i + 1} plants`).toBe(true);
        stepN(g, 722); // past the 12s plant cooldown
      } else {
        expect(g.tryPlant(spot), 'third nest rejected').toBe(false);
      }
    }
    expect(g.nestCountValue()).toBe(2);
    // Removing one tree frees the limit.
    expect(g.lanes[0].removePlant(0, 'removed')).toBe(true);
    expect(g.nestCountValue()).toBe(1);
    expect(g.tryPlant(spots[2])).toBe(true);
  });

  it('塔毁立即取消该塔未发生援军；胜利不等取消项的远期时点', () => {
    const g = makeGame();
    // Custom scenario: one reinforcement far in the future, tied to lane 0.
    g.level.reinforcements.push({ atMs: 600000, lane: 0, type: 'normal', count: 2, towerLane: 0 });
    g.restart();
    let wonCount = 0;
    g.events.won.on(() => wonCount++);
    // No base waves in makeGame levels: tower-down alone ends the schedule.
    g.lanes[0].damageBlockById('core-l0', 9999);
    stepN(g, 60);
    expect(g.stats.reinforcementsCancelled).toBe(1);
    expect(g.phase).toBe('won'); // victory settles without waiting 600s
    expect(wonCount).toBe(1);
    expect(g.pendingSpawns().every((p) => p.cancelled || p.done)).toBe(true);
  });

  it('种植冷却独立计时（同一植物在冷却期内不能重复种）', () => {
    const g = makeGame();
    g.resources = 1000;
    g.selectPlant('pea');
    const y = 600 - 20;
    const x0 = CONFIG.plants.slotXStart;
    const x1 = CONFIG.plants.slotXStart + CONFIG.plants.slotSpacing;
    expect(g.tryPlant({ x: x0, y })).toBe(true);
    expect(g.tryPlant({ x: x1, y })).toBe(false); // cooling down
    stepN(g, Math.ceil(PLANTS.pea.cooldownMs / FIXED_DT_MS) + 2);
    expect(g.tryPlant({ x: x1, y })).toBe(true);
    void PLANTS;
  });
});
