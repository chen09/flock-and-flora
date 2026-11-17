import { describe, expect, it } from 'vitest';
import { CONFIG, laneGroundTop } from '../src/config';
import { makeGame, makeLane } from './helpers';

describe('轨迹预览（至首次碰撞）', () => {
  it('M2 战场：预测命中塔区且不修改物理世界', () => {
    const g = makeGame();
    const lane = g.lanes[1];
    const a = lane.slingAnchor();
    const spawn = { x: a.x + CONFIG.sling.spawnAhead, y: a.y };
    const bodiesBefore = lane.bodyCount();
    const blocksBefore = lane.blockSnapshot();

    const traj = lane.previewTrajectory(spawn, { x: 17, y: -9 });
    expect(traj.points.length).toBeGreaterThanOrEqual(10);
    expect(traj.hit).not.toBeNull();
    expect(traj.hit!.x).toBeGreaterThan(800); // reaches the tower zone
    expect(traj.hit!.x).toBeLessThan(1250);

    expect(lane.bodyCount()).toBe(bodiesBefore);
    expect(lane.blockSnapshot()).toEqual(blocksBefore);
  });

  it('垂直下射很快命中地面', () => {
    const lane = makeLane([]);
    const a = { x: 170, y: laneGroundTop(1) - 50 };
    const traj = lane.previewTrajectory({ x: a.x + 26, y: a.y }, { x: 0, y: -2 });
    expect(traj.hit).not.toBeNull();
    expect(traj.hit!.y).toBeGreaterThan(laneGroundTop(1) - 80);
    expect(traj.points.length).toBeLessThan(40);
  });

  it('预览在预定的最大步数内终止', () => {
    const lane = makeLane([]);
    const traj = lane.previewTrajectory({ x: 170, y: 550 }, { x: 0.001, y: -20 });
    expect(traj.points.length * CONFIG.preview.dotEvery).toBeLessThanOrEqual(
      CONFIG.preview.maxSteps,
    );
  });
});
