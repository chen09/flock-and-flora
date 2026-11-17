import { laneGroundTop } from "../config";
import type { BirdId, PlantId } from "./entities";
import type { LaneLevelDef } from "./lane";
import type { M2LevelDef } from "./game";

export interface SpecialStats {
  launched: number;
  kills: number;
  towersDown: number;
  plantsPlanted: number;
  nestRefills: number;
  nestCarPartsBroken: number;
  reinforcementsCancelled: number;
}

// M3: data-driven eight levels. Each level is a full LevelConfig; lane count,
// available units, towers, waves, preset plants, star rules and tutorial
// hints are all data. Nothing here is balance-scaled copies of one layout:
// tower shapes, materials, wave mixes and unlock sets differ per level
// (PLAN section 3).

export interface StarRules {
  // Star 1 is always "clear the level"; star 2 is no-leak (noLeakZh).
  noLeakZh: string;
  special: { zh: string; check: (s: SpecialStats) => boolean };
}

export interface TutorialStep {
  atMs: number;
  textZh: string;
}

export interface LevelConfig extends M2LevelDef {
  id: number; // 1..8
  nameZh: string;
  unlockZh: string; // what this level introduces
  laneCount: 1 | 2 | 3;
  availablePlants: PlantId[];
  availableBirds: BirdId[];
  startResources: number;
  lives: number;
  presetPlants: { lane: number; slot: number; plant: PlantId }[];
  star: StarRules;
  tutorial: TutorialStep[];
}
const G = (laneIndex: number) => laneGroundTop(laneIndex);

// Tower templates -----------------------------------------------------------

/** Simple wooden watch tower: two legs + plank + wooden core (L1/L2). */
function woodenTower(laneIndex: number): LaneLevelDef {
  const g = G(laneIndex);
  const s = String(laneIndex);
  return {
    laneIndex,
    sling: { x: 170, y: g - 50 },
    coreId: `core-l${s}`,
    blocks: [
      { id: `leg-l${s}-a`, x: 1030, y: g - 45, w: 24, h: 90, material: "wood" },
      { id: `leg-l${s}-b`, x: 1170, y: g - 45, w: 24, h: 90, material: "wood" },
      {
        id: `plank-l${s}`,
        x: 1100,
        y: g - 101,
        w: 220,
        h: 22,
        material: "wood",
      },
      { id: `core-l${s}`, x: 1100, y: g - 143, w: 60, h: 60, material: "wood" },
    ],
  };
}

/** Stone-capped tower with crystals (M2 style, used mid-game). */
function mixedTower(laneIndex: number): LaneLevelDef {
  const g = G(laneIndex);
  const s = String(laneIndex);
  return {
    laneIndex,
    sling: { x: 170, y: g - 50 },
    coreId: `core-l${s}`,
    blocks: [
      { id: `leg-l${s}-a`, x: 1030, y: g - 45, w: 24, h: 90, material: "wood" },
      { id: `leg-l${s}-b`, x: 1170, y: g - 45, w: 24, h: 90, material: "wood" },
      {
        id: `slab-l${s}`,
        x: 1100,
        y: g - 101,
        w: 220,
        h: 22,
        material: "stone",
      },
      {
        id: `crystal-l${s}-a`,
        x: 1052,
        y: g - 134,
        w: 44,
        h: 44,
        material: "crystal",
      },
      {
        id: `crystal-l${s}-b`,
        x: 1148,
        y: g - 134,
        w: 44,
        h: 44,
        material: "crystal",
      },
      {
        id: `core-l${s}`,
        x: 1100,
        y: g - 178,
        w: 60,
        h: 56,
        material: "stone",
      },
    ],
  };
}

/** Crystal greenhouse: wide brittle posts under a light wood canopy. */
function crystalHouse(laneIndex: number): LaneLevelDef {
  const lane = woodenTower(laneIndex);
  lane.blocks = lane.blocks.map((b) =>
    b.id.includes("leg")
      ? { ...b, material: "crystal", w: 44 }
      : b.id.includes("core")
        ? { ...b, material: "crystal" }
        : b,
  );
  return lane;
}

/** Low stone bridge: accessible wooden piers, heavy falling arch. */
function stoneBridge(laneIndex: number): LaneLevelDef {
  const g = G(laneIndex);
  return {
    laneIndex,
    sling: { x: 170, y: g - 50 },
    coreId: `core-l${laneIndex}`,
    blocks: [
      {
        id: `pier-${laneIndex}-a`,
        x: 1000,
        y: g - 35,
        w: 36,
        h: 70,
        material: "wood",
      },
      {
        id: `pier-${laneIndex}-b`,
        x: 1190,
        y: g - 35,
        w: 36,
        h: 70,
        material: "wood",
      },
      {
        id: `arch-${laneIndex}`,
        x: 1095,
        y: g - 84,
        w: 250,
        h: 28,
        material: "stone",
      },
      {
        id: `core-l${laneIndex}`,
        x: 1095,
        y: g - 126,
        w: 64,
        h: 56,
        material: "wood",
      },
    ],
  };
}

/**
 * L8 nest car (middle lane): a two-storey beetle wagon. Phase 1 parts are the
 * two side gantries physically shelter the core. Destroying both wooden posts
 * advances the deployment phase early; otherwise it advances at 125 seconds.
 * Finite second-stage waves arrive at 155/165/175s, then a combined 200s assault.
 * Neither core destruction nor a phase transition is a victory prerequisite.
 */
function nestCarLane(): LaneLevelDef {
  const g = G(1);
  return {
    laneIndex: 1,
    sling: { x: 170, y: g - 50 },
    coreId: "nestcore",
    blocks: [
      // wheels / chassis
      {
        id: "nc-chassis",
        x: 1100,
        y: g - 16,
        w: 300,
        h: 32,
        material: "stone",
      },
      { id: "nc-leg-a", x: 1000, y: g - 62, w: 24, h: 60, material: "wood" },
      { id: "nc-leg-b", x: 1200, y: g - 62, w: 24, h: 60, material: "wood" },
      // lower deck
      { id: "nc-deck", x: 1100, y: g - 108, w: 260, h: 22, material: "stone" },
      // phase-1 part A: left 护架 + crystals
      {
        id: "nc-partA-post",
        x: 1030,
        y: g - 140,
        w: 20,
        h: 40,
        material: "wood",
      },
      {
        id: "nc-partA-top",
        x: 1030,
        y: g - 168,
        w: 76,
        h: 16,
        material: "wood",
      },
      {
        id: "nc-partA-cr",
        x: 1030,
        y: g - 196,
        w: 40,
        h: 40,
        material: "crystal",
      },
      // phase-1 part B: right 护架 + crystals
      {
        id: "nc-partB-post",
        x: 1170,
        y: g - 140,
        w: 20,
        h: 40,
        material: "wood",
      },
      {
        id: "nc-partB-top",
        x: 1170,
        y: g - 168,
        w: 76,
        h: 16,
        material: "wood",
      },
      {
        id: "nc-partB-cr",
        x: 1170,
        y: g - 196,
        w: 40,
        h: 40,
        material: "crystal",
      },
      // core sits between the gantries, on the lower deck, sheltered
      { id: "nestcore", x: 1100, y: g - 152, w: 60, h: 64, material: "stone" },
    ],
  };
}

// Star special checks reuse run stats; each is visible in the level intro.
const star = {
  shotsAtMost: (n: number, zh: string) => ({
    zh,
    check: (s: { launched: number }) => s.launched <= n,
  }),
  plantsAtLeast: (n: number, zh: string) => ({
    zh,
    check: (s: { plantsPlanted: number }) => s.plantsPlanted >= n,
  }),
  towersAtLeast: (n: number, zh: string) => ({
    zh,
    check: (s: { towersDown: number }) => s.towersDown >= n,
  }),
  killsAtLeast: (n: number, zh: string) => ({
    zh,
    check: (s: { kills: number }) => s.kills >= n,
  }),
  nestRefill: (zh: string) => ({
    zh,
    check: (s: { nestRefills: number }) => s.nestRefills >= 1,
  }),
  gantryParts: (zh: string) => ({
    zh,
    check: (s: { nestCarPartsBroken: number }) => s.nestCarPartsBroken >= 2,
  }),
};

// Levels --------------------------------------------------------------------

export function level1(): LevelConfig {
  const base = woodenTower(0);
  return {
    id: 1,
    nameZh: "第一声鸟鸣",
    unlockZh: "单路 · 凿木雀 · 木塔",
    laneCount: 1,
    availablePlants: [],
    availableBirds: ["woodpecker"],
    startResources: 0,
    lives: 3,
    presetPlants: [{ lane: 0, slot: 4, plant: "pea" }],
    lanes: [base],
    baseWaves: [
      { atMs: 30000, lane: 0, type: "normal", count: 1 },
      { atMs: 70000, lane: 0, type: "normal", count: 1 },
      { atMs: 105000, lane: 0, type: "normal", count: 1 },
    ],
    reinforcements: [],
    star: {
      noLeakZh: "家园无损：没有虫子越过田埂",
      special: {
        zh: "精准拆塔：最多使用 4 发，并拆毁木塔",
        check: (s) => s.launched <= 4 && s.towersDown >= 1,
      },
    },
    tutorial: [
      { atMs: 500, textZh: "按住弹弓拖拽瞄准——瞄准时全场时间冻结" },
      { atMs: 4000, textZh: "先打木支撑腿：塔塌下来比砸核心有效" },
      { atMs: 30000, textZh: "虫子出现时，在它走进田里之前打中它" },
    ],
  };
}

export function level2(): LevelConfig {
  return {
    id: 2,
    nameZh: "花园开始工作",
    unlockZh: "晨露花 · 连荚草 · 种植资源",
    laneCount: 1,
    availablePlants: ["dawn", "pea"],
    availableBirds: ["woodpecker"],
    startResources: 100,
    lives: 3,
    presetPlants: [],
    lanes: [woodenTower(0)],
    baseWaves: [
      { atMs: 40000, lane: 0, type: "normal", count: 1 },
      { atMs: 75000, lane: 0, type: "normal", count: 2 },
      { atMs: 110000, lane: 0, type: "normal", count: 1 },
      { atMs: 145000, lane: 0, type: "normal", count: 1 },
    ],
    reinforcements: [],
    star: {
      noLeakZh: "家园无损：没有虫子越过田埂",
      special: star.plantsAtLeast(2, "花园经营：种下至少 2 株植物"),
    },
    tutorial: [
      { atMs: 500, textZh: "点上方「晨露花」卡片，再点路里的空格位种植" },
      { atMs: 6000, textZh: "晨露花会持续产出资源；连荚草会自动射击本路敌人" },
      { atMs: 38000, textZh: "敌人到来时，连荚草会开火，你也可以用弹弓支援" },
    ],
  };
}

export function level3(): LevelConfig {
  return {
    id: 3,
    nameZh: "上下两难",
    unlockZh: "第二路 · 壳盾藤 · 共享弹药",
    laneCount: 2,
    availablePlants: ["dawn", "pea", "shell"],
    availableBirds: ["woodpecker"],
    startResources: 125,
    lives: 3,
    presetPlants: [{ lane: 0, slot: 0, plant: "dawn" }],
    lanes: [woodenTower(0), woodenTower(1)],
    baseWaves: [
      { atMs: 30000, lane: 0, type: "normal", count: 1 },
      { atMs: 45000, lane: 1, type: "normal", count: 1 },
      { atMs: 80000, lane: 0, type: "normal", count: 1 },
      { atMs: 95000, lane: 1, type: "normal", count: 2 },
      { atMs: 125000, lane: 0, type: "normal", count: 2 },
      { atMs: 180000, lane: 1, type: "normal", count: 1 },
    ],
    reinforcements: [],
    star: {
      noLeakZh: "两路都守住：没有虫子越过田埂",
      special: star.shotsAtMost(6, "节约弹药：最多使用 6 发"),
    },
    tutorial: [
      { atMs: 500, textZh: "第二条路开放了！弹药与资源两路共享" },
      { atMs: 8000, textZh: "壳盾藤能挡住虫子让它们啃盾——争取输出时间" },
      { atMs: 28000, textZh: "哪一路快守不住，就用弹弓救哪一路" },
    ],
  };
}

export function level4(): LevelConfig {
  const g0 = { ...mixedTower(0) };
  const g1 = { ...mixedTower(1) };
  const g2 = { ...mixedTower(2) };
  return {
    id: 4,
    nameZh: "拆掉援军",
    unlockZh: "完整三路 · 巢塔增援预告",
    laneCount: 3,
    availablePlants: ["dawn", "pea", "shell"],
    availableBirds: ["woodpecker"],
    startResources: 150,
    lives: 3,
    presetPlants: [{ lane: 1, slot: 0, plant: "dawn" }],
    lanes: [g0, g1, g2],
    baseWaves: [
      { atMs: 30000, lane: 1, type: "normal", count: 1 },
      { atMs: 55000, lane: 0, type: "normal", count: 1 },
      { atMs: 80000, lane: 2, type: "normal", count: 1 },
      { atMs: 100000, lane: 1, type: "normal", count: 1 },
      { atMs: 125000, lane: 0, type: "normal", count: 2 },
      { atMs: 195000, lane: 2, type: "normal", count: 2 },
    ],
    reinforcements: [
      { atMs: 110000, lane: 0, type: "normal", count: 6, towerLane: 0 },
      { atMs: 135000, lane: 1, type: "normal", count: 4, towerLane: 1 },
      { atMs: 160000, lane: 2, type: "normal", count: 4, towerLane: 2 },
    ],
    star: {
      noLeakZh: "三路全守：没有虫子越过田埂",
      special: {
        zh: "及时拆塔：取消至少一批尚未生成的援军",
        check: (s) => s.reinforcementsCancelled >= 1,
      },
    },
    tutorial: [
      {
        atMs: 500,
        textZh: "塔上的旗帜是援军预告：拆掉塔，未来的增援就不会出现",
      },
      { atMs: 25000, textZh: "粮草要紧，但别忘了即将到来的增援" },
    ],
  };
}

export function level5(): LevelConfig {
  const l0 = { ...crystalHouse(0) };
  const l1 = { ...crystalHouse(1) };
  const l2 = { ...crystalHouse(2) };
  return {
    id: 5,
    nameZh: "一击成片",
    unlockZh: "爆栗鸮 · 脆晶 · 群集小虫",
    laneCount: 3,
    availablePlants: ["dawn", "pea", "shell"],
    availableBirds: ["woodpecker", "owlbomb"],
    startResources: 150,
    lives: 3,
    presetPlants: [{ lane: 1, slot: 0, plant: "pea" }],
    lanes: [l0, l1, l2],
    baseWaves: [
      { atMs: 40000, lane: 0, type: "swarm", count: 3 },
      { atMs: 70000, lane: 1, type: "swarm", count: 3 },
      { atMs: 95000, lane: 2, type: "swarm", count: 3 },
      { atMs: 115000, lane: 0, type: "normal", count: 2 },
      { atMs: 140000, lane: 1, type: "swarm", count: 4 },
      { atMs: 185000, lane: 2, type: "normal", count: 2 },
    ],
    reinforcements: [
      { atMs: 130000, lane: 1, type: "swarm", count: 3, towerLane: 1 },
    ],
    star: {
      noLeakZh: "三路全守：没有虫子越过田埂",
      special: star.shotsAtMost(8, "精准群攻：最多使用 8 发"),
    },
    tutorial: [
      { atMs: 500, textZh: "爆栗鸮撞击会爆炸——等虫子聚在一起再出手" },
      { atMs: 38000, textZh: "脆晶一碰就碎，碎块也能砸到虫子" },
    ],
  };
}

export function level6(): LevelConfig {
  const l0 = { ...stoneBridge(0) };
  const l1 = { ...stoneBridge(1) };
  const l2 = { ...stoneBridge(2) };
  return {
    id: 6,
    nameZh: "留住它们",
    unlockZh: "霜铃草 · 霜翎燕 · 疾跑虫",
    laneCount: 3,
    availablePlants: ["dawn", "pea", "shell", "frost"],
    availableBirds: ["woodpecker", "owlbomb", "frostswallow"],
    startResources: 150,
    lives: 3,
    presetPlants: [],
    lanes: [l0, l1, l2],
    baseWaves: [
      { atMs: 30000, lane: 0, type: "runner", count: 1 },
      { atMs: 55000, lane: 1, type: "runner", count: 1 },
      { atMs: 75000, lane: 2, type: "runner", count: 2 },
      { atMs: 100000, lane: 0, type: "runner", count: 2 },
      { atMs: 120000, lane: 1, type: "normal", count: 2 },
      { atMs: 185000, lane: 2, type: "runner", count: 2 },
    ],
    reinforcements: [],
    star: {
      noLeakZh: "疾跑虫一只都别放过",
      special: star.killsAtLeast(6, "稳住防线：消灭至少 6 只敌人"),
    },
    tutorial: [
      { atMs: 500, textZh: "疾跑虫很快！霜铃草的冰霜范围会让它们慢下来" },
      { atMs: 28000, textZh: "霜翎燕撞地会留下减速霜圈——正好拦住疾跑虫" },
    ],
  };
}

export function level7(): LevelConfig {
  const l0 = { ...crystalHouse(0) };
  const l1 = { ...stoneBridge(1) };
  const l2 = { ...mixedTower(2) };
  return {
    id: 7,
    nameZh: "守住补给",
    unlockZh: "栖羽树 · 甲壳虫 · 混合材料",
    laneCount: 3,
    availablePlants: ["dawn", "pea", "shell", "frost", "nest"],
    availableBirds: ["woodpecker", "owlbomb", "frostswallow"],
    startResources: 175,
    lives: 3,
    presetPlants: [],
    lanes: [l0, l1, l2],
    baseWaves: [
      { atMs: 35000, lane: 0, type: "normal", count: 2 },
      { atMs: 65000, lane: 1, type: "armor", count: 1 },
      { atMs: 90000, lane: 2, type: "normal", count: 2 },
      { atMs: 115000, lane: 1, type: "armor", count: 1 },
      { atMs: 140000, lane: 0, type: "runner", count: 2 },
      { atMs: 190000, lane: 2, type: "armor", count: 1 },
    ],
    reinforcements: [
      { atMs: 130000, lane: 1, type: "armor", count: 4, towerLane: 1 },
    ],
    star: {
      noLeakZh: "三路全守：没有虫子越过田埂",
      special: star.nestRefill("补给线运转：栖羽树补弹至少 1 次"),
    },
    tutorial: [
      { atMs: 500, textZh: "栖羽树每 18 秒补 1 发弹药，全场最多 2 株" },
      { atMs: 30000, textZh: "甲壳虫抗植物弹——用鸟砸它更有效" },
    ],
  };
}

export function level8(): LevelConfig {
  return {
    id: 8,
    nameZh: "梯田保卫战",
    unlockZh: "分阶段巢车 · 三路组合进攻",
    laneCount: 3,
    availablePlants: ["dawn", "pea", "shell", "frost", "nest"],
    availableBirds: ["woodpecker", "owlbomb", "frostswallow"],
    startResources: 200,
    lives: 3,
    presetPlants: [],
    lanes: [{ ...mixedTower(0) }, nestCarLane(), { ...mixedTower(2) }],
    baseWaves: [
      { atMs: 25000, lane: 0, type: "normal", count: 1 },
      { atMs: 40000, lane: 2, type: "normal", count: 1 },
      { atMs: 60000, lane: 1, type: "normal", count: 1 },
      { atMs: 80000, lane: 0, type: "runner", count: 1 },
      { atMs: 100000, lane: 2, type: "swarm", count: 3 },
      { atMs: 120000, lane: 0, type: "normal", count: 2 },
      // Advertised finite second-stage waves, all after the 125s deployment deadline.
      { atMs: 155000, lane: 1, type: "swarm", count: 6 },
      { atMs: 165000, lane: 0, type: "armor", count: 3 },
      { atMs: 175000, lane: 2, type: "runner", count: 4 },
      // Final combined assault: all three routes demand attention together.
      { atMs: 200000, lane: 0, type: "normal", count: 2 },
      { atMs: 200000, lane: 1, type: "normal", count: 2 },
      { atMs: 200000, lane: 2, type: "normal", count: 2 },
    ],
    reinforcements: [
      { atMs: 100000, lane: 0, type: "normal", count: 2, towerLane: 0 },
      { atMs: 110000, lane: 2, type: "normal", count: 2, towerLane: 2 },
      { atMs: 150000, lane: 1, type: "runner", count: 2, towerLane: 1 },
    ],
    star: {
      noLeakZh: "三路全守：没有虫子越过田埂",
      special: star.gantryParts("拆解护架：实际摧毁巢车左右两根护架立柱"),
    },
    tutorial: [
      {
        atMs: 500,
        textZh: "巢车来了：击破两根护架可提前部署第二阶段；否则 125 秒部署",
      },
      { atMs: 60000, textZh: "两翼的塔也在出兵——别只盯着巢车" },
      {
        atMs: 145000,
        textZh: "125 秒会部署第二阶段；留意之后的三路虫群，护架挑战仍可继续",
      },
    ],
    nestCar: {
      lane: 1,
      parts: ["nc-partA-post", "nc-partB-post"],
      advanceAtMs: 125000,
    },
  };
}

export const LEVEL_FACTORIES: (() => LevelConfig)[] = [
  level1,
  level2,
  level3,
  level4,
  level5,
  level6,
  level7,
  level8,
];

export function buildLevel(index0: number): LevelConfig {
  const factory = LEVEL_FACTORIES[index0];
  if (!factory) throw new RangeError("Unknown campaign level");
  return factory();
}
