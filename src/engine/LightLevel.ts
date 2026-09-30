/**
 * `SelectPaletteForLightLevel` (`doc/CSBwin-src/CSBCode.cpp:7242-7336`, `TAG017fa8`): how
 * bright the party's level is, as `d.CurrentPalette`, the index of the viewport palette
 * the screen draws with (0 the brightest, 5 the darkest) and what shortens a monster's
 * sight in the dark (`Monster.cpp:577-581`).
 *
 * CSBWin calls it where the light changes, and so does the port: a torch into or out of
 * a hand and an Illumulet on or off the neck (`CharacterSystem`, `Character.cpp:1867`,
 * `:1903`, `:1992`, `:2017`), a `TT_LIGHT` timer (`TimerSystem`, `CSBCode.cpp:6517`), a
 * level loaded (`MonsterSystem.loadPartyLevel`, `:819`), the torches burning down
 * (`ninetySecondUpdate`, `:7384`), a light timer set (`MagicSystem.setBrightnessTimer`,
 * `Magic.cpp:839`) and the fusion (`AttackSystem`, `Attack.cpp:2275`).
 *
 * `d.Word11778 = 1`, which tells the VBL handler to load the new palette (`:7335`,
 * `:1011-1014`), has no counterpart: the screen reads `d.CurrentPalette` whenever it
 * presents.
 */
import { OBJNI_TORCH_A, OBJNI_TORCH_D } from '../core/objectNameIndex';
import { sw } from '../core/intCast';
import type { GameContext } from './GameContext';
import { getChampionPossession } from './gameTypes';
import { GetBasicObjectType } from './objectIndex';

export function selectPaletteForLightLevel(ctx: GameContext): void {
  const party = ctx.party.state;
  const state = ctx.state;
  // `d.pCurLevelDesc->experienceMultiplier()`: the level loaded is the party's here.
  const experienceMultiplier = ctx.dungeon.getMap(party.position.z)?.descriptor.difficulty ?? 0;
  if (experienceMultiplier === 0) {
    state.currentPalette = 0;
    return;
  }
  const { word1074, paletteBrightness } = ctx.tables;
  // `LOCAL_26[8]`: the charges of the torches in each champion's hands, hand 1 then hand 0.
  const local26 = new Array<number>(8).fill(0);
  let pwA3 = 0;
  for (let D5W = 0; D5W < 4; D5W++) {
    for (let D4W = 2; D4W-- !== 0; pwA3++) {
      local26[pwA3] = 0;
      if (D5W >= party.champions.length) continue;
      const objD0 = getChampionPossession(party.champions[D5W]!, D4W);
      const objNID0 = GetBasicObjectType(ctx.dungeon, ctx.tables.objDescObjectType, objD0);
      if (objNID0 >= OBJNI_TORCH_A && objNID0 <= OBJNI_TORCH_D) {
        local26[pwA3] = ctx.dungeon.getWeaponRecord(objD0)!.charges;
      }
    }
  }
  // Find four brightest torches.
  for (let D4W = 0; D4W !== 4; D4W++) {
    let D5W = 7 - D4W;
    for (let pwA2 = D4W + 1; D5W-- !== 0; pwA2++) {
      if (local26[pwA2]! > local26[D4W]!) {
        const temp = local26[pwA2]!;
        local26[pwA2] = local26[D4W]!;
        local26[D4W] = temp;
      }
    }
  }
  let D6W = 6;
  let totalLight = 0;
  for (let i = 0; i < 5; i++) {
    const charges = local26[i]!;
    if (charges === 0) continue;
    // `D0W <<= D6W; D0W = (I16)((D0W >> 6) & 0x3ff);`, on a 16-bit register.
    const D0W = (word1074[charges]! << D6W) & 0xffff;
    totalLight += (D0W >> 6) & 0x3ff; // Sum of torches
    D6W = Math.max(0, D6W - 1);
  }
  totalLight += sw(party.brightness);
  let D4W: number;
  if (totalLight > 0) {
    D4W = 0;
    while (paletteBrightness[D4W]! > totalLight) D4W++;
  } else {
    D4W = 5;
  }
  state.currentPalette = D4W;
}
