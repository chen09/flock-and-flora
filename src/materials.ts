export type MaterialId = 'wood' | 'crystal' | 'stone';

export interface MaterialDef {
  id: MaterialId;
  nameZh: string;
  color: number;
  edgeColor: number;
  density: number;
  hp: number;
  friction: number;
}

// Three materials with clearly distinct look and physics (PLAN section 2).
export const MATERIALS: Record<MaterialId, MaterialDef> = {
  wood: {
    id: 'wood',
    nameZh: '木材',
    color: 0xb5813f,
    edgeColor: 0x7c5424,
    density: 0.0012,
    hp: 60, // baseline: a full-speed bird hit (~76 dmg) breaks a wooden column in one shot
    friction: 0.85,
  },
  crystal: {
    id: 'crystal',
    nameZh: '脆晶',
    color: 0x7fdcea,
    edgeColor: 0x2f9db4,
    density: 0.0009,
    hp: 30,
    friction: 0.6,
  },
  stone: {
    id: 'stone',
    nameZh: '石材',
    color: 0x8d8f96,
    edgeColor: 0x5c5e66,
    density: 0.0025,
    hp: 260,
    friction: 0.9,
  },
};
