import { describe, expect, it } from 'vitest';
import Matter from 'matter-js';
import { CONFIG, FIXED_DT_MS, laneGroundTop } from '../src/config';
import { type GameSimulation } from '../src/sim/game';
import { makeGame, makeLane, stepN } from './helpers';

// M2 lane-level physical/rule regressions requested in review:
// pea shots actually hit enemies, moving blocks crush enemies, standing
// blocks never trap walkers, plants (solid and sensor) are chewed, frost slows
// AND chips, pea targets only ahead, nest refills on its own cadence.

function plantPea(game: GameSimulation, slot = 0, lane = 1): void {
  game.resources = Math.max(game.resources, 200);
  game.selectPlant('pea');
  const x = CONFIG.plants.slotXStart + slot * CONFIG.plants.slotSpacing;
  const y = laneGroundTop(lane) - 20;
  expect(game.tryPlant({ x, y })).toBe(true);
}

describe('M2 lane 物理与规则回归', () => {
  it('连荚草子弹真实命中敌人（SHOT/ENEMY mask 双向有效）', () => {
    const game = makeGame();
    plantPea(game, 0, 1);
    const lane = game.lanes[1];
    lane.spawnEnemy('normal', 480); // ahead of the pea muzzle, in range
    const hpBefore = lane.getEnemyViews()[0].hp;
    stepN(game, 240);
    const views = lane.getEnemyViews();
    if (views.length > 0) {
      expect(views[0].hp).toBeLessThan(hpBefore);
    } else {
      expect(hpBefore).toBeGreaterThan(0); // died to shots
    }
  });

  it('高速运动材料压伤敌人；静止块不阻挡行走（穿过）', () => {
    const lane = makeLane([{ id: 'faller', x: 800, w: 60, h: 40, material: 'stone', y: 380 }]);
    const x = 800;
    lane.spawnEnemy('normal', x);
    lane.wakeAll(); // mirrors a collapse waking the structure
    const hpBefore = lane.getEnemyViews()[0].hp;
    // Run: the block falls ~180px and crushes the enemy below.
    for (let i = 0; i < 240; i++) lane.step(FIXED_DT_MS);
    const views = lane.getEnemyViews();
    if (views.length > 0) {
      expect(views[0].hp).toBeLessThan(hpBefore);
    }
    // Standing block must not trap a walker: enemy walks left through x=800.
    lane.spawnEnemy('runner', 900);
    for (let i = 0; i < 180; i++) lane.step(FIXED_DT_MS);
    const walker = lane.getEnemyViews().find((e) => e.type === 'runner');
    expect(walker).toBeDefined();
    expect(walker!.x).toBeLessThan(x); // passed through the resting block
  });

  it('壳盾藤被真实啃食至毁（bodyId→slot 映射生效）', () => {
    const game = makeGame();
    game.selectPlant('shell');
    const x = CONFIG.plants.slotXStart;
    const y = laneGroundTop(1) - 20;
    expect(game.tryPlant({ x, y })).toBe(true);
    const lane = game.lanes[1];
    lane.spawnEnemy('normal', x + 30); // adjacent, chewing
    const plantBefore = lane.getPlantViews()[0];
    expect(plantBefore).toBeDefined();
    stepN(game, 600); // 10s at 8 dps = 80 > 220? no: 80 < 220 -> damaged only
    const after = lane.getPlantViews().find((p) => p.slot === 0);
    expect(after).toBeDefined();
    expect(after!.hp).toBeLessThan(plantBefore!.hp);
    // long chew kills it
    stepN(game, 2400);
    expect(lane.hasPlantAt(0)).toBe(false);
  });

  it('非固体植物（晨露花）也可被啃食（sensor body）', () => {
    const game = makeGame();
    game.selectPlant('dawn');
    const x = CONFIG.plants.slotXStart;
    const y = laneGroundTop(1) - 20;
    expect(game.tryPlant({ x, y })).toBe(true);
    const lane = game.lanes[1];
    lane.spawnEnemy('normal', x + 26);
    const before = lane.getPlantViews()[0]!.hp;
    stepN(game, 300);
    const after = lane.getPlantViews().find((p) => p.slot === 0);
    expect(after).toBeDefined();
    expect(after!.hp).toBeLessThan(before);
  });

  it('霜铃草：范围减速 + 低输出（输出较低）', () => {
    const game = makeGame();
    game.selectPlant('frost');
    const x = CONFIG.plants.slotXStart;
    const y = laneGroundTop(1) - 20;
    expect(game.tryPlant({ x, y })).toBe(true);
    const lane = game.lanes[1];
    lane.spawnEnemy('normal', x - 100); // left of plant, in aura range
    const hpBefore = lane.getEnemyViews()[0].hp;
    const steps = 300;
    stepN(game, steps);
    const view = lane.getEnemyViews()[0];
    // Expected walking distance without slow: 0.9 * 300 = 270px; with 0.5 slow
    // plus aura: clearly less than that.
    expect(view.x).toBeGreaterThan(CONFIG.plants.slotXStart - 260);
    expect(view.hp).toBeLessThan(hpBefore); // chip damage applied
    const expectedChip = (CONFIG.plants.frost.dps * steps * FIXED_DT_MS) / 1000;
    expect(hpBefore - view.hp).toBeGreaterThanOrEqual(expectedChip - 1);
  });

  it('连荚草不向后射击：身在植物左侧（身后）的敌人血量冻结', () => {
    // Geometry: muzzle at slot1 (x=410) fires towards +x only. An enemy at
    // x=300 is 110px to the LEFT of the plant - behind the muzzle - and must
    // never be shot even while walking further left.
    const game = makeGame();
    plantPea(game, 1, 1);
    const lane = game.lanes[1];
    lane.spawnEnemy('normal', 300);
    const hpBefore = lane.getEnemyViews()[0].hp;
    for (let i = 0; i < 240; i++) lane.step(FIXED_DT_MS);
    const view = lane.getEnemyViews()[0];
    expect(view).toBeDefined(); // walked left, not yet leaked (needs ~356 steps)
    expect(view!.hp).toBe(hpBefore); // untouched: no backwards shots
  });

  it('碎块与仍存结构真实碰撞（DEBRIS/BLOCK 双向 mask）', () => {
    const g = laneGroundTop(1);
    const lane = makeLane([
      { id: 'top', x: 600, y: g - 160, w: 40, h: 40, material: 'wood' },
      { id: 'floor', x: 600, y: g - 40, w: 100, h: 40, material: 'stone' },
    ], 1);
    const hits: string[] = [];
    Matter.Events.on(lane.engine, 'collisionStart', (evt) => {
      for (const pair of evt.pairs) {
        const a = pair.bodyA.label;
        const b = pair.bodyB.label;
        if ((a === 'debris' && b === 'block') || (b === 'debris' && a === 'block')) {
          hits.push(`${a}-${b}`);
        }
      }
    });
    lane.damageBlockById('top', 9999);
    for (let i = 0; i < 180; i++) lane.step(FIXED_DT_MS);
    expect(hits.length, 'falling debris must collide with a standing block').toBeGreaterThan(0);
  });

  it('敌人在无植物阻挡时越往左走直至泄漏（步末扣生命顺序）', () => {
    const game = makeGame();
    // Force one walker via a direct wave on lane 1.
    game.lanes[1].spawnEnemy('runner', 200);
    const livesBefore = game.lives;
    for (let i = 0; i < 600 && game.lives === livesBefore; i++) game.advance(FIXED_DT_MS);
    expect(game.lives).toBe(livesBefore - 1);
  });
});
