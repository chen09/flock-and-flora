// Entity catalogs for M2: plants, enemies, birds. Pure data + helpers, no physics.

export type PlantId = 'dawn' | 'pea' | 'shell' | 'frost' | 'nest';
export type EnemyId = 'normal' | 'runner' | 'armor' | 'swarm';
export type BirdId = 'woodpecker' | 'owlbomb' | 'frostswallow';

export interface PlantDef {
  id: PlantId;
  nameZh: string;
  cost: number;
  cooldownMs: number;
  hp: number;
  w: number;
  h: number;
  color: number;
  roleZh: string;
  solid: boolean; // has a physical body (壳盾藤 blocks enemies)
}

export const PLANTS: Record<PlantId, PlantDef> = {
  dawn: {
    id: 'dawn', nameZh: '晨露花', cost: 50, cooldownMs: 7000, hp: 30, w: 36, h: 44,
    color: 0xf2d05e, roleZh: '生产资源', solid: false,
  },
  pea: {
    id: 'pea', nameZh: '连荚草', cost: 100, cooldownMs: 7000, hp: 40, w: 34, h: 46,
    color: 0x63b25e, roleZh: '本路射击', solid: false,
  },
  shell: {
    id: 'shell', nameZh: '壳盾藤', cost: 75, cooldownMs: 9000, hp: 220, w: 40, h: 64,
    color: 0x8f9a58, roleZh: '阻挡敌人', solid: true,
  },
  frost: {
    id: 'frost', nameZh: '霜铃草', cost: 75, cooldownMs: 9000, hp: 30, w: 34, h: 44,
    color: 0x9fd4e8, roleZh: '范围减速', solid: false,
  },
  nest: {
    id: 'nest', nameZh: '栖羽树', cost: 125, cooldownMs: 12000, hp: 60, w: 44, h: 60,
    color: 0xb0713c, roleZh: '补充弹药', solid: false,
  },
};

export interface EnemyDef {
  id: EnemyId;
  nameZh: string;
  hp: number;
  w: number;
  h: number;
  speed: number; // px per fixed step (walking left)
  color: number;
  munchDps: number;
  plantShotScale: number; // damage taken from 连荚草 shots
  packSize: number; // spawned per spawn entry
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  normal: {
    id: 'normal', nameZh: '普通虫兵', hp: 55, w: 30, h: 40, speed: 0.7,
    color: 0xc25b4a, munchDps: 6, plantShotScale: 1, packSize: 1,
  },
  runner: {
    id: 'runner', nameZh: '疾跑虫', hp: 40, w: 26, h: 36, speed: 1.7,
    color: 0xe0913f, munchDps: 6, plantShotScale: 1, packSize: 1,
  },
  armor: {
    id: 'armor', nameZh: '甲壳虫', hp: 140, w: 40, h: 46, speed: 0.7,
    color: 0x6b7ba6, munchDps: 8, plantShotScale: 0.35, packSize: 1,
  },
  swarm: {
    id: 'swarm', nameZh: '群集小虫', hp: 22, w: 22, h: 28, speed: 1.1,
    color: 0xa45fb2, munchDps: 5, plantShotScale: 1, packSize: 3,
  },
};

export interface BirdDef {
  id: BirdId;
  nameZh: string;
  ammoCost: number;
  radius: number;
  density: number;
  color: number;
  roleZh: string;
}

export const BIRDS: Record<BirdId, BirdDef> = {
  woodpecker: {
    id: 'woodpecker', nameZh: '凿木雀', ammoCost: 1, radius: 13, density: 0.006,
    color: 0x3f6fd8, roleZh: '单体撞击',
  },
  owlbomb: {
    id: 'owlbomb', nameZh: '爆栗鸮', ammoCost: 2, radius: 15, density: 0.007,
    color: 0xc06a32, roleZh: '首次撞击爆炸',
  },
  frostswallow: {
    id: 'frostswallow', nameZh: '霜翎燕', ammoCost: 1, radius: 13, density: 0.004,
    color: 0x7fb7d9, roleZh: '首次撞击减速场',
  },
};

export const BIRD_ORDER: BirdId[] = ['woodpecker', 'owlbomb', 'frostswallow'];
export const PLANT_ORDER: PlantId[] = ['dawn', 'pea', 'shell', 'frost', 'nest'];

// Matter collision categories. A pair collides only when BOTH bodies include
// the other's category in their mask. Blocks/debris switch their ENEMY bit
// dynamically: standing (slow/asleep) blocks never trap walking enemies;
// fast-moving (falling) blocks crush them.
export const CAT = {
  ENV: 0x0001,
  BLOCK: 0x0002,
  BIRD: 0x0004,
  ENEMY: 0x0008,
  PLANT: 0x0010,
  SHOT: 0x0020,
  DEBRIS: 0x0040,
  // Walls exist to keep birds/debris inside. Enemies deliberately do NOT
  // collide with walls: they must walk off the left edge to leak.
  WALL: 0x0080,
} as const;
