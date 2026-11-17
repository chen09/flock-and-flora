import Matter from 'matter-js';
import { CONFIG, FIXED_DT_MS, VIEW } from '../config';
import { BIRDS, CAT, ENEMIES, PLANTS, type BirdId, type EnemyId, type PlantId } from './entities';
import { MATERIALS, MaterialId } from '../materials';
import { SimEvents, Vec } from './events';

const { Bodies, Body, Composite, Engine, Events, Query, Sleeping } = Matter;

export interface BlockSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  material: MaterialId;
}

export interface TargetSpec {
  id: string;
  x: number;
  y: number;
}

export interface LaneLevelDef {
  laneIndex: number;
  sling: Vec;
  blocks: BlockSpec[];
  targets?: TargetSpec[];
  coreId?: string; // block whose destruction takes the tower down
}

export interface LaneGeometry {
  bandTop: number;
  groundTop: number;
  laneBottom: number;
}

export interface BlockView {
  id: string;
  material: MaterialId;
  x: number;
  y: number;
  angle: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
}

export interface TargetView {
  id: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
}

export interface EnemyView {
  id: string;
  type: EnemyId;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  slowed: boolean;
}

export interface PlantView {
  slot: number;
  plantId: PlantId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface TrajectoryPreview {
  points: Vec[];
  hit: Vec | null;
}

interface LaneBlock {
  id: string;
  body: Matter.Body;
  material: MaterialId;
  hp: number;
  maxHp: number;
  w: number;
  h: number;
  dead: boolean;
}

interface LaneTarget {
  id: string;
  body: Matter.Body;
  hp: number;
  maxHp: number;
  alive: boolean;
  dead: boolean;
}

interface ActiveProjectile {
  body: Matter.Body;
  birdType: BirdId;
  ageMs: number;
  slowMs: number;
  firstHitDone: boolean;
}

interface EnemyEntity {
  id: string;
  type: EnemyId;
  body: Matter.Body;
  hp: number;
  maxHp: number;
  slowUntilMs: number;
  dead: boolean;
}

interface PlantEntity {
  slot: number;
  plantId: PlantId;
  hp: number;
  maxHp: number;
  body: Matter.Body;
  produceTimerMs: number;
  shootTimerMs: number;
  dead: boolean;
}

interface ShotEntity {
  body: Matter.Body;
  ageMs: number;
  dmg: number;
}

interface DebrisEntity {
  body: Matter.Body;
  settledMs: number;
  ageMs: number;
  hp: number;
}

const BASE_BLOCK_MASK = CAT.ENV | CAT.WALL | CAT.BIRD | CAT.BLOCK | CAT.DEBRIS;
const BASE_DEBRIS_MASK = CAT.ENV | CAT.WALL | CAT.BIRD | CAT.BLOCK | CAT.DEBRIS;

// Small deterministic PRNG so identical inputs produce identical debris
// behaviour (repeatable replays/acceptance). Same distribution scale as the
// previous Math.random usage; only reproducibility changes.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One lane = one independent Matter world, stepped manually with a fixed delta.
// All destruction (collapse, impact, crush) is computed by the physics engine;
// there are no scripted animations.
export class LaneSimulation {
  readonly laneIndex: number;
  readonly geo: LaneGeometry;
  readonly engine: Matter.Engine;
  readonly world: Matter.Composite;
  readonly simEvents: SimEvents;
  readonly slotXs: number[];
  simTimeMs = 0;
  projectile: ActiveProjectile | null = null;
  towerAlive = true;

  private readonly coreId?: string;
  private blocks = new Map<number, LaneBlock>();
  private targets = new Map<number, LaneTarget>();
  private blockById = new Map<string, LaneBlock>();
  private targetById = new Map<string, LaneTarget>();
  private enemies = new Map<number, EnemyEntity>();
  private enemyById = new Map<string, EnemyEntity>();
  private plants = new Map<number, PlantEntity>();
  private plantSlotByBody = new Map<number, number>(); // plant body.id -> slot
  private shots: ShotEntity[] = [];
  private debris = new Map<number, DebrisEntity>();
  private frostAreas: { x: number; y: number; radius: number; until: number }[] = [];
  private munchPairs = new Set<string>();
  private pairCooldown = new Map<string, number>();
  private pendingRemove: Matter.Body[] = [];
  private enemySeq = 0;
  private readonly rng: () => number;
  private collisionStartHandler: (evt: Matter.IEventCollision<Matter.Engine>) => void;
  private collisionActiveHandler: (evt: Matter.IEventCollision<Matter.Engine>) => void;
  private collisionEndHandler: (evt: Matter.IEventCollision<Matter.Engine>) => void;
  private disposed = false;

  constructor(
    laneIndex: number,
    geo: LaneGeometry,
    level: LaneLevelDef,
    simEvents: SimEvents,
    slotXs: number[],
    seed = 20261117,
  ) {
    this.laneIndex = laneIndex;
    this.geo = geo;
    this.slotXs = slotXs;
    this.coreId = level.coreId;
    this.simEvents = simEvents;
    this.rng = mulberry32(seed + laneIndex * 7919);
    this.engine = Engine.create({ enableSleeping: true });
    this.engine.positionIterations = 10;
    this.engine.velocityIterations = 8;
    this.world = this.engine.world;

    this.buildEnvironment();
    for (const spec of level.blocks) this.addBlock(spec);
    for (const spec of level.targets ?? []) this.addTarget(spec);

    this.collisionStartHandler = (evt) => this.onCollisionStart(evt);
    this.collisionActiveHandler = (evt) => this.onCollisionActive(evt);
    this.collisionEndHandler = (evt) => this.onCollisionEnd(evt);
    Events.on(this.engine, 'collisionStart', this.collisionStartHandler);
    Events.on(this.engine, 'collisionActive', this.collisionActiveHandler);
    Events.on(this.engine, 'collisionEnd', this.collisionEndHandler);
  }

  slingAnchor(): Vec {
    return {
      x: CONFIG.sling.anchor.x,
      y: this.geo.groundTop - CONFIG.sling.offsetFromGround,
    };
  }

  // ---------- construction ----------

  private buildEnvironment(): void {
    const gTop = this.geo.groundTop;
    const bandTop = this.geo.bandTop;
    const envFilter = { category: CAT.ENV, mask: 0xffffffff };
    const ground = Bodies.rectangle(VIEW.width / 2, gTop + 60, VIEW.width + 200, 120, {
      isStatic: true,
      friction: 0.9,
      label: 'ground',
      collisionFilter: envFilter,
    });
    const ceiling = Bodies.rectangle(VIEW.width / 2, bandTop + 8 - 50, VIEW.width + 200, 100, {
      isStatic: true,
      label: 'ceiling',
      collisionFilter: envFilter,
    });
    const wallLeft = Bodies.rectangle(-30, bandTop + 135, 60, 300, {
      isStatic: true,
      label: 'wall',
      collisionFilter: { category: CAT.WALL, mask: 0xffffffff },
    });
    const wallRight = Bodies.rectangle(VIEW.width + 30, bandTop + 135, 60, 300, {
      isStatic: true,
      label: 'wall',
      collisionFilter: { category: CAT.WALL, mask: 0xffffffff },
    });
    Composite.add(this.world, [ground, ceiling, wallLeft, wallRight]);
  }

  private addBlock(spec: BlockSpec): void {
    const def = MATERIALS[spec.material];
    const body = Bodies.rectangle(spec.x, spec.y, spec.w, spec.h, {
      density: def.density,
      friction: def.friction,
      frictionStatic: 1.0,
      restitution: 0.02,
      label: 'block',
      collisionFilter: { category: CAT.BLOCK, mask: BASE_BLOCK_MASK },
    });
    Sleeping.set(body, true);
    Composite.add(this.world, body);
    const block: LaneBlock = {
      id: spec.id,
      body,
      material: spec.material,
      hp: def.hp,
      maxHp: def.hp,
      w: spec.w,
      h: spec.h,
      dead: false,
    };
    this.blocks.set(body.id, block);
    this.blockById.set(spec.id, block);
  }

  private addTarget(spec: TargetSpec): void {
    const body = Bodies.rectangle(spec.x, spec.y, CONFIG.target.w, CONFIG.target.h, {
      density: CONFIG.target.density,
      friction: 0.95,
      frictionStatic: 1.0,
      restitution: 0.05,
      chamfer: { radius: 5 },
      label: 'target',
      collisionFilter: { category: CAT.BLOCK, mask: BASE_BLOCK_MASK },
    });
    Sleeping.set(body, true);
    Composite.add(this.world, body);
    const target: LaneTarget = {
      id: spec.id,
      body,
      hp: CONFIG.target.hp,
      maxHp: CONFIG.target.hp,
      alive: true,
      dead: false,
    };
    this.targets.set(body.id, target);
    this.targetById.set(spec.id, target);
  }

  // ---------- stepping ----------

  step(dtMs: number): void {
    if (this.disposed) return;
    this.simTimeMs += dtMs;
    this.frostAreas = this.frostAreas.filter((f) => f.until > this.simTimeMs);
    for (const field of this.frostAreas) {
      for (const enemy of this.enemies.values()) {
        if (Math.hypot(enemy.body.position.x - field.x, enemy.body.position.y - field.y) <= field.radius) {
          enemy.slowUntilMs = Math.max(enemy.slowUntilMs, field.until);
        }
      }
    }
    this.driveEnemies();
    Engine.update(this.engine, dtMs);
    this.flushPending();
    this.applyMunch(dtMs);
    this.updatePlants(dtMs);
    this.trackProjectile(dtMs);
    this.updateShots(dtMs);
    this.updateDebris(dtMs);
    this.updateBlockEnemyMasks();
    this.cullOutOfBounds();
  }

  // Strategy movement: enemies always walk left at their (slowed) speed; being
  // buried or bumped never permanently stops them.
  private driveEnemies(): void {
    for (const e of this.enemies.values()) {
      const slowed = e.slowUntilMs > this.simTimeMs;
      const v = ENEMIES[e.type].speed * (slowed ? CONFIG.plants.frost.slowFactor : 1);
      if (e.body.isSleeping) Sleeping.set(e.body, false);
      Body.setVelocity(e.body, { x: -v, y: e.body.velocity.y });
    }
  }

  private applyMunch(dtMs: number): void {
    if (this.munchPairs.size === 0) return;
    for (const key of [...this.munchPairs]) {
      const sep = key.indexOf(':');
      const enemyId = Number(key.slice(0, sep));
      const slot = Number(key.slice(sep + 1));
      const enemy = this.enemies.get(enemyId);
      const plant = this.plants.get(slot);
      if (!enemy || !plant || plant.dead) {
        this.munchPairs.delete(key);
        continue;
      }
      const dps = ENEMIES[enemy.type].munchDps;
      plant.hp -= (dps * dtMs) / 1000;
      if (plant.hp <= 0) this.removePlant(slot, 'munched');
    }
  }

  private updatePlants(dtMs: number): void {
    for (const p of this.plants.values()) {
      if (p.dead) continue;
      if (p.plantId === 'dawn') {
        p.produceTimerMs += dtMs;
        if (p.produceTimerMs >= CONFIG.plants.dawn.produceMs) {
          p.produceTimerMs -= CONFIG.plants.dawn.produceMs;
          this.simEvents.resourceProduced.emit({ amount: CONFIG.plants.dawn.produceAmount });
        }
      } else if (p.plantId === 'nest') {
        p.produceTimerMs += dtMs;
        if (p.produceTimerMs >= CONFIG.plants.nest.refillMs) {
          p.produceTimerMs -= CONFIG.plants.nest.refillMs;
          this.simEvents.ammoRefilled.emit({ laneIndex: this.laneIndex, amount: 1 });
        }
      } else if (p.plantId === 'pea') {
        p.shootTimerMs += dtMs;
        if (p.shootTimerMs >= CONFIG.plants.peaShot.intervalMs) {
          const target = this.leftmostEnemyInRange(this.slotXs[p.slot], CONFIG.plants.peaShot.range);
          if (target) {
            p.shootTimerMs = 0;
            this.firePeaShot(p, target);
          }
        }
      } else if (p.plantId === 'frost') {
        const px = this.slotXs[p.slot];
        // Aura: refresh slow AND apply low chip damage (PLAN table: 输出较低).
        for (const e of this.enemies.values()) {
          if (Math.abs(e.body.position.x - px) <= CONFIG.plants.frost.range) {
            e.slowUntilMs = Math.max(e.slowUntilMs, this.simTimeMs + 300);
            this.damageEnemy(e, (CONFIG.plants.frost.dps * dtMs) / 1000);
          }
        }
      }
    }
  }

  // Pea shots fly towards +x (enemies come from the right). Targets must be
  // AHEAD of the plant (x >= plantX - 30) and within range; enemies that
  // already walked past the plant are not shot backwards.
  private leftmostEnemyInRange(plantX: number, range: number): EnemyEntity | null {
    let best: EnemyEntity | null = null;
    for (const e of this.enemies.values()) {
      const x = e.body.position.x;
      if (x < plantX - 30) continue; // already behind the plant
      if (x > plantX + range) continue; // out of range
      if (!best || x < best.body.position.x) best = e; // deepest invader first
    }
    return best;
  }

  private firePeaShot(p: PlantEntity, target: EnemyEntity): void {
    const x = this.slotXs[p.slot] + 20;
    const y = this.geo.groundTop - CONFIG.plants.peaShot.radius - 8;
    const T = Math.max(1, Math.abs(target.body.position.x - x) / CONFIG.plants.peaShot.speed);
    const dy = target.body.position.y - y;
    const gStep = 1 * 0.001 * FIXED_DT_MS * FIXED_DT_MS;
    const vy = dy / T - (gStep * (T + 1)) / 2;
    const body = Bodies.circle(x, y, CONFIG.plants.peaShot.radius, {
      density: 0.002,
      frictionAir: 0,
      restitution: 0,
      label: 'shot',
      collisionFilter: { category: CAT.SHOT, mask: CAT.ENEMY | CAT.ENV },
    });
    Body.setVelocity(body, { x: CONFIG.plants.peaShot.speed, y: vy });
    Composite.add(this.world, body);
    this.shots.push({ body, ageMs: 0, dmg: CONFIG.plants.peaShot.dmg });
  }

  private updateShots(dtMs: number): void {
    for (const s of [...this.shots]) {
      s.ageMs += dtMs;
      if (s.ageMs > 3000 || s.body.position.y > this.geo.groundTop + 40) {
        this.removeShot(s);
      }
    }
  }

  private removeShot(s: ShotEntity): void {
    Composite.remove(this.world, s.body);
    this.shots = this.shots.filter((x) => x !== s);
  }

  private updateDebris(dtMs: number): void {
    for (const d of this.debris.values()) {
      d.ageMs += dtMs;
      const speed = Math.hypot(d.body.velocity.x, d.body.velocity.y);
      if (speed < CONFIG.enemies.settleSpeed) {
        d.settledMs += dtMs;
      } else {
        d.settledMs = 0;
      }
      if (d.settledMs >= CONFIG.enemies.despawnSettledMs) {
        this.requestRemove(d.body);
      }
    }
  }

  // Standing (slow/asleep) blocks & debris never collide with walking enemies;
  // fast-moving (falling) ones crush them. Implemented via the dynamic ENEMY
  // bit in their collision mask.
  private updateBlockEnemyMasks(): void {
    const threshold = CONFIG.enemies.crushSpeedThreshold;
    const update = (b: Matter.Body, base: number) => {
      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      const wantEnemy = speed > threshold && !b.isSleeping;
      const mask = b.collisionFilter.mask ?? 0;
      const hasEnemy = (mask & CAT.ENEMY) !== 0;
      if (wantEnemy !== hasEnemy) {
        b.collisionFilter.mask = wantEnemy ? base | CAT.ENEMY : base;
      }
    };
    for (const b of this.blocks.values()) update(b.body, BASE_BLOCK_MASK);
    for (const d of this.debris.values()) update(d.body, BASE_DEBRIS_MASK);
  }

  private flushPending(): void {
    if (this.pendingRemove.length === 0) return;
    const removed = [...this.pendingRemove];
    this.pendingRemove = [];
    let woke = false;
    for (const body of removed) {
      Composite.remove(this.world, body);
      const block = this.blocks.get(body.id);
      if (block && !block.dead) {
        block.dead = true;
        this.blocks.delete(body.id);
        this.blockById.delete(block.id);
        this.simEvents.blockDestroyed.emit({
          laneIndex: this.laneIndex,
          blockId: block.id,
          material: block.material,
          x: body.position.x,
          y: body.position.y,
        });
        if (this.towerAlive && this.coreId === block.id) {
          this.towerAlive = false;
          this.simEvents.towerDown.emit({ laneIndex: this.laneIndex });
        }
        this.spawnDebrisFor(block);
      }
      const target = this.targets.get(body.id);
      if (target && !target.dead) {
        target.dead = true;
        target.alive = false;
        this.targets.delete(body.id);
        this.targetById.delete(target.id);
        this.simEvents.targetKilled.emit({ laneIndex: this.laneIndex, targetId: target.id, cause: 'impact' });
      }
      const enemy = this.enemies.get(body.id);
      if (enemy && !enemy.dead) {
        enemy.dead = true;
        this.enemies.delete(body.id);
        this.enemyById.delete(enemy.id);
        this.simEvents.enemyKilled.emit({
          laneIndex: this.laneIndex,
          enemyId: enemy.id,
          enemyType: enemy.type,
        });
      }
      if (this.debris.delete(body.id)) {
        // debris removed (crushed or despawned)
      }
      woke = woke || !body.isStatic;
    }
    if (woke) this.wakeAllDynamic();
  }

  // Destroyed blocks break into two fragments (falling debris can hurt).
  // Complete load-bearing blocks are never auto-removed (PLAN ruling).
  private spawnDebrisFor(block: LaneBlock): void {
    for (const offset of [-block.w / 4, block.w / 4]) {
      const body = Bodies.rectangle(
        block.body.position.x + offset,
        block.body.position.y,
        Math.max(8, block.w / 2),
        Math.max(8, block.h / 2),
        {
          density: MATERIALS[block.material].density * 1.2,
          friction: 0.7,
          restitution: 0.05,
          label: 'debris',
          collisionFilter: { category: CAT.DEBRIS, mask: BASE_DEBRIS_MASK | CAT.ENEMY },
        },
      );
      Body.setVelocity(body, {
        x: (this.rng() - 0.5) * 4,
        y: -this.rng() * 2 - 1,
      });
      Composite.add(this.world, body);
      this.debris.set(body.id, { body, settledMs: 0, ageMs: 0, hp: 12 });
    }
    this.wakeAllDynamic();
  }

  private wakeAllDynamic(): void {
    for (const body of Composite.allBodies(this.world)) {
      if (!body.isStatic && body.isSleeping) Sleeping.set(body, false);
    }
  }

  private onCollisionStart(evt: Matter.IEventCollision<Matter.Engine>): void {
    for (const pair of evt.pairs) {
      const bodyA = pair.bodyA;
      const bodyB = pair.bodyB;

      // Bird first-hit detection; abilities are applied by the game layer.
      if (
        this.projectile &&
        !this.projectile.firstHitDone &&
        (bodyA.id === this.projectile.body.id || bodyB.id === this.projectile.body.id)
      ) {
        this.projectile.firstHitDone = true;
        // Center abilities on the BIRD's current position - never on the other
        // body's center (ground/walls/long beams span hundreds of pixels and
        // would teleport the blast to their midpoint).
        this.simEvents.birdFirstHit.emit({
          laneIndex: this.laneIndex,
          birdType: this.projectile.birdType,
          x: this.projectile.body.position.x,
          y: this.projectile.body.position.y,
        });
      }

      // Pea shots deal fixed damage to enemies and vanish on any contact.
      const shot = bodyA.label === 'shot' ? bodyA : bodyB.label === 'shot' ? bodyB : null;
      if (shot) {
        const other = shot === bodyA ? bodyB : bodyA;
        const enemy = this.enemies.get(other.id);
        const entity = this.shots.find((s) => s.body.id === shot.id);
        if (enemy && entity) {
          this.damageEnemy(enemy, entity.dmg * ENEMIES[enemy.type].plantShotScale);
        }
        const found = this.shots.find((s) => s.body.id === shot.id);
        if (found) this.removeShot(found);
        continue;
      }

      const n = pair.collision.normal;
      const rvx = bodyA.velocity.x - bodyB.velocity.x;
      const rvy = bodyA.velocity.y - bodyB.velocity.y;
      const impactSpeed = Math.abs(rvx * n.x + rvy * n.y);
      if (impactSpeed < CONFIG.damage.minImpactSpeed) continue;

      const key =
        bodyA.id < bodyB.id ? `${bodyA.id}-${bodyB.id}` : `${bodyB.id}-${bodyA.id}`;
      const last = this.pairCooldown.get(key) ?? Number.NEGATIVE_INFINITY;
      if (this.simTimeMs - last < CONFIG.damage.pairCooldownMs) continue;
      this.pairCooldown.set(key, this.simTimeMs);

      this.applyPairDamage(bodyA, bodyB, impactSpeed);
      this.applyPairDamage(bodyB, bodyA, impactSpeed);
    }
  }

  private onCollisionActive(evt: Matter.IEventCollision<Matter.Engine>): void {
    for (const pair of evt.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const enemy = a.label === 'enemy' ? a : b.label === 'enemy' ? b : null;
      const plantBody = a.label === 'plant' ? a : b.label === 'plant' ? b : null;
      if (enemy && plantBody) {
        const slot = this.plantSlotByBody.get(plantBody.id);
        if (slot !== undefined) {
          this.munchPairs.add(`${enemy.id}:${slot}`);
        }
      }
    }
  }

  private onCollisionEnd(evt: Matter.IEventCollision<Matter.Engine>): void {
    for (const pair of evt.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const enemy = a.label === 'enemy' ? a : b.label === 'enemy' ? b : null;
      const plantBody = a.label === 'plant' ? a : b.label === 'plant' ? b : null;
      if (enemy && plantBody) {
        const slot = this.plantSlotByBody.get(plantBody.id);
        if (slot !== undefined) {
          this.munchPairs.delete(`${enemy.id}:${slot}`);
        }
      }
    }
  }

  // Damage to `receiver` scales with the mass of the OTHER body. Static
  // partners use the receiver's own mass (self-slam on landing).
  private applyPairDamage(receiver: Matter.Body, other: Matter.Body, impactSpeed: number): void {
    if (receiver.isStatic) return;
    if (receiver.label === 'projectile' || receiver.label === 'shot') return;
    const mOther = other.isStatic ? receiver.mass : other.mass;
    const dmg = Math.min(
      impactSpeed * mOther * CONFIG.damage.impactK,
      CONFIG.damage.maxDamagePerHit,
    );
    if (dmg <= 0) return;

    const block = this.blocks.get(receiver.id);
    if (block && !block.dead) {
      const hp = Math.max(0, block.hp - dmg);
      block.hp = hp;
      this.simEvents.blockDamaged.emit({
        laneIndex: this.laneIndex,
        blockId: block.id,
        material: block.material,
        hp,
        maxHp: block.maxHp,
        impactSpeed,
      });
      if (hp <= 0) this.requestRemove(block.body);
      return;
    }
    const target = this.targets.get(receiver.id);
    if (target && !target.dead) {
      const hp = Math.max(0, target.hp - dmg);
      target.hp = hp;
      if (hp <= 0) this.requestRemove(target.body);
      return;
    }
    const enemy = this.enemies.get(receiver.id);
    if (enemy && !enemy.dead) {
      this.damageEnemy(enemy, dmg);
      return;
    }
    const debris = this.debris.get(receiver.id);
    if (debris) {
      debris.hp -= dmg;
      if (debris.hp <= 0) this.requestRemove(receiver);
    }
  }

  private damageEnemy(enemy: EnemyEntity, dmg: number): void {
    if (enemy.dead || dmg <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - dmg);
    if (enemy.hp <= 0) this.requestRemove(enemy.body);
  }

  private requestRemove(body: Matter.Body): void {
    if (this.pendingRemove.includes(body)) return;
    this.pendingRemove.push(body);
  }

  private trackProjectile(dtMs: number): void {
    const p = this.projectile;
    if (!p) return;
    p.ageMs += dtMs;
    const speed = Math.hypot(p.body.velocity.x, p.body.velocity.y);
    if (speed < CONFIG.projectileRetire.slowSpeed) {
      p.slowMs += dtMs;
    } else {
      p.slowMs = 0;
    }
    if (p.slowMs >= CONFIG.projectileRetire.slowMs) {
      this.retireProjectile('settled');
    } else if (p.ageMs >= CONFIG.projectileRetire.maxAgeMs) {
      this.retireProjectile('timeout');
    }
  }

  private retireProjectile(cause: 'settled' | 'timeout' | 'outOfBounds'): void {
    const p = this.projectile;
    if (!p) return;
    Composite.remove(this.world, p.body);
    this.projectile = null;
    this.simEvents.projectileRetired.emit({ laneIndex: this.laneIndex, cause });
  }

  private cullOutOfBounds(): void {
    const all = Composite.allBodies(this.world);
    for (const body of all) {
      if (body.isStatic) continue;
      // Enemy leak check FIRST: enemies deliberately pass through the wall and
      // walk off the left edge, costing a life (game layer listens).
      const enemy = this.enemies.get(body.id);
      if (enemy && !enemy.dead && body.position.x < CONFIG.enemies.leakX) {
        enemy.dead = true;
        this.enemies.delete(body.id);
        this.enemyById.delete(enemy.id);
        this.simEvents.enemyLeaked.emit({
          laneIndex: this.laneIndex,
          enemyId: enemy.id,
          enemyType: enemy.type,
        });
        continue;
      }
      const out =
        body.position.y > this.geo.groundTop + 60 ||
        body.position.x < -60 ||
        body.position.x > VIEW.width + 60;
      if (!out) continue;
      if (this.projectile && body.id === this.projectile.body.id) {
        this.retireProjectile('outOfBounds');
        continue;
      }
      this.pendingRemove.push(body);
      this.flushPending();
    }
  }

  // ---------- spawning / planting / abilities ----------

  spawnEnemy(type: EnemyId, x?: number): string {
    const def = ENEMIES[type];
    const id = `e${this.laneIndex}-${this.enemySeq++}`;
    const spawnX = x ?? CONFIG.enemies.spawnX;
    const body = Bodies.rectangle(spawnX, this.geo.groundTop - def.h / 2, def.w, def.h, {
      density: 0.0018,
      friction: 0.9,
      frictionStatic: 1.0,
      restitution: 0.05,
      // Walking speed (<=1.7 px/step) maps to Matter motion ~= speed^2 << 60,
      // the default sleep threshold: without this, walkers freeze after ~1s.
      sleepThreshold: Number.MAX_SAFE_INTEGER,
      label: 'enemy',
      collisionFilter: {
        category: CAT.ENEMY,
        mask:
          CAT.ENV |
          CAT.ENEMY |
          CAT.PLANT |
          CAT.DEBRIS |
          CAT.BIRD |
          CAT.SHOT |
          CAT.BLOCK,
      },
    });
    Composite.add(this.world, body);
    const e: EnemyEntity = {
      id,
      type,
      body,
      hp: def.hp,
      maxHp: def.hp,
      slowUntilMs: 0,
      dead: false,
    };
    this.enemies.set(body.id, e);
    this.enemyById.set(id, e);
    return id;
  }

  plantAt(slot: number, plantId: PlantId): boolean {
    if (this.plants.has(slot)) return false;
    const def = PLANTS[plantId];
    const x = this.slotXs[slot];
    const y = this.geo.groundTop - def.h / 2;
    // Every plant gets a body: solid plants block enemies; the rest are
    // sensors that can still be chewed on (they never block or get pushed).
    const body = Bodies.rectangle(x, y, def.w, def.h, {
      isStatic: true,
      isSensor: !def.solid,
      label: 'plant',
      collisionFilter: { category: CAT.PLANT, mask: CAT.ENEMY },
    });
    Composite.add(this.world, body);
    this.plantSlotByBody.set(body.id, slot);
    this.plants.set(slot, {
      slot,
      plantId,
      hp: def.hp,
      maxHp: def.hp,
      body,
      produceTimerMs: 0,
      shootTimerMs: 0,
      dead: false,
    });
    this.simEvents.plantPlanted.emit({ laneIndex: this.laneIndex, slot, plantId });
    return true;
  }

  removePlant(slot: number, cause: 'removed' | 'munched'): boolean {
    const p = this.plants.get(slot);
    if (!p || p.dead) return false;
    p.dead = true;
    if (p.body) {
      Composite.remove(this.world, p.body);
      this.plantSlotByBody.delete(p.body.id);
      for (const key of [...this.munchPairs]) {
        if (key.endsWith(`:${slot}`)) this.munchPairs.delete(key);
      }
    }
    this.plants.delete(slot);
    this.simEvents.plantRemoved.emit({
      laneIndex: this.laneIndex,
      slot,
      plantId: p.plantId,
      cause,
    });
    return true;
  }

  hasPlantAt(slot: number): boolean {
    return this.plants.has(slot);
  }

  // Owl bomb: radial damage + impulse. Frost swallow: radial slow field.
  explodeAt(x: number, y: number, radius: number, baseDmg: number): void {
    const fall = (px: number, py: number): number => {
      const d = Math.hypot(px - x, py - y);
      return Math.max(0, 1 - d / (radius * 1.2));
    };
    for (const e of [...this.enemies.values()]) {
      const f = fall(e.body.position.x, e.body.position.y);
      if (f > 0) this.damageEnemy(e, baseDmg * f);
    }
    for (const b of [...this.blocks.values()]) {
      const f = fall(b.body.position.x, b.body.position.y);
      if (f <= 0) continue;
      const hp = Math.max(0, b.hp - baseDmg * f);
      b.hp = hp;
      this.simEvents.blockDamaged.emit({
        laneIndex: this.laneIndex,
        blockId: b.id,
        material: b.material,
        hp,
        maxHp: b.maxHp,
        impactSpeed: 0,
      });
      if (hp <= 0) this.requestRemove(b.body);
      this.impulse(b.body, x, y, f);
    }
    for (const d of [...this.debris.values()]) {
      const f = fall(d.body.position.x, d.body.position.y);
      if (f <= 0) continue;
      d.hp -= baseDmg * f * 0.5;
      if (d.hp <= 0) this.requestRemove(d.body);
      this.impulse(d.body, x, y, f);
    }
    this.wakeAllDynamic();
    this.flushPending();
  }

  frostAt(x: number, y: number, radius: number, durMs: number): void {
    this.frostAreas.push({ x, y, radius, until: this.simTimeMs + durMs });
    for (const e of this.enemies.values()) {
      if (Math.hypot(e.body.position.x - x, e.body.position.y - y) <= radius) {
        e.slowUntilMs = Math.max(e.slowUntilMs, this.simTimeMs + durMs);
      }
    }
  }

  private impulse(body: Matter.Body, x: number, y: number, falloff: number): void {
    Sleeping.set(body, false);
    const dx = body.position.x - x;
    const dy = body.position.y - y;
    const d = Math.max(12, Math.hypot(dx, dy));
    const imp = 9 * falloff;
    Body.setVelocity(body, {
      x: body.velocity.x + (dx / d) * imp,
      y: body.velocity.y + (dy / d) * imp - 2 * falloff,
    });
  }

  getFrostViews(): readonly { x: number; y: number; radius: number; until: number }[] {
    return this.frostAreas.map((f) => ({ ...f }));
  }

  getDebrisViews(): readonly { x: number; y: number; angle: number; vertices: Vec[] }[] {
    return [...this.debris.values()].map(({ body }) => ({
      x: body.position.x, y: body.position.y, angle: body.angle,
      vertices: body.vertices.map((v) => ({ x: v.x, y: v.y })),
    }));
  }

  enemiesAlive(): number {
    return this.enemies.size;
  }

  // Public wake tool: mirrors the collapse path (structure damage wakes all).
  // Tests and tools use it; strategies have no reason to.
  wakeAll(): void {
    this.wakeAllDynamic();
  }

  // ---------- per-bird launch ----------

  launch(from: Vec, velocity: Vec, birdType: BirdId = 'woodpecker'): boolean {
    if (this.disposed || this.projectile) return false;
    const def = BIRDS[birdType];
    const body = Bodies.circle(from.x, from.y, def.radius, {
      density: def.density,
      frictionAir: CONFIG.projectile.frictionAir,
      friction: CONFIG.projectile.friction,
      restitution: CONFIG.projectile.restitution,
      label: 'projectile',
      collisionFilter: {
        category: CAT.BIRD,
        mask: CAT.ENV | CAT.BLOCK | CAT.ENEMY | CAT.DEBRIS,
      },
    });
    Body.setVelocity(body, { x: velocity.x, y: velocity.y });
    Composite.add(this.world, body);
    this.projectile = { body, birdType, ageMs: 0, slowMs: 0, firstHitDone: false };
    return true;
  }

  // ---------- queries ----------

  getBlockViews(): BlockView[] {
    const out: BlockView[] = [];
    for (const b of this.blocks.values()) {
      out.push({
        id: b.id,
        material: b.material,
        x: b.body.position.x,
        y: b.body.position.y,
        angle: b.body.angle,
        w: b.w,
        h: b.h,
        hp: b.hp,
        maxHp: b.maxHp,
      });
    }
    return out;
  }

  getTargetViews(): TargetView[] {
    const out: TargetView[] = [];
    for (const t of this.targets.values()) {
      out.push({
        id: t.id,
        x: t.body.position.x,
        y: t.body.position.y,
        angle: t.body.angle,
        hp: t.hp,
        maxHp: t.maxHp,
      });
    }
    return out;
  }

  getEnemyViews(): EnemyView[] {
    const out: EnemyView[] = [];
    for (const e of this.enemies.values()) {
      out.push({
        id: e.id,
        type: e.type,
        x: e.body.position.x,
        y: e.body.position.y,
        angle: e.body.angle,
        hp: e.hp,
        maxHp: e.maxHp,
        slowed: e.slowUntilMs > this.simTimeMs,
      });
    }
    return out;
  }

  getPlantViews(): PlantView[] {
    const out: PlantView[] = [];
    for (const p of this.plants.values()) {
      const d = PLANTS[p.plantId];
      out.push({
        slot: p.slot,
        plantId: p.plantId,
        x: this.slotXs[p.slot],
        y: this.geo.groundTop - d.h / 2,
        hp: p.hp,
        maxHp: p.maxHp,
      });
    }
    return out;
  }

  getShotViews(): { x: number; y: number }[] {
    return this.shots.map((s) => ({ x: s.body.position.x, y: s.body.position.y }));
  }

  targetsAlive(): number {
    return this.targets.size;
  }

  blockCount(): number {
    return this.blocks.size;
  }

  bodyCount(): number {
    return Composite.allBodies(this.world).length;
  }

  blockSnapshot(): Map<string, Vec> {
    const snap = new Map<string, Vec>();
    for (const b of this.blocks.values()) {
      snap.set(b.id, { x: b.body.position.x, y: b.body.position.y });
    }
    return snap;
  }

  targetSnapshot(): Map<string, Vec> {
    const snap = new Map<string, Vec>();
    for (const t of this.targets.values()) {
      snap.set(t.id, { x: t.body.position.x, y: t.body.position.y });
    }
    return snap;
  }

  isQuiet(): boolean {
    for (const b of Composite.allBodies(this.world)) {
      if (b.isStatic || b.isSleeping) continue;
      if (b.label === 'enemy' || b.label === 'shot') continue;
      if (Math.hypot(b.velocity.x, b.velocity.y) > 0.3) return false;
    }
    return true;
  }

  // Test/debug hooks (documented; game strategies must not use them).
  damageBlockById(id: string, dmg: number): boolean {
    const block = this.blockById.get(id);
    if (!block || block.dead) return false;
    const hp = Math.max(0, block.hp - dmg);
    block.hp = hp;
    if (hp <= 0) {
      this.requestRemove(block.body);
      this.flushPending();
    }
    return true;
  }

  damageTargetById(id: string, dmg: number): boolean {
    const target = this.targetById.get(id);
    if (!target || target.dead) return false;
    const hp = Math.max(0, target.hp - dmg);
    target.hp = hp;
    if (hp <= 0) {
      this.requestRemove(target.body);
      this.flushPending();
    }
    return true;
  }

  // ---------- trajectory preview ----------

  previewTrajectory(from: Vec, velocity: Vec): TrajectoryPreview {
    const probe = Bodies.circle(from.x, from.y, CONFIG.projectile.radius, {
      frictionAir: CONFIG.projectile.frictionAir,
      label: 'previewProbe',
    });
    Body.setVelocity(probe, { x: velocity.x, y: velocity.y });
    const points: Vec[] = [];
    let hit: Vec | null = null;
    const g = this.engine.gravity;
    for (let i = 0; i < CONFIG.preview.maxSteps && !hit; i++) {
      const prev = { x: probe.position.x, y: probe.position.y };
      probe.force.x += probe.mass * g.x * g.scale;
      probe.force.y += probe.mass * g.y * g.scale;
      Body.update(probe, FIXED_DT_MS, 1, 1);
      probe.force.x = 0;
      probe.force.y = 0;
      if (i % CONFIG.preview.dotEvery === 0 && points.length < CONFIG.preview.maxDots) {
        points.push({ x: probe.position.x, y: probe.position.y });
      }
      const bodies = Composite.allBodies(this.world);
      if (Query.ray(bodies, prev, probe.position, CONFIG.projectile.radius * 2).length > 0) {
        hit = { x: probe.position.x, y: probe.position.y };
      }
    }
    return { points, hit };
  }

  // ---------- disposal ----------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.projectile = null;
    Events.off(this.engine, 'collisionStart', this.collisionStartHandler);
    Events.off(this.engine, 'collisionActive', this.collisionActiveHandler);
    Events.off(this.engine, 'collisionEnd', this.collisionEndHandler);
    Composite.clear(this.world, false);
    Engine.clear(this.engine);
    this.blocks.clear();
    this.targets.clear();
    this.blockById.clear();
    this.targetById.clear();
    this.enemies.clear();
    this.enemyById.clear();
    this.plants.clear();
    this.shots = [];
    this.debris.clear();
    this.frostAreas = [];
    this.munchPairs.clear();
    this.pairCooldown.clear();
    this.pendingRemove = [];
  }
}
