/**
 * `SwapCharacter` (`doc/CSBwin-src/Character.cpp:5497-5535`), a DSA's `&SWAPCHARACTER`:
 * a champion of the party sent to the wings, one from the wings brought into the party,
 * or one for the other in the same slot (`CharacterDelete`, `CharacterAdd`,
 * `CharacterSwap`, `:5376-5494`). Nothing else in CSBWin takes a living champion out of
 * the party, and the retail dungeons never do.
 *
 * A champion goes into the wings as the `CHARDESC` the save writer packs, so the portrait
 * of one this port created comes from the host (`GameHost.portraitOf`), and comes back as
 * a save's champion does, with the pixels.
 */
import { writeU16BE } from '../core/bytes';
import { writeCsbwinCharacter } from '../data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../data/CsbwinSaveInfo';
import type { GameContext } from './GameContext';
import type { Champion } from './gameTypes';
import { markAllPortraitsChanged, selectMagicCaster, setHandOwner } from './Party';
import { getFromWings, saveToWings, wingsChampion } from './Wings';

/** `hp`'s offset in a `CHARDESC`, big-endian in the file's form. */
const HP_OFFSET = 52;
/** `charPosition`'s offset in a `CHARDESC`. */
const CHAR_POSITION_OFFSET = 29;

/**
 * `SwapCharacter(index, fingerPrint)`: 2 to delete the last champion, 3 to add one to a
 * full party, 4 for a fingerprint not in the wings, else 0 once done. An `index` outside
 * the party is no champion, and a negative `fingerPrint` nobody.
 */
export function swapCharacter(ctx: GameContext, index: number, fingerPrint: number): number {
  const numCharacter = ctx.party.state.champions.length;
  // Is a character to be deleted?
  if (index >= 0 && index < numCharacter) {
    // Make sure it is not the last character.
    if (numCharacter < 2 && fingerPrint < 0) return 2;
  } else {
    index = -1;
  }
  // Is a character to be added?
  if (fingerPrint >= 0) {
    if (index === -1 && numCharacter === 4) return 3;
    if (getFromWings(ctx.dungeon, fingerPrint & 0xffff, true) === null) return 4;
  }
  if (index >= 0 && fingerPrint < 0) return characterDelete(ctx, index);
  if (index < 0 && fingerPrint >= 0) return characterAdd(ctx, fingerPrint);
  if (index >= 0 && fingerPrint >= 0) return characterSwap(ctx, index, fingerPrint);
  return 0;
}

/**
 * `CharacterDelete` (`doc/CSBwin-src/Character.cpp:5376-5439`): the champion into the
 * wings and the ones after them a slot down, with the cursor's owner, the open
 * inventory and the caster. `d.PendingDamage` stays where it is. The slot left past the
 * party keeps a copy of the champion who was last, possessions and all, with HP 0. The
 * two boxes emptied are the screen's, which draws none past the party.
 */
function characterDelete(ctx: GameContext, chIdx: number): number {
  const party = ctx.party.state;
  const numCharacter = party.champions.length;
  expireDamageTimer(ctx, chIdx);
  removeCharacter(ctx, chIdx);
  saveToWings(ctx.dungeon, chardesc(ctx, party.champions[chIdx]!));
  // The last record stays as it is when the others move down onto it.
  const vacant = chardesc(ctx, party.champions[numCharacter - 1]!);
  for (let i = chIdx; i < numCharacter - 1; i++) {
    party.champions[i] = party.champions[i + 1]!;
    // Adjust any timer entries pointing to this character.
    if (party.champions[i]!.timerIndex !== -1) throw new Error('die(0x452a): Need Playfile to fix');
  }
  if (party.cursorOwner > chIdx) party.cursorOwner--;
  // `d.SelectedCharacterOrdinal > chIdx`, an ordinal from 1.
  if (party.selectedCharacterIndex + 1 > chIdx) party.selectedCharacterIndex--;
  if (party.magicCasterIndex > chIdx) selectMagicCaster(party, party.magicCasterIndex - 1);
  party.champions.length = numCharacter - 1;
  writeU16BE(vacant, HP_OFFSET, 0);
  party.vacantCharacters[numCharacter - 1] = vacant;
  redrawEverything(ctx);
  return 0;
}

/**
 * `CharacterAdd` (`doc/CSBwin-src/Character.cpp:5442-5461`): the champion out of the
 * wings into the slot after the last, in the first corner nobody stands in, facing 0.
 * The search reads the slot it fills as one of the party's, so a corner the champion
 * already holds is passed over too.
 */
function characterAdd(ctx: GameContext, fingerPrint: number): number {
  const party = ctx.party.state;
  const numCharacter = party.champions.length;
  const champion = wingsChampion(getFromWings(ctx.dungeon, fingerPrint & 0xffff, false)!);
  const charPosition = (i: number): number => i < numCharacter ? party.champions[i]!.partyPosition : champion.partyPosition;
  for (let pos = 0; pos < 4; pos++) {
    let i: number;
    for (i = 0; i < numCharacter; i++) {
      // Find a nice position for this new party member
      if (party.champions[i]!.partyPosition === pos) break;
    }
    if (charPosition(i) === pos) continue;
    champion.partyPosition = pos;
    break;
  }
  champion.facing = 0;
  ctx.party.addChampion(champion);
  redrawEverything(ctx);
  return 0;
}

/**
 * `CharacterSwap` (`doc/CSBwin-src/Character.cpp:5463-5494`): the champion at `index`
 * into the wings, and the one with `fingerPrint` out of them into the same slot, in the
 * first corner nobody stands in, else 5, and with the facing of the one who left. The
 * search reads `d.CH16482[d.NumCharacter]` for a corner nobody holds: the slot past the
 * party, or, the party being four, the bytes after the array (`slotCharPosition`).
 */
function characterSwap(ctx: GameContext, index: number, fingerPrint: number): number {
  const party = ctx.party.state;
  const numCharacter = party.champions.length;
  expireDamageTimer(ctx, index);
  const facing = party.champions[index]!.facing;
  removeCharacter(ctx, index);
  saveToWings(ctx.dungeon, chardesc(ctx, party.champions[index]!));
  const champion = wingsChampion(getFromWings(ctx.dungeon, fingerPrint & 0xffff, false)!);
  party.champions[index] = champion;
  champion.partyPosition = 5; //An impossible
  for (let pos = 0; pos < 4; pos++) {
    // See if we can find an empty position
    let i: number;
    for (i = 0; i < numCharacter; i++) {
      // Find a nice position for this new party member
      if (party.champions[i]!.partyPosition === pos) break;
    }
    if (slotCharPosition(ctx, i) === pos) continue;
    champion.partyPosition = pos;
    break;
  }
  champion.facing = facing;
  redrawEverything(ctx);
  return 0;
}

/**
 * `RemoveCharacter` (`doc/CSBwin-src/Character.cpp:5279-5362`), `KillCharacter`'s tail
 * without the death: the held eye or mouth let go and the inventory closed, the
 * incantation cleared, the facing the party's, the poison cured, and the cursor and the
 * magic tab handed to the first living champion. Nobody living, that is slot
 * `d.NumCharacter`, which the port's `setHandOwner` and `selectMagicCaster` refuse
 * (`DEBT.md` H). The marching order's cursor and the position square are the screen's,
 * as in `killCharacter`.
 */
function removeCharacter(ctx: GameContext, chIdx: number): void {
  const party = ctx.party.state;
  const champion = party.champions[chIdx]!;
  if (party.selectedCharacterIndex === chIdx) {
    ctx.host.releaseEyeOrMouth();
    ctx.host.showHideInventory(4); //Hide the inventory screen
  }
  // `byte33 = 0`, `incantation[0] = 0`.
  champion.incantation = [];
  champion.facing = party.facing;
  champion.maxRecentDamage = 0;
  if (champion.poisonCount) ctx.systems.monsterAttack.curePoison(chIdx);
  let livingChar: number;
  for (livingChar = 0; livingChar < party.champions.length; livingChar++) {
    // Find a living party member.
    if (chIdx !== livingChar && party.champions[livingChar]!.attributes.health !== 0) break;
  }
  if (chIdx === party.cursorOwner) setHandOwner(ctx, livingChar);
  if (chIdx === party.magicCasterIndex) selectMagicCaster(party, livingChar);
}

/**
 * A champion's `TT_12` deleted and `TAG011366` run, "as if it had expired"
 * (`doc/CSBwin-src/Character.cpp:5382-5387`, `:5468-5473`).
 */
function expireDamageTimer(ctx: GameContext, chIdx: number): void {
  const champion = ctx.party.state.champions[chIdx]!;
  if (champion.timerIndex === -1) return;
  ctx.timers.deleteTimer(champion.timerIndex);
  ctx.systems.monsterAttack.tag011366(chIdx);
}

/**
 * `d.CH16482[i].charPosition` for `i` from 0 to 4. Past the party it is the record a
 * slot keeps (`PartyState.vacantCharacters`). Index 4 is past the array, whose 800
 * bytes on are `d.Brightness` and the party state after it (`doc/CSBwin-src/Data.h:781-797`):
 * byte 29 is the high byte of `d.PartyFootprints[7]`, at 14, on the little-endian build.
 */
function slotCharPosition(ctx: GameContext, i: number): number {
  const party = ctx.party.state;
  if (i < party.champions.length) return party.champions[i]!.partyPosition;
  if (i >= 4) return (ctx.footprints.getPrint(7) >> 8) & 0xff;
  const vacant = party.vacantCharacters[i]!;
  return vacant instanceof Uint8Array ? vacant[CHAR_POSITION_OFFSET]! : vacant.partyPosition;
}

/**
 * `RedrawEverything` (`doc/CSBwin-src/Character.cpp:5365-5374`): `CHARFLAG_positionChanged`
 * and `CHARFLAG_weaponAttack`, which the screen draws on every frame, and
 * `MarkAllPortraitsChanged`.
 */
function redrawEverything(ctx: GameContext): void {
  markAllPortraitsChanged(ctx);
}

/** `champion` as the `CHARDESC` the save writer packs, in the file's form. */
function chardesc(ctx: GameContext, champion: Champion): Uint8Array {
  const bytes = new Uint8Array(CHARDESC_SIZE);
  writeCsbwinCharacter(bytes, 0, champion, {
    load: (c) => ctx.systems.characterStats.characterLoad(c),
    portraitOf: (c) => ctx.host.portraitOf(c),
  });
  return bytes;
}
