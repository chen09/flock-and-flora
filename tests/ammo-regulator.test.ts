import { describe, expect, it } from 'vitest';
import { AmmoRegulator } from '../src/sim/ammo';
import { CONFIG } from '../src/config';

// Official shared-ammo rules from PLAN section 2 (2026-11-17 clarification):
// start 2 / max 3 / +1 per 12s battle time / overflow discarded when full /
// pause freezes the cycle / one deduction per valid launch.
// M1 runs the 5-shot trial mode; this regulator is the M2 official baseline.
describe('正式弹药再生规则（PLAN §2 基线，M2 接线）', () => {
  it('初始 2/3，12 秒战斗时间恢复 1 格', () => {
    const r = new AmmoRegulator();
    expect(r.ammo).toBe(CONFIG.officialAmmo.start);
    expect(r.ammo).toBe(2);
    r.advance(11999);
    expect(r.ammo).toBe(2);
    r.advance(1);
    expect(r.ammo).toBe(3); // 2 -> max after exactly 12000ms
  });

  it('0 格时按同一周期恢复', () => {
    const r = new AmmoRegulator();
    expect(r.spend()).toBe(true);
    expect(r.spend()).toBe(true);
    expect(r.spend()).toBe(false); // empty
    r.advance(12000);
    expect(r.ammo).toBe(1);
  });

  it('满格时计时继续、溢出丢弃，不积存隐藏弹药', () => {
    const r = new AmmoRegulator(3, 12000, 3);
    r.advance(12000); // cycle completes at cap -> refill discarded
    expect(r.ammo).toBe(3);
    r.advance(12000);
    r.advance(12000); // many cycles at cap: still exactly 3
    expect(r.ammo).toBe(3);
    // Timer keeps running at cap: after a fresh cycle boundary, a slot opened
    // mid-cycle is filled when that running cycle completes.
    r.advance(11999);
    expect(r.ammo).toBe(3);
    r.spend(); // 3 -> 2
    r.advance(1); // the running cycle completes 1ms later -> refill arrives
    expect(r.ammo).toBe(3);
    // From a fresh boundary (elapsed=0), a full cycle is needed again.
    r.advance(11999);
    expect(r.ammo).toBe(3);
    r.spend();
    r.advance(1); // elapsed was 11999 -> pending cycle completes -> 3
    expect(r.ammo).toBe(3);
  });

  it('时间不推进（暂停/瞄准冻结）则永远不恢复', () => {
    const r = new AmmoRegulator();
    r.spend();
    expect(r.ammo).toBe(1);
    // No advance() calls at all: battle time frozen.
    expect(r.ammo).toBe(1);
    expect(r.msToNextRegen).toBe(12000);
  });

  it('亚帧累积与一次推进等价', () => {
    const whole = new AmmoRegulator();
    const parts = new AmmoRegulator();
    whole.advance(12000);
    for (let i = 0; i < 600; i++) parts.advance(20); // 12s in 20ms chunks
    expect(parts.ammo).toBe(whole.ammo);
    expect(parts.ammo).toBe(3);
  });

  it('固定步长 1000/60 累积 720 步必须完成一个恢复周期（无浮点卡死）', () => {
    const r = new AmmoRegulator();
    for (let i = 0; i < 720; i++) r.advance(1000 / 60); // exactly 12s of fixed steps
    expect(r.ammo).toBe(3);
  });

  it('有效发射扣费一次，空仓拒绝扣费', () => {
    const r = new AmmoRegulator(3, 12000, 1);
    expect(r.spend()).toBe(true);
    expect(r.ammo).toBe(0);
    expect(r.spend()).toBe(false);
    expect(r.ammo).toBe(0);
    expect(r.spend()).toBe(false);
  });

  it('上限参数可配置且初始值被钳制', () => {
    const r = new AmmoRegulator(2, 6000, 5);
    expect(r.ammo).toBe(2); // start clamped to max
    r.advance(6000);
    expect(r.ammo).toBe(2); // already full -> discarded
    r.spend();
    r.advance(6000);
    expect(r.ammo).toBe(2);
  });

  it('reset 恢复初始状态', () => {
    const r = new AmmoRegulator();
    r.spend();
    r.advance(5000);
    r.reset();
    expect(r.ammo).toBe(2);
    expect(r.msToNextRegen).toBe(12000);
  });
});
