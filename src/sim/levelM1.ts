import { LaneLevelDef } from './lane';
import { GROUND_TOP_Y } from '../config';

// M1 single-lane trial layout (gray-box), constrained to the MIDDLE lane band
// of the final three-lane budget: air [360, 600), ground surface y=600 (dirt
// strip 600-630), static band ceiling at y=368 (LAYOUT/CEILING_BOTTOM_Y).
// Trial rules: 5 ammo, 4 beetle targets. This is NOT the final wave ruleset
// from PLAN section 2 - it exists to validate physics, pause and settlement.
// t1-under is shielded on purpose: the intended kill is the slab collapse.
export function buildLevelM1(): LaneLevelDef {
  const g = GROUND_TOP_Y; // 600: physical ground surface
  const th = 17; // CONFIG.target.h / 2
  return {
    laneIndex: 1,
    sling: { x: 170, y: 550 },
    blocks: [
      { id: 'col-left', x: 1030, y: 558, w: 24, h: 84, material: 'wood' },
      { id: 'col-right', x: 1170, y: 558, w: 24, h: 84, material: 'wood' },
      { id: 'slab', x: 1100, y: 505, w: 220, h: 22, material: 'stone' },
      { id: 'cr-low-l', x: 1052, y: 472, w: 44, h: 44, material: 'crystal' },
      { id: 'cr-low-r', x: 1148, y: 472, w: 44, h: 44, material: 'crystal' },
      { id: 'beam', x: 1100, y: 442, w: 180, h: 16, material: 'wood' },
      { id: 'cr-top', x: 1100, y: 412, w: 44, h: 44, material: 'crystal' },
    ],
    targets: [
      { id: 't1-under', x: 1100, y: g - th },
      // Elevated targets are NOT physically reachable inside the band budget
      // (speed cap 20 + band ceiling 368 + gravity leave ~0px margin for a
      // far/up shot - verified by the discrete solver in lane-band tests), so
      // the fourth beetle stands on the ground behind the tower.
      { id: 't2-right', x: 1240, y: g - th },
      { id: 't3-back', x: 1310, y: g - th },
      { id: 't4-front', x: 950, y: g - th },
    ],
  };
}
