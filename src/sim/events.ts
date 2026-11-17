import { Signal } from './signal';
import { type BirdId, type EnemyId, type PlantId } from './entities';

export interface Vec {
  x: number;
  y: number;
}

export type Phase = 'running' | 'aiming' | 'paused' | 'won' | 'lost';

export type AimCancelReason = 'manual' | 'blur' | 'canvasExit' | 'tooWeak' | 'pause';

export interface LaunchInfo {
  laneIndex: number;
  birdType: BirdId;
  vx: number;
  vy: number;
  ammoLeft: number;
}

export interface BlockDamageInfo {
  laneIndex: number;
  blockId: string;
  material: string;
  hp: number;
  maxHp: number;
  impactSpeed: number;
}

export interface BlockDestroyInfo {
  laneIndex: number;
  blockId: string;
  material: string;
  x: number;
  y: number;
}

export interface TargetKillInfo {
  laneIndex: number;
  targetId: string;
  cause: 'impact' | 'outOfBounds';
}

export interface ProjectileRetireInfo {
  laneIndex: number;
  cause: 'settled' | 'timeout' | 'outOfBounds';
}

export interface PhaseInfo {
  from: Phase;
  to: Phase;
}

export interface EnemyEventInfo {
  laneIndex: number;
  enemyId: string;
  enemyType: EnemyId;
}

export interface TowerDownInfo {
  laneIndex: number;
}

export interface PlantEventInfo {
  laneIndex: number;
  slot: number;
  plantId: PlantId;
  cause?: 'removed' | 'munched';
}

export interface BirdFirstHitInfo {
  laneIndex: number;
  birdType: BirdId;
  x: number;
  y: number;
}

export interface ResourceProducedInfo {
  amount: number;
}

export interface AmmoRefilledInfo {
  laneIndex: number;
  amount: number;
}

// Shared event bus between lane simulations, game rules and presentation layer.
export class SimEvents {
  readonly aimStarted = new Signal<{ laneIndex: number }>();
  readonly aimCancelled = new Signal<{ reason: AimCancelReason }>();
  readonly aimReleased = new Signal<{ laneIndex: number; launched: boolean }>();
  readonly launched = new Signal<LaunchInfo>();
  readonly ammoChanged = new Signal<{ value: number }>();
  readonly ammoRefilled = new Signal<AmmoRefilledInfo>();
  readonly resourcesChanged = new Signal<{ value: number }>();
  readonly resourceProduced = new Signal<ResourceProducedInfo>();
  readonly livesChanged = new Signal<{ value: number }>();
  readonly phaseChanged = new Signal<PhaseInfo>();
  readonly blockDamaged = new Signal<BlockDamageInfo>();
  readonly blockDestroyed = new Signal<BlockDestroyInfo>();
  readonly targetKilled = new Signal<TargetKillInfo>();
  readonly projectileRetired = new Signal<ProjectileRetireInfo>();
  readonly enemyKilled = new Signal<EnemyEventInfo>();
  readonly enemyLeaked = new Signal<EnemyEventInfo>();
  readonly towerDown = new Signal<TowerDownInfo>();
  readonly plantPlanted = new Signal<PlantEventInfo>();
  readonly plantRemoved = new Signal<PlantEventInfo>();
  readonly birdFirstHit = new Signal<BirdFirstHitInfo>();
  readonly won = new Signal<void>();
  readonly lost = new Signal<void>();
  readonly restarted = new Signal<void>();
}
