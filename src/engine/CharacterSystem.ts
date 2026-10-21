/**
 * `CharacterSystem` — the possession half of CSBWin's `Character.cpp`:
 * `RemoveCharacterPossession` and `AddCharacterPossession`, the one pair every writer of a
 * champion's slots goes through (the inventory click, the DSA, the hand refills, a spell,
 * a recruit, a death), `DropAllPossessions`, `AdjustStatsForItemCarried` bound to the
 * context, and the two hand refills the busy timer runs (`matchingAmmunition`,
 * `refillPossessionSlot`). Also `_ExecuteAttack`'s engine half (`executeAttack`) and
 * `BringCharacterToLife`, by the same file. The open chest is `OpenChest.ts`'s.
 *
 * The other systems reach it as `ctx.systems.character`.
 */
import { sw } from '../core/intCast';
import {
  OBJNI_CHEST,
  OBJNI_ILLUMULET_A,
  OBJNI_ILLUMULET_B,
  OBJNI_JEWEL_SYMAL_A,
  OBJNI_JEWEL_SYMAL_B,
  OBJNI_OPEN_SCROLL,
  OBJNI_SCROLL,
  OBJNI_TORCH_A,
  OBJNI_TORCH_D,
} from '../core/objectNameIndex';
import { DBType, OBJECT_ID_NULL, type ObjectID } from '../core/types';
import { characterAtPosition } from './AddCharacter';
import { AdjustStatsForItemCarried } from './AdjustStatsForItemCarried';
import { tag01b1c0 } from './AttackMenu';
import { nameIndexOf, type GameContext } from './GameContext';
import { CHARFLAG_CHEST_OR_SCROLL, getChampionPossession } from '../core/charDesc';
import type { Champion } from './gameTypes';
import { selectPaletteForLightLevel } from './LightLevel';
import { repackChest } from './OpenChest';
import { drawCharacterState } from './Party';

export class CharacterSystem {
  constructor(private readonly ctx: GameContext) {}

  /**
   * `RemoveCharacterPossession` (`doc/CSBwin-src/Character.cpp:1827-1935`) — empty a
   * slot and undo what wearing or holding the object did.
   *
   * Round the neck an Illumulet gets `value(0)` and takes `d.Word1074[2]` off
   * `d.Brightness`, a Jewel Symal gets `value(0)`. Out of the weapon hand, the attack
   * menu closes if it is this champion's and a scroll closes; out of either hand a torch
   * goes out; and a chest out of the weapon hand of the champion whose inventory is open
   * is repacked. All of these test `RN::NameIndex`, the modified name, so a lit torch is
   * any of `Torch_a`-`Torch_d` and a worn Illumulet `_b`. The attack menu is the UI's,
   * so its closing goes out as a `GameHost` notice.
   *
   * The light changes are followed by `SelectPaletteForLightLevel`. A chest or a scroll
   * out of the selected champion's weapon hand sets `CHARFLAG_chestOrScroll`
   * (`:1911-1926`), which the `DrawCharacterState` every caller makes next draws
   * (`doc/CSBwin-src/DSA.cpp:1675-1676`, `doc/CSBwin-src/CSBCode.cpp:7054-7057`); the
   * port draws it as the call ends. No counterpart here: `DrawEightHands`,
   * `DisplayBackpackItem` and the other `charFlags` redraw bits (the panels are derived
   * from live state every frame); `load` (`CharacterStats.characterLoad` re-sums it). The chest slots (30 and up) are `d.rnChestContents`, the open
   * inventory's, and nothing but the stat call reads them here, which does nothing past
   * slot 29; so the inventory click writes them itself and no caller passes one.
   */
  removeCharacterPossession(chIdx: number, slot: number): ObjectID {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return OBJECT_ID_NULL;
    const objRemoved = getChampionPossession(champion, slot);
    this.setPossession(chIdx, slot, OBJECT_ID_NULL);
    if (objRemoved === OBJECT_ID_NULL) return OBJECT_ID_NULL;
    const objNID5 = nameIndexOf(this.ctx, objRemoved);
    this.adjustStatsForItemCarried(champion, slot, -1, objRemoved);
    if (slot === 10) {
      if (isIllumulet(objNID5)) {
        this.ctx.dungeon.getMiscRecord(objRemoved)!.specialState = 0; // Of no use anymore.
        const party = this.ctx.party.state;
        party.brightness = sw(party.brightness - illumuletLight(this.ctx.tables.word1074));
        selectPaletteForLightLevel(this.ctx);
      } else if (objNID5 >= OBJNI_JEWEL_SYMAL_A && objNID5 <= OBJNI_JEWEL_SYMAL_B) {
        this.ctx.dungeon.getMiscRecord(objRemoved)!.specialState = 0; // Of no use anymore.
      }
    }
    if (slot < 2) {
      if (slot === 1) {
        // `if (d.AttackingCharacterOrdinal == chIdx+1) TAG01b1c0();` (`:1893-1896`)
        if (this.ctx.interface.attackingCharacterOrdinal === chIdx + 1) tag01b1c0(this.ctx);
        if (objNID5 >= OBJNI_OPEN_SCROLL && objNID5 <= OBJNI_SCROLL) {
          this.ctx.dungeon.getScrollRecord(objRemoved)!.open = false;
        }
      }
      if (objNID5 >= OBJNI_TORCH_A && objNID5 <= OBJNI_TORCH_D) {
        this.ctx.dungeon.getWeaponRecord(objRemoved)!.litTorch = false;
        selectPaletteForLightLevel(this.ctx);
      }
      // `LOCAL_2`, `chIdx+1 == d.SelectedCharacterOrdinal` (`:1861`, `:1911-1926`).
      if (chIdx === this.ctx.party.state.selectedCharacterIndex && slot === 1) {
        if (objNID5 === OBJNI_CHEST) {
          repackChest(this.ctx);
          champion.charFlags |= CHARFLAG_CHEST_OR_SCROLL;
        } else if (objNID5 >= OBJNI_OPEN_SCROLL && objNID5 <= OBJNI_SCROLL) {
          champion.charFlags |= CHARFLAG_CHEST_OR_SCROLL;
        }
      }
    }
    drawCharacterState(this.ctx, chIdx, 0);
    return objRemoved;
  }

  /**
   * `AddCharacterPossession` (`doc/CSBwin-src/Character.cpp:1941-2042`) — put an object
   * in a slot, which its caller has found empty, and do what wearing or holding it does.
   *
   * Into the weapon hand, the attack menu closes if it is this champion's and a scroll
   * opens; into either hand an unlit torch (`NameIndex == Torch_a`, `:1993`) is lit.
   * Round the neck an Illumulet gets `value(1)` and adds `d.Word1074[2]` to
   * `d.Brightness`, a Jewel Symal gets `value(1)`. A light change is followed by
   * `SelectPaletteForLightLevel`. A chest or a scroll into the selected champion's
   * weapon hand sets `CHARFLAG_chestOrScroll` (`:2002-2009`), drawn as the call ends
   * (`doc/CSBwin-src/DSA.cpp:2076-2077`, `doc/CSBwin-src/Magic.cpp:1379-1380`). The rest
   * has no counterpart here, as in `removeCharacterPossession`. A chest slot (30 and up)
   * is the inventory click's.
   */
  addCharacterPossession(chIdx: number, object: ObjectID, place: number): void {
    if (object === OBJECT_ID_NULL) return;
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return;
    this.setPossession(chIdx, place, object);
    const objNID4 = nameIndexOf(this.ctx, object);
    this.adjustStatsForItemCarried(champion, place, 1, object);
    if (place < 2) {
      if (place === 1) {
        // `if (d.AttackingCharacterOrdinal == chIdx+1) TAG01b1c0();` (`:1982-1985`)
        if (this.ctx.interface.attackingCharacterOrdinal === chIdx + 1) tag01b1c0(this.ctx);
        if (objNID4 >= OBJNI_OPEN_SCROLL && objNID4 <= OBJNI_SCROLL) {
          this.ctx.dungeon.getScrollRecord(object)!.open = true;
        }
      }
      if (objNID4 === OBJNI_TORCH_A) {
        this.ctx.dungeon.getWeaponRecord(object)!.litTorch = true;
        selectPaletteForLightLevel(this.ctx);
      } else if (
        chIdx === this.ctx.party.state.selectedCharacterIndex && place === 1
        && (objNID4 === OBJNI_CHEST || (objNID4 >= OBJNI_OPEN_SCROLL && objNID4 <= OBJNI_SCROLL))
      ) {
        // `bool_2`, `chIdx+1 == d.SelectedCharacterOrdinal` (`:1974`).
        champion.charFlags |= CHARFLAG_CHEST_OR_SCROLL;
      }
    } else if (place === 10) {
      if (isIllumulet(objNID4)) {
        this.ctx.dungeon.getMiscRecord(object)!.specialState = 1;
        const party = this.ctx.party.state;
        party.brightness = sw(party.brightness + illumuletLight(this.ctx.tables.word1074));
        selectPaletteForLightLevel(this.ctx);
      } else if (objNID4 >= OBJNI_JEWEL_SYMAL_A && objNID4 <= OBJNI_JEWEL_SYMAL_B) {
        this.ctx.dungeon.getMiscRecord(object)!.specialState = 1;
      }
    }
    drawCharacterState(this.ctx, chIdx, 0);
  }

  /**
   * `DropAllPossessions` (`doc/CSBwin-src/Character.cpp:2504-2525`) — everything a
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
      this.ctx.systems.worldMove.moveObject(
        this.ctx.dungeon.rnMaps.setPos(objD5, D6W), -1, 0, party.position.x, party.position.y, party.position.z,
      );
    }
  }

  /** `AdjustStatsForItemCarried` (`src/engine/AdjustStatsForItemCarried.ts`). */
  adjustStatsForItemCarried(champion: Champion, slot: number, addOrRemove: number, obj: ObjectID): void {
    AdjustStatsForItemCarried(champion, slot, addOrRemove, obj, this.ctx.dungeon, (rn) => nameIndexOf(this.ctx, rn));
  }

  /**
   * `CHARDESC::SetPossession(index, newObject, true)` (`doc/CSBwin-src/Character.cpp:2922-3003`),
   * the pair's slot write: the equip filter's DSA sees the object leaving and the one
   * arriving, then the slot is written.
   */
  private setPossession(chIdx: number, slot: number, value: ObjectID): void {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return;
    this.ctx.systems.dsa.equipFilter(chIdx, slot, getChampionPossession(champion, slot), value);
    this.setPossessionDirect(champion, slot, value);
  }

  /**
   * `CHARDESC::SetPossession(…, false)`, the bare slot write, with no filter: CSBWin's
   * temporary hand swap, where the object is put back at once (`doc/CSBwin-src/Mouse.cpp:700-707`).
   */
  setPossessionDirect(champion: Champion, slot: number, value: ObjectID): void {
    if (slot >= 0 && slot < champion.possessions.length) champion.possessions[slot] = value;
  }

  /**
   * `TAG0153c2` (`doc/CSBwin-src/Character.cpp:1526`) — is what is in `slot` the right
   * ammunition for the launcher in the fighting hand? Weapon classes 16-31 fire
   * class-10 objects (arrows), 32-47 fire class-11 (slingstones).
   */
  matchingAmmunition(champion: Champion, slot: number): boolean {
    const launcher = getChampionPossession(champion, 1);
    if (launcher === OBJECT_ID_NULL || this.ctx.dungeon.rnMaps.dbType(launcher) !== DBType.WEAPON) return false;
    const launcherDesc = this.ctx.systems.characterStats.weaponDescFor(launcher);
    if (!launcherDesc) return false;
    const wanted = ammunitionClassFor(launcherDesc.uByte1);
    if (wanted < 0) return false;

    const candidate = getChampionPossession(champion, slot);
    if (candidate === OBJECT_ID_NULL || this.ctx.dungeon.rnMaps.dbType(candidate) !== DBType.WEAPON) return false;
    const desc = this.ctx.systems.characterStats.weaponDescFor(candidate);
    return !!desc && desc.uByte1 === wanted;
  }

  /**
   * `TAG0115ee` (`doc/CSBwin-src/CSBCode.cpp:6310`) — put a weapon back into the hand
   * a throw emptied, from slot 12 first and then slots 7-9 (`:6322-6329`, each through
   * `TAG011594`, `:6290`). Only a weapon: a thrown apple does not come back.
   */
  refillPossessionSlot(chIdx: number, slot: number): void {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return;
    if (getChampionPossession(champion, slot) !== OBJECT_ID_NULL) return;
    for (const source of [12, 7, 8, 9]) {
      const obj = getChampionPossession(champion, source);
      if (obj === OBJECT_ID_NULL) continue;
      if (this.ctx.dungeon.rnMaps.dbType(obj) !== DBType.WEAPON) continue;
      this.addCharacterPossession(chIdx, this.removeCharacterPossession(chIdx, source), slot);
      return;
    }
  }

  /**
   * `BringCharacterToLife` (`doc/CSBwin-src/Character.cpp:805`).
   *
   * The order matters and is CSBWin's: the corner is settled **before** the champion
   * is alive again, because `CharacterAtPosition` ignores the dead — so the champion
   * never collides with themselves, and the free-corner search below always has one
   * to find (at most three of four can be living while this runs).
   *
   * The `MaxHP` cut is permanent, not a temporary weakening: dying costs a champion
   * a 64th of their maximum health for good, floored at 25.
   */
  bringCharacterToLife(chIdx: number): void {
    const party = this.ctx.party.state;
    const champ = party.champions[chIdx];
    if (!champ) return;

    if (characterAtPosition(party.champions, champ.partyPosition | 0) !== -1) {
      let free = 0;
      while (characterAtPosition(party.champions, free) !== -1) free++;
      champ.partyPosition = free & 0xff;
    }

    const maxHealth = champ.attributes?.maxHealth ?? 0;
    const reducedMax = Math.max(25, (maxHealth - Math.floor(maxHealth / 64) - 1) | 0);
    champ.attributes.maxHealth = reducedMax;
    champ.attributes.health = Math.floor(reducedMax / 2);
    // `pcA3->facing = (ui8)d.partyFacing` (`:824`) — a champion who comes back looks
    // the way the party is looking, not the way they died.
    champ.facing = party.facing;
  }

  /**
   * `_ExecuteAttack`'s engine half (`doc/CSBwin-src/Character.cpp:4969`): run the
   * attack, and record the type on the champion so `EnableCharacterAction` can undo
   * its defence penalty and refill a bow's quiver when the busy timer expires.
   * The attack menu's half — `d.AttackingCharacterOrdinal`, `d.PossibleAttackTypes`,
   * `TAG01b1c0` — is the UI's (`src/renderer/ui/Attack.ts`).
   */
  executeAttack(chIdx: number, attackType: number): number {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return 0;
    // `CHARDESC.word64` — the attack's own defence modifier, live until the
    // champion is free again. Mostly negative: swinging leaves you open.
    champion.attackStatModifier = this.attackStatModifier(attackType);
    const result = this.ctx.systems.attack.attack(chIdx, attackType);
    // The fusion's `Attack(_1_, …)` never returns (`Character.cpp:4997`): see `AttackSystem`.
    if (this.ctx.systems.mainLoop.isRunningScript()) return result;
    champion.attackType = attackType;
    return result;
  }

  /** `d.Byte20090[attackType]`, as a signed byte. */
  private attackStatModifier(attackType: number): number {
    const raw = this.ctx.tables.byte20090[attackType] ?? 0;
    return (raw << 24) >> 24;
  }
}

/**
 * `TAG0153c2`'s classes (`doc/CSBwin-src/Character.cpp:1539-1552`), which `atk_SHOOT`
 * checks too (`doc/CSBwin-src/Attack.cpp:1871-1897`): a launcher of weapon class 16-31
 * fires ammunition of class 10, one of 32-47 class 11. -1 for a weapon that is no
 * launcher. Its own function so that the eye's item properties show the pairing
 * (`getItemPropertyLines`, `src/renderer/ui/Objects.ts`).
 */
export function ammunitionClassFor(launcherClass: number): number {
  if (launcherClass >= 16 && launcherClass <= 31) return 10;
  if (launcherClass >= 32 && launcherClass <= 47) return 11;
  return -1;
}

/**
 * Whether round the neck the object lights the party: an Illumulet, worn (`_b`) or not
 * (`doc/CSBwin-src/Character.cpp:1866-1867`, `:2014-2015`).
 */
export function isIllumulet(nameIndex: number): boolean {
  return nameIndex >= OBJNI_ILLUMULET_A && nameIndex <= OBJNI_ILLUMULET_B;
}

/** What an Illumulet round the neck adds to `d.Brightness`, `d.Word1074[2]` (`Character.cpp:1871`, `:2021`). */
export function illumuletLight(word1074: readonly number[]): number {
  return word1074[2]!;
}
