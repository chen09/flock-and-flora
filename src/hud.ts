import Phaser from "phaser";
import { CONFIG } from "./config";
import {
  BIRDS,
  BIRD_ORDER,
  PLANTS,
  PLANT_ORDER,
  type BirdId,
} from "./sim/entities";
import { GameSimulation } from "./sim/game";
import { portraitUrl } from "./art";

export class Hud {
  private readonly abort = new AbortController();
  private readonly text: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    private readonly sim: GameSimulation,
  ) {
    this.text = scene.add
      .text(25, 18, "", {
        fontFamily: "sans-serif",
        fontSize: "22px",
        color: "#193f40",
      })
      .setDepth(8);
    this.detail = scene.add
      .text(25, 53, "", {
        fontFamily: "sans-serif",
        fontSize: "16px",
        color: "#3e6652",
      })
      .setDepth(8);
    const bind = (id: string, fn: () => void) =>
      button(id).addEventListener("click", fn, { signal: this.abort.signal });
    bind("btn-pause", () => sim.togglePause());
    bind("btn-remove", () => sim.setRemoveMode(!sim.removeMode));
    // Retry is owned by the campaign controller so a result/tutorial cannot
    // remain stale after restarting. This HUD never accumulates global hooks.
    for (const id of PLANT_ORDER) bind(`card-${id}`, () => sim.selectPlant(id));
    for (const id of BIRD_ORDER) bind(`bird-${id}`, () => sim.selectBird(id));
    this.update();
  }

  update(): void {
    const sim = this.sim;
    const modes = {
      running: "守园中",
      aiming: "瞄准中 · 全场时间冻结",
      paused: "已暂停",
      won: "守园成功",
      lost: "防线失守",
    };
    this.text.setText(
      `露珠 ${Math.floor(sim.resources)}     家园 ${"♥".repeat(Math.max(0, sim.lives)) || "—"}     飞羽 ${sim.regulator.ammo} / ${CONFIG.officialAmmo.max}     ${modes[sim.phase]}`,
    );
    const selection = sim.removeMode
      ? "铲除 · 点击植物，不退还资源"
      : sim.selectedPlant
        ? `种植 ${PLANTS[sim.selectedPlant].nameZh} · 点击空格位`
        : `${BIRDS[sim.selectedBird].nameZh} · 拖拽本路弹弓，松手发射`;
    this.detail.setText(
      selection +
        (sim.level.nestCar
          ? `     巢车：${sim.nestCarPhase === 1 ? "护架阶段 · 拆双柱可提前部署，否则125秒部署" : "第二阶段已部署"} · 护架 ${sim.stats.nestCarPartsBroken}/2`
          : ""),
    );
    for (const id of PLANT_ORDER) {
      const def = PLANTS[id];
      const el = button(`card-${id}`);
      const cd = sim.plantCooldownRemainingMs(id);
      const reason = !sim.isPlantAvailable(id)
        ? "本关未开放"
        : sim.phase !== "running"
          ? "战斗暂停"
          : cd > 0
            ? `冷却 ${Math.ceil(cd / 1000)}秒`
            : id === "nest" &&
                sim.nestCountValue() >= CONFIG.plants.nest.maxPerRun
              ? "已达2株上限"
              : sim.resources < def.cost
                ? "露珠不足"
                : "可种植";
      el.disabled = reason !== "可种植";
      el.classList.toggle(
        "selected",
        sim.selectedPlant === id && !sim.removeMode,
      );
      this.card(el, id, def.nameZh, `${def.cost}露珠 · ${reason}`);
    }
    for (const id of BIRD_ORDER) {
      const el = button(`bird-${id}`);
      const def = BIRDS[id];
      const reason = !sim.isBirdAvailable(id)
        ? "本关未开放"
        : sim.phase !== "running"
          ? "战斗暂停"
          : sim.regulator.ammo < def.ammoCost
            ? "飞羽不足"
            : sim.lanes.some((l) => l.projectile)
              ? "鸟儿飞行中"
              : "可发射";
      el.disabled = !sim.isBirdAvailable(id) || sim.phase !== "running";
      el.classList.toggle(
        "selected",
        sim.selectedBird === id && !sim.selectedPlant && !sim.removeMode,
      );
      this.card(el, id, def.nameZh, `${def.ammoCost}羽 · ${reason}`);
    }
    button("btn-pause").textContent = sim.phase === "paused" ? "继续" : "暂停";
    button("btn-pause").disabled = sim.phase === "won" || sim.phase === "lost";
    button("btn-remove").disabled = sim.phase !== "running";
    button("btn-remove").classList.toggle("selected", sim.removeMode);
    const next = sim
      .pendingSpawns()
      .filter((p) => !p.done && !p.cancelled)
      .slice(0, 3);
    const now = sim.lanes[0].simTimeMs;
    const enemyNames = {
      normal: "普通虫",
      runner: "疾跑虫",
      armor: "甲壳虫",
      swarm: "群集虫",
    };
    document.getElementById("wave-preview")!.textContent = next.length
      ? next
          .map(
            (p) =>
              `${Math.max(0, Math.ceil((p.atMs - now) / 1000))}秒后 · ${p.lane + 1}路 ${p.towerLane === null ? "进攻" : "塔援军"} ${enemyNames[p.type]}×${p.count}`,
          )
          .join("　｜　")
      : "所有进攻已到达 · 清理田里的虫子";
  }

  private card(
    el: HTMLButtonElement,
    id: string,
    name: string,
    detail: string,
  ): void {
    const label = `${name} ${detail}`;
    if (el.getAttribute("aria-label") === label) return;
    el.setAttribute("aria-label", label);
    el.title = label;
    el.innerHTML = `<img alt="" src="${portraitUrl(id)}"><span class="card-label">${name}<small>${detail}</small></span>`;
  }

  destroy(): void {
    this.abort.abort();
    this.text.destroy();
    this.detail.destroy();
  }
}

function button(id: string): HTMLButtonElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLButtonElement))
    throw new Error(`Missing control ${id}`);
  return el;
}
export function birdLabel(id: BirdId): string {
  return BIRDS[id].nameZh;
}
