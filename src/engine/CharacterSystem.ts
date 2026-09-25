/**
 * `CharacterSystem` — the possession half of CSBWin's `Character.cpp`:
 * `RemoveCharacterPossession`, `DropAllPossessions`, the stat half of
 * `AddCharacterPossession` (`setChampionHand`) and `AdjustStatsForItemCarried` bound to
 * the context, and the two hand refills the busy timer runs (`matchingAmmunition`,
 * `refillPossessionSlot`). `DEBT.md` C34 makes this the one home of the possession writers.
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
import { DBType, decodeObjectID, OBJECT_ID_NULL, withObjectPosition, type ObjectID } from '../core/types';
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

  /**
   * `TAG0153c2` (`doc/CSBwin-src/Character.cpp:1521`) — is what is in `slot` the right
   * ammunition for the launcher in the fighting hand? Weapon classes 16-31 fire
   * class-10 objects (arrows), 32-47 fire class-11 (slingstones).
   */
  matchingAmmunition(champion: Champion, slot: number): boolean {
    const launcher = champion.possessions[1] ?? OBJECT_ID_NULL;
    if (launcher === OBJECT_ID_NULL || decodeObjectID(launcher).category !== DBType.WEAPON) return false;
    const launcherDesc = this.ctx.systems.characterStats.weaponDescFor(launcher);
    if (!launcherDesc) return false;
    let wanted: number;
    if (launcherDesc.uByte1 >= 16 && launcherDesc.uByte1 <= 31) wanted = 10;
    else if (launcherDesc.uByte1 >= 32 && launcherDesc.uByte1 <= 47) wanted = 11;
    else return false;

    const candidate = champion.possessions[slot] ?? OBJECT_ID_NULL;
    if (candidate === OBJECT_ID_NULL || decodeObjectID(candidate).category !== DBType.WEAPON) return false;
    const desc = this.ctx.systems.characterStats.weaponDescFor(candidate);
    return !!desc && desc.uByte1 === wanted;
  }

  /**
   * `TAG0115ee` (`doc/CSBwin-src/CSBCode.cpp:6251`) — put a weapon back into the hand
   * a throw emptied, from slot 12 first and then slots 7-9 (`:6263-6270`, each through
   * `TAG011594`, `:6231`). Only a weapon: a thrown apple does not come back.
   */
  refillPossessionSlot(chIdx: number, slot: number): void {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return;
    if ((champion.possessions[slot] ?? OBJECT_ID_NULL) !== OBJECT_ID_NULL) return;
    for (const source of [12, 7, 8, 9]) {
      const obj = champion.possessions[source] ?? OBJECT_ID_NULL;
      if (obj === OBJECT_ID_NULL) continue;
      if (decodeObjectID(obj).category !== DBType.WEAPON) continue;
      const moved = this.removeCharacterPossession(chIdx, source);
      if (moved !== OBJECT_ID_NULL) this.setChampionHand(champion, slot, moved);
      return;
    }
  }
}
