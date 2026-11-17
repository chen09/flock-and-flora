import { CONFIG } from '../config';

// Official shared-ammo economy from PLAN section 2 (2026-11-17 clarification):
// start 2, max 3, +1 per 12s of BATTLE time. When full, the regen timer keeps
// running and any refill that would exceed the cap is discarded (no hidden
// stockpile). Pausing/aiming freezes battle time, which freezes this timer.
//
// M1 runs the clearly-labelled 5-shot trial mode instead; M2 wires this
// regulator into GameSimulation for the official baseline (PLAN section 6).
export class AmmoRegulator {
  readonly max: number;
  readonly regenIntervalMs: number;
  private value: number;
  private elapsed = 0;

  constructor(
    max: number = CONFIG.officialAmmo.max,
    regenIntervalMs: number = CONFIG.officialAmmo.regenIntervalMs,
    start: number = CONFIG.officialAmmo.start,
  ) {
    this.max = max;
    this.regenIntervalMs = regenIntervalMs;
    this.value = Math.min(start, max);
  }

  get ammo(): number {
    return this.value;
  }

  // Battle-time advance only (never called while paused/aiming).
  advance(dtMs: number): void {
    if (dtMs <= 0) return;
    this.elapsed += dtMs;
    // Epsilon guards against floating-point drift when the caller feeds many
    // fixed steps of 1000/60 ms (720 steps sum to 11999.999... instead of 12000).
    const EPS = 1e-6;
    while (this.elapsed + EPS >= this.regenIntervalMs) {
      this.elapsed -= this.regenIntervalMs;
      if (this.value < this.max) {
        this.value += 1;
      }
      // At cap: the cycle completed but the refill overflows and is discarded;
      // the next cycle starts fresh from now.
    }
  }

  // Spend exactly one ammo on a valid launch.
  spend(n: number = 1): boolean {
    if (this.value < n) return false;
    this.value -= n;
    return true;
  }

  // Nest-tree refill: overflow above the cap is silently discarded (PLAN rule).
  refill(amount: number = 1): void {
    this.value = Math.min(this.max, this.value + amount);
  }

  // Roll back a deduction when the paired launch could not happen.
  refund(n: number = 1): void {
    this.value = Math.min(this.max, this.value + n);
  }

  // Milliseconds until the next regen cycle completes (cycle restarts on refill,
  // whether or not the refill was kept).
  get msToNextRegen(): number {
    return this.regenIntervalMs - this.elapsed;
  }

  reset(): void {
    this.value = Math.min(CONFIG.officialAmmo.start, this.max);
    this.elapsed = 0;
  }
}
