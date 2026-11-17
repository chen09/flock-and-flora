import { describe, expect, it } from 'vitest';
import { FIXED_DT_MS, laneGroundTop } from '../src/config';
import { buildLevelM2 } from '../src/sim/levelM2';
import { makeGame } from './helpers';

// Isolation regression for the shared-array pollution found in review
// (M2_PRECHECK finding 1): buildLevelM2 must return per-call deep copies,
// including nested wave entries. NOTE: the base trial waves legitimately
// contain armor entries, so "contains armor" is expected; aliasing is checked
// by full-snapshot equality against an untouched baseline instead.

describe('关卡构建隔离（共享数组污染回归）', () => {
  it('两次构建返回不同数组与不同条目对象，且数据与基线完全一致', () => {
    const baseline = {
      waves: JSON.parse(JSON.stringify(buildLevelM2().baseWaves)),
      reinforcements: JSON.parse(JSON.stringify(buildLevelM2().reinforcements)),
    };
    const a = buildLevelM2();
    const b = buildLevelM2();
    expect(a.baseWaves).not.toBe(b.baseWaves);
    expect(a.reinforcements).not.toBe(b.reinforcements);
    expect(a.baseWaves[0]).not.toBe(b.baseWaves[0]);
    expect(a.lanes[0].blocks[0]).not.toBe(b.lanes[0].blocks[0]);
    // Content must equal the untouched baseline exactly.
    expect(JSON.stringify(a.baseWaves)).toBe(JSON.stringify(baseline.waves));
    expect(JSON.stringify(a.reinforcements)).toBe(JSON.stringify(baseline.reinforcements));
  });

  it('场景构建器的 push/mutation 不泄漏到后续构建（完整快照比较）', () => {
    const polluted = buildLevelM2();
    // Snapshot the untouched baseline BEFORE any mutation.
    const baseline = {
      waves: JSON.parse(JSON.stringify(polluted.baseWaves)),
      reinforcements: JSON.parse(JSON.stringify(polluted.reinforcements)),
    };
    // Exact injection: one schedule entry, count=24 (24 units, NOT 24 entries).
    const injection = { atMs: 100_000, lane: 0, type: 'armor' as const, count: 24 };
    polluted.baseWaves.push({ ...injection });
    polluted.reinforcements.push({ ...injection, towerLane: 0 });
    polluted.baseWaves[0].count = 99;

    const fresh = buildLevelM2();
    // Fresh must equal the untouched baseline EXACTLY - the injected entry
    // (atMs 100000 / lane 0 / armor / count 24) must not exist in it.
    expect(JSON.stringify(fresh.baseWaves)).toBe(JSON.stringify(baseline.waves));
    expect(JSON.stringify(fresh.reinforcements)).toBe(JSON.stringify(baseline.reinforcements));
    expect(
      fresh.baseWaves.some((w) => w.atMs === 100000 && w.type === 'armor' && w.count === 24),
    ).toBe(false);
  });

  // Ported from the auxiliary independent probe
  // (review/evidence/m2-independent-cac427bb/probes.ts dueTickProbe; the
  // auxiliary already ran it successfully - this is the same minimal fixture
  // living in our suite, NOT a second independent verification). Fixture bird
  // = test input (lane.launch), explicitly not the player drag path.
  // Semantics proven: a reinforcement due at tick-start spawns BEFORE a tower
  // core destroyed later in the SAME advance, and is never retroactively
  // cancelled. Rescued from my inaccurate earlier attempt (review noted).
  it('步首到期援军与同 advance 真实碰撞毁塔：先生成、不追溯取消（移植辅助 probe）', () => {
    const g = laneGroundTop(0);
    const game = makeGame();
    game.level.lanes[0] = {
      laneIndex: 0,
      sling: { x: 170, y: g - 50 },
      coreId: 'core',
      blocks: [{ id: 'core', x: 220, y: g - 40, w: 60, h: 64, material: 'crystal' }],
    };
    game.level.baseWaves = [];
    game.level.reinforcements = [
      { atMs: 0, lane: 0, type: 'normal', count: 1, towerLane: 0 },
    ];
    game.restart();
    let towerDowns = 0;
    game.events.towerDown.on(() => towerDowns++);
    expect(game.lanes[0].launch({ x: 196, y: g - 40 }, { x: 20, y: 0 }, 'woodpecker')).toBe(true);
    let spawnStep = -1;
    let towerStep = -1;
    for (let i = 0; i < 8; i++) {
      const beforeDown = towerDowns;
      game.advance(FIXED_DT_MS);
      const p = game.pendingSpawns()[0];
      if (spawnStep < 0 && p.done) spawnStep = i + 1;
      if (towerStep < 0 && towerDowns > beforeDown) towerStep = i + 1;
    }
    expect(spawnStep).toBe(1);
    expect(towerStep).toBe(1);
    const pending = game.pendingSpawns().map((x) => ({ done: x.done, cancelled: x.cancelled }));
    expect(pending[0].done).toBe(true);
    expect(pending[0].cancelled).toBe(false); // spawned units are NOT recalled
    expect(game.stats.reinforcementsCancelled).toBe(0);
    expect(game.lanes[0].enemiesAlive()).toBe(1);
    expect(towerDowns).toBe(1);
  });
});
