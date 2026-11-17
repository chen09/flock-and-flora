export const SAVE_KEY = "flock-and-flora:v1";
export interface SaveData {
  version: 1;
  unlocked: number;
  bestStars: number[];
  volume: number;
  muted: boolean;
  reduceShake: boolean;
}
interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const defaults = (): SaveData => ({
  version: 1,
  unlocked: 1,
  bestStars: Array<number>(8).fill(0),
  volume: 0.45,
  muted: false,
  reduceShake: false,
});

function decode(raw: string | null): SaveData {
  if (!raw) return defaults();
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) return defaults();
  const v = value as Partial<SaveData>;
  if (
    v.version !== 1 ||
    !Number.isInteger(v.unlocked) ||
    v.unlocked! < 1 ||
    v.unlocked! > 8
  )
    return defaults();
  const result = defaults();
  result.unlocked = v.unlocked!;
  if (Array.isArray(v.bestStars)) {
    result.bestStars = result.bestStars.map((_, i) => {
      const n = v.bestStars![i];
      return Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0;
    });
  }
  if (typeof v.volume === "number" && Number.isFinite(v.volume))
    result.volume = Math.max(0, Math.min(1, v.volume));
  result.muted = v.muted === true;
  result.reduceShake = v.reduceShake === true;
  return result;
}

export class SaveStore {
  readonly data: SaveData;
  persistent = true;
  constructor(private readonly storage?: StoragePort) {
    try {
      this.data = decode(storage?.getItem(SAVE_KEY) ?? null);
      if (!storage) this.persistent = false;
    } catch {
      this.data = defaults();
      this.persistent = false;
    }
  }

  complete(levelId: number, stars: readonly boolean[]): void {
    if (
      !Number.isInteger(levelId) ||
      levelId < 1 ||
      levelId > 8 ||
      levelId > this.data.unlocked ||
      !stars[0]
    )
      return;
    const earned = stars.slice(0, 3).filter((value) => value === true).length;
    this.data.bestStars[levelId - 1] = Math.max(
      this.data.bestStars[levelId - 1],
      earned,
    );
    this.data.unlocked = Math.max(this.data.unlocked, Math.min(8, levelId + 1));
    this.persist();
  }

  settings(
    patch: Partial<Pick<SaveData, "volume" | "muted" | "reduceShake">>,
  ): void {
    if (typeof patch.volume === "number" && Number.isFinite(patch.volume))
      this.data.volume = Math.max(0, Math.min(1, patch.volume));
    if (patch.muted !== undefined) this.data.muted = patch.muted;
    if (patch.reduceShake !== undefined)
      this.data.reduceShake = patch.reduceShake;
    this.persist();
  }

  private persist(): void {
    try {
      if (!this.storage) return;
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
  }
}

export function browserSave(): SaveStore {
  try {
    return new SaveStore(window.localStorage);
  } catch {
    return new SaveStore();
  }
}
