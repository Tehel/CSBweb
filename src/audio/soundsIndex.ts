import { SoundIndex } from '../core/constants';
import type { SoundTableEntry } from '../data/tables/UITables';

export interface SoundInfo {
  name: string;
  rates?: number[];
}


/**
 * Playback rates for the 4-bit PCM sounds, in Hz.
 *
 * DELIBERATE DIVERGENCE FROM CSBWIN: these rates come from the original JS
 * proof-of-concept and were validated against the real Atari ST software
 * (emulator + vintage-hardware video). CSBWin's own rates are wrong here.
 * Do not "fix" these to match the C++ source.
 * See doc/PROVEN_FACTS.md - "Audio sample rates".
 */
export const ratesDefault = [5486];

/** A PAL Amiga's colour clock, Hz, which Paula counts its period in. */
const PAL_PAULA_CLOCK = 3546895;

/**
 * The rate, in Hz, A22E plays a sound at for its `Period`: Paula's period is
 * `72800 / Period` (ReDMCSB `SOUND.C:1107`), on a PAL machine. 112 is 650, 5456.8 Hz.
 */
export function amigaSoundRate(period: number): number {
  return PAL_PAULA_CLOCK / Math.trunc(72800 / period);
}

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
  for (const entry of soundTable) {
    const soundId = entry.word0 | 0;
    if (soundId <= 0) continue;
    catalog[soundId] ??= { name: `Sound ${soundId}` };
  }
  return catalog;
}

export const soundsIndex: Record<number, SoundInfo> = buildSoundCatalog();
