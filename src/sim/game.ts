import { CONFIG, FIXED_DT_MS, laneBandTop, laneBottomY, laneGroundTop } from '../config';
import { AmmoRegulator } from './ammo';
import { SimClock } from './clock';
import {
  BIRDS,
  PLANTS,
  type BirdId,
  type EnemyId,
  type PlantId,
} from './entities';
import { AimCancelReason, Phase, SimEvents, Vec } from './events';
import { LaneLevelDef, LaneSimulation } from './lane';

const SLOT_XS = Array.from(
  { length: CONFIG.plants.slotsPerLane },
  (_, i) => CONFIG.plants.slotXStart + i * CONFIG.plants.slotSpacing,
);

function geometryFor(laneIndex: number) {
  return {
    bandTop: laneBandTop(laneIndex),
    groundTop: laneGroundTop(laneIndex),
    laneBottom: laneBottomY(laneIndex),
  };
}

export type { Phase };

export interface LogEntry {
  tMs: number;
  type: string;
  detail?: string;
}

export interface AimLaunchPlan {
  laneIndex: number;
  spawn: Vec;
  velocity: Vec;
  strongEnough: boolean;
}

export interface WaveSpawn {
  atMs: number;
  lane: number;
  type: EnemyId;
  count?: number;
}

export interface ReinforceSpawn extends WaveSpawn {
  towerLane: number; // cancelled while that lane's tower is already down
}

export interface M2LevelDef {
  lanes: LaneLevelDef[]; // 3 entries; laneIndex must match array position
  baseWaves: WaveSpawn[];
  reinforcements: ReinforceSpawn[];
  startResources: number;
  lives: number;
  availableBirds?: BirdId[];
  availablePlants?: PlantId[];
  presetPlants?: { lane: number; slot: number; plant: PlantId }[];
  // Phase 2 may start when supports break OR on the advertised deployment
  // deadline. Neither phase nor core destruction is a victory requirement.
  nestCar?: { lane: number; parts: string[]; advanceAtMs: number };
}

interface PendingSpawn {
  atMs: number;
  lane: number;
  type: EnemyId;
  count: number;
  towerLane: number | null;
  done: boolean;
  cancelled: boolean;
}

// Top-level M2 rules: three independent lane worlds, shared resources/ammo/
// lives, planting/removal, bird selection, wave scheduling, victory/defeat.
// The presentation layer never mutates rule state directly; strategies drive
// the same legal APIs a player uses.
export class GameSimulation {
  readonly events = new SimEvents();
  readonly level: M2LevelDef;
  lanes: LaneSimulation[];
  clock: SimClock;
  regulator: AmmoRegulator;
  resources: number;
  lives: number;
  phase: Phase = 'running';
  selectedBird: BirdId = 'woodpecker';
  selectedPlant: PlantId | null = null;
  removeMode = false;
  aimActive = false;
  aimLaneIndex = -1;
  aimPoint: Vec = { x: 0, y: 0 };

  nestCarPhase = 0;

  // strategy/replay statistics
  stats = {
    launched: 0,
    aimCancels: 0,
    leaks: 0,
    kills: 0,
    towersDown: 0,
    reinforcementsCancelled: 0,
    nestRefills: 0,
    nestCarPartsBroken: 0,
    plantsPlanted: 0,
    plantsRemoved: 0,
    resourcesSpent: 0,
  };

  private plantReadyAtMs: Record<PlantId, number>;
  private nestCount = 0;
  private pending: PendingSpawn[] = [];
  private incomeAcc = 0;
  private log: LogEntry[] = [];
  private unsubs: Array<() => void> = [];
  private readonly slotXs: number[];

  constructor(level: M2LevelDef) {
    if ((level.presetPlants ?? []).filter((p) => p.plant === 'nest').length > CONFIG.plants.nest.maxPerRun) {
      throw new Error('Preset nest count exceeds the shared limit');
    }
    this.level = level;
    this.lanes = level.lanes.map((l) => new LaneSimulation(l.laneIndex, geometryFor(l.laneIndex), l, this.events, SLOT_XS));
    this.regulator = new AmmoRegulator();
    this.resources = level.startResources;
    this.lives = level.lives;
    this.slotXs = SLOT_XS;
    const ready = {} as Record<PlantId, number>;
    for (const id of Object.keys(PLANTS) as PlantId[]) ready[id] = 0;
    this.plantReadyAtMs = ready;
    this.pending = [
      ...level.baseWaves.map((w) => ({ ...w, count: w.count ?? 1, towerLane: null, done: false, cancelled: false })),
      ...level.reinforcements.map((w) => ({ ...w, count: w.count ?? 1, towerLane: w.towerLane, done: false, cancelled: false })),
    ].sort((a, b) => a.atMs - b.atMs);

    this.clock = new SimClock(() => this.simStep(), FIXED_DT_MS, CONFIG.clock.maxStepsPerFrame);
    const e = this.events;
    this.unsubs.push(
      e.enemyLeaked.on((i) => {
        this.stats.leaks++;
        this.lives -= 1;
        this.events.livesChanged.emit({ value: this.lives });
        this.addLog('leak', `lane=${i.laneIndex} lives=${this.lives}`);
      }),
      e.blockDestroyed.on((i) => {
        const car = this.level.nestCar;
        if (car && car.lane === i.laneIndex && car.parts.includes(i.blockId)) {
          this.stats.nestCarPartsBroken++;
        }
      }),
      e.enemyKilled.on(() => {
        this.stats.kills++;
      }),
      e.towerDown.on((i) => {
        this.stats.towersDown++;
        // Immediately cancel every NOT-yet-spawned future reinforcement of
        // this tower. Entries already done this tick stay untouched; base
        // waves are never touched. This lets victory settle without waiting
        // for far-future spawn times of cancelled entries.
        for (const p of this.pending) {
          if (!p.done && !p.cancelled && p.towerLane === i.laneIndex) {
            p.cancelled = true;
            this.stats.reinforcementsCancelled++;
          }
        }
        this.addLog('towerDown', `lane=${i.laneIndex}`);
      }),
      e.plantRemoved.on((i) => {
        if (i.plantId === 'nest') {
          // Removal (manual or munched) frees the run-wide nest limit.
          this.nestCount = Math.max(0, this.nestCount - 1);
        }
      }),
      e.resourceProduced.on((i) => {
        this.resources += i.amount;
        this.events.resourcesChanged.emit({ value: this.resources });
      }),
      e.ammoRefilled.on(() => {
        this.regulator.refill(1);
        this.stats.nestRefills++;
        this.events.ammoChanged.emit({ value: this.regulator.ammo });
        this.addLog('nestRefill');
      }),
      e.projectileRetired.on(() => this.addLog('birdRetired')),
      e.birdFirstHit.on((i) => {
        // First-collision abilities (PLAN section 2). Fired from the real
        // collisionStart event; no manual emit paths exist.
        const lane = this.lanes[i.laneIndex];
        if (i.birdType === 'owlbomb') {
          lane.explodeAt(i.x, i.y, 120, 55);
          this.addLog('owlBomb', `lane=${i.laneIndex}`);
        } else if (i.birdType === 'frostswallow') {
          lane.frostAt(i.x, i.y, 140, 4000);
          this.addLog('frostField', `lane=${i.laneIndex}`);
        }
      }),
    );
    this.initializeCampaign();
  }

  private initializeCampaign(): void {
    this.nestCarPhase = this.level.nestCar ? 1 : 0;
    this.selectedBird = this.level.availableBirds?.[0] ?? 'woodpecker';
    for (const p of this.level.presetPlants ?? []) {
      if (this.lanes[p.lane]?.plantAt(p.slot, p.plant) && p.plant === 'nest') this.nestCount++;
    }
  }

  isBirdAvailable(id: BirdId): boolean {
    return !this.level.availableBirds || this.level.availableBirds.includes(id);
  }

  isPlantAvailable(id: PlantId): boolean {
    return !this.level.availablePlants || this.level.availablePlants.includes(id);
  }

  laneAtPoint(p: Vec): number {
    for (let i = 0; i < this.lanes.length; i++) {
      const geo = this.lanes[i].geo;
      if (p.y >= geo.bandTop && p.y < geo.laneBottom) return i;
    }
    return -1;
  }

  // ---------- time ----------

  private simStep(): void {
    if (this.phase !== 'running') return;
    // Official ammo clock runs on battle time only (frozen while paused/aiming
    // because simStep is never called in those phases).
    this.regulator.advance(FIXED_DT_MS);
    // Step START: spawns due now execute (a tower that dies later in this step
    // cannot recall reinforcements that already entered the world).
    this.processSpawns();
    for (const lane of this.lanes) lane.step(FIXED_DT_MS);
    const car = this.level.nestCar;
    if (car && this.nestCarPhase === 1) {
      const remaining = new Set(this.lanes[car.lane].getBlockViews().map((b) => b.id));
      if (car.parts.every((id) => !remaining.has(id)) || this.lanes[0].simTimeMs >= car.advanceAtMs) {
        this.nestCarPhase = 2;
        this.addLog('nestCarPhase', '2');
      }
    }
    // Economy trickle (fractional accumulation, displayed floored).
    this.incomeAcc += (CONFIG.economy.baseIncomePerSecond * FIXED_DT_MS) / 1000;
    if (this.incomeAcc >= 1) {
      const whole = Math.floor(this.incomeAcc);
      this.incomeAcc -= whole;
      this.resources += whole;
      this.events.resourcesChanged.emit({ value: this.resources });
    }
    // Step END: defeat first, then victory (same-moment disambiguation).
    if (this.lives <= 0) {
      this.setPhase('lost');
      this.events.lost.emit(undefined);
      this.addLog('lost');
      return;
    }
    // Victory only applies when a schedule exists at all (empty-wave sandbox
    // levels never "win", so structural tests keep running).
    if (this.pending.length > 0 && this.pending.every((p) => p.done || p.cancelled)) {
      const alive = this.lanes.reduce((s, l) => s + l.enemiesAlive(), 0);
      if (alive === 0) {
        this.setPhase('won');
        this.events.won.emit(undefined);
        this.addLog('won');
      }
    }
  }

  private processSpawns(): void {
    for (const p of this.pending) {
      if (p.done || p.cancelled || p.atMs > this.lanes[0].simTimeMs) continue;
      if (p.towerLane !== null && !this.lanes[p.towerLane].towerAlive) {
        p.cancelled = true;
        this.addLog('reinforceCancelled', `towerLane=${p.towerLane}`);
        continue;
      }
      p.done = true;
      const lane = this.lanes[p.lane];
      for (let k = 0; k < p.count; k++) {
        lane.spawnEnemy(p.type, CONFIG.enemies.spawnX + k * 34);
      }
      this.addLog('spawn', `lane=${p.lane} ${p.type} x${p.count}`);
    }
  }

  advance(realDeltaMs: number): number {
    if (this.phase !== 'running') return 0;
    return this.clock.advance(realDeltaMs);
  }

  stepFixed(steps: number): void {
    for (let i = 0; i < steps; i++) this.advance(FIXED_DT_MS);
  }

  // ---------- aiming / launching ----------

  tryStartAim(point: Vec): boolean {
    const laneIndex = this.laneAtPoint(point);
    if (laneIndex < 0) return false;
    const lane = this.lanes[laneIndex];
    if (this.phase !== 'running') return false;
    if (this.regulator.ammo < BIRDS[this.selectedBird].ammoCost) return false;
    if (this.lanes.some((l) => l.projectile)) return false; // one active bird globally
    const anchor = lane.slingAnchor();
    if (Math.hypot(point.x - anchor.x, point.y - anchor.y) > CONFIG.sling.grabRadius) return false;
    this.aimActive = true;
    this.aimLaneIndex = laneIndex;
    this.aimPoint = { ...point };
    this.setPhase('aiming');
    this.events.aimStarted.emit({ laneIndex });
    this.addLog('aimStarted', `lane=${laneIndex}`);
    return true;
  }

  updateAim(point: Vec): void {
    if (!this.aimActive) return;
    this.aimPoint = { ...point };
  }

  currentAimLaunch(): AimLaunchPlan | null {
    if (!this.aimActive || this.aimLaneIndex < 0) return null;
    const lane = this.lanes[this.aimLaneIndex];
    const a = lane.slingAnchor();
    const pull = { x: a.x - this.aimPoint.x, y: a.y - this.aimPoint.y };
    const rawLen = Math.hypot(pull.x, pull.y);
    if (rawLen < 1e-6) {
      return { laneIndex: this.aimLaneIndex, spawn: { ...a }, velocity: { x: 0, y: 0 }, strongEnough: false };
    }
    const len = Math.min(rawLen, CONFIG.sling.maxPull);
    const speed = Math.min(len * CONFIG.sling.speedFactor, CONFIG.sling.maxSpeed);
    const dir = { x: pull.x / rawLen, y: pull.y / rawLen };
    return {
      laneIndex: this.aimLaneIndex,
      spawn: { x: a.x + dir.x * CONFIG.sling.spawnAhead, y: a.y + dir.y * CONFIG.sling.spawnAhead },
      velocity: { x: dir.x * speed, y: dir.y * speed },
      strongEnough: speed >= CONFIG.sling.minSpeed,
    };
  }

  cancelAim(reason: AimCancelReason = 'manual'): boolean {
    if (!this.aimActive) return false;
    this.aimActive = false;
    const laneIndex = this.aimLaneIndex;
    this.aimLaneIndex = -1;
    this.setPhase('running');
    this.events.aimCancelled.emit({ reason });
    this.stats.aimCancels++;
    this.addLog('aimCancelled', `${reason} lane=${laneIndex}`);
    return true;
  }

  releaseAim(): { launched: boolean } {
    if (!this.aimActive) return { launched: false };
    const plan = this.currentAimLaunch();
    if (!plan || !plan.strongEnough) {
      this.cancelAim('tooWeak');
      this.events.aimReleased.emit({ laneIndex: this.aimLaneIndex, launched: false });
      return { launched: false };
    }
    const bird = BIRDS[this.selectedBird];
    // Atomic deduction: spend then launch; a failed launch (race) refunds.
    if (!this.regulator.spend(bird.ammoCost)) return { launched: false };
    this.aimActive = false;
    const ok = this.lanes[plan.laneIndex].launch(plan.spawn, plan.velocity, this.selectedBird);
    if (!ok) {
      this.regulator.refund(bird.ammoCost);
      this.setPhase('running');
      return { launched: false };
    }
    this.stats.launched++;
    this.events.ammoChanged.emit({ value: this.regulator.ammo });
    this.events.launched.emit({
      laneIndex: plan.laneIndex,
      birdType: this.selectedBird,
      vx: plan.velocity.x,
      vy: plan.velocity.y,
      ammoLeft: this.regulator.ammo,
    });
    this.setPhase('running');
    this.events.aimReleased.emit({ laneIndex: plan.laneIndex, launched: true });
    this.addLog('launched', `lane=${plan.laneIndex} ${this.selectedBird} ammo=${this.regulator.ammo}`);
    return { launched: true };
  }

  // Test/debug helper mirroring the deduction+launch path. Unlike the player
  // path it skips drag min/max-speed shaping ONLY up to the hard cap; strategy
  // comparisons must use tryStartAim/updateAim/releaseAim instead.
  fireWithVelocity(laneIndex: number, vx: number, vy: number): boolean {
    if (this.phase !== 'running') return false;
    const speed = Math.hypot(vx, vy);
    if (speed > CONFIG.sling.maxSpeed) return false; // no arbitrary velocities
    if (this.regulator.ammo < BIRDS[this.selectedBird].ammoCost) return false;
    if (this.lanes.some((l) => l.projectile)) return false;
    const lane = this.lanes[laneIndex];
    const a = lane.slingAnchor();
    const mag = Math.hypot(vx, vy) || 1;
    const spawn = {
      x: a.x + (vx / mag) * CONFIG.sling.spawnAhead,
      y: a.y + (vy / mag) * CONFIG.sling.spawnAhead,
    };
    if (!this.regulator.spend(BIRDS[this.selectedBird].ammoCost)) return false;
    if (!lane.launch(spawn, { x: vx, y: vy }, this.selectedBird)) return false;
    this.stats.launched++;
    this.events.ammoChanged.emit({ value: this.regulator.ammo });
    this.events.launched.emit({ laneIndex, birdType: this.selectedBird, vx, vy, ammoLeft: this.regulator.ammo });
    this.addLog('launched', `lane=${laneIndex} ${this.selectedBird} ammo=${this.regulator.ammo}`);
    return true;
  }

  // ---------- planting / removal ----------

  selectBird(bird: BirdId): boolean {
    if (this.phase !== 'running' || !this.isBirdAvailable(bird)) return false;
    this.selectedBird = bird;
    this.selectedPlant = null;
    this.removeMode = false;
    return true;
  }

  selectPlant(plant: PlantId): boolean {
    if (this.phase !== 'running' || !this.isPlantAvailable(plant)) return false;
    this.selectedPlant = plant;
    this.removeMode = false;
    return true;
  }

  setRemoveMode(on: boolean): boolean {
    if (this.phase !== 'running') return false;
    this.removeMode = on;
    if (on) this.selectedPlant = null;
    return true;
  }

  plantCooldownRemainingMs(plant: PlantId): number {
    return Math.max(0, this.plantReadyAtMs[plant] - this.lanes[0].simTimeMs);
  }

  nestCountValue(): number {
    return this.nestCount;
  }

  tryPlant(point: Vec): boolean {
    if (this.phase !== 'running' || this.aimActive) return false;
    if (!this.selectedPlant || !this.isPlantAvailable(this.selectedPlant)) return false;
    const def = PLANTS[this.selectedPlant];
    if (this.plantCooldownRemainingMs(this.selectedPlant) > 0) return false;
    if (this.resources < def.cost) return false;
    if (this.selectedPlant === 'nest' && this.nestCount >= CONFIG.plants.nest.maxPerRun) return false;
    const laneIndex = this.laneAtPoint(point);
    if (laneIndex < 0) return false;
    const lane = this.lanes[laneIndex];
    const slot = this.nearestFreeSlot(lane, point);
    if (slot < 0) return false;
    if (!lane.plantAt(slot, this.selectedPlant)) return false;
    this.resources -= def.cost;
    this.stats.resourcesSpent += def.cost;
    this.plantReadyAtMs[this.selectedPlant] = lane.simTimeMs + def.cooldownMs;
    if (this.selectedPlant === 'nest') this.nestCount++;
    this.stats.plantsPlanted++;
    this.events.resourcesChanged.emit({ value: this.resources });
    this.addLog('plant', `lane=${laneIndex} slot=${slot} ${this.selectedPlant}`);
    return true;
  }

  tryRemove(point: Vec): boolean {
    if (this.phase !== 'running' || this.aimActive) return false;
    if (!this.removeMode) return false;
    const laneIndex = this.laneAtPoint(point);
    if (laneIndex < 0) return false;
    const lane = this.lanes[laneIndex];
    const slot = this.nearestOccupiedSlot(lane, point);
    if (slot < 0) return false;
    if (!lane.removePlant(slot, 'removed')) return false;
    this.stats.plantsRemoved++;
    this.addLog('remove', `lane=${laneIndex} slot=${slot}`);
    return true;
  }

  private nearestFreeSlot(lane: LaneSimulation, point: Vec): number {
    let best = -1;
    let bestD = Infinity;
    for (const slot of this.slotXs.map((_, i) => i)) {
      if (lane.hasPlantAt(slot)) continue;
      const d = Math.abs(this.slotXs[slot] - point.x);
      if (d < bestD && d <= 60) {
        best = slot;
        bestD = d;
      }
    }
    return best;
  }

  private nearestOccupiedSlot(lane: LaneSimulation, point: Vec): number {
    let best = -1;
    let bestD = Infinity;
    for (const slot of this.slotXs.map((_, i) => i)) {
      if (!lane.hasPlantAt(slot)) continue;
      const d = Math.abs(this.slotXs[slot] - point.x);
      if (d < bestD && d <= 60) {
        best = slot;
        bestD = d;
      }
    }
    return best;
  }

  // ---------- pause / focus ----------

  togglePause(): void {
    if (this.phase === 'won' || this.phase === 'lost') return;
    if (this.phase === 'aiming') this.cancelAim('pause');
    if (this.phase === 'running') {
      this.clock.pause();
      this.setPhase('paused');
    } else if (this.phase === 'paused') {
      this.clock.resume();
      this.setPhase('running');
    }
  }

  onWindowBlur(): void {
    if (this.aimActive) this.cancelAim('blur');
    if (this.phase === 'running') {
      this.clock.pause();
      this.setPhase('paused');
      this.addLog('autoPauseBlur');
    }
  }

  // ---------- restart ----------

  restart(): void {
    const from = this.phase;
    this.aimActive = false;
    this.aimLaneIndex = -1;
    for (const lane of this.lanes) lane.dispose();
    this.lanes = this.level.lanes.map(
      (l) => new LaneSimulation(l.laneIndex, geometryFor(l.laneIndex), l, this.events, SLOT_XS),
    );
    this.regulator = new AmmoRegulator();
    this.resources = this.level.startResources;
    this.lives = this.level.lives;
    for (const id of Object.keys(PLANTS) as PlantId[]) this.plantReadyAtMs[id] = 0;
    this.nestCount = 0;
    this.selectedBird = 'woodpecker';
    this.selectedPlant = null;
    this.removeMode = false;
    this.pending = [
      ...this.level.baseWaves.map((w) => ({ ...w, count: w.count ?? 1, towerLane: null, done: false, cancelled: false })),
      ...this.level.reinforcements.map((w) => ({ ...w, count: w.count ?? 1, towerLane: w.towerLane, done: false, cancelled: false })),
    ].sort((a, b) => a.atMs - b.atMs);
    this.incomeAcc = 0;
    this.stats = {
      launched: 0, aimCancels: 0, leaks: 0, kills: 0,
      towersDown: 0, reinforcementsCancelled: 0, nestRefills: 0, nestCarPartsBroken: 0,
      plantsPlanted: 0, plantsRemoved: 0, resourcesSpent: 0,
    };
    this.phase = 'running';
    this.clock.reset();
    this.initializeCampaign();
    this.log = [];
    this.events.phaseChanged.emit({ from, to: 'running' });
    this.events.restarted.emit(undefined);
  }

  // ---------- misc ----------

  private setPhase(to: Phase): void {
    const from = this.phase;
    if (from === to) return;
    this.phase = to;
    this.events.phaseChanged.emit({ from, to });
  }

  private addLog(type: string, detail?: string): void {
    this.log.push({ tMs: this.lanes[0].simTimeMs, type, detail });
    if (this.log.length > 800) this.log.shift();
  }

  getLog(): readonly LogEntry[] {
    return this.log;
  }

  // Read-only view of the spawn schedule for verification/tooling.
  pendingSpawns(): readonly {
    atMs: number;
    lane: number;
    type: EnemyId;
    count: number;
    towerLane: number | null;
    done: boolean;
    cancelled: boolean;
  }[] {
    return this.pending.map((p) => ({ ...p }));
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    for (const lane of this.lanes) lane.dispose();
  }
}
