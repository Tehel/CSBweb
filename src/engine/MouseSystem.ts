/**
 * `MouseSystem` — the engine half of CSBWin's `Mouse.cpp`: the cursor object dropped
 * (`DropObject`, `Mouse.cpp:848`, with its Vi-altar arm) or thrown (`ThrowObjectInHand`,
 * `:764`), and `ThrowByCharacter` (`:672`), which the THROW attack also runs. The UI half
 * — the hit tests, the inventory click — is `src/renderer/ui/Mouse.ts`.
 *
 * Moved out of `Game` by `DEBT.md` E2; the other systems reach it as `ctx.systems.mouse`.
 */
import { MISC_BONES_OF_HERO } from '../core/constants';
import { applyLimits } from '../core/intCast';
import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_NULL, type ObjectID, type Position } from '../core/types';
import { nameIndexOf, type GameContext } from './GameContext';
import type { Champion } from './gameTypes';
import { findChampionByFingerprint } from './Party';
import { AdjustSkillsWhy, determineMastery } from './skills';

export interface DropCursorOptions {
  viAltar?: boolean;
}

export class MouseSystem {
  constructor(private readonly ctx: GameContext) {}

  /**
   * `ThrowByCharacter` with an explicit hand (`doc/CSBwin-src/Mouse.cpp:672`) — the
   * THROW attack, which throws what is in the fighting hand rather than what the
   * cursor is holding. `range`/`damage`/`decayRate` of -1 mean "compute them", which
   * is how the Party Attack Filter can override any of the three.
   */
  throwFromWeaponHand(options: {
    chIdx: number;
    side: number;
    disableTime: number;
    range: number;
    damage: number;
    decayRate: number;
  }): number {
    const champion = this.ctx.party.state.champions[options.chIdx];
    if (!champion) return 0;
    const throwingDistance = this.ctx.systems.characterStats.determineThrowingDistance(
      champion, 1, this.ctx.party.state.sleeping,
    );
    const obj = this.ctx.systems.character.removeCharacterPossession(options.chIdx, 1);
    if (obj === OBJECT_ID_NULL) return 0;
    return this.throwByCharacter(
      options.chIdx, champion, obj, options.side, throwingDistance, options,
    ) ? 1 : 0;
  }

  /**
   * Drop the cursor object into the current/front cell, following CSBWin's DropObject positioning rules.
   */
  dropObjectFromCursor(relativePos: number, options?: DropCursorOptions): boolean {
    const party = this.ctx.party.state;
    const owner = party.cursorOwner ?? -1;
    if (owner < 0) return false;

    const obj = party.objectInHand;
    if (obj === OBJECT_ID_NULL) return false;

    let dropPos = relativePos | 0;
    if (dropPos < 0 || dropPos > 4) return false;
    if (dropPos === 4) dropPos = 2;

    const facing = party.facing & 0x3;
    const target =
      dropPos > 1
        ? facing === 0 ? party.position.north
          : facing === 1 ? party.position.east
            : facing === 2 ? party.position.south
              : party.position.west
        : party.position;

    const map = this.ctx.dungeon.getMap(target.z);
    if (!map) return false;
    if (target.x < 0 || target.y < 0 || target.x >= map.descriptor.width || target.y >= map.descriptor.height) return false;

    const decoded = decodeObjectID(obj);
    const newPos = (facing + dropPos) & 0x3;

    // `objD4.pos(w_4); MoveObject(objD4, -1, 0, D6W, D5W, NULL, NULL)`
    // (`doc/CSBwin-src/Mouse.cpp:881-882`): a freshly-dropped object still walks
    // through an active teleporter or open pit on the cell it lands on.
    const dropped = encodeObjectID(newPos, decoded.category, decoded.index);
    party.objectInHand = OBJECT_ID_NULL;
    this.ctx.systems.timer.moveObject(dropped, -1, 0, target.x, target.y, target.z);
    this.ctx.systems.monsters.loadPartyLevelOnArrival();
    this.ctx.systems.timer.processTimers(this.ctx.state.tickCount);
    if (options?.viAltar) {
      this.maybeScheduleViAltar(dropped, target, newPos);
    }
    return true;
  }

  /**
   * Dropping bones into the Vi altar's alcove (`doc/CSBwin-src/Mouse.cpp:894-960`).
   *
   * The two arms are the same pair `ProcessTT_ViAltar` runs on, and the difference
   * between them is the whole point. Bones made by a **death** carry an expool
   * record holding the champion's fingerprint; there `value` is the kind of bones
   * and must be **2** ("a dead champion's", `doc/CSBwin-src/CSB.h:1264`), and the
   * champion is found by fingerprint. Bones placed by the **dungeon** carry no
   * record; there `value` is itself the champion index and there is no `== 2` test
   * at all — which is why this used to demand `value == 2` unconditionally and so
   * ignored every dungeon-authored bones object except one aimed at champion 2.
   *
   * Both arms refuse a champion who is not dead, so the altar cannot be used to
   * resurrect the living.
   */
  private maybeScheduleViAltar(obj: ObjectID, location: Position, posInCell: number): void {
    const misc = this.ctx.dungeon.getMiscRecord(obj);
    if (!misc) return;
    // `objNI_2 == objNI_Bones_a`.
    if ((misc.miscType | 0) !== MISC_BONES_OF_HERO) return;

    const party = this.ctx.party.state;
    const fingerprint = this.ctx.dungeon.copyChampionBonesRecord(obj);
    let chIdx: number;
    if (fingerprint !== null) {
      chIdx = findChampionByFingerprint(party, fingerprint);
      if (chIdx === -1) return;
      if ((misc.specialState | 0) !== 2) return;
    } else {
      chIdx = (misc.specialState | 0) & 0x3;
      // `if (chIdx < d.NumCharacter)`.
      if (chIdx >= party.champions.length) return;
    }
    const champion = party.champions[chIdx];
    if (!champion) return;
    if (champion.alive !== false && (champion.attributes?.health ?? 0) !== 0) return;

    this.ctx.systems.timer.scheduleViAltar(obj, location, posInCell, this.ctx.state.tickCount);
  }

  /**
   * `ThrowObjectInHand` / `TAG01772e` (`doc/CSBwin-src/Mouse.cpp:764`) — throw what
   * the cursor is holding, on behalf of the champion who owns the cursor.
   */
  throwObjectFromCursor(leftOrRight: number): boolean {
    const party = this.ctx.party.state;
    const owner = party.cursorOwner ?? -1;
    if (owner < 0) return false;

    const obj = party.objectInHand;
    if (obj === OBJECT_ID_NULL) return false;

    const champion = party.champions[owner] ?? null;
    if (!champion) return false;

    // CSBWin's `hand < 0` path: the object goes into the fighting hand for exactly
    // as long as it takes to measure the throw, because `DetermineThrowingDistance`
    // reads a *possession*, not a loose object (`doc/CSBwin-src/Mouse.cpp:698-705`).
    const saved = champion.possessions[1]!;
    this.ctx.systems.character.setPossessionDirect(champion, 1, obj);
    const throwingDistance = this.ctx.systems.characterStats.determineThrowingDistance(
      champion, 1, party.sleeping,
    );
    this.ctx.systems.character.setPossessionDirect(champion, 1, saved);

    party.objectInHand = OBJECT_ID_NULL;
    const launched = this.throwByCharacter(owner, champion, obj, leftOrRight, throwingDistance);
    if (!launched) party.objectInHand = obj;
    return launched;
  }

  /**
   * The tail of `ThrowByCharacter` / `TAG017570` (`doc/CSBwin-src/Mouse.cpp:722-756`),
   * from the sound to `LaunchMissile`.
   *
   * The order matters and is not the obvious one: the throw **raises skill 10 before**
   * the mastery that sets its range is read, so a throw that levels the skill flies
   * that little bit further. All three missile statistics come out of one mastery
   * value — range from it plus the throwing distance, damage as `8 * mastery` plus
   * noise, and the decay rate as `11 - mastery` — so a master thrower throws further,
   * harder, and with a projectile that keeps its damage longer.
   *
   * This replaces `estimateThrowRange/Damage/Decay`, three invented formulas built on
   * strength and dexterity that touched neither the object's weight nor the skill.
   */
  private throwByCharacter(
    chIdx: number,
    champion: Champion,
    obj: ObjectID,
    leftOrRight: number,
    throwingDistance: number,
    overrides?: { disableTime: number; range: number; damage: number; decayRate: number },
  ): boolean {
    const party = this.ctx.party.state;

    this.ctx.sounds.queueSound(16, party.position.x, party.position.y, 1);
    this.ctx.systems.monsterAttack.adjustStamina(chIdx, this.throwStaminaCost(obj));
    // A negative disable time means "use the default", which is 4 ticks.
    const disableTime = overrides && overrides.disableTime >= 0 ? overrides.disableTime : 4;
    this.ctx.systems.magic.disableCharacterAction(chIdx, disableTime);

    // The experience the throw earns, and `weaponBonus` — the weapon's own
    // contribution to the distance, which doubles as the damage scale below.
    let experience = 8;
    let weaponBonus = 1;
    if (decodeObjectID(obj).category === DBType.WEAPON) {
      experience += 4;
      const desc = this.ctx.systems.characterStats.weaponDescFor(obj);
      // Above class 12 are the staves and wands, which gain nothing from a throw.
      if (desc && desc.uByte1 <= 12) {
        weaponBonus = desc.uByte3;
        experience += Math.trunc(weaponBonus / 4);
      }
    }
    this.ctx.systems.magic.applySpellSkillGain(chIdx, 10, experience, AdjustSkillsWhy.ThrowByCharacter);

    const base = throwingDistance + weaponBonus;
    const mastery = determineMastery(champion, 10, {
      partySleeping: party.sleeping,
      getObjectNameIndex: (objectId: ObjectID) => nameIndexOf(this.ctx, objectId),
    });
    const range = base + this.ctx.random.below(16) + Math.trunc(base / 2) + mastery;
    const damage = applyLimits(40, 8 * mastery + (this.ctx.random.next() & 31), 200);
    const decayRate = Math.max(5, 11 - mastery);

    const launched = this.ctx.systems.timer.throwObjectFromHand(
      obj,
      party.position,
      leftOrRight,
      party.facing,
      overrides && overrides.range >= 0 ? overrides.range : range,
      overrides && overrides.damage >= 0 ? overrides.damage : damage,
      overrides && overrides.decayRate >= 0 ? overrides.decayRate : decayRate,
      this.ctx.state.tickCount,
    );
    // `d.Word11712 = 4; d.Word11714 = d.partyFacing;` (doc/CSBwin-src/Mouse.cpp:753-754):
    // for 4 ticks the party cannot step after what it threw.
    party.word11712 = 4;
    party.word11714 = party.facing;
    return launched;
  }

  /**
   * `TAG016382` (`doc/CSBwin-src/Mouse.cpp:653`) — the stamina a throw costs, which
   * grows faster than linearly with weight: half the weight, clamped to 1-10, and then
   * half of every remaining 10 units piled on top.
   */
  private throwStaminaCost(obj: ObjectID): number {
    let remaining = Math.trunc(this.ctx.systems.characterStats.getObjectWeight(obj) / 2);
    let cost = applyLimits(1, remaining, 10);
    while ((remaining -= 10) > 0) {
      cost = cost + Math.trunc(remaining / 2);
    }
    return cost;
  }
}
