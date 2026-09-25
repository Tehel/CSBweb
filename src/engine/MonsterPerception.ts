/**
 * What a monster can see, smell, and step onto.
 *
 * The self-contained half of `doc/CSBwin-src/Monster.cpp` — everything the AI state
 * machine asks *questions* of, with no state of its own beyond the scratch fields
 * CSBWin keeps in `d`:
 *
 * - `BlockedTypeA` (:294) and `StoneOrClosedFalseWall` (:354) — the two wall tests
 * - `TestDirectPathOpen` (:375) — line of sight, by slope-following
 * - `Blocked` (:518) — can this group see the party at all
 * - `GetBestMonsterFacingP1` (:596) — smelling, and the footprint trail
 * - `PossibleMove` (:635), `FindPossibleMove` (:775), `PossibleDoubleMove` (:799)
 * - `TurnMonster` (:821) and `TurnMonsterGroup` (:876)
 *
 * plus `IsItInThisDirection` and `GetPrimaryAndSecondaryDirection` from
 * `Code11f52.cpp` (:2144 and :2181) and `DistanceBetweenPoints` (:4506).
 *
 * `PossibleMove` communicates through several `d.` globals rather than a return
 * value — whether a door blocked it, which monster was in the way, whether the step
 * would land on the party — so those are gathered into `MoveProbe` below and handed
 * back explicitly.
 */
import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../core/types';
import type { CsbRandom } from '../core/random';
import type { CreatureRecord } from '../data/dungeonTypes';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import type { PartyFootprints } from './PartyFootprints';
import { PartyFootprints as Footprints } from './PartyFootprints';
import type { MonsterDesc } from '../renderer/csbwin/ObjectTables';
import {
  monsterCanSeeInDark,
  monsterInvincible,
  monsterLevitating,
  monsterNonMaterial,
  monsterSee360,
  monsterSeesInvisible,
  monsterSightDistance,
  monsterSmellingDistance,
  monsterVerticalSize,
  monsterWord16_12_15,
} from '../renderer/csbwin/ObjectTables';
import { setPackedBits } from './MonsterSystem';
import { CloudType } from './cloudTypes';

/** `d.DeltaX` / `d.DeltaY`, indexed by direction (N, E, S, W). */
export const DELTA_X = [0, 1, 0, -1];
export const DELTA_Y = [-1, 0, 1, 0];


/** `PossibleMove`'s minimum `word16_12_15` before a monster will use a teleporter. */
const TELEPORTER_WILLINGNESS = 10;

/**
 * `RelativeXY` (`doc/CSBwin-src/CSBCode.cpp:4571`) — step `forward` cells along
 * `facing` and `right` cells along `facing + 1`.
 */
export function relativeXY(facing: number, forward: number, right: number, mapX: number, mapY: number): { x: number; y: number } {
  const f = facing & 0x3;
  const r = (facing + 1) & 0x3;
  return {
    x: mapX + forward * (DELTA_X[f] ?? 0) + right * (DELTA_X[r] ?? 0),
    y: mapY + forward * (DELTA_Y[f] ?? 0) + right * (DELTA_Y[r] ?? 0),
  };
}

/** `DistanceBetweenPoints` (`doc/CSBwin-src/Monster.cpp:4506`) — orthogonal, "crow". */
export function distanceBetweenPoints(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * `IsItInThisDirection` (`doc/CSBwin-src/Code11f52.cpp:2144`).
 *
 * True when the destination lies within a 45°-ish cone ahead of `dir`. "Even with
 * us" counts as ahead, and the sideways tolerance is `ahead + 1`, so the cone is one
 * cell wider than a strict diagonal.
 */
export function isItInThisDirection(dir: number, myX: number, myY: number, destX: number, destY: number): boolean {
  let ahead = 0;
  let sideways = 0;
  switch (dir & 0x3) {
    case 0: ahead = myY - destY; sideways = destX - myX; break;
    case 1: ahead = destX - myX; sideways = destY - myY; break;
    case 2: ahead = destY - myY; sideways = destX - myX; break;
    case 3: ahead = myX - destX; sideways = destY - myY; break;
  }
  if (ahead < 0) return false;
  if (Math.abs(sideways) > ahead + 1) return false;
  return true;
}

/**
 * `GetPrimaryAndSecondaryDirection` (`doc/CSBwin-src/Code11f52.cpp:2181`).
 *
 * The primary direction is the one within 45° of the target. At exactly 45° the two
 * candidate directions are assigned to primary and secondary at random; inside 45°
 * the secondary is one of the two perpendicular directions, also at random.
 *
 * Returns both, since CSBWin returns the primary and leaves the secondary in
 * `d.SecondaryDirection`.
 */
export function getPrimaryAndSecondaryDirection(
  random: CsbRandom,
  oldX: number,
  oldY: number,
  newX: number,
  newY: number,
): { primary: number; secondary: number } {
  if (oldX === newX) {
    const secondary = (random.next() & 2) + 1;
    return { primary: oldY > newY ? 0 : 2, secondary };
  }
  if (oldY === newY) {
    const secondary = (random.next() & 2) + 0;
    return { primary: oldX > newX ? 3 : 1, secondary };
  }

  // Moved in both axes.
  for (let dir = 0; ; dir = (dir + 1) & 3) {
    if (!isItInThisDirection(dir, oldX, oldY, newX, newY)) continue;

    let secondary = (dir + 1) & 3;
    if (!isItInThisDirection(secondary, oldX, oldY, newX, newY)) {
      // Not a perfect diagonal towards `dir + 1`. Try `dir - 1`, but only when
      // `dir != 0` — CSBWin's short-circuit, which makes north special.
      let diagonal = false;
      if (dir !== 0) {
        secondary = (dir + 3) & 3;
        diagonal = isItInThisDirection(secondary, oldX, oldY, newX, newY);
      }
      if (!diagonal) {
        secondary = (dir + (random.next() & 2) + 1) & 3;
        return { primary: dir, secondary };
      }
    }
    // A perfect diagonal: swap primary and secondary on a coin toss.
    if (random.bool() !== 0) return { primary: secondary, secondary: dir };
    return { primary: dir, secondary };
  }
}

/** The two wall predicates `TestDirectPathOpen` is parameterised over. */
export type BlockingTest = (mapX: number, mapY: number) => boolean;

export class MonsterPerception {
  private readonly dungeon: DungeonState;
  private readonly random: CsbRandom;
  private readonly footprints: PartyFootprints;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.random = ctx.random;
    this.footprints = ctx.footprints;
  }

  /**
   * `BlockedTypeA` (`doc/CSBwin-src/Monster.cpp:294`) — blocked to passage, where
   * "certain monsters can go through certain doors".
   *
   * A door at position 3 (almost closed) or 4 (closed) blocks unless its `DoorTOC`
   * entry has bit 8 set, marking it one of the level's two special types. Note
   * CSBWin's `if (neophyteSkills)` here has identical branches — a real no-op, kept
   * out of the port rather than reproduced.
   */
  blockedTypeA(level: number, mapX: number, mapY: number): boolean {
    const position = new Position(mapX, mapY, level);
    const flag = this.dungeon.getCellFlag(position);
    const roomType = (flag >> 5) & 0x7;

    if (roomType === RoomType.DOOR) {
      const doorPosition = flag & 0x7;
      if (doorPosition === 3 || doorPosition === 4) {
        const doorRn = this.dungeon.findFirstDoor(position);
        const door = doorRn === OBJECT_ID_EOF ? null : this.dungeon.getDoorRecordByIndex(decodeObjectID(doorRn).index);
        const toc = door ? this.dungeon.doorTOC(level, door.doorType, this.ctx.tables.doorCharacteristics) : 0;
        return (toc & 0x100) === 0; // blocked unless special
      }
      return false;
    }
    if (roomType === RoomType.STONE) return true;
    if (roomType !== RoomType.FALSEWALL) return false;
    if ((flag & 4) !== 0) return false; // open false wall
    return true;
  }

  /** `StoneOrClosedFalseWall` (`doc/CSBwin-src/Monster.cpp:354`). Doors do not block. */
  stoneOrClosedFalseWall(level: number, mapX: number, mapY: number): boolean {
    const flag = this.dungeon.getCellFlag(new Position(mapX, mapY, level));
    const roomType = (flag >> 5) & 0x7;
    if (roomType === RoomType.STONE) return true;
    if (roomType !== RoomType.FALSEWALL) return false;
    if ((flag & 4) !== 0) return false;
    return true;
  }

  /**
   * `TestDirectPathOpen` (`doc/CSBwin-src/Monster.cpp:375`).
   *
   * Walks from the party towards the monster, keeping the slope of the line as
   * constant as it can: at each step it computes what the slope would become after a
   * step in x and after a step in y, and takes whichever deviates less. If the cell
   * it lands on is blocked it gives up — except on an exact tie, where it gets one
   * retry along the other diagonal.
   *
   * A perfect diagonal is handled separately: both orthogonal neighbours must be
   * blocked *and* the diagonal cell itself before the path is refused.
   *
   * Returns the orthogonal distance if the path is open, 0 if it is blocked, and 1
   * when the two points are already adjacent. Slopes are scaled by 64 and use
   * integer division, exactly as CSBWin does — the truncation is part of the result.
   *
   * There is no `level` parameter, as in CSBWin: the `blocked` callback the caller
   * supplies already knows which level it is testing, the way CSBWin's two
   * predicates read the loaded level's `d.LevelCellFlags`.
   */
  testDirectPathOpen(
    mapX: number,
    mapY: number,
    partyX: number,
    partyY: number,
    blocked: BlockingTest,
  ): number {
    if (Math.abs(mapX - partyX) + Math.abs(mapY - partyY) <= 1) return 1;

    const dx = Math.abs(partyX - mapX);
    const dy = Math.abs(partyY - mapY);
    const northSouth = dx < dy;
    const diagonal = dx === dy;

    let x = partyX;
    let y = partyY;
    const stepX = partyX <= mapX ? 1 : -1;
    const stepY = partyY <= mapY ? 1 : -1;

    // The original slope, measured from the party's starting cell.
    const slopeAt = (px: number, py: number): number => {
      const denom = northSouth ? py - mapY : px - mapX;
      if (denom === 0) return 128;
      const numer = northSouth ? px - mapX : py - mapY;
      return Math.trunc((64 * numer) / denom);
    };
    const originalSlope = slopeAt(x, y);

    do {
      if (diagonal) {
        if (
          (blocked(x + stepX, y) && blocked(x, y + stepY)) ||
          blocked((x += stepX), (y += stepY))
        ) {
          return 0;
        }
      } else {
        const deviationX = Math.abs(slopeAt(x + stepX, y) - originalSlope);
        const deviationY = Math.abs(slopeAt(x, y + stepY) - originalSlope);
        if (deviationX < deviationY) x += stepX;
        else y += stepY;

        if (blocked(x, y)) {
          if (deviationX !== deviationY) return 0;
          // An exact tie gets one retry, stepping the other way on both axes.
          x += stepX;
          y -= stepY;
          if (blocked(x, y)) return 0;
        }
      }
    } while (Math.abs(y - mapY) + Math.abs(x - mapX) > 1);

    return distanceBetweenPoints(mapX, mapY, partyX, partyY);
  }

  /**
   * `Blocked` (`doc/CSBwin-src/Monster.cpp:518`) — despite the name, this answers
   * "can this group see the party?", returning the distance to it or 0.
   *
   * An invisible party is unseen unless the monster `seesInvisible`. A `See360`
   * monster skips the facing check entirely; otherwise the party must lie in the
   * cone ahead of at least one *distinct* facing in the group (CSBWin de-duplicates
   * the facings first, so a group of four all looking north tests north once).
   *
   * Sight distance is reduced by `CurrentPalette / 2` — half a step per level of
   * darkness — unless the monster `canSeeInDark`, and never falls below 1.
   */
  blocked(
    monster: CreatureRecord,
    individualMonsterIndex: number,
    level: number,
    mapX: number,
    mapY: number,
    context: {
      partyX: number;
      partyY: number;
      partyInvisible: boolean;
      currentPalette: number;
      orthogonalDistanceToParty: number;
    },
  ): number {
    const desc = this.ctx.tables.monsterDesc[monster.creatureType];
    if (!desc) return 0;
    if (context.partyInvisible && !monsterSeesInvisible(desc)) return 0;

    const seeParty = (): number => {
      let sight = monsterSightDistance(desc);
      if (!monsterCanSeeInDark(desc)) sight -= Math.trunc(context.currentPalette / 2);
      const limit = Math.max(1, sight);
      if (context.orthogonalDistanceToParty > limit) return 0;
      return this.testDirectPathOpen(mapX, mapY, context.partyX, context.partyY, (bx, by) =>
        this.blockedTypeA(level, bx, by),
      );
    };

    if (monsterSee360(desc)) return seeParty();

    const item16 = this.dungeon.getAttachedItem16(monster);
    // CSBWin substitutes 0x7ccc here when no ITEM16 is attached, "designed to cause
    // error" (doc/CSBwin-src/Monster.cpp:538). A monster with no slot is not active,
    // so answering "cannot see" is the honest equivalent.
    if (!item16) return 0;
    const facings = item16.facings & 0xff;

    const distinct: number[] = [];
    if (individualMonsterIndex < 0) {
      for (let i = monster.numMonM1 & 0x3; i >= 0; i--) {
        const facing = (facings >> (2 * i)) & 0x3;
        if (!distinct.includes(facing)) distinct.push(facing);
      }
    } else {
      distinct.push((facings >> (2 * individualMonsterIndex)) & 0x3);
    }

    // CSBWin walks the list backwards (`while (D6W-- != 0)`).
    for (let i = distinct.length - 1; i >= 0; i--) {
      if (!isItInThisDirection(distinct[i]!, mapX, mapY, context.partyX, context.partyY)) continue;
      return seeParty();
    }
    return 0;
  }

  /**
   * `GetBestMonsterFacingP1` (`doc/CSBwin-src/Monster.cpp:596`) — smelling.
   *
   * Returns a **1-based** direction (0 = no preference), plus the secondary
   * direction CSBWin leaves in `d.SecondaryDirection`.
   *
   * Two ways to get a scent. Within `(smellingDistance + 1) / 2` cells, with an open
   * path ignoring doors, the monster simply knows where the party is. Failing that it
   * checks the footprint trail: the freshest print on its own square, aged by
   * `Random(0..3) + age`, is followed if that total exceeds
   * `30 - 2 * smellingDistance` — so a keener nose follows staler prints.
   */
  getBestMonsterFacing(
    desc: MonsterDesc,
    level: number,
    mapX: number,
    mapY: number,
    context: {
      partyX: number;
      partyY: number;
      orthogonalDistanceToParty: number;
      primaryDirectionToParty: number;
      secondaryDirectionToParty: number;
    },
  ): { direction: number; secondary: number } {
    const smell = monsterSmellingDistance(desc);
    if (smell === 0) return { direction: 0, secondary: context.secondaryDirectionToParty };

    if (
      Math.trunc((smell + 1) / 2) >= context.orthogonalDistanceToParty &&
      this.testDirectPathOpen(mapX, mapY, context.partyX, context.partyY, (bx, by) =>
        this.stoneOrClosedFalseWall(level, bx, by),
      ) !== 0
    ) {
      return {
        direction: context.primaryDirectionToParty + 1,
        secondary: context.secondaryDirectionToParty,
      };
    }

    const found = this.footprints.searchFootprints(level, mapX, mapY);
    if (found !== 0) {
      const roll = this.random.zeroTo3();
      // Note the index skew, which is CSBWin's: the age comes from `found - 1` but
      // the followed print from `found` (doc/CSBwin-src/Monster.cpp:618-625).
      if (roll + this.footprints.getAge(found - 1) > 30 - 2 * smell) {
        const target = this.footprints.getPrint(found);
        const dirs = getPrimaryAndSecondaryDirection(
          this.random,
          mapX,
          mapY,
          Footprints.printX(target),
          Footprints.printY(target),
        );
        return { direction: dirs.primary + 1, secondary: dirs.secondary };
      }
    }
    return { direction: 0, secondary: context.secondaryDirectionToParty };
  }

  /**
   * `PossibleMove` (`doc/CSBwin-src/Monster.cpp:635`) — may this group step one cell
   * in `direction`, and if not, why not.
   *
   * `recognizesFalsePitsAndWalls` is CSBWin's `RFPAW`: it only matters for a cell
   * whose flag bit 0 is set, which marks a *fake* pit or false wall — a monster that
   * recognises the illusion will walk onto it.
   *
   * The order of the tests is the order CSBWin runs them, and it matters: the
   * fluxcage check (invincible monsters only) precedes the teleporter check, which
   * precedes the party check, which precedes the door check, which precedes looking
   * for another monster in the way.
   */
  possibleMove(
    monsterRn: ObjectID,
    desc: MonsterDesc,
    level: number,
    mapX: number,
    mapY: number,
    direction: number,
    recognizesFalsePitsAndWalls: boolean,
    state: MoveProbeState,
  ): MoveProbe {
    const dir = direction & 0x3;
    state.directionHasBeenTested[dir] = 1;

    const probe: MoveProbe = {
      possible: false,
      impossible: true, // d.Word13038 — "assume the move is impossible"
      blockedByDoor: false,
      monsterInTheWay: OBJECT_ID_EOF,
      moveOntoPartyPosition: false,
      fluxcage: false,
    };

    // `timePerMove == 255` means the monster never moves at all.
    if (desc.movementTicks06 === 255) return probe;

    const step = relativeXY(dir, 1, 0, mapX, mapY);
    const map = this.dungeon.getMap(level);
    if (!map) return probe;
    if (step.x < 0 || step.x >= map.descriptor.width) return probe;
    if (step.y < 0 || step.y >= map.descriptor.height) return probe;
    if (state.monsterMoveInhibit[dir] !== 0) return probe;

    const target = new Position(step.x, step.y, level);
    const flag = this.dungeon.getCellFlag(target);
    const roomType = (flag >> 5) & 0x7;

    if (roomType === RoomType.STONE) return probe;
    if (roomType === RoomType.STAIRS) return probe;
    if (roomType === RoomType.PIT) {
      if ((flag & 8) !== 0 && !monsterLevitating(desc)) {
        // Bit 0 marks a fake pit; only a monster that recognises it will step on.
        if (!((flag & 1) !== 0 ? recognizesFalsePitsAndWalls : false)) return probe;
      }
    }
    if (roomType === RoomType.FALSEWALL) {
      if ((flag & 4) === 0) {
        if (!((flag & 1) !== 0 ? recognizesFalsePitsAndWalls : false)) return probe;
      }
    }
    probe.impossible = false;

    // An invincible monster is stopped dead by a Fluxcage. This is the mechanism the
    // Lord Chaos fusion depends on.
    if (monsterInvincible(desc)) {
      for (
        let rn = this.dungeon.findFirstObject(target);
        rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
        rn = this.dungeon.getDBRecordLink(rn)
      ) {
        if (decodeObjectID(rn).category !== DBType.CLOUD) continue;
        const cloud = this.dungeon.getCloudRecord(rn);
        if (!cloud || cloud.cloudType !== CloudType.CT_FLUXCAGE) continue;
        state.fluxCages[dir] = 1;
        state.fluxCageCount++;
        probe.fluxcage = true;
        return probe;
      }
    }

    // An active teleporter that accepts monsters, where this monster is unwilling or
    // is not allowed on the destination level, makes the move impossible.
    if (roomType === RoomType.TELEPORTER && (flag & 8) !== 0 && monsterWord16_12_15(desc) >= TELEPORTER_WILLINGNESS) {
      const teleporter = this.dungeon.getTeleporterRecord(this.dungeon.findFirstObject(target));
      if (teleporter && teleporter.scope !== 0) {
        const monster = this.dungeon.getCreatureRecord(monsterRn);
        if (!monster || !this.dungeon.monsterAllowedOnLevel(monster.creatureType, teleporter.destMap & 0xff)) {
          probe.impossible = true;
          return probe;
        }
      }
    }

    probe.moveOntoPartyPosition =
      level === this.ctx.party.state.position.z && step.x === state.partyX && step.y === state.partyY;
    if (probe.moveOntoPartyPosition) return probe;

    if (roomType === RoomType.DOOR) {
      const doorPosition = flag & 0x7;
      const doorRn = this.dungeon.findFirstDoor(target);
      const door = doorRn === OBJECT_ID_EOF ? null : this.dungeon.getDoorRecordByIndex(decodeObjectID(doorRn).index);
      // A vertical (up-down) door admits a monster up to its `verticalSize`; a
      // sideways one only at position 1 or below.
      const allowance = door && door.vertical ? monsterVerticalSize(desc) : 1;
      if (doorPosition > allowance && doorPosition !== 5 && !monsterNonMaterial(desc)) {
        probe.blockedByDoor = true;
        return probe;
      }
    }

    probe.monsterInTheWay = this.dungeon.findFirstMonster(target);
    probe.possible = probe.monsterInTheWay === OBJECT_ID_EOF;
    return probe;
  }

  /**
   * `FindPossibleMove` (`doc/CSBwin-src/Monster.cpp:775`) — the first untested
   * direction that works, **1-based** (0 = none).
   */
  findPossibleMove(
    monsterRn: ObjectID,
    desc: MonsterDesc,
    level: number,
    mapX: number,
    mapY: number,
    recognizesFalsePitsAndWalls: boolean,
    state: MoveProbeState,
  ): number {
    for (let direction = 0; direction < 4; direction++) {
      if (state.directionHasBeenTested[direction] !== 0) continue;
      const probe = this.possibleMove(monsterRn, desc, level, mapX, mapY, direction, recognizesFalsePitsAndWalls, state);
      if (probe.possible) return direction + 1;
    }
    return 0;
  }

  /**
   * `PossibleDoubleMove` (`doc/CSBwin-src/Monster.cpp:799`) — can the group take a
   * *second* step in the same direction. A Fluxcage already found in that direction
   * refuses it outright, and `RFPAW` is hard-coded off for the second step.
   */
  possibleDoubleMove(
    monsterRn: ObjectID,
    desc: MonsterDesc,
    level: number,
    mapX: number,
    mapY: number,
    direction: number,
    state: MoveProbeState,
  ): boolean {
    const dir = direction & 0x3;
    if (state.fluxCages[dir] !== 0) return false;
    return this.possibleMove(
      monsterRn,
      desc,
      level,
      mapX + (DELTA_X[dir] ?? 0),
      mapY + (DELTA_Y[dir] ?? 0),
      dir,
      false,
      state,
    ).possible;
  }

  /**
   * `TurnMonster` (`doc/CSBwin-src/Monster.cpp:821`).
   *
   * A monster already facing *away* from the preferred direction turns only 90°, to
   * one side at random, rather than spinning about face. Anything else snaps straight
   * to the preferred direction.
   *
   * `asPair` is CSBWin's `P4`: a monster occupying two corners (a worm) must turn
   * both of its halves together, so the partner at `index ^ 1` gets the same facing.
   * The `d.Time13130` / `d.pI1613134` guard stops a pair being turned twice in one
   * tick, and is carried in `state`.
   */
  turnMonster(
    state: TurnState,
    slotIndex: number,
    facingsRef: { facings: number },
    preferredDirection: number,
    monsterIndex: number,
    asPair: boolean,
    time: number,
  ): void {
    if (asPair && state.lastPairTurnTime === time && state.lastPairTurnSlot === slotIndex) return;

    let facings = facingsRef.facings & 0xff;
    const current = (facings >> (2 * monsterIndex)) & 0x3;
    const relative = (current - preferredDirection) & 0x3;

    const newDir =
      relative === 2
        ? ((this.random.next() & 2) + preferredDirection + 1) & 0x3
        : preferredDirection & 0x3;

    facings = setPackedBits(facings, monsterIndex, newDir);
    if (asPair) {
      facings = setPackedBits(facings, monsterIndex ^ 1, newDir);
      state.lastPairTurnTime = time;
      state.lastPairTurnSlot = slotIndex;
    }
    facingsRef.facings = facings & 0xff;
  }

  /**
   * `TurnMonsterGroup` (`doc/CSBwin-src/Monster.cpp:876`).
   *
   * Each member turns on a coin toss, except member 0, which always turns. When
   * `asPairs` is set and the group has more than one member the loop starts one lower
   * so the pairing in `turnMonster` lines up.
   */
  turnMonsterGroup(
    state: TurnState,
    slotIndex: number,
    facingsRef: { facings: number },
    preferredDirection: number,
    numMonsterM1: number,
    asPairs: boolean,
    time: number,
  ): void {
    let index = numMonsterM1;
    const pair = index !== 0 && asPairs;
    if (pair) index--;
    do {
      if (index === 0 || this.random.bool() !== 0) {
        this.turnMonster(state, slotIndex, facingsRef, preferredDirection, index, pair, time);
      }
      index--;
    } while (index >= 0);
  }

  /* ------------------------------------------------------------- internals ---- */

}

/** What `PossibleMove` answers, gathered from CSBWin's `d.` scratch globals. */
export interface MoveProbe {
  /** The move can be made. */
  possible: boolean;
  /** `d.Word13038` — the destination itself is impassable. */
  impossible: boolean;
  /** `d.Word13042` — a door in the way, at a position this monster cannot pass. */
  blockedByDoor: boolean;
  /** `d.Obj13040` — the monster occupying the destination, or `OBJECT_ID_EOF`. */
  monsterInTheWay: ObjectID;
  /** `d.moveOntoPartyPosition` — the step would land on the party. */
  moveOntoPartyPosition: boolean;
  /** A Fluxcage stopped an invincible monster. */
  fluxcage: boolean;
}

/** The per-turn scratch state `PossibleMove` reads and writes across calls. */
export interface MoveProbeState {
  /** `d.DirectionHasBeenTested[4]`. */
  directionHasBeenTested: Uint8Array;
  /** `monsterMoveInhibit[4]`, which the Monster Move Filter DSA may set. */
  monsterMoveInhibit: Uint8Array;
  /** `d.FluxCages[4]` and `d.FluxCageCount`. */
  fluxCages: Uint8Array;
  fluxCageCount: number;
  partyX: number;
  partyY: number;
}

/** `d.Time13130` / `d.pI1613134` — the once-per-tick guard on turning a pair. */
export interface TurnState {
  lastPairTurnTime: number;
  lastPairTurnSlot: number;
}

export function makeMoveProbeState(partyX: number, partyY: number): MoveProbeState {
  return {
    directionHasBeenTested: new Uint8Array(4),
    monsterMoveInhibit: new Uint8Array(4),
    fluxCages: new Uint8Array(4),
    fluxCageCount: 0,
    partyX,
    partyY,
  };
}
