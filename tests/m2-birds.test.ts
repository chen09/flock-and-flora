import { describe, expect, it } from 'vitest';
import { FIXED_DT_MS, laneGroundTop } from '../src/config';
import { GameSimulation, M2LevelDef } from '../src/sim/game';
import { makeGame, makeLane, stepN } from './helpers';

// Bird collision regression: real engine collisions only (no manual emit).
// - woodpecker must actually HIT full material blocks (BIRD bit in mask)
// - owlbomb first collision explodes with radial damage
// - frostswallow first collision slows nearby enemies

describe('鸟首次碰撞技能与材料命中回归', () => {
  it('凿木雀真实撞中完整材料块（BIRD mask 回归）', () => {
    const lane = makeLane([{ id: 'plank', x: 600, w: 40, h: 200, material: 'wood' }], 0);
    const hpBefore = lane.getBlockViews()[0].hp;
    lane.launch({ x: 196, y: laneGroundTop(0) - 50 - 26 + 0 }, { x: 20, y: 0 }, 'woodpecker');
    expect(lane.projectile).not.toBeNull();
    for (let i = 0; i < 90 && lane.projectile; i++) lane.step(FIXED_DT_MS);
    const plank = lane.getBlockViews().find((b) => b.id === 'plank');
    // Full-speed impact deals ~76 > wood hp 60: the plank may shatter outright.
    expect(plank === undefined || plank.hp < hpBefore, 'bird must hit the plank').toBe(true);
  });

  it('爆栗鸮首撞爆炸：塔区受损，跨路块不受影响', () => {
    const game = makeGame();
    game.selectBird('owlbomb');
    game.regulator.refill(5); // test fixture: afford the 2-ammo bird
    const lane = game.lanes[1];
    const lane0 = game.lanes[0];
    const slabBefore = lane.getBlockViews().find((b) => b.id === 'slab-l1')!.hp;
    const coreBefore = lane.getBlockViews().find((b) => b.id === 'core-l1')!.hp;
    const lane0LegBefore = lane0.getBlockViews().find((b) => b.id === 'leg-l0-a')!.hp;
    const anchor = lane.slingAnchor();
    expect(game.tryStartAim({ x: anchor.x, y: anchor.y })).toBe(true);
    game.updateAim({ x: 40, y: anchor.y + 50 });
    expect(game.releaseAim().launched).toBe(true);
    stepN(game, 300);
    const slabAfter = lane.getBlockViews().find((b) => b.id === 'slab-l1')?.hp ?? 0;
    const coreAfter = lane.getBlockViews().find((b) => b.id === 'core-l1')!.hp;
    expect(slabAfter, 'slab damaged by explosion').toBeLessThan(slabBefore);
    expect(coreAfter, 'core damaged by explosion').toBeLessThan(coreBefore);
    // Cross-lane isolation: lane 0 structure untouched by a lane 1 blast.
    const lane0LegAfter = lane0.getBlockViews().find((b) => b.id === 'leg-l0-a')!.hp;
    expect(lane0LegAfter).toBe(lane0LegBefore);
  });

  it('凿木雀首撞坐标取鸟当前位置（不声称爆炸半径）：跨路块不受影响', () => {
    // Woodpecker has no radial ability. This test only proves the real
    // birdFirstHit coordinate is the bird's current position, not the ground
    // body midpoint. It deliberately does not claim an explosion radius.
    const game = makeGame();
    const lane = game.lanes[1];
    const firstHit: { x: number; y: number }[] = [];
    game.events.birdFirstHit.on((i) => firstHit.push({ x: i.x, y: i.y }));

    lane.damageBlockById('leg-l1-a', 9999);
    lane.damageBlockById('leg-l1-b', 9999);
    lane.wakeAll();
    stepN(game, 240); // wreckage settles around x=1000..1200

    const leg0Before = game.lanes[0].getBlockViews().find((b) => b.id === 'leg-l0-a')!.hp;
    const anchor = lane.slingAnchor();
    // Find a legal drag whose preview lands on the wreck cluster (x>1000).
    let aim: { x: number; y: number } | null = null;
    for (const pullX of [30, 50, 70, 90, 110, 130, 150]) {
      for (const pullY of [20, 35, 50, 65, 80]) {
        const cand = { x: anchor.x - pullX, y: anchor.y + pullY };
        if (cand.y > 630) continue;
        game.tryStartAim({ x: anchor.x, y: anchor.y });
        game.updateAim(cand);
        const plan = game.currentAimLaunch();
        if (!plan || !plan.strongEnough) {
          game.cancelAim('manual');
          continue;
        }
        const traj = lane.previewTrajectory(plan.spawn, plan.velocity);
        game.cancelAim('manual');
        if (traj.hit && traj.hit.x >= 1000 && traj.hit.x <= 1220) {
          aim = cand;
          break;
        }
      }
      if (aim) break;
    }
    expect(aim, 'found a legal lob onto the wreck cluster').not.toBeNull();

    expect(game.tryStartAim({ x: anchor.x, y: anchor.y })).toBe(true);
    game.updateAim(aim!);
    expect(game.releaseAim().launched).toBe(true);
    stepN(game, 300);

    expect(firstHit.length).toBeGreaterThanOrEqual(1);
    const hit = firstHit[0];
    // Center must be near the crash site (>960) and NOT the ground mid-point.
    expect(hit.x).toBeGreaterThan(960);
    expect(Math.abs(hit.x - 720)).toBeGreaterThan(40);

    // Cross-lane control: lane 0 untouched by a lane 1 explosion.
    const leg0After = game.lanes[0].getBlockViews().find((b) => b.id === 'leg-l0-a')!.hp;
    expect(leg0After).toBe(leg0Before);
  });

  it('爆栗鸮首撞爆炸：邻近非直接受击块受损，同路范围外块不受损', () => {
    const g = laneGroundTop(0);
    const blocks = [
      { id: 'hit', x: 600, y: g - 40, w: 40, h: 80, material: 'wood' as const },
      { id: 'near', x: 660, y: g - 40, w: 40, h: 80, material: 'stone' as const },
      { id: 'far', x: 850, y: g - 40, w: 40, h: 80, material: 'stone' as const },
    ];
    const level: M2LevelDef = {
      lanes: [{ laneIndex: 0, sling: { x: 170, y: g - 50 }, blocks, targets: [] }],
      baseWaves: [], reinforcements: [], startResources: 100, lives: 3,
    };
    const game = new GameSimulation(level);
    game.selectBird('owlbomb');
    const lane = game.lanes[0];
    const firstHit: { x: number; y: number }[] = [];
    game.events.birdFirstHit.on((i) => firstHit.push({ x: i.x, y: i.y }));
    const anchor = lane.slingAnchor();
    let aim: { x: number; y: number } | null = null;
    for (const pullX of [30, 50, 70, 90, 110, 130, 150]) {
      for (const pullY of [20, 35, 50, 65, 80]) {
        const cand = { x: anchor.x - pullX, y: anchor.y + pullY };
        if (cand.y > g) continue;
        game.tryStartAim({ x: anchor.x, y: anchor.y });
        game.updateAim(cand);
        const plan = game.currentAimLaunch();
        if (!plan || !plan.strongEnough) { game.cancelAim('manual'); continue; }
        const traj = lane.previewTrajectory(plan.spawn, plan.velocity);
        game.cancelAim('manual');
        if (traj.hit && traj.hit.x >= 540 && traj.hit.x <= 660) { aim = cand; break; }
      }
      if (aim) break;
    }
    expect(aim, 'legal aim onto the first block').not.toBeNull();
    const nearBefore = lane.getBlockViews().find((b) => b.id === 'near')!.hp;
    const farBefore = lane.getBlockViews().find((b) => b.id === 'far')!.hp;
    expect(game.tryStartAim({ x: anchor.x, y: anchor.y })).toBe(true);
    game.updateAim(aim!);
    expect(game.releaseAim().launched).toBe(true);
    for (let i = 0; i < 300 && firstHit.length === 0; i++) game.advance(FIXED_DT_MS);
    expect(firstHit.length).toBe(1);
    expect(firstHit[0].x).toBeGreaterThan(540);
    expect(firstHit[0].x).toBeLessThan(680);
    const nearAfter = lane.getBlockViews().find((b) => b.id === 'near')?.hp ?? 0;
    const farAfter = lane.getBlockViews().find((b) => b.id === 'far')?.hp ?? 0;
    expect(nearAfter, 'nearby non-direct block damaged by owl blast').toBeLessThan(nearBefore);
    expect(farAfter, 'outside-radius block untouched').toBe(farBefore);
  });

  it('霜翎燕首撞减速场：近处敌人被标记减速，远处敌人不受影响', () => {
    const game = makeGame();
    game.selectBird('frostswallow');
    const lane = game.lanes[1];
    lane.spawnEnemy('normal', 620);
    lane.spawnEnemy('normal', 700);
    lane.spawnEnemy('normal', 1000); // far outside the 140-radius field
    const anchor = lane.slingAnchor();
    expect(game.tryStartAim({ x: anchor.x, y: anchor.y })).toBe(true);
    game.updateAim({ x: 75, y: 571 }); // lob landing around x~650
    expect(game.releaseAim().launched).toBe(true);
    let sawFlying = false;
    for (let i = 0; i < 400 && game.phase === 'running'; i++) {
      game.advance(FIXED_DT_MS);
      if (game.lanes[1].projectile) sawFlying = true;
      const slowed = lane.getEnemyViews().filter((e) => e.slowed);
      if (sawFlying && slowed.length >= 1) break; // ability fired on impact
    }
    expect(sawFlying).toBe(true);
    const slowed = lane.getEnemyViews().filter((e) => e.slowed);
    expect(slowed.length).toBeGreaterThanOrEqual(1);
    expect(slowed.every((e) => e.x < 900), 'frost field stays local').toBe(true);
  });
});
