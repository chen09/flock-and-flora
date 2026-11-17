import { describe, expect, it } from 'vitest';
import { CONFIG, FIXED_DT_MS } from '../src/config';
import { makeGame, makeTrialGame, stepN } from './helpers';

// M2 victory/defeat settlement: leak costs a life; defeat checked BEFORE
// victory at step end; both settle exactly once.

describe('M2 胜负结算', () => {
  it('敌人泄漏扣生命；3 次泄漏判负且只结算一次', () => {
    const g = makeTrialGame();
    let lostCount = 0;
    g.events.lost.on(() => lostCount++);
    // Spawn 3 runners already at the left edge region; they leak quickly.
    for (let i = 0; i < 3; i++) g.lanes[1].spawnEnemy('runner', 160 + i * 60);
    for (let i = 0; i < 3600 && g.phase === 'running'; i++) g.advance(FIXED_DT_MS);
    expect(g.phase).toBe('lost');
    expect(lostCount).toBe(1);
    expect(g.lives).toBeLessThanOrEqual(0);
    stepN(g, 300);
    expect(lostCount).toBe(1);
    expect(g.advance(16.7)).toBe(0);
  });

  it('全部波次完成且清场即胜利，只结算一次', () => {
    const g = makeGame();
    // One wave, one normal worm: kill it with legal shots (woodpecker, 1 ammo).
    g.level.baseWaves.push({ atMs: 1000, lane: 1, type: 'normal', count: 1 });
    // Restart to register the wave through the level definition path.
    g.restart();
    g.level.baseWaves.pop(); // keep the level object clean for later tests
    // Fire legal shots at the enemy once it spawns.
    let kills = 0;
    g.events.enemyKilled.on(() => kills++);
    let wonCount = 0;
    g.events.won.on(() => wonCount++);
    let shots = 0;
    for (let i = 0; i < 4000 && g.phase === 'running'; i++) {
      g.advance(FIXED_DT_MS);
      const lane = g.lanes[1];
      const alive = lane.enemiesAlive();
      const nearest = Math.min(...lane.getEnemyViews().map((e) => e.x), Infinity);
      if (alive > 0 && !lane.projectile && shots < 5 && nearest < 760) {
        if (g.fireWithVelocity(1, 18, -2)) shots++;
      }
      if (kills >= 1) break;
    }
    expect(kills).toBe(1);
    stepN(g, 400);
    expect(g.phase).toBe('won');
    expect(wonCount).toBe(1);
    stepN(g, 300);
    expect(wonCount).toBe(1);
    expect(g.advance(16.7)).toBe(0);
    void CONFIG;
  });

  it('失败与胜利同刻竞态：优先判负', () => {
    const g = makeGame();
    // lives = 1 via two direct leaks, then the last walker leaks on the same
    // step where the field is otherwise clear -> lost must win the race.
    g.lives = 1;
    g.lanes[1].spawnEnemy('runner', 100);
    for (let i = 0; i < 1200 && g.phase === 'running'; i++) g.advance(FIXED_DT_MS);
    expect(g.phase).toBe('lost');
  });
});
