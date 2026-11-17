import { describe, expect, it } from 'vitest';
import { CONFIG, laneBandTop, laneGroundTop, laneBottomY } from '../src/config';
import { makeGame, makeLane, stepN } from './helpers';

// Band-budget verification, now for all THREE live lanes, plus in-band flight
// checks for real shots in the M2 battlefield.

describe('三路层槽预算与带内飞行', () => {
  it('三层槽位几何互不重叠且铺满 HUD 以下画布', () => {
    for (let i = 0; i < 3; i++) {
      const top = laneBandTop(i);
      const bottom = laneBottomY(i);
      expect(top).toBe(90 + i * 270);
      expect(bottom - top).toBe(270);
      expect(laneGroundTop(i)).toBe(bottom - 30);
      if (i > 0) expect(top).toBe(laneBottomY(i - 1));
    }
    expect(laneBottomY(2)).toBe(900);
  });

  it('三层初始结构各自带内静置（零跨层重叠）', () => {
    const g = makeGame();
    g.lanes.forEach((lane, i) => {
      const top = laneBandTop(i);
      const ground = laneGroundTop(i);
      for (const b of lane.getBlockViews()) {
        expect(b.y - b.h / 2).toBeGreaterThanOrEqual(top - 1);
        expect(b.y + b.h / 2).toBeLessThanOrEqual(ground + 1);
      }
    });
  });

  it('M2 实际发射：鸟全程留在本带内（不进邻层）', () => {
    const g = makeGame();
    const laneIndex = 1;
    const bandTop = laneBandTop(laneIndex);
    const ground = laneGroundTop(laneIndex);
    // Fire from the middle lane at a high lob; ceiling must keep the bird in.
    expect(g.fireWithVelocity(laneIndex, 0, -CONFIG.sling.maxSpeed)).toBe(true);
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < 600; i++) {
      stepN(g, 1);
      const bird = g.lanes[laneIndex].projectile;
      if (!bird) break;
      const y = bird.body.position.y;
      const x = bird.body.position.x;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    expect(minY).toBeGreaterThanOrEqual(bandTop + 8 - CONFIG.projectile.radius - 1);
    expect(maxY).toBeLessThanOrEqual(ground + CONFIG.projectile.radius + 2);
    expect(minX).toBeGreaterThanOrEqual(-45);
    expect(maxX).toBeLessThanOrEqual(1485);
    // No bird ever entered another lane's band while flying: the deepest point
    // stays under this band's ceiling (bird center may touch ceiling minus r).
    expect(minY).toBeGreaterThanOrEqual(bandTop + 8 - CONFIG.projectile.radius);
  });

  it('独立 lane 天花板拦截近垂直高抛', () => {
    const lane = makeLane([]);
    const a = { x: 170, y: laneGroundTop(1) - 50 };
    const traj = lane.previewTrajectory({ x: a.x + 26, y: a.y }, { x: 2, y: -20 });
    expect(traj.hit).not.toBeNull();
    expect(traj.hit!.y).toBeGreaterThanOrEqual(laneBandTop(1) + 8 - CONFIG.projectile.radius - 2);
    const real = lane.previewTrajectory({ x: a.x + 26, y: a.y }, { x: 2, y: -20 });
    expect(real.points.length * CONFIG.preview.dotEvery).toBeLessThanOrEqual(CONFIG.preview.maxSteps);
  });
});
