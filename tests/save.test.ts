import { describe, expect, it } from "vitest";
import { SaveStore, SAVE_KEY } from "../src/save";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(
    initial === undefined ? [] : [[SAVE_KEY, initial]],
  );
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

describe("versioned progress without permanent power", () => {
  it("unlocks only the next level on real completion and retains best stars/settings", () => {
    const storage = memoryStorage();
    const store = new SaveStore(storage);
    expect(store.data.unlocked).toBe(1);
    store.complete(1, [true, true, false]);
    store.complete(1, [true, false, false]);
    store.settings({ volume: 0.2, reduceShake: true });
    const reloaded = new SaveStore(storage);
    expect(reloaded.data.unlocked).toBe(2);
    expect(reloaded.data.bestStars[0]).toBe(2);
    expect(reloaded.data.volume).toBe(0.2);
    expect(reloaded.data.reduceShake).toBe(true);
    reloaded.complete(7, [true, true, true]); // locked levels cannot advance progress
    expect(reloaded.data.unlocked).toBe(2);
  });

  it("caps custom completion arguments at three stars and rejects fractional level IDs", () => {
    const storage = memoryStorage();
    const store = new SaveStore(storage);
    store.complete(1.5, [true, true, true]);
    expect(store.data.unlocked).toBe(1);
    store.complete(1, [true, true, true, true]);
    expect(store.data.bestStars[0]).toBe(3);
    expect(new SaveStore(storage).data.bestStars[0]).toBe(3);
  });

  it("recovers invalid/future/out of range data and handles throwing storage", () => {
    for (const raw of [
      "{broken",
      "null",
      '{"version":999,"unlocked":8}',
      '{"version":1,"unlocked":99}',
    ]) {
      expect(new SaveStore(memoryStorage(raw)).data.unlocked).toBe(1);
    }
    const store = new SaveStore({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => store.complete(1, [true, false, false])).not.toThrow();
    expect(store.data.unlocked).toBe(2);
    expect(store.persistent).toBe(false);
  });
});
