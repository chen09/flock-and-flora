import { describe, expect, it } from 'vitest';
import { FIXED_DT_MS } from '../src/config';
import { SimClock } from '../src/sim/clock';

describe('SimClock 固定步长与暂停纪律', () => {
  it('60Hz 实时推进 1 秒恰好执行 60 个固定步', () => {
    let calls = 0;
    const clock = new SimClock(
      () => {
        calls++;
      },
      FIXED_DT_MS,
      1000,
    );
    for (let i = 0; i < 60; i++) clock.advance(FIXED_DT_MS);
    expect(clock.stepsExecuted).toBe(60);
    expect(clock.simTimeMs).toBeCloseTo(60 * FIXED_DT_MS, 6);
    expect(calls).toBe(60);
  });

  it('暂停期间不积累实时时间，恢复后不追赶', () => {
    let calls = 0;
    const clock = new SimClock(
      () => {
        calls++;
      },
      FIXED_DT_MS,
      1000,
    );
    clock.advance(1000);
    expect(clock.stepsExecuted).toBe(60);
    clock.pause();
    // Long paused stretch: real time is dropped, never banked.
    expect(clock.advance(60_000)).toBe(0);
    expect(clock.advance(60_000)).toBe(0);
    clock.resume();
    // After resume only freshly arriving time counts: no catch-up burst.
    expect(clock.advance(1000)).toBe(60);
    expect(clock.stepsExecuted).toBe(120);
    expect(clock.simTimeMs).toBeCloseTo(120 * FIXED_DT_MS, 6);
    expect(calls).toBe(120);
  });

  it('恢复后第一次 advance 只按新到的实时时间推进', () => {
    const clock = new SimClock(() => undefined);
    clock.pause();
    clock.advance(5000);
    clock.advance(5000);
    clock.resume();
    expect(clock.advance(FIXED_DT_MS)).toBe(1);
    expect(clock.simTimeMs).toBeCloseTo(FIXED_DT_MS, 6);
  });

  it('亚帧残差保留；超过每帧步数上限时丢弃积压', () => {
    const clock = new SimClock(() => undefined);
    clock.maxStepsPerFrame = 2;
    expect(clock.advance(8)).toBe(0);
    expect(clock.advance(9)).toBe(1);
    expect(clock.advance(200)).toBe(2);
    expect(clock.advance(1)).toBe(0);
  });
});
