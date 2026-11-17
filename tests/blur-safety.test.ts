import { describe, expect, it } from 'vitest';
import { FIXED_DT_MS } from '../src/config';
import { grabPoint, makeGame, stepN, strongAimPoint } from './helpers';

describe('页面失焦与暂停安全（M2）', () => {
  const GRAB = grabPoint();
  const STRONG_AIM = strongAimPoint();

  it('瞄准中失焦：取消瞄准并自动暂停，不扣弹药', () => {
    const g = makeGame();
    expect(g.tryStartAim(GRAB)).toBe(true);
    g.updateAim(STRONG_AIM);
    g.onWindowBlur();
    expect(g.aimActive).toBe(false);
    expect(g.phase).toBe('paused');
    expect(g.regulator.ammo).toBe(CONFIG_AMMO_START);
    expect(g.advance(1000)).toBe(0);
    g.togglePause();
    expect(g.phase).toBe('running');
    expect(g.advance(FIXED_DT_MS)).toBe(1);
    expect(g.lanes[1].simTimeMs).toBeCloseTo(FIXED_DT_MS, 6);
  });

  it('运行中失焦自动暂停；恢复后不追赶', () => {
    const g = makeGame();
    stepN(g, 120);
    const t = g.lanes[1].simTimeMs;
    g.onWindowBlur();
    expect(g.phase).toBe('paused');
    stepN(g, 300);
    expect(g.lanes[1].simTimeMs).toBe(t);
    g.togglePause();
    expect(g.phase).toBe('running');
    stepN(g, 1);
    expect(g.lanes[1].simTimeMs).toBeCloseTo(t + FIXED_DT_MS, 6);
  });

  it('暂停按钮在瞄准中先取消再暂停；暂停态禁瞄准/种植', () => {
    const g = makeGame();
    expect(g.tryStartAim(GRAB)).toBe(true);
    g.togglePause();
    expect(g.aimActive).toBe(false);
    expect(g.phase).toBe('paused');
    g.selectPlant('pea');
    expect(g.selectedPlant).toBeNull(); // selection blocked while paused
    g.togglePause();
    expect(g.phase).toBe('running');
    g.selectPlant('pea');
    expect(g.selectedPlant).toBe('pea');
    g.cancelAim('manual');
  });

  it('暂停状态下不能开始瞄准', () => {
    const g = makeGame();
    g.togglePause();
    expect(g.tryStartAim(GRAB)).toBe(false);
    g.togglePause();
    expect(g.phase).toBe('running');
  });
});

const CONFIG_AMMO_START = 2;
