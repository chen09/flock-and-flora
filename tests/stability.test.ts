import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { makeGame, stepN } from './helpers';

// M2: three lanes' structures must all sit perfectly still when untouched.
describe('初始结构稳定（三路）', () => {
  it('无人操作静置 10 秒：三路结构零漂移', () => {
    const g = makeGame();
    const before = g.lanes.map((l) => ({
      blocks: l.blockSnapshot(),
      targets: l.targetSnapshot(),
    }));
    stepN(g, 600);
    g.lanes.forEach((lane, i) => {
      for (const [id, p] of before[i].blocks) {
        const now = lane.blockSnapshot().get(id);
        expect(now, `lane${i} block ${id} exists`).toBeDefined();
        expect(Math.hypot(now!.x - p.x, now!.y - p.y), `lane${i} ${id} drift`).toBeLessThan(1);
      }
      for (const [id] of before[i].targets) {
        expect(lane.targetSnapshot().has(id), `lane${i} target ${id}`).toBe(true);
      }
    });
    expect(g.lives).toBe(CONFIG.economy.lives);
    expect(g.phase).toBe('running');
    expect(g.lanes.every((l) => l.isQuiet())).toBe(true);
  });
});
