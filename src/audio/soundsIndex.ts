import { SoundIndex } from '../core/constants';

export interface SoundMeta {
  tableIndex?: number;
  byte2?: number;
  byte3?: number;
  byte4?: number;
  byte5?: number;
  distanceNear?: number;
  distanceFar?: number;
}

export interface SoundInfo {
  name: string;
  rates?: number[];
  meta?: SoundMeta;
}

export interface SoundTableEntry {
  word0: number;
  byte2: number;
  byte3: number;
  byte4: number;
  byte5: number;
  byte6: number;
  byte7: number;
}

export const ratesDefault = [5486];

const baseSounds: Record<number, SoundInfo> = {
  [SoundIndex.FALLING_ITEM]: { name: 'Falling item' },
  [SoundIndex.SWITCH]: { name: 'Switch' },
  [SoundIndex.DOOR]: { name: 'Door', rates: [5486, 4237] },
  [SoundIndex.WALL_SWITCH]: { name: 'Trolin attack / Stone golem attack / Touch wall' },
  [SoundIndex.FIREBALL_EXPLODE]: { name: 'Exploding fireball' },
  [SoundIndex.FALL_AND_DIE]: { name: 'Falling and dying' },
  [SoundIndex.SWALLOW]: { name: 'Swallowing' },
  [SoundIndex.CHAMP_WOUND_1]: { name: 'Champion wounded 1' },
  [SoundIndex.CHAMP_WOUND_2]: { name: 'Champion wounded 2' },
  [SoundIndex.CHAMP_WOUND_3]: { name: 'Champion wounded 3' },
  [SoundIndex.CHAMP_WOUND_4]: { name: 'Champion wounded 4' },
  [SoundIndex.SPELL_EXPLODE]: { name: 'Exploding spell' },
  [SoundIndex.SKELETON_ATTACK]: { name: 'Skeleton attack / armour attack / slash' },
  [SoundIndex.TELEPORT]: { name: 'Teleport' },
  [SoundIndex.WALL_BUMP]: { name: 'Running into a wall' },
  [SoundIndex.RAT_ATTACK]: { name: 'Rat attack / Dragon attack' },
  [SoundIndex.MUMMY_ATTACK]: { name: 'Mummy attack / Ghost attack' },
  [SoundIndex.SCREAMER_ATTACK]: { name: 'Screamer attack / Oitu attack' },
  [SoundIndex.SCORPION_ATTACK]: { name: 'Scorpion attack' },
  [SoundIndex.WORM_ATTACK]: { name: 'Worm attack' },
  [SoundIndex.GIGGLER]: { name: 'Giggler' },
};

export function buildSoundCatalog(soundTable?: SoundTableEntry[]): Record<number, SoundInfo> {
  const catalog: Record<number, SoundInfo> = {};
  for (const [key, info] of Object.entries(baseSounds)) {
    catalog[Number(key)] = { ...info };
  }

  if (!soundTable) return catalog;
  for (let i = 0; i < soundTable.length; i++) {
    const entry = soundTable[i];
    const soundId = entry.word0 | 0;
    if (soundId <= 0) continue;
    const existing = catalog[soundId] ?? { name: `Sound ${soundId}` };
    catalog[soundId] = {
      ...existing,
      meta: {
        ...(existing.meta ?? {}),
        tableIndex: i,
        byte2: entry.byte2,
        byte3: entry.byte3,
        byte4: entry.byte4,
        byte5: entry.byte5,
        distanceNear: entry.byte6,
        distanceFar: entry.byte7,
      },
    };
  }
  return catalog;
}

export const soundsIndex: Record<number, SoundInfo> = buildSoundCatalog();
