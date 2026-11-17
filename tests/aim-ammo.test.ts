import { describe, expect, it } from 'vitest';
import { CONFIG, FIXED_DT_MS } from '../src/config';
import { BIRDS } from '../src/sim/entities';
import { grabPoint, makeGame, stepN, strongAimPoint, weakAimPoint } from './helpers';

// M2 semantics of the M1 aim/ammo contract: official ammo (start 2 / max 3),
// bird ammo cost, aiming freezes everything, cancel never deducts, valid
// launch deducts exactly once, one active bird globally.

describe('瞄准冻结与弹药扣费（M2 正式弹药）', () => {
  const GRAB = grabPoint();
  const STRONG_AIM = strongAimPoint();
  const WEAK_AIM = weakAimPoint();

  it('瞄准期间全部战斗冻结（零步推进、物体零位移、波次不走）', () => {
    const g = makeGame();
    expect(g.tryStartAim(GRAB)).toBe(true);
    expect(g.phase).toBe('aiming');
    const before = g.lanes.map((l) => l.blockSnapshot());
    const simTime = g.lanes[1].simTimeMs;
    stepN(g, 300);
    expect(g.lanes[1].simTimeMs).toBe(simTime);
    g.lanes.forEach((l, i) => expect(l.blockSnapshot()).toEqual(before[i]));
    expect(g.regulator.ammo).toBe(CONFIG.officialAmmo.start);
  });

  it('取消瞄准不扣弹药，恢复后不追赶时间', () => {
    const g = makeGame();
    g.tryStartAim(GRAB);
    g.advance(3000);
    expect(g.lanes[1].simTimeMs).toBe(0);
    expect(g.cancelAim('manual')).toBe(true);
    expect(g.regulator.ammo).toBe(CONFIG.officialAmmo.start);
    expect(g.phase).toBe('running');
    expect(g.advance(FIXED_DT_MS)).toBe(1);
    expect(g.lanes[1].simTimeMs).toBeCloseTo(FIXED_DT_MS, 6);
  });

  it('拖拽力度不足按取消处理，不扣弹药', () => {
    const g = makeGame();
    g.tryStartAim(GRAB);
    g.updateAim(WEAK_AIM);
    expect(g.releaseAim().launched).toBe(false);
    expect(g.regulator.ammo).toBe(CONFIG.officialAmmo.start);
    expect(g.phase).toBe('running');
  });

  it('有效发射恰好扣一次弹药（凿木雀 1 弹）', () => {
    const g = makeGame();
    const launches: number[] = [];
    g.events.launched.on((i) => launches.push(i.ammoLeft));
    g.tryStartAim(GRAB);
    g.updateAim(STRONG_AIM);
    expect(g.releaseAim().launched).toBe(true);
    expect(g.regulator.ammo).toBe(CONFIG.officialAmmo.start - BIRDS.woodpecker.ammoCost);
    expect(launches).toEqual([CONFIG.officialAmmo.start - 1]);
    expect(g.releaseAim().launched).toBe(false);
    expect(launches).toHaveLength(1);
  });

  it('爆栗鸮一次扣 2 弹（原子扣费）', () => {
    const g = makeGame();
    g.selectBird('owlbomb');
    g.tryStartAim(GRAB);
    g.updateAim(STRONG_AIM);
    expect(g.releaseAim().launched).toBe(true);
    expect(g.regulator.ammo).toBe(CONFIG.officialAmmo.start - BIRDS.owlbomb.ammoCost);
  });

  it('弹药不足的鸟无法发射', () => {
    const g = makeGame();
    g.selectBird('owlbomb'); // costs 2; start = 2
    g.tryStartAim(GRAB);
    g.updateAim(STRONG_AIM);
    expect(g.releaseAim().launched).toBe(true); // ammo 0
    stepN(g, 1200);
    expect(g.tryStartAim(GRAB)).toBe(false); // 0 < 2
    expect(g.phase).toBe('running');
  });

  it('飞行结束前全球不能再次瞄准（跨路约束）', () => {
    const g = makeGame();
    expect(g.fireWithVelocity(1, 10, -6)).toBe(true);
    expect(g.tryStartAim(GRAB)).toBe(false);
    expect(g.fireWithVelocity(2, 10, -6)).toBe(false);
    stepN(g, 1400);
    expect(g.tryStartAim(GRAB)).toBe(true);
    g.cancelAim('manual');
  });

  it('瞄准起点不在任一路弹弓附近被拒绝', () => {
    const g = makeGame();
    expect(g.tryStartAim({ x: 800, y: 300 })).toBe(false);
    expect(g.phase).toBe('running');
  });
});
