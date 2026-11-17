import { FIXED_DT_MS } from '../config';

// Fixed-step simulation clock.
//
// Key discipline: while paused, incoming real time is DROPPED (never accumulated),
// so resuming can never "catch up" by replaying the paused duration. Resume also
// clears any residue, guaranteeing no catch-up on both sides of a pause.
export class SimClock {
  readonly fixedDtMs: number;
  maxStepsPerFrame: number;

  private accumulator = 0;
  private _simTimeMs = 0;
  private _paused = false;
  private _stepsExecuted = 0;

  constructor(
    private readonly stepFn: () => void,
    fixedDtMs: number = FIXED_DT_MS,
    maxStepsPerFrame = 5,
  ) {
    this.fixedDtMs = fixedDtMs;
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  get paused(): boolean {
    return this._paused;
  }

  get simTimeMs(): number {
    return this._simTimeMs;
  }

  get stepsExecuted(): number {
    return this._stepsExecuted;
  }

  pause(): void {
    this._paused = true;
    this.accumulator = 0;
  }

  resume(): void {
    this._paused = false;
    this.accumulator = 0;
  }

  // Returns the number of fixed steps executed for this call.
  advance(realDeltaMs: number): number {
    if (this._paused || realDeltaMs <= 0) return 0;
    this.accumulator += realDeltaMs;
    let steps = 0;
    while (this.accumulator >= this.fixedDtMs && steps < this.maxStepsPerFrame) {
      this.accumulator -= this.fixedDtMs;
      this.stepFn();
      steps++;
      this._stepsExecuted++;
      this._simTimeMs += this.fixedDtMs;
    }
    if (steps >= this.maxStepsPerFrame) {
      // Drop excess debt instead of building an unbounded backlog.
      this.accumulator = 0;
    }
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
    this._simTimeMs = 0;
    this._stepsExecuted = 0;
    this._paused = false;
  }
}
