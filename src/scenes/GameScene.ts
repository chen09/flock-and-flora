import Phaser from 'phaser';
import { CONFIG, VIEW, laneBandTop, laneGroundTop, laneBottomY } from '../config';
import { Hud } from '../hud';
import { BIRDS, PLANTS } from '../sim/entities';
import { MATERIALS } from '../materials';
import { GameSimulation } from '../sim/game';
import { buildLevel, type LevelConfig } from '../sim/levels';
import { PORTRAIT_IDS, portraitUrl } from '../art';
import { gardenAudio } from '../audio';
import { BlockView, LaneSimulation } from '../sim/lane';

interface Corner {
  x: number;
  y: number;
}

function rectCorners(x: number, y: number, w: number, h: number, angle: number): Corner[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;
  const pts: Corner[] = [];
  for (const [lx, ly] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ] as const) {
    pts.push({ x: x + lx * c - ly * s, y: y + lx * s + ly * c });
  }
  return pts;
}

function local(x: number, y: number, lx: number, ly: number, angle: number): Corner {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x + lx * c - ly * s, y: y + lx * s + ly * c };
}

function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export class GameScene extends Phaser.Scene {
  private sim!: GameSimulation;
  private gfx!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private levelIndex = 0;
  private config!: LevelConfig;
  private completed = false;
  private offEvents: (() => void)[] = [];
  private portraits = new Map<string, Phaser.GameObjects.Image>();
  private usedPortraits = new Set<string>();
  private feedback: { x: number; y: number; until: number; color: number }[] = [];
  private lastAmmo = 2;
  private hoverPoint: { x: number; y: number } | null = null;

  private aimText!: Phaser.GameObjects.Text;
  private pausedText!: Phaser.GameObjects.Text;
  private pausedSubText!: Phaser.GameObjects.Text;
  private winText!: Phaser.GameObjects.Text;
  private winSubText!: Phaser.GameObjects.Text;
  private loseText!: Phaser.GameObjects.Text;
  private loseSubText!: Phaser.GameObjects.Text;
  private hintAim!: Phaser.GameObjects.Text;

  private onBlur = () => this.sim.onWindowBlur();
  private onPointerCancel = () => this.sim.cancelAim('manual');

  constructor() {
    super({ key: 'game', active: false });
  }

  get simulation(): GameSimulation { return this.sim; }

  init(data: { levelIndex?: number }): void {
    this.levelIndex = data.levelIndex ?? 0;
    this.completed = false;
    this.hoverPoint = null;
    this.portraits = new Map();
    this.usedPortraits = new Set();
    this.offEvents = [];
    this.feedback = [];
    this.lastAmmo = 2;
  }

  preload(): void {
    for (const id of PORTRAIT_IDS) {
      if (!this.textures.exists(id)) this.load.svg(id, portraitUrl(id), { width: 128, height: 128 });
    }
  }

  create(): void {
    this.config = buildLevel(this.levelIndex);
    this.sim = new GameSimulation(this.config);
    this.gfx = this.add.graphics();
    this.hud = new Hud(this, this.sim);
    for (let i = this.sim.lanes.length; i < 3; i++) {
      this.add.text(44, laneBandTop(i) + 120, `第 ${i + 1} 条梯田 · 第 ${i === 1 ? 3 : 4} 关开放`, {
        fontFamily: 'sans-serif', fontSize: '18px', color: '#6b927d',
      }).setDepth(1);
    }
    this.buildOverlays();
    this.bindInput();
    const e = this.sim.events;
    this.offEvents.push(
      e.launched.on(() => gardenAudio.play('launch')),
      e.blockDestroyed.on((b) => { this.feedback.push({ x: b.x, y: b.y, until: this.sim.lanes[0].simTimeMs + 420, color: MATERIALS[b.material as keyof typeof MATERIALS].color }); gardenAudio.play('break'); if (!gardenAudio.reduceShake) this.cameras.main.shake(70, 0.0015); }),
      e.birdFirstHit.on(() => gardenAudio.play('impact')),
      e.resourceProduced.on(() => gardenAudio.play('income')),
      e.enemyKilled.on((e) => {
        const img = this.portraits.get(`enemy-${e.laneIndex}-${e.enemyId}`);
        if (img) this.feedback.push({ x: img.x, y: img.y, until: this.sim.lanes[0].simTimeMs + 250, color: 0xd57872 });
      }),
      e.enemyLeaked.on(() => gardenAudio.play('alarm')),
      e.plantPlanted.on(() => gardenAudio.play('plant')),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('pointercancel', this.onPointerCancel);
      for (const off of this.offEvents) off();
      this.offEvents = [];
      this.hud.destroy();
      this.sim.dispose();
      this.portraits.clear();
      gardenAudio.stop();
    });
  }

  private buildOverlays(): void {
    const cx = VIEW.width / 2;
    const cy = VIEW.height / 2;
    const style = { fontFamily: 'sans-serif', fontSize: '24px', color: '#14351f' };
    const big = { fontFamily: 'sans-serif', fontSize: '52px', color: '#14351f' };
    const sub = { fontFamily: 'sans-serif', fontSize: '22px', color: '#3a4a3f' };

    this.aimText = this.add
      .text(cx, 110, '瞄准中 · 全局时间已冻结（松手发射 · 拖回弹弓附近取消）', {
        ...style,
        backgroundColor: '#ffffffd9',
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.pausedText = this.add.text(cx, cy - 16, '已暂停', big).setOrigin(0.5).setVisible(false);
    this.pausedSubText = this.add
      .text(cx, cy + 40, '点击上方「继续」按钮恢复战斗', sub)
      .setOrigin(0.5)
      .setVisible(false);

    this.winText = this.add
      .text(cx, cy - 16, '梯田守住了！', { ...big, color: '#1b6b34' })
      .setOrigin(0.5)
      .setVisible(false);
    this.winSubText = this.add
      .text(cx, cy + 44, '点击上方「重新开始」再来一次', sub)
      .setOrigin(0.5)
      .setVisible(false);

    this.loseText = this.add
      .text(cx, cy - 16, '防线失守：家园生命耗尽', { ...big, color: '#8f2f22' })
      .setOrigin(0.5)
      .setVisible(false);
    this.loseSubText = this.add
      .text(cx, cy + 44, '点击上方「重新开始」重试', sub)
      .setOrigin(0.5)
      .setVisible(false);

    this.hintAim = this.add
      .text(230, 120, '先点上方卡片选植物/鸟；点空格位种植；点弹弓拖拽瞄准', {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        color: '#51432a',
        backgroundColor: '#ffffffb3',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0, 0.5)
      .setVisible(false);
  }

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      const pt = { x: p.x, y: p.y };
      if (this.sim.removeMode) {
        this.sim.tryRemove(pt);
        return;
      }
      if (this.sim.selectedPlant) {
        this.sim.tryPlant(pt);
        return;
      }
      this.sim.tryStartAim(pt);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      this.hoverPoint = { x: p.x, y: p.y };
      if (this.sim.aimActive) this.sim.updateAim({ x: p.x, y: p.y });
    });
    const release = () => {
      if (this.sim.aimActive) this.sim.releaseAim();
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, release);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, release);
    this.input.on(Phaser.Input.Events.GAME_OUT, () => {
      this.hoverPoint = null;
      this.sim.cancelAim('canvasExit');
    });
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointercancel', this.onPointerCancel);
  }

  update(_time: number, delta: number): void {
    this.sim.advance(delta);
    if (this.sim.regulator.ammo > this.lastAmmo) gardenAudio.play('ammo');
    this.lastAmmo = this.sim.regulator.ammo;
    this.redraw();
    this.hud.update();
    this.updateOverlays();
    if (!this.completed && (this.sim.phase === 'won' || this.sim.phase === 'lost')) {
      this.completed = true;
      const won = this.sim.phase === 'won';
      const stars = [won, won && this.sim.stats.leaks === 0, won && this.config.star.special.check(this.sim.stats)];
      if (won) gardenAudio.play('win');
      this.game.events.emit('campaign-end', { levelIndex: this.levelIndex, won, stars, stats: { ...this.sim.stats } });
    }
  }

  private updateOverlays(): void {
    const phase = this.sim.phase;
    const canShoot =
      phase === 'running' && this.sim.regulator.ammo > 0 && !this.sim.aimActive;
    this.hintAim.setVisible(canShoot && !this.sim.selectedPlant && !this.sim.removeMode);
    this.aimText.setVisible(phase === 'aiming');
    this.pausedText.setVisible(phase === 'paused');
    this.pausedSubText.setVisible(phase === 'paused');
    this.winText.setVisible(false);
    this.winSubText.setVisible(false);
    this.loseText.setVisible(false);
    this.loseSubText.setVisible(false);
  }

  private redraw(): void {
    const g = this.gfx;
    g.clear();
    this.usedPortraits.clear();

    // HUD strip
    g.fillStyle(0xdde8da, 1);
    g.fillRect(0, 0, VIEW.width, 90);
    g.lineStyle(2, 0x9db89a, 1);
    g.lineBetween(0, 90, VIEW.width, 90);

    for (let i = 0; i < 3; i++) {
      const bandTop = laneBandTop(i);
      const groundTop = laneGroundTop(i);
      const laneBottom = laneBottomY(i);
      // band backdrop
      g.fillStyle([0xd7e9e4, 0xc9dfd3, 0xbcd6c5][i], 1);
      g.fillRect(0, bandTop, VIEW.width, laneBottom - bandTop);
      // Distant folded hills and terrace ledges, deliberately quiet behind
      // the actionable silhouettes. All procedural decoration is static.
      for (let h = 0; h < 2; h++) {
        g.fillStyle(h ? 0x9ebfaa : 0xb6cfc5, 0.55);
        const points = [{ x: 0, y: groundTop }];
        for (let x = 0; x <= VIEW.width; x += 90) points.push({ x, y: bandTop + 95 + h * 48 + Math.sin(x / 195 + i * 2 + h) * 35 });
        points.push({ x: VIEW.width, y: groundTop });
        g.fillPoints(points, true);
      }
      g.lineStyle(2, 0xe2ecd1, 0.55);
      for (let x = 30; x < VIEW.width; x += 180) g.lineBetween(x, groundTop - 72, x + 110, groundTop - 83);
      // ceiling hint line
      g.fillStyle(0x9fb39a, 1);
      g.fillRect(0, bandTop + 6, VIEW.width, 2);
      // ground strip
      g.fillStyle(0x8a5a33, 1);
      g.fillRect(0, groundTop, VIEW.width, laneBottom - groundTop);
      g.fillStyle(0x4f8056, 1);
      g.fillRect(0, groundTop, VIEW.width, 7);
      g.lineStyle(1, 0xd2ad78, 0.45);
      for (let x = 5; x < VIEW.width; x += 27) {
        g.lineBetween(x, groundTop + 16 + (x % 7), x + 11, groundTop + 18 + (x % 7));
        g.lineStyle(2, 0x4f8056, 0.8);
        g.lineBetween(x, groundTop, x + 3, groundTop - 7);
        g.lineStyle(1, 0xd2ad78, 0.45);
      }
      // separators
      g.fillStyle(0x9fb39a, 1);
      g.fillRect(0, laneBottom - 2, VIEW.width, 2);

      const lane = this.sim.lanes[i];
      if (!lane) continue;
      for (const f of lane.getFrostViews()) {
        g.fillStyle(0xb7e6eb, 0.16); g.fillCircle(f.x, f.y, f.radius);
        g.lineStyle(2, 0x679fb8, 0.5); g.strokeCircle(f.x, f.y, f.radius);
      }
      for (const d of lane.getDebrisViews()) {
        g.fillStyle(0xba9f78, 0.9); g.fillPoints([...d.vertices], true);
        g.lineStyle(1, 0x654f39, 0.8); g.strokePoints([...d.vertices], true, true);
      }
      this.drawSlots(g, lane, i);
      this.drawSling(g, lane);
      for (const b of lane.getBlockViews()) this.drawBlock(g, b, lane);
      for (const t of lane.getTargetViews()) this.drawTarget(g, t);
      for (const pl of lane.getPlantViews()) {
        const plantImg = this.image(`plant-${i}-${pl.slot}`, pl.plantId, pl.x, pl.y - 5, 58, 58);
        const firing = pl.plantId === 'pea' && lane.getShotViews().some((s) => Math.abs(s.x - pl.x) < 55);
        plantImg.setAngle(firing ? -6 : 0);
        this.hurtFlash(plantImg, pl.hp);
        if (pl.hp < pl.maxHp) this.health(g, pl.x, pl.y - 37, pl.hp / pl.maxHp, 0x428b58);
      }
      for (const e of lane.getEnemyViews()) {
        const size = e.type === 'swarm' ? 39 : e.type === 'armor' ? 62 : 53;
        const img = this.image(`enemy-${i}-${e.id}`, e.type, e.x, e.y, size, size);
        img.setRotation(e.angle * 0.15).setTint(e.slowed ? 0xadd9f2 : 0xffffff);
        this.hurtFlash(img, e.hp, e.slowed ? 0xadd9f2 : 0xffffff);
        if (e.hp < e.maxHp) this.health(g, e.x, e.y - size / 2 - 4, e.hp / e.maxHp, 0xd57872);
      }
      for (const s of lane.getShotViews()) {
        g.fillStyle(0x2f7d3a, 1);
        g.fillCircle(s.x, s.y, CONFIG.plants.peaShot.radius);
        g.lineStyle(2, 0xc9e9a4, 0.65); g.lineBetween(s.x - 13, s.y, s.x - 4, s.y);
      }
      this.drawProjectile(lane);
      if (this.sim.aimActive && this.sim.aimLaneIndex === i) this.drawAimAssist(g, lane, i);
      if (this.sim.selectedPlant || this.sim.removeMode) this.drawPlacementPreview(g, i);
    }
    const now = this.sim.lanes[0].simTimeMs;
    this.feedback = this.feedback.filter((f) => f.until > now);
    for (const f of this.feedback) {
      const life = (f.until - now) / 420;
      g.lineStyle(2, f.color, Math.max(0, life));
      g.strokeCircle(f.x, f.y, 12 + (1 - life) * 24);
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3;
        const d = 12 + (1 - life) * 30;
        g.fillStyle(f.color, Math.max(0, life));
        g.fillRect(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 4, 4);
      }
    }
    for (const [key, img] of this.portraits) {
      if (!this.usedPortraits.has(key)) { img.destroy(); this.portraits.delete(key); }
    }
  }

  private image(key: string, texture: string, x: number, y: number, w: number, h: number): Phaser.GameObjects.Image {
    this.usedPortraits.add(key);
    let img = this.portraits.get(key);
    if (!img) { img = this.add.image(x, y, texture).setDepth(3); this.portraits.set(key, img); }
    return img.setTexture(texture).setPosition(x, y).setDisplaySize(w, h);
  }

  private hurtFlash(image: Phaser.GameObjects.Image, hp: number, normalTint = 0xffffff): void {
    const previous: number | undefined = image.getData('hp');
    const now = this.sim.lanes[0].simTimeMs;
    if (previous !== undefined && hp < previous) image.setData('hurtUntil', now + 130);
    image.setData('hp', hp);
    image.setTint((image.getData('hurtUntil') ?? 0) > now ? 0xffbbb0 : normalTint);
  }

  private health(g: Phaser.GameObjects.Graphics, x: number, y: number, ratio: number, color: number): void {
    g.fillStyle(0x193f40, 0.8); g.fillRoundedRect(x - 19, y, 38, 4, 2);
    g.fillStyle(color, 1); g.fillRoundedRect(x - 18, y, 36 * Math.max(0, ratio), 3, 2);
  }

  private drawSlots(g: Phaser.GameObjects.Graphics, lane: LaneSimulation, laneIndex: number): void {
    const groundTop = laneGroundTop(laneIndex);
    const mode = this.sim.removeMode ? 'remove' : this.sim.selectedPlant ? 'plant' : null;
    for (let slot = 0; slot < CONFIG.plants.slotsPerLane; slot++) {
      const x = CONFIG.plants.slotXStart + slot * CONFIG.plants.slotSpacing;
      const occupied = lane.hasPlantAt(slot);
      let color = 0x6a9a5a;
      let alpha = 0.25;
      if (mode === 'remove') {
        color = occupied ? 0xd8543f : 0x888888;
        alpha = occupied ? 0.5 : 0.12;
      } else {
        const plant = this.sim.selectedPlant;
        const afford = !!plant && this.sim.resources >= PLANTS[plant].cost && this.sim.plantCooldownRemainingMs(plant) === 0;
        color = occupied ? 0xd8543f : afford ? 0x2f8d3a : 0xaaaaaa;
        alpha = occupied ? 0.45 : afford ? 0.4 : 0.15;
      }
      g.lineStyle(2, color, alpha);
      g.strokeRect(x - 22, groundTop - 64, 44, 64);
    }
  }

  private drawPlacementPreview(g: Phaser.GameObjects.Graphics, laneIndex: number): void {
    if (!this.hoverPoint) return;
    if (this.sim.laneAtPoint(this.hoverPoint) !== laneIndex) return;
    const groundTop = laneGroundTop(laneIndex);
    const slot = Math.round((this.hoverPoint.x - CONFIG.plants.slotXStart) / CONFIG.plants.slotSpacing);
    if (slot < 0 || slot >= CONFIG.plants.slotsPerLane) return;
    const x = CONFIG.plants.slotXStart + slot * CONFIG.plants.slotSpacing;
    const lane = this.sim.lanes[laneIndex];
    const occupied = lane.hasPlantAt(slot);
    g.fillStyle(this.sim.removeMode ? 0xd8543f : 0x2f8d3a, occupied ? 0.35 : 0.2);
    g.fillRect(x - 24, groundTop - 66, 48, 66);
  }

  private drawSling(g: Phaser.GameObjects.Graphics, lane: LaneSimulation): void {
    const a = lane.slingAnchor();
    const groundTop = lane.geo.groundTop;
    if (!lane.projectile && !(this.sim.aimActive && this.sim.aimLaneIndex === lane.laneIndex)) {
      this.image(`perch-${lane.laneIndex}`, this.sim.selectedBird, a.x, a.y - 8, 44, 44);
    }
    g.fillStyle(0x5d4024, 1);
    g.fillRect(a.x - 5, a.y, 10, groundTop - a.y);
    g.lineStyle(5, 0x5d4024, 1);
    g.beginPath();
    g.moveTo(a.x - 12, a.y - 14);
    g.lineTo(a.x, a.y);
    g.lineTo(a.x + 12, a.y - 14);
    g.strokePath();
  }

  private drawAimAssist(g: Phaser.GameObjects.Graphics, lane: LaneSimulation, laneIndex: number): void {
    if (this.sim.aimLaneIndex !== laneIndex) return;
    const a = lane.slingAnchor();
    const plan = this.sim.currentAimLaunch();
    if (!plan) return;
    g.lineStyle(2, 0x555555, 0.4);
    g.lineBetween(a.x, a.y, this.sim.aimPoint.x, this.sim.aimPoint.y);
    const traj = lane.previewTrajectory(plan.spawn, plan.velocity);
    const birdDef = BIRDS[this.sim.selectedBird];
    g.fillStyle(birdDef.color, 0.45);
    for (const pt of traj.points) g.fillCircle(pt.x, pt.y, 3.5);
    if (traj.hit) {
      g.lineStyle(2, 0xd8543f, 0.8);
      g.strokeCircle(traj.hit.x, traj.hit.y, 6);
    }
    const color = plan.strongEnough ? 0x4a2f1b : 0x9a6a4a;
    const dx = this.sim.aimPoint.x - a.x;
    const dy = this.sim.aimPoint.y - a.y;
    const pullScale = Math.min(1, CONFIG.sling.maxPull / Math.max(1, Math.hypot(dx, dy)));
    const pulled = { x: a.x + dx * pullScale, y: a.y + dy * pullScale };
    g.lineStyle(3, color, 1);
    g.lineBetween(a.x - 12, a.y - 14, pulled.x, pulled.y);
    g.lineBetween(a.x + 12, a.y - 14, pulled.x, pulled.y);
    this.image('aim-bird', this.sim.selectedBird, pulled.x, pulled.y, 40, 40).setAlpha(plan.strongEnough ? 1 : 0.5);
  }

  private drawBlock(g: Phaser.GameObjects.Graphics, b: BlockView, lane: LaneSimulation): void {
    const def = MATERIALS[b.material];
    const pts = rectCorners(b.x, b.y, b.w, b.h, b.angle);
    const isCore = lane.towerAlive && (b.id.startsWith('core-') || b.id === 'nestcore');
    g.fillStyle(def.color, b.material === 'crystal' ? 0.92 : 1);
    g.fillPoints(pts, true);
    g.lineStyle(isCore ? 3 : 2, isCore ? 0xd9a520 : def.edgeColor, 1);
    g.strokePoints(pts, true, true);

    const r = idHash(b.id);
    if (b.material === 'wood') {
      const along = b.w >= b.h;
      g.lineStyle(1, def.edgeColor, 0.55);
      for (const off of [-b.w / 6, b.w / 6]) {
        const p1 = along
          ? local(b.x, b.y, -b.w / 2 + 8, off * (b.h / b.w), b.angle)
          : local(b.x, b.y, off, -b.h / 2 + 8, b.angle);
        const p2 = along
          ? local(b.x, b.y, b.w / 2 - 8, off * (b.h / b.w), b.angle)
          : local(b.x, b.y, off, b.h / 2 - 8, b.angle);
        g.lineBetween(p1.x, p1.y, p2.x, p2.y);
      }
    } else if (b.material === 'crystal') {
      const d = Math.min(b.w, b.h) * 0.22;
      g.lineStyle(2, 0xffffff, 0.75);
      const q1 = local(b.x, b.y, -d, -d, b.angle);
      const q2 = local(b.x, b.y, d, d, b.angle);
      const q3 = local(b.x, b.y, -d, d, b.angle);
      const q4 = local(b.x, b.y, d, -d, b.angle);
      g.lineBetween(q1.x, q1.y, q2.x, q2.y);
      g.lineBetween(q3.x, q3.y, q4.x, q4.y);
    } else {
      g.fillStyle(0x6f7178, 0.8);
      for (let i = 0; i < 3; i++) {
        const lx = ((r * 977) % 1 - 0.5) * b.w * 0.6;
        const ly = (((r * 613 + i * 331) % 1) - 0.5) * b.h * 0.6;
        const p = local(b.x, b.y, lx, ly, b.angle);
        g.fillCircle(p.x, p.y, 2);
      }
    }
    if (b.id === 'nc-chassis') {
      for (const off of [-95, 95]) {
        const wheel = local(b.x, b.y, off, 8, b.angle);
        g.fillStyle(0x274846, 1); g.fillCircle(wheel.x, wheel.y, 17);
        g.lineStyle(3, 0xdbbc7b, 1); g.strokeCircle(wheel.x, wheel.y, 11);
      }
    }
    if (isCore) {
      // core hp pips
      const ratio = b.hp / b.maxHp;
      g.fillStyle(0xd9a520, 0.9);
      g.fillRect(b.x - 20, b.y - b.h / 2 - 8, 40 * ratio, 4);
    }
    const ratio = b.hp / b.maxHp;
    const cracks = ratio <= 0.33 ? 2 : ratio <= 0.66 ? 1 : 0;
    if (cracks > 0) {
      g.lineStyle(2, 0x2e2a26, 0.85);
      for (let i = 0; i < cracks; i++) {
        const x0 = -b.w / 2 + 6 + (((r * 7 + i * 3) % 1) * b.w) * 0.4;
        const c1 = local(b.x, b.y, x0, -b.h / 2 + 4, b.angle);
        const c2 = local(b.x, b.y, x0 + b.w * 0.12, 0, b.angle);
        const c3 = local(b.x, b.y, x0 - b.w * 0.06, b.h / 2 - 4, b.angle);
        g.lineBetween(c1.x, c1.y, c2.x, c2.y);
        g.lineBetween(c2.x, c2.y, c3.x, c3.y);
      }
    }
  }

  private drawTarget(g: Phaser.GameObjects.Graphics, t: { x: number; y: number; angle: number }): void {
    const pts = rectCorners(t.x, t.y, CONFIG.target.w, CONFIG.target.h, t.angle);
    g.fillStyle(0xd8543f, 1);
    g.fillPoints(pts, true);
    g.lineStyle(2, 0x8f2f22, 1);
    g.strokePoints(pts, true, true);
  }

  private drawProjectile(lane: LaneSimulation): void {
    const p = lane.projectile;
    if (!p) return;
    const def = BIRDS[p.birdType];
    const { x, y } = p.body.position;
    this.image(`bird-${lane.laneIndex}`, p.birdType, x, y, def.radius * 3, def.radius * 3).setRotation(p.body.angle * 0.2);
  }
}
