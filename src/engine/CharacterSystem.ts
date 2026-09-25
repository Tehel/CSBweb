/**
 * `CharacterSystem` — the possession half of CSBWin's `Character.cpp`:
 * `RemoveCharacterPossession`, `DropAllPossessions`, the stat half of
 * `AddCharacterPossession` (`setChampionHand`) and `AdjustStatsForItemCarried` bound to
 * the context. `DEBT.md` C34 makes this the one home of the possession writers.
 *
 * Moved out of `Game` by `DEBT.md` E2; the other systems reach it as
 * `ctx.systems.character`.
 */
import { sw } from '../core/intCast';
import {
  OBJNI_ILLUMULET_A,
  OBJNI_ILLUMULET_B,
  OBJNI_JEWEL_SYMAL_A,
  OBJNI_JEWEL_SYMAL_B,
  OBJNI_OPEN_SCROLL,
  OBJNI_SCROLL,
  OBJNI_TORCH_A,
  OBJNI_TORCH_D,
} from '../core/objectNameIndex';
import { OBJECT_ID_NULL, withObjectPosition, type ObjectID } from '../core/types';
import { AdjustStatsForItemCarried } from './AdjustStatsForItemCarried';
import { nameIndexOf, type GameContext } from './GameContext';
import type { Champion } from './gameTypes';

export class CharacterSystem {
  constructor(private readonly ctx: GameContext) {}

  /**
   * `RemoveCharacterPossession` (`doc/CSBwin-src/Character.cpp:1822-1930`) — empty a
   * slot and undo what wearing or holding the object did.
   *
   * Ported: round the neck an Illumulet gets `value(0)` and takes `d.Word1074[2]` off
   * `d.Brightness`, a Jewel Symal gets `value(0)`; in the weapon hand a scroll closes;
   * in either hand a torch goes out. All of these test `RN::NameIndex`, the modified
   * name, so a lit torch is any of `Torch_a`-`Torch_d` and a worn Illumulet `_b`.
   *
   * No counterpart here: `SelectPaletteForLightLevel`, `DrawEightHands`,
   * `DisplayBackpackItem` and the `charFlags` redraw bits (the light and the panels are
   * derived from live state every frame); `load` (`CharacterStats.characterLoad`
   * re-sums it). Not ported (`DEBT.md` C34), because they read UI state: `TAG01b1c0`
   * when this champion's attack menu is open and `RepackChest` when their inventory is. The chest slots (30 and up)
   * belong to the open inventory; no engine caller passes one.
   */
  removeCharacterPossession(chIdx: number, slot: number): ObjectID {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return OBJECT_ID_NULL;
    const objRemoved = champion.possessions[slot] ?? OBJECT_ID_NULL;
    this.setPossessionDirect(champion, slot, OBJECT_ID_NULL);
    if (objRemoved === OBJECT_ID_NULL) return OBJECT_ID_NULL;
    const objNID5 = nameIndexOf(this.ctx, objRemoved);
    this.adjustStatsForItemCarried(champion, slot, -1, objRemoved);
    if (slot === 10) {
      if (objNID5 >= OBJNI_ILLUMULET_A && objNID5 <= OBJNI_ILLUMULET_B) {
        this.ctx.dungeon.getMiscRecord(objRemoved)!.specialState = 0; // Of no use anymore.
        const party = this.ctx.party.state;
        party.brightness = sw(party.brightness - this.ctx.tables.word1074[2]!);
      } else if (objNID5 >= OBJNI_JEWEL_SYMAL_A && objNID5 <= OBJNI_JEWEL_SYMAL_B) {
        this.ctx.dungeon.getMiscRecord(objRemoved)!.specialState = 0; // Of no use anymore.
      }
    }
    if (slot < 2) {
      if (slot === 1 && objNID5 >= OBJNI_OPEN_SCROLL && objNID5 <= OBJNI_SCROLL) {
        this.ctx.dungeon.getScrollRecord(objRemoved)!.open = false;
      }
      if (objNID5 >= OBJNI_TORCH_A && objNID5 <= OBJNI_TORCH_D) {
        this.ctx.dungeon.getWeaponRecord(objRemoved)!.litTorch = false;
      }
    }
    return objRemoved;
  }

  setChampionHand(champion: Champion, slot: number, obj: ObjectID): boolean {
    const slots = champion.possessions;
    if (slot < 0 || slot >= slots.length) return false;
    if (slots[slot] !== OBJECT_ID_NULL) return false;
    slots[slot] = obj;
    // The stat half of `AddCharacterPossession` (`doc/CSBwin-src/Character.cpp:1970`);
    // the rest is `DEBT.md` C34.
    this.adjustStatsForItemCarried(champion, slot, 1, obj);
    return true;
  }

  /**
   * `DropAllPossessions` (`doc/CSBwin-src/Character.cpp:2499-2520`) — everything a
   * dying champion carried falls into the party's cell, slot by slot in
   * `d.DropOrder` order, each taken out through `RemoveCharacterPossession`, turned
   * to the champion's corner and set down with `MoveObject(obj, -1, 0, partyX,
   * partyY)` — so it presses a pad or falls down a pit like any other drop.
   */
  dropAllPossessions(chIdx: number): void {
    const champ = this.ctx.party.state.champions[chIdx];
    if (!champ) return;
    const D6W = champ.partyPosition & 0x3;
    const party = this.ctx.party.state;
    for (let D4W = 0; D4W < 30; D4W++) {
      const objD5 = this.removeCharacterPossession(chIdx, this.ctx.tables.dropOrder[D4W]!);
      if (objD5 === OBJECT_ID_NULL) continue;
      this.ctx.systems.timer.moveObject(
        withObjectPosition(objD5, D6W), -1, 0, party.position.x, party.position.y, party.position.z,
      );
    }
  }

  /** `AdjustStatsForItemCarried` (`src/engine/AdjustStatsForItemCarried.ts`). */
  adjustStatsForItemCarried(champion: Champion, slot: number, addOrRemove: number, obj: ObjectID): void {
    AdjustStatsForItemCarried(champion, slot, addOrRemove, obj, this.ctx.dungeon, (rn) => nameIndexOf(this.ctx, rn));
  }

  /**
   * Write a possession slot without the UI's placement rules — used for CSBWin's
   * temporary hand swap, where the object is put back immediately, and by
   * `RemoveCharacterPossession`.
   */
  setPossessionDirect(champion: Champion, slot: number, value: ObjectID): void {
    if (slot >= 0 && slot < champion.possessions.length) champion.possessions[slot] = value;
  }
}
