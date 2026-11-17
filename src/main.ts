import Phaser from "phaser";
import { VIEW } from "./config";
import { GameScene } from "./scenes/GameScene";
import { buildLevel } from "./sim/levels";
import { browserSave } from "./save";
import { gardenAudio } from "./audio";
import type { GameSimulation } from "./sim/game";
import "./style.css";

const save = browserSave();
let currentLevel = -1;
let tutorialStep = 0;
let finished = false;
const el = (id: string): HTMLElement => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing UI element ${id}`);
  return value;
};
const input = (id: string) => el(id) as HTMLInputElement;
const dialog = (id: string) => el(id) as HTMLDialogElement;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: VIEW.width,
  height: VIEW.height,
  backgroundColor: "#d5ece6",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true },
  scene: [],
  callbacks: {
    postBoot: () => {
      game.scene.add("game", GameScene, false);
      new ResizeObserver(([entry]) => {
        game.scale.setParentSize(
          entry.contentRect.width,
          entry.contentRect.height,
        );
      }).observe(el("game-root"));
      renderMenu();
    },
  },
});

// Read-only verification entrypoint retains the accepted tooling name. No UI
// contains implementation paths, session IDs, build metadata or credentials.
(window as unknown as Record<string, unknown>).__featherGame = game;

function sim(): GameSimulation | null {
  if (!game.scene.isActive("game")) return null;
  // Scene owns lifecycle; app uses the same public player controls as cards.
  const scene = game.scene.getScene("game") as GameScene;
  return scene.simulation;
}

function renderMenu(): void {
  const list = el("level-list");
  list.replaceChildren();
  for (let i = 0; i < 8; i++) {
    const config = buildLevel(i);
    const button = document.createElement("button");
    button.disabled = i + 1 > save.data.unlocked;
    button.innerHTML = `<b>${i + 1}</b><span>${config.nameZh}<small>${button.disabled ? "尚未开放" : "★".repeat(save.data.bestStars[i]) + "☆".repeat(3 - save.data.bestStars[i])}</small></span>`;
    button.setAttribute(
      "aria-label",
      `第${i + 1}关 ${config.nameZh}${button.disabled ? " 尚未开放" : ""}`,
    );
    button.addEventListener("click", () => startLevel(i));
    list.append(button);
  }
  el("btn-continue").textContent =
    save.data.unlocked === 1 && save.data.bestStars[0] === 0
      ? "开始守园"
      : `继续 · 第 ${save.data.unlocked} 关`;
  el("save-notice").textContent = save.persistent
    ? "进度与设置仅保存在本机"
    : "本机存储不可用：仍可游玩，本次进度不会跨重载保留";
}

function startLevel(index: number): void {
  if (index < 0 || index >= save.data.unlocked || index >= 8) return;
  gardenAudio.unlock();
  gardenAudio.stop();
  currentLevel = index;
  finished = false;
  el("menu").hidden = true;
  el("result").hidden = true;
  el("battle-tools").hidden = false;
  const config = buildLevel(index);
  el("level-name").textContent = `${index + 1} / 8 · ${config.nameZh}`;
  game.scene.start("game", { levelIndex: index });
  tutorialStep = 0;
  renderTutorial();
}

function toMenu(): void {
  game.scene.stop("game");
  gardenAudio.stop();
  currentLevel = -1;
  el("menu").hidden = false;
  el("battle-tools").hidden = true;
  el("result").hidden = true;
  el("tutorial").hidden = true;
  el("level-name").textContent = "";
  renderMenu();
}

function renderTutorial(): void {
  if (currentLevel < 0 || finished) {
    el("tutorial").hidden = true;
    return;
  }
  const config = buildLevel(currentLevel);
  const step = config.tutorial[tutorialStep];
  el("tutorial").hidden = !step;
  if (step)
    el("tutorial-copy").textContent =
      `${tutorialStep + 1} / ${config.tutorial.length}　${step.textZh}`;
  el("tutorial-next").textContent =
    tutorialStep + 1 === config.tutorial.length ? "开始守园" : "下一步";
}

function objectives(): void {
  if (currentLevel < 0) return;
  const config = buildLevel(currentLevel);
  el("objective-title").textContent = `${config.id}. ${config.nameZh}`;
  el("objective-unlocks").textContent = config.unlockZh;
  el("objective-goals").replaceChildren(
    ...[
      "通关：消灭全部有限波次与存活敌人",
      config.star.noLeakZh,
      config.star.special.zh,
    ].map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }),
  );
  el("objective-waves").textContent =
    `基础进攻 ${config.baseWaves.length} 批 · 塔援军 ${config.reinforcements.length} 批。拆塔只取消尚未到达的对应援军，不是通关硬条件。${config.nestCar ? "巢车护架双柱被拆或125秒到时部署第二阶段。" : ""}`;
  pauseForDialog("objectives");
}

function pauseForDialog(id: string): void {
  const battle = sim();
  const resume = battle?.phase === "running" || battle?.phase === "aiming";
  if (resume) battle?.onWindowBlur();
  const d = dialog(id);
  d.addEventListener(
    "close",
    () => {
      if (resume && battle === sim() && battle?.phase === "paused")
        battle.togglePause();
    },
    { once: true },
  );
  d.showModal();
}

function applySettings(): void {
  gardenAudio.volume = save.data.volume;
  gardenAudio.muted = save.data.muted;
  gardenAudio.reduceShake = save.data.reduceShake;
  input("setting-volume").value = String(save.data.volume);
  input("setting-muted").checked = save.data.muted;
  input("setting-shake").checked = save.data.reduceShake;
}
applySettings();
document.addEventListener("pointerdown", () => gardenAudio.unlock(), {
  capture: true,
});
document.addEventListener("keydown", () => gardenAudio.unlock(), {
  capture: true,
});
el("btn-continue").addEventListener("click", () =>
  startLevel(save.data.unlocked - 1),
);
el("btn-menu").addEventListener("click", toMenu);
el("brand").addEventListener("click", (e) => {
  e.preventDefault();
  toMenu();
});
el("btn-restart").addEventListener("click", () => startLevel(currentLevel));
el("result-retry").addEventListener("click", () => startLevel(currentLevel));
el("result-menu").addEventListener("click", toMenu);
el("tutorial-next").addEventListener("click", () => {
  tutorialStep++;
  renderTutorial();
});
el("tutorial-skip").addEventListener("click", () => {
  el("tutorial").hidden = true;
});
el("btn-objectives").addEventListener("click", objectives);
el("btn-next").addEventListener("click", () => {
  if (currentLevel < 7) startLevel(currentLevel + 1);
  else toMenu();
});
el("btn-settings").addEventListener("click", () => pauseForDialog("settings"));
for (const id of ["setting-volume", "setting-muted", "setting-shake"]) {
  input(id).addEventListener("input", () => {
    save.settings({
      volume: Number(input("setting-volume").value),
      muted: input("setting-muted").checked,
      reduceShake: input("setting-shake").checked,
    });
    applySettings();
    if (id !== "setting-shake") gardenAudio.play("income");
  });
}

game.events.on(
  "campaign-end",
  (result: {
    levelIndex: number;
    won: boolean;
    stars: boolean[];
    stats: GameSimulation["stats"];
  }) => {
    if (finished || result.levelIndex !== currentLevel) return;
    finished = true;
    const config = buildLevel(currentLevel);
    if (result.won) {
      save.complete(config.id, result.stars);
      renderMenu();
    }
    el("tutorial").hidden = true;
    el("result").hidden = false;
    el("result-title").textContent = !result.won
      ? "防线失守，再试一次"
      : currentLevel === 7
        ? "八段梯田，都守住了！"
        : `${config.nameZh} · 守园成功`;
    el("result-stars").textContent = result.stars
      .map((s) => (s ? "★" : "☆"))
      .join("");
    const conditions = [
      "消灭全部敌人，守住家园",
      config.star.noLeakZh,
      config.star.special.zh,
    ];
    el("result-goals").replaceChildren(
      ...conditions.map((text, i) => {
        const li = document.createElement("li");
        li.textContent = `${result.stars[i] ? "★" : "☆"} ${text}`;
        return li;
      }),
    );
    el("result-detail").textContent =
      `发射 ${result.stats.launched} 次 · 泄漏 ${result.stats.leaks} 只 · 拆塔 ${result.stats.towersDown} 座 · 取消援军 ${result.stats.reinforcementsCancelled} 批`;
    el("btn-next").hidden = !result.won;
    el("btn-next").textContent =
      currentLevel === 7 ? "完成旅程 · 回到田园" : "下一关";
  },
);
