import { decodeObjectID, encodeObjectID, DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, rnEquals, type LocationRel, type ObjectID } from '../core/types';

/**
 * `soundDOOROPENING` (doc/CSBwin-src/CSB.h:626) — what the party hears when a closing
 * door springs back off them.
 */
const SOUND_DOOR_OPENING = 18;
/** The ordinal `ProcessTT_1` queues when a door rebounds off a monster (`QueueSound(4, …)`). */
const SOUND_DOOR_STRUGGLE = 4;
/** The ordinal `ProcessTT_1` queues for each step a door moves (`QueueSound(2, …)`, Timer.cpp:1375). */
const SOUND_DOOR_STEP = 2;
/** `soundTELEPORT` (doc/CSBwin-src/CSB.h:625). */
const SOUND_TELEPORT = 17;
import type { CsbRandom } from '../core/random';
import { sw } from '../core/intCast';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { getChampionPossession, type PartyState } from './gameTypes';
import { CHARFLAG_ATTACK_DISABLE } from '../data/CsbwinCharacters';
import {
  RN_DISPELL_MISSILE, RN_FIREBALL, RN_LIGHTNING, RN_MONSTER_DEATH, RN_POISON_CLOUD, RN_FFE4,
  isMagicSpellRn,
} from '../core/spellRn';
import { findChampionByFingerprint } from './Party';
import type {
  ActuatorRecord,
  MapData,
  TextRecord,
} from '../data/dungeonTypes';
import {
  ActuatorAction,
  getActuatorAction,
  getActuatorAndOrEdge,
  getActuatorDelay,
  getActuatorEnergyRemaining,
  getActuatorDisableTime,
  getActuatorDrawAsSize4,
  getActuatorHitPointMultiplier,
  getActuatorSetResponses,
  getActuatorClearResponses,
  getActuatorToggleResponses,
  getActuatorState,
  getActuatorTargetPos,
  getActuatorType,
  getActuatorValue,
  isActuatorNormallyClosed,
  isActuatorAudible,
  isActuatorOnceOnly,
  setActuatorState,
  setActuatorType,
  setActuatorValue,
} from '../data/actuatorHelpers';
import { MISSILE_FILTER_TIMER_INDEX, TimerFunction, type TimerEntry, TimerQueue } from './TimerQueue';
import { AttackType } from './monsterTypes';
import { MonsterDamageResult } from './MonsterDamage';
import { monsterNonMaterial, monsterVerticalSize } from '../renderer/csbwin/ObjectTables';
import { constructPredefinedMissile, decodeMissileTimerWord8, encodeMissileTimerWord8, spellObjectId } from './missileHelpers';


export type MissileDropTarget = { monster: ObjectID } | null;

/** A door's state, the low three bits of its cell's flags, as the door timer and `HitDoor` write it. */
export function setDoorState(map: MapData, x: number, y: number, doorState: number): void {
  const cellFlag = map.cellFlags[x][y];
  const newCellFlag = (cellFlag & 0xf8) | (doorState & 0x7);
  map.cellFlags[x][y] = newCellFlag;
}

export class TimerSystem {
  /**
   * `d.Time` as `processTimers` last set it. `MissileEncounter`'s `CreateCloud`,
   * `HitDoor` and Zo-at-a-door arm schedule from it, also when they are reached from
   * outside a timer pass (a monster death).
   */
  now = 0;
  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;
  private readonly random: CsbRandom;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
    this.random = ctx.random;
    this.dungeon.setTimerWord8Lookup((index) => this.timers.getTimerWord8(index));
  }

  processTimers(currentTime: number): void {
    this.now = currentTime >>> 0;
    let processed = 0;
    let next = this.timers.peekNext();

    while (next && next.time <= currentTime) {
      const timer = this.timers.shiftNext();
      if (!timer) break;
      this.dispatch(timer);

      processed++;
      if (processed > 50000) {
        // A timer that re-queues itself at the tick it just ran on livelocks the pass,
        // and everything behind it in the queue silently stops happening. This used to
        // `break` without a word, which is how the level-3 monster stall below went
        // unnoticed. Say which timer did it.
        console.warn(
          `TimerSystem: timer pass at t=${currentTime} hit the 50000 cap; last timer ` +
          `fn=${timer.function} time=${timer.time} at (${timer.uByte6},${timer.uByte7}) ` +
          `L${timer.level}. Timers behind it did not run.`,
        );
        break;
      }
      next = this.timers.peekNext();
    }
  }

  private dispatch(timer: TimerEntry): void {
    // The monster AI is routed off before the switch, exactly as CSBWin does
    // (doc/CSBwin-src/CSBCode.cpp:6422-6429) — timer types 29-41 never reach the
    // ordinary timer dispatch.
    if (
      timer.function >= TimerFunction.TT_FIRST_MONSTER_AI &&
      timer.function <= TimerFunction.TT_LAST_MONSTER_AI
    ) {
      this.ctx.systems.monsterAI.processTimers29to41({
        mapX: timer.uByte6,
        mapY: timer.uByte7,
        level: timer.level,
        timerFunction: timer.function,
        timeUntilAlternateUpdate: timer.uByte8,
      });
      return;
    }

    switch (timer.function) {
      case TimerFunction.TT_DOOR_STEP:
        this.processDoorStep(timer);
        break;
      case TimerFunction.TT_BASH_DOOR:
        this.processBashDoor(timer);
        break;
      case TimerFunction.TT_LIGHT:
        this.processLightLevelTimer(timer);
        break;
      case TimerFunction.TT_71:
        this.processInvisibleTimer();
        break;
      case TimerFunction.TT_72:
        this.processChampionShieldTimer(timer);
        break;
      case TimerFunction.TT_73:
        this.processSeeThruWallsTimer();
        break;
      case TimerFunction.TT_74:
        this.processPartyShieldTimer(timer);
        break;
      case TimerFunction.TT_75:
        this.processPoisonTimer(timer);
        break;
      case TimerFunction.TT_77:
        this.processSpellShieldTimer(timer);
        break;
      case TimerFunction.TT_78:
        this.processFireShieldTimer(timer);
        break;
      case TimerFunction.TT_79:
        this.processMagicFootprintsTimer();
        break;
      case TimerFunction.TT_MISSILE0:
      case TimerFunction.TT_MISSILE:
        this.processMissileTimer(timer);
        break;
      case TimerFunction.TT_11:
        this.processActionDisableTimer(timer);
        break;
      case TimerFunction.TT_24:
        this.processExpireObject(timer);
        break;
      case TimerFunction.TT_25:
        this.processTT_25(timer);
        break;
      case TimerFunction.TT_60:
      case TimerFunction.TT_61:
        this.ctx.systems.monsters.processAbeyanceTimer(timer);
        break;
      case TimerFunction.TT_OPENROOM:
        this.processOpenRoom(timer);
        break;
      case TimerFunction.TT_STONEROOM:
        this.processStoneRoom(timer);
        break;
      case TimerFunction.TT_FALSEWALL:
        this.processFalseWall(timer);
        break;
      case TimerFunction.TT_TELEPORTER:
        this.processTeleporter(timer);
        break;
      case TimerFunction.TT_PIT:
        this.processPit(timer);
        break;
      case TimerFunction.TT_DOOR:
        this.processDoor(timer);
        break;
      case TimerFunction.TT_VI_ALTAR:
        this.processViAltar(timer);
        break;
      case TimerFunction.TT_DESSAGE:
        this.processOpenRoom(timer);
        break;
      case TimerFunction.TT_PARAMETER_MESSAGE:
        this.processParameterMessage(timer);
        break;
      case TimerFunction.TT_REACTIVATE_GENERATOR:
        this.processReactivateGenerator(timer);
        break;
      default:
        break;
    }
  }

  private processActionDisableTimer(timer: TimerEntry): void {
    const chIdx = timer.uByte5 & 0xff;
    if (!this.ctx.party.state.champions[chIdx]) return;
    // The `TT_11` case (doc/CSBwin-src/CSBCode.cpp:6466-6475): `EnableCharacterAction`,
    // then `TAG0115ee(chIdx, uByte6 - 1)` when `uByte6 != 0` — the slot a throw emptied.
    this.enableCharacterAction(chIdx);
    const refillSlot = timer.uByte6 & 0xff;
    if (refillSlot !== 0) this.ctx.systems.character.refillPossessionSlot(chIdx, refillSlot - 1);
  }

  /**
   * `EnableCharacterAction` (`doc/CSBwin-src/Timer.cpp:2638`) — the champion is free
   * again: the busy timer and bit go, so does the attack's defence penalty, a bow that
   * has just been fired reloads from the quiver, and the attack is over. The
   * `CHARFLAG_weaponAttack` and `DrawCharacterState` of `:2675-2676` are the redraw,
   * which this port does every frame.
   */
  private enableCharacterAction(chIdx: number): void {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return;
    champion.busyTimerIndex = -1;
    champion.charFlags &= ~CHARFLAG_ATTACK_DISABLE;
    if (champion.attackType !== -1) champion.attackStatModifier = 0;
    if ((champion.attributes.health | 0) !== 0) {
      // A bow that has just been fired reloads itself from slot 12, then from
      // slots 7-9, taking the first object of the matching ammunition class
      // (`TAG0153c2`, `doc/CSBwin-src/Timer.cpp:2656-2672`).
      const character = this.ctx.systems.character;
      if (champion.attackType === AttackType.atk_SHOOT && getChampionPossession(champion, 0) === OBJECT_ID_NULL) {
        for (const slot of [12, 7, 8, 9]) {
          if (character.matchingAmmunition(champion, slot)) {
            character.addCharacterPossession(chIdx, character.removeCharacterPossession(chIdx, slot), 0);
            break;
          }
        }
      }
    }
    champion.attackType = -1;
  }

  queueBrightnessTimer(deltaSteps: number, time: number): void {
    const party = this.ctx.party.state;
    this.timers.createTimer(
      TimerFunction.TT_LIGHT,
      0,
      0,
      0,
      0,
      time >>> 0,
      party.position.z,
      undefined,
      0,
      deltaSteps,
    );
  }

  applyBrightnessSteps(steps: number, sign: number): void {
    const word1074 = this.ctx.tables.word1074;
    if (!word1074 || word1074.length === 0) return;
    let idx = steps | 0;
    if (idx < 0) idx = -idx;
    if (idx >= word1074.length) idx = word1074.length - 1;
    const delta = (word1074[idx] ?? 0) * (sign >= 0 ? 1 : -1);
    const party = this.ctx.party.state;
    party.brightness = sw((party.brightness ?? 0) + delta);
  }

  private processLightLevelTimer(timer: TimerEntry): void {
    const word1074 = this.ctx.tables.word1074;
    if (!word1074 || word1074.length < 2) return;

    let steps = sw(timer.timerWord6);
    if (steps === 0) return;

    const negative = steps < 0;
    if (negative) steps = -steps;
    if (steps >= word1074.length) steps = word1074.length - 1;

    const newSteps = steps - 1;
    let change = (word1074[steps] ?? 0) - (word1074[newSteps] ?? 0);
    if (negative) {
      change = -change;
    }

    const party = this.ctx.party.state;
    const current = party.brightness ?? 0;
    party.brightness = sw(current + change);

    if (newSteps !== 0) {
      const nextSteps = negative ? -newSteps : newSteps;
      this.timers.createTimer(
        TimerFunction.TT_LIGHT,
        0,
        0,
        0,
        0,
        (timer.time + 4) >>> 0,
        party.position.z,
        undefined,
        0,
        nextSteps,
      );
    }
  }

  private processInvisibleTimer(): void {
    const party = this.ctx.party.state;
    const value = party.invisible - 1;
    party.invisible = value < 0 ? 0 : value;
  }

  private processSeeThruWallsTimer(): void {
    const party = this.ctx.party.state;
    const value = party.seeThruWalls - 1;
    party.seeThruWalls = value < 0 ? 0 : value;
  }

  private processPartyShieldTimer(timer: TimerEntry): void {
    const party = this.ctx.party.state;
    const current = party.partyShield;
    const next = current - sw(timer.timerWord6);
    party.partyShield = next < 0 ? 0 : next;
  }

  /**
   * `TT_72` (`doc/CSBwin-src/CSBCode.cpp:6520`) — a champion's own shield expires and
   * the Ya potion's contribution comes back off.
   */
  private processChampionShieldTimer(timer: TimerEntry): void {
    const champ = this.ctx.party.state.champions[timer.uByte5 & 0xff];
    if (!champ) return;
    // CSBWin stores the result through `uw()`, so it wraps rather than clamping.
    champ.shieldStrength = (champ.shieldStrength - sw(timer.timerWord6)) & 0xffff;
  }

  /**
   * The `TT_72` half of the Ya potion (`doc/CSBwin-src/Character.cpp:4386-4391`):
   * `shieldDuration` ticks from now, carrying the amount to take back.
   */
  scheduleChampionShieldExpiry(chIdx: number, amount: number, duration: number, level: number): void {
    this.timers.createTimerWithUByte5(
      TimerFunction.TT_72,
      0,
      0,
      0,
      0,
      (this.now + duration) >>> 0,
      level,
      chIdx & 0xff,
      undefined,
      0,
      amount,
    );
  }

  /**
   * `TT_75` (`doc/CSBwin-src/CSBCode.cpp:6554`) — one tick of poison.
   *
   * The count comes down here and `PoisonCharacter` puts it back up if there are ticks
   * left, so `poisonCount` sits at 1 for as long as the champion is poisoned and
   * reaches 0 on the last tick. That is what the portrait's poison indicator reads.
   */
  private processPoisonTimer(timer: TimerEntry): void {
    const chIdx = timer.uByte5 & 0xff;
    const champ = this.ctx.party.state.champions[chIdx];
    if (!champ) return;
    champ.poisonCount = Math.max(0, champ.poisonCount - 1);
    this.ctx.systems.monsterAttack.poisonCharacter(chIdx, sw(timer.timerWord6));
  }

  /**
   * The `TT_75` half of `PoisonCharacter` (`doc/CSBwin-src/CSBCode.cpp:7228-7235`):
   * 36 ticks from now, on the party's level, carrying the champion and the number of
   * ticks still to come.
   */
  schedulePoison(chIdx: number, remaining: number, level: number): void {
    // `createTimerWithUByte5` queues the entry itself — adding it again would put two
    // copies in, and both would fire in the same pass.
    this.timers.createTimerWithUByte5(
      TimerFunction.TT_75,
      0,
      0,
      0,
      0,
      (this.now + 36) >>> 0,
      level,
      chIdx & 0xff,
      undefined,
      0,
      remaining,
    );
  }

  /**
   * The timer sweep of `CurePoison` (`doc/CSBwin-src/Character.cpp:3007-3031`) —
   * delete every outstanding `TT_75` for this champion. Zeroing `poisonCount` is the
   * caller's half. CSBWin walks a `TIMER_SEARCH`, so this walks `searchOrder`.
   */
  cancelPoisonTimers(chIdx: number): void {
    if (chIdx === -1) return;
    for (const timer of this.timers.searchOrder()) {
      if (timer.function !== TimerFunction.TT_75) continue;
      if ((timer.uByte5 & 0xff) !== (chIdx & 0xff)) continue;
      this.timers.deleteTimer(timer.index);
    }
  }

  private processSpellShieldTimer(timer: TimerEntry): void {
    const party = this.ctx.party.state;
    const current = party.spellShield;
    const next = current - sw(timer.timerWord6);
    party.spellShield = next < 0 ? 0 : next;
  }

  private processFireShieldTimer(timer: TimerEntry): void {
    const party = this.ctx.party.state;
    const current = party.fireShield;
    const next = current - sw(timer.timerWord6);
    party.fireShield = next < 0 ? 0 : next;
  }

  private processMagicFootprintsTimer(): void {
    const party = this.ctx.party.state;
    const value = party.magicFootprintsActive - 1;
    party.magicFootprintsActive = value < 0 ? 0 : value;
  }

  private processOpenRoom(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category === DBType.TEXT) {
        const rec = this.dungeon.getTextRecord(rn);
        if (!rec) continue;
        this.applyTextVisibility(rec, action);
        continue;
      }
      if (decoded.category === DBType.ACTUATOR) {
        const rec = this.dungeon.getActuatorRecord(rn);
        if (!rec) continue;
        const type = getActuatorType(rec);
        if (type === 47) {
          const loc = new Position(target.x, target.y, target.z);
          if (this.ctx.systems.dsa.processTimer5(rn, timer, loc)) break;
          continue;
        }
        if (type === 48) {
          this.operateCounterActuator(timer, rec, target);
        }
        if (type === 6) {
          this.spawnMonsterGenerator(timer, rec, rn, target);
        }
      }
    }
  }

  private processStoneRoom(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    const targetPos = timer.uByte8 & 3;

    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category === DBType.TEXT && decoded.position === targetPos) {
        const rec = this.dungeon.getTextRecord(rn);
        if (!rec) continue;
        this.applyTextVisibility(rec, action);
        continue;
      }
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      const type = getActuatorType(rec);
      if (type === 47) {
        const loc = new Position(target.x, target.y, target.z);
        if (this.ctx.systems.dsa.processTimer6(rn, timer, loc)) break;
        continue;
      }
      if (type === 127 && decoded.position === targetPos) {
        this.processPortraitTimer(timer, rec);
        continue;
      }
      if (type === 6 || type === 48) {
        this.operateCounterActuator(timer, rec, target);
        continue;
      }
      if (type === 5) {
        this.processBitwiseCompare(timer, rec, target, decoded.position);
        continue;
      }
      if ((type >= 7 && type <= 10) || type === 14 || type === 15) {
        if (decoded.position === targetPos) {
          this.triggerMissileLauncher(rec, timer);
          if (isActuatorOnceOnly(rec)) setActuatorType(rec, 0);
        }
      }
    }
  }

  private processFalseWall(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.getTimerAction(timer) === 3) return;
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      const type = getActuatorType(rec);
      if (type === 127 && decoded.position === (timer.uByte8 & 3)) {
        this.processPortraitTimer(timer, rec);
        continue;
      }
      if (type === 47) {
        const loc = new Position(target.x, target.y, target.z);
        if (this.ctx.systems.dsa.processTimer7(rn, timer, loc)) break;
        continue;
      }
    }

    let nextAction = action;
    if (action === ActuatorAction.TOGGLE) {
      const isSet = (map.cellFlags[target.x][target.y] & 0x04) !== 0;
      nextAction = isSet ? ActuatorAction.CLEAR : ActuatorAction.SET;
    }

    const cellFlag = map.cellFlags[target.x][target.y];
    if (nextAction === ActuatorAction.CLEAR) {
      if (this.isPartyAt(target) || this.isNonMaterialMonsterAt(target)) {
        timer.time = (timer.time + 1) >>> 0;
        this.timers.addTimer(timer);
        return;
      }
      this.setCellFlag(map, target.x, target.y, cellFlag & 0xfb);
    } else {
      this.setCellFlag(map, target.x, target.y, cellFlag | 0x04);
    }
  }

  private processTeleporter(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    this.activateDsa(timer);

    let nextAction = action;
    if (action === ActuatorAction.TOGGLE) {
      const isSet = (map.cellFlags[timer.uByte6][timer.uByte7] & 0x08) !== 0;
      nextAction = isSet ? ActuatorAction.CLEAR : ActuatorAction.SET;
    }

    const cellFlag = map.cellFlags[timer.uByte6][timer.uByte7];
    if (nextAction === ActuatorAction.SET) {
      this.setCellFlag(map, timer.uByte6, timer.uByte7, cellFlag | 0x08);
      this.wiggleEverything(timer.uByte6, timer.uByte7, timer.level);
    } else {
      this.setCellFlag(map, timer.uByte6, timer.uByte7, cellFlag & 0xf7);
    }
  }

  private processPit(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    this.activateDsa(timer);

    let nextAction = action;
    if (action === ActuatorAction.TOGGLE) {
      const isSet = (map.cellFlags[timer.uByte6][timer.uByte7] & 0x08) !== 0;
      nextAction = isSet ? ActuatorAction.CLEAR : ActuatorAction.SET;
    }

    const cellFlag = map.cellFlags[timer.uByte6][timer.uByte7];
    if (nextAction === ActuatorAction.SET) {
      const wasClosed = (cellFlag & 0x08) === 0;
      this.setCellFlag(map, timer.uByte6, timer.uByte7, cellFlag | 0x08);
      if (wasClosed) {
        this.wiggleEverything(timer.uByte6, timer.uByte7, timer.level);
      }
    } else {
      this.setCellFlag(map, timer.uByte6, timer.uByte7, cellFlag & 0xf7);
    }
  }

  private processDoor(timer: TimerEntry): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;
    const cellFlag = map.cellFlags[timer.uByte6][timer.uByte7];
    if (((cellFlag >> 5) & 7) !== RoomType.DOOR) return;
    const doorState = cellFlag & 0x7;
    if (doorState === 5) return;

    this.activateDsa(timer);

    let nextAction = action;
    if (action === ActuatorAction.TOGGLE) {
      nextAction = doorState === 0 ? ActuatorAction.CLEAR : ActuatorAction.SET;
    } else if (action === ActuatorAction.SET) {
      if (doorState === 0) return;
    } else if (action === ActuatorAction.CLEAR) {
      if (doorState === 4) return;
    }

    timer.function = TimerFunction.TT_DOOR_STEP;
    timer.uByte9 = nextAction & 0xff;
    this.timers.addTimer(timer);
  }

  private processDoorStep(timer: TimerEntry): void {
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;
    const x = timer.uByte6;
    const y = timer.uByte7;
    const cellFlag = map.cellFlags[x]?.[y];
    if (cellFlag === undefined) return;
    if (((cellFlag >> 5) & 7) !== RoomType.DOOR) return;
    let doorState = cellFlag & 0x7;
    if (doorState === 5) return;

    const action = timer.uByte9 & 0xff;
    timer.time = (timer.time + 1) >>> 0;

    // A door coming *down* onto something standing under it. `ProcessTT_1`
    // (doc/CSBwin-src/Timer.cpp:1289-1357) has two different rules here, for the
    // party and for a monster, and neither was ported — the door closed straight
    // through both.
    //
    // The nesting matters and is easy to get wrong: CSBWin's outer test is on the
    // action alone (`if (D5W == 1)`); the `D4W != 0` guard belongs to the *party*
    // arm only. The monster arm's gate is `D4W >= D1W`, which a fully open door
    // (`D4W == 0`) still passes against a monster of `VerticalSize() == 0` — and two
    // of the 27 monster types in the shipped data have exactly that.
    if (action === ActuatorAction.CLEAR) {
      const target = new Position(x, y, timer.level);

      // `w_10 = pDB0_4->mode()` — read before either arm. Bit 5 of `DB0.word2`,
      // up/down vs sideways (doc/CSBwin-src/CSB.h:837), which the loader reads as
      // `vertical`.
      const doorRn = this.dungeon.findFirstDoor(target);
      const doorRecord =
        doorRn === OBJECT_ID_EOF ? null : this.dungeon.getDoorRecordByIndex(decodeObjectID(doorRn).index);
      const upDown = doorRecord?.vertical ?? false;

      // The party arm. The door springs fully open again, hurts everyone, and only
      // makes a noise if somebody was actually hurt:
      //
      //   *cfA2 &= 0xf8;        // fully open again
      //   w_10 |= 8;            // dead store; nothing reads w_10 after this
      //   D0W = DamageAllCharacters(5, 4, 2);
      //   if (D0W != 0) QueueSound(soundDOOROPENING, x, y, 1);
      //
      // Gated on `d.NumCharacter > 0` — an empty party is not squashed.
      if (this.isPartyAt(target) && doorState !== 0) {
        if (this.ctx.party.state.champions.length > 0) {
          setDoorState(map, x, y, 0);
          const hurt = this.ctx.systems.monsterAttack.damageAllCharacters(5, 4, 2);
          if (hurt !== 0) this.ctx.sounds.queueSound(SOUND_DOOR_OPENING, x, y, 1);
        }
        this.timers.addTimer(timer);
        return;
      }

      // The monster arm. The door hurts the group and *rebounds* one step instead of
      // closing through it:
      //
      //   obj_6 = FindFirstMonster(x, y);          // first monster in the chain only
      //   if (!obj_6.NonMaterial())                // a ghost is not squashed
      //     D1W = w_10 != 0 ? obj_6.VerticalSize() : 1;
      //     if (D4W >= D1W) { ...crush... }        // the gap must reach the monster
      //
      // A sideways door catches anything (`D1W = 1`); an up-down one only catches a
      // monster at least as tall as the gap that is left.
      const monsterRn = this.dungeon.findFirstMonster(target);
      if (monsterRn !== OBJECT_ID_EOF) {
        const creature = this.dungeon.getCreatureRecord(monsterRn);
        const desc = creature ? this.ctx.tables.monsterDesc[creature.creatureType] : undefined;
        if (creature && desc && !monsterNonMaterial(desc)) {
          const needed = upDown ? monsterVerticalSize(desc) : 1;
          if (doorState >= needed) {
            const result = this.ctx.systems.monsterDamage.damageMonsterGroup(creature, timer.level, x, y, 5, true, false);
            if (result !== MonsterDamageResult.ALL_MONSTERS_DIED) {
              this.ctx.systems.monsterAI.processTimers29to41({
                mapX: x,
                mapY: y,
                level: timer.level,
                timerFunction: TimerFunction.TT_M3,
                timeUntilAlternateUpdate: 0,
              });
            }
            // The rebound: one step back up, floored at 0, then re-queue.
            setDoorState(map, x, y, doorState === 0 ? 0 : doorState - 1);
            this.ctx.sounds.queueSound(SOUND_DOOR_STRUGGLE, x, y, 1);
            this.timers.addTimer(timer);
            return;
          }
        }
      }
    }

    if ((action === ActuatorAction.SET && doorState === 0) || (action === ActuatorAction.CLEAR && doorState === 4)) {
      return;
    }

    const delta = action === ActuatorAction.SET ? -1 : 1;
    doorState = Math.max(0, Math.min(4, doorState + delta));
    setDoorState(map, x, y, doorState);
    this.ctx.sounds.queueSound(SOUND_DOOR_STEP, x, y, 1, timer.level);

    if ((action === ActuatorAction.SET && doorState !== 0) || (action === ActuatorAction.CLEAR && doorState !== 4)) {
      this.timers.addTimer(timer);
    }
  }

  private processParameterMessage(timer: TimerEntry): void {
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;
    const x = timer.uByte6;
    const y = timer.uByte7;
    const cellFlag = map.cellFlags[x]?.[y];
    if (cellFlag === undefined) return;
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType !== RoomType.STONE) {
      this.processOpenRoom(timer);
    } else {
      this.processStoneRoom(timer);
    }
  }

  private operateCounterActuator(timer: TimerEntry, actuator: ActuatorRecord, target: Position): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    let counter = getActuatorValue(actuator);
    if (counter === 0) return;

    if (action === ActuatorAction.SET) {
      if (counter < 511) counter += 1;
    } else {
      counter -= 1;
    }

    setActuatorValue(actuator, counter);

    if (getActuatorAction(actuator) === ActuatorAction.CONSTPRESSURE) {
      const pressed = counter === 0;
      const closed = pressed !== isActuatorNormallyClosed(actuator);
      this.ctx.systems.actuators.queueSwitchActionForActuator(
        actuator,
        closed ? ActuatorAction.SET : ActuatorAction.CLEAR,
        target.z,
        getActuatorTargetPos(actuator),
      );
    } else if (counter === 0) {
      this.ctx.systems.actuators.queueSwitchActionForActuator(
        actuator,
        getActuatorAction(actuator),
        target.z,
        getActuatorTargetPos(actuator),
      );
    }
  }

  private processBitwiseCompare(
    timer: TimerEntry,
    actuator: ActuatorRecord,
    target: Position,
    actuatorPos: number,
  ): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;

    const oldValue = getActuatorValue(actuator);
    const bitmask = 1 << (timer.uByte8 & 0xf);
    let newValue = oldValue;
    if (action === ActuatorAction.TOGGLE) {
      newValue ^= bitmask;
    } else if (action === ActuatorAction.CLEAR) {
      newValue &= ~bitmask;
    } else {
      newValue |= bitmask;
    }

    const oldState = oldValue & 0xf;
    const oldTarget = (oldValue >> 4) & 0xf;
    const newState = newValue & 0xf;
    const newTarget = (newValue >> 4) & 0xf;
    const oldMatch = oldState === oldTarget;
    const newMatch = newState === newTarget;

    const edge = getActuatorAndOrEdge(actuator);
    switch (edge) {
      case 1:
        if (oldState === newState) return;
        break;
      case 2:
        if (oldMatch === newMatch) return;
        break;
      case 3:
        if (oldState === newState) return;
        if (oldMatch !== newMatch) return;
        break;
      case 4:
        if (action !== ActuatorAction.SET) return;
        break;
      case 5:
        if (action !== ActuatorAction.CLEAR) return;
        break;
      case 6:
        if (oldState === newState) return;
        if (oldState & bitmask) return;
        break;
      case 7:
        if (oldState === newState) return;
        if (newState & bitmask) return;
        break;
      default:
        break;
    }

    setActuatorValue(actuator, newValue);

    const pressed = newState === newTarget;
    const closed = pressed !== isActuatorNormallyClosed(actuator);
    if (getActuatorAction(actuator) === ActuatorAction.CONSTPRESSURE) {
      this.ctx.systems.actuators.queueSwitchActionForActuator(
        actuator,
        closed ? ActuatorAction.SET : ActuatorAction.CLEAR,
        target.z,
        actuatorPos & 3,
      );
    } else if (closed) {
      this.ctx.systems.actuators.queueSwitchActionForActuator(
        actuator,
        getActuatorAction(actuator),
        target.z,
        actuatorPos & 3,
      );
    }
  }

  private getTimerAction(timer: TimerEntry): ActuatorAction | 3 {
    if (timer.uByte9 > 2) return 3;
    return timer.uByte9 as ActuatorAction;
  }

  private applyTextVisibility(record: TextRecord, action: ActuatorAction | 3): void {
    if (action === 3) return;
    if (action === ActuatorAction.SET) record.visible = true;
    else if (action === ActuatorAction.CLEAR) record.visible = false;
    else record.visible = !record.visible;
  }

  /**
   * `ThrowMissile` (doc/CSBwin-src/Timer.cpp:2016). Its one CSBWin caller is the DSA's
   * `STKOP_Throw` (`DSA.cpp:4558`), which `DsaSystem` does not implement yet, so nothing
   * calls this — see DEBT.md G1 before wiring it.
   */
  throwMissile(
    missileType: number,
    launchLocation: LocationRel,
    direction: number,
    objectLocation: LocationRel | null,
    range: number,
    damage: number,
    decayRate: number,
    startTime: number,
  ): boolean {
    if (!this.dungeon.isValidLocation(launchLocation)) return false;

    const missileTypeWord = missileType & 0xffff;
    let projectileObject = OBJECT_ID_EOF;

    if (missileTypeWord === 0) {
      if (!objectLocation) return false;
      if (!this.dungeon.isValidLocation(objectLocation)) return false;
      const objectPosition = new Position(objectLocation.x, objectLocation.y, objectLocation.l);
      for (
        let rn = this.dungeon.findFirstObject(objectPosition);
        rn !== OBJECT_ID_EOF;
        rn = this.dungeon.getDBRecordLink(rn)
      ) {
        const decoded = decodeObjectID(rn);
        if (decoded.category <= DBType.CREATURE || decoded.category > DBType.MISC) continue;
        if ((decoded.position & 0x3) !== (objectLocation.p & 0x3)) continue;
        this.dungeon.removeObjectFromCell(objectPosition, rn);
        projectileObject = rn;
        break;
      }
    } else {
      // `>= 0xff80` is a spell `RNVAL` already, which the word carries as is.
      projectileObject = missileTypeWord >= 0xff80 ? missileTypeWord as ObjectID : spellObjectId(missileTypeWord);
    }

    if (projectileObject === OBJECT_ID_EOF) return false;

    return this.ctx.systems.magic.launchMissile(
      projectileObject,
      launchLocation.x,
      launchLocation.y,
      launchLocation.l,
      launchLocation.p & 0x3,
      direction & 0x3,
      range,
      damage,
      decayRate,
      startTime,
      false,
    );
  }

  scheduleViAltar(bones: ObjectID, location: Position, posInCell: number, startTime: number): void {
    this.queueViAltarTimer(bones, location, posInCell, 2, startTime);
  }

  private processViAltar(timer: TimerEntry): void {
    const state = this.unpackViAltarState(timer.uByte5);
    const pos = this.unpackViAltarPos(timer.uByte5);
    const location = new Position(timer.uByte6, timer.uByte7, timer.level);
    const bones = timer.object ?? OBJECT_ID_EOF;
    if (bones === OBJECT_ID_EOF) return;

    // `CreateCloud(RN(RNffe4), 0, bonesX, bonesY, bonesX, bonesY, D5W, NULL)`
    // (`doc/CSBwin-src/Timer.cpp:2730`) — the resurrection's only visible effect, and
    // the reason the altar takes five ticks to answer: `createCloud` gives `RNffe4`
    // a 5-tick first turn, and this state waits the same five before moving on.
    if (state === 2) {
      this.ctx.systems.missileEncounter.createCloud(RN_FFE4, 0, location.x, location.y, location, pos);
      this.queueViAltarTimer(bones, location, pos, 1, (timer.time + 5) >>> 0);
      return;
    }

    if (state === 1) {
      const target = this.findViAltarBones(bones, location, pos);
      if (target === null) return;
      let chIdx: number | null = null;
      let consumeBonesRecord = false;
      const fingerprint = this.dungeon.copyChampionBonesRecord(target);
      if (fingerprint !== null) {
        const found = findChampionByFingerprint(this.ctx.party.state, fingerprint);
        chIdx = found === -1 ? null : found;
        // ⏳ CSBWin's other arm here is the wings: a champion whose fingerprint
        // matches nobody in the party is fetched with `CHARDESC::GetFromWings`,
        // healed to `MaxHP/2`, saved back, and the bones deleted with the timer
        // stopping there (`doc/CSBwin-src/Timer.cpp:2769-2782`). This port has no
        // wings — no store of champions who have left the party — so there is
        // nothing to look in, and the bones are left on the floor rather than
        // silently destroyed.
        if (chIdx === null) return;
        if (!this.isChampionDead(this.ctx.party.state.champions[chIdx])) return;
        consumeBonesRecord = true;
      } else {
        // `chIndex = DB10A2->value()` (`doc/CSBwin-src/Timer.cpp:2789`). Bones with no
        // expool record were placed by the dungeon rather than by a death, and their
        // `value` — `DB10`'s bits 14-15, this port's `specialState`
        // (`doc/CSBwin-src/CSB.h:1272`) — *is* the champion index. This used to guess
        // instead, resurrecting the one dead champion if there was exactly one and
        // refusing outright if there were two.
        const record = this.dungeon.getMiscRecord(target);
        if (!record) return;
        chIdx = (record.specialState ?? 0) & 0x3;
        const champ = this.ctx.party.state.champions[chIdx];
        // `if (chIndex < d.NumCharacter)`, then `if (HP() != 0) break`.
        if (!champ) return;
        if (!this.isChampionDead(champ)) return;
      }
      if (!this.dungeon.removeObjectFromCell(location, target)) return;
      this.dungeon.deleteDBEntry(target);
      if (consumeBonesRecord) this.dungeon.getChampionBonesRecord(target);
      this.queueViAltarTimer(bones, location, chIdx, 0, (timer.time + 1) >>> 0);
      return;
    }

    if (state === 0) {
      const chIdx = pos & 0x3;
      this.ctx.systems.character.bringCharacterToLife(chIdx);
    }
  }

  private queueViAltarTimer(
    bones: ObjectID,
    location: Position,
    posInCell: number,
    state: number,
    time: number,
  ): void {
    const entry = this.timers.createTimer(
      TimerFunction.TT_VI_ALTAR,
      location.x,
      location.y,
      0,
      0,
      time >>> 0,
      location.z,
      bones,
    );
    entry.uByte5 = this.packViAltarByte(posInCell, state);
    entry.uByte8 = 0;
    entry.uByte9 = 0;
  }

  private packViAltarByte(pos: number, state: number): number {
    return ((pos & 0x3) << 2) | (state & 0x3);
  }

  private unpackViAltarState(value: number): number {
    return value & 0x3;
  }

  private unpackViAltarPos(value: number): number {
    return (value >> 2) & 0x3;
  }

  private findViAltarBones(bones: ObjectID, location: Position, posInCell: number): ObjectID | null {
    for (let rn = this.dungeon.findFirstObject(location); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (!rnEquals(rn, bones)) continue;
      const decoded = decodeObjectID(rn);
      if ((decoded.position & 0x3) !== (posInCell & 0x3)) continue;
      return rn;
    }
    return null;
  }

  private isChampionDead(champ: PartyState['champions'][number]): boolean {
    const health = champ.attributes?.health ?? 0;
    if (health <= 0) return true;
    return champ.alive === false;
  }

  private setCellFlag(map: MapData, x: number, y: number, cellFlag: number): void {
    map.cellFlags[x][y] = cellFlag;
  }

  private isPartyAt(position: Position): boolean {
    const party = this.ctx.party.state;
    const pos = party.position;
    return pos.x === position.x && pos.y === position.y && pos.z === position.z;
  }

  /**
   * Mirrors CSBWin `FindFirstMonster()` + `RN::NonMaterial()`
   * (doc/CSBwin-src/Code11f52.cpp:533, doc/CSBwin-src/data.cpp:553).
   * Only the FIRST monster in the cell chain is consulted, exactly as the
   * false-wall timer does (doc/CSBwin-src/Timer.cpp:1466-1472).
   */
  private isNonMaterialMonsterAt(position: Position): boolean {
    const table = this.ctx.tables.monsterDesc;
    if (!table) return false;
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category !== DBType.CREATURE) continue;
      const rec = this.dungeon.getCreatureRecord(rn);
      if (!rec) return false;
      const desc = table[rec.creatureType];
      if (!desc) return false;
      return monsterNonMaterial(desc);
    }
    return false;
  }

  private processPortraitTimer(timer: TimerEntry, actuator: ActuatorRecord): void {
    const action = this.getTimerAction(timer);
    if (action === 3) return;
    let responses = 0;
    if (action === ActuatorAction.SET) responses = getActuatorSetResponses(actuator);
    else if (action === ActuatorAction.CLEAR) responses = getActuatorClearResponses(actuator);
    else responses = getActuatorToggleResponses(actuator);

    let state = getActuatorState(actuator);
    state = this.applyPortraitResponse(state, 1, responses, 0);
    state = this.applyPortraitResponse(state, 2, responses, 2);
    state = this.applyPortraitResponse(state, 4, responses, 4);
    setActuatorState(actuator, state);
  }

  private applyPortraitResponse(state: number, bitmask: number, responses: number, fieldStart: number): number {
    const response = (responses >> fieldStart) & 3;
    switch (response) {
      case 1:
        return state & ~bitmask;
      case 2:
        return state | bitmask;
      case 3:
        return state ^ bitmask;
      default:
        return state;
    }
  }

  private spawnMonsterGenerator(timer: TimerEntry, actuator: ActuatorRecord, rn: ObjectID, target: Position): void {
    let countMinus1 = getActuatorDelay(actuator);
    if ((countMinus1 & 0x8) !== 0) {
      // `STRandom(n)` yields 0..n-1 (doc/CSBwin-src/Timer.cpp:1776). This used to be
      // an inclusive 0..n, one monster too many at the top of the range.
      countMinus1 = this.random.below(countMinus1 & 0x7);
    } else {
      countMinus1 = (countMinus1 - 1) & 0xffff;
    }

    const hitPointMultiplier = getActuatorHitPointMultiplier(actuator) || 0;
    const facing = this.random.zeroTo3(); // doc/CSBwin-src/Timer.cpp:1791
    const drawAsSize4 = getActuatorDrawAsSize4(actuator);
    const normallyClosed = isActuatorNormallyClosed(actuator);
    const audible = isActuatorAudible(actuator);

    this.ctx.systems.monsters.createMonster({
      value: getActuatorValue(actuator),
      hitPointMultiplier,
      numMonM1: countMinus1,
      facing,
      mapX: target.x,
      mapY: target.y,
      level: this.ctx.party.state.position.z,
      // CSBWin passes `normallyClosed()` as `invisible` and `drawAsSize4()` as itself
      // (doc/CSBwin-src/Timer.cpp:1785-1793).
      invisible: normallyClosed,
      drawAsSize4,
    });
    // `CreateMonster` makes its own sound only off the party's level; an audible
    // generator always queues one (`doc/CSBwin-src/Timer.cpp:1797-1800`).
    if (audible) this.ctx.sounds.queueSound(SOUND_TELEPORT, target.x, target.y, 1);

    if (isActuatorOnceOnly(actuator)) {
      setActuatorType(actuator, 0);
    } else {
      let disableTime = getActuatorDisableTime(actuator);
      if (disableTime !== 0) {
        setActuatorType(actuator, 0);
        if (disableTime >= 128) {
          disableTime = 64 * (disableTime - 126);
        }
        const actionTime = (timer.time + disableTime) >>> 0;
        this.timers.createTimer(
          TimerFunction.TT_REACTIVATE_GENERATOR,
          target.x,
          target.y,
          0,
          0,
          actionTime,
          target.z,
          rn,
        );
      }
    }
  }

  private processReactivateGenerator(timer: TimerEntry): void {
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    let firstTypeZero: ObjectID | null = null;
    let match: ObjectID | null = null;

    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      if (getActuatorType(rec) !== 0) continue;
      if (firstTypeZero === null) firstTypeZero = rn;
      if (timer.object !== undefined && rnEquals(rn, timer.object)) {
        match = rn;
        break;
      }
    }

    const targetRn = match ?? firstTypeZero;
    if (targetRn === null) return;
    const rec = this.dungeon.getActuatorRecord(targetRn);
    if (!rec) return;
    setActuatorType(rec, getActuatorType(rec) | 6);
  }

  private triggerMissileLauncher(actuator: ActuatorRecord, timer: TimerEntry): void {
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;

    const actuatorType = getActuatorType(actuator);
    const missileType = getActuatorValue(actuator);
    const energyRemaining = getActuatorEnergyRemaining(actuator) & 0xff;

    const timerPos = timer.uByte8 & 0x3;
    let initialPosition = (timerPos + 2) & 0x3;
    let singleMissile = actuatorType === 7 || actuatorType === 8 || actuatorType === 14;

    const source = new Position(timer.uByte6, timer.uByte7, timer.level);
    const altPos = (timerPos + 1) & 0x3;
    const takeObject = (): ObjectID => {
      for (let rn = this.dungeon.findFirstObject(source); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
        const decoded = decodeObjectID(rn);
        if (decoded.category <= DBType.ACTUATOR) continue;
        const objPos = decoded.position & 0x3;
        if (objPos !== timerPos && objPos !== altPos) continue;
        this.dungeon.removeObjectFromCell(source, rn);
        return rn;
      }
      return OBJECT_ID_EOF;
    };

    let firstObject = OBJECT_ID_EOF;
    let secondObject = OBJECT_ID_EOF;

    if (actuatorType === 8 || actuatorType === 10) {
      firstObject = spellObjectId(missileType);
      secondObject = firstObject;
    } else if (actuatorType === 14 || actuatorType === 15) {
      firstObject = takeObject();
      if (firstObject === OBJECT_ID_EOF) return;
      if (!singleMissile) {
        secondObject = takeObject();
        if (secondObject === OBJECT_ID_EOF) singleMissile = true;
      }
    } else {
      const constructed = constructPredefinedMissile(this.dungeon, missileType);
      if (constructed === null) return;
      firstObject = constructed;
      if (!singleMissile) {
        const constructedSecond = constructPredefinedMissile(this.dungeon, missileType);
        if (constructedSecond === null) {
          singleMissile = true;
        } else {
          secondObject = constructedSecond;
        }
      }
    }

    if (singleMissile) {
      initialPosition = (initialPosition + this.random.bool()) & 0x3; // doc/CSBwin-src/Timer.cpp:1980
    }

    const dir = timerPos & 0x3;
    const launchX = timer.uByte6 + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
    const launchY = timer.uByte7 + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
    if (launchX < 0 || launchY < 0 || launchX >= map.descriptor.width || launchY >= map.descriptor.height) return;

    const launchLevel = timer.level;
    const launched = this.ctx.systems.magic.launchMissile(
      firstObject,
      launchX,
      launchY,
      launchLevel,
      initialPosition,
      dir,
      energyRemaining,
      100,
      0,
      timer.time,
      true,
    );
    if (!launched) return;

    if (!singleMissile && secondObject !== OBJECT_ID_EOF) {
      this.ctx.systems.magic.launchMissile(
        secondObject,
        launchX,
        launchY,
        launchLevel,
        (initialPosition + 1) & 0x3,
        dir,
        energyRemaining,
        100,
        0,
        timer.time,
        true,
      );
    }

  }

  private processMissileTimer(timer: TimerEntry): void {
    const missileRn = timer.object ?? OBJECT_ID_EOF;
    if (missileRn === OBJECT_ID_EOF) return;
    const missile = this.dungeon.getMissileRecord(missileRn);
    if (!missile) return;

    if (this.timers.missileFilterObject !== OBJECT_ID_NULL) {
      throw new Error('MissileFilter already active');
    }

    this.timers.missileFilterObject = missileRn;
    this.timers.missileFilterTimer = timer;
    // While the timer runs, the record names its copy, not the slot `shiftNext` freed
    // (`doc/CSBwin-src/Timer.cpp:224-226`): a `CheckMoveFromMissile` from inside it meets
    // this missile, and a hit on it deletes no queued timer.
    missile.timerIndex = MISSILE_FILTER_TIMER_INDEX;

    const decoded = decodeObjectID(missileRn);
    const word8 = timer.timerWord8 & 0xffff;
    const { x: origMapX, y: origMapY, dir: initialDir, deltaEnergy } = decodeMissileTimerWord8(word8);
    let curMapX = origMapX;
    let curMapY = origMapY;

    if (timer.function === TimerFunction.TT_MISSILE0) {
      timer.function = TimerFunction.TT_MISSILE;
    } else {
      const curPos = decoded.position & 0x3;
      const current = new Position(curMapX, curMapY, timer.level);
      if (this.isPartyAt(current)) {
        if (this.ctx.systems.missileEncounter.processMissileEncounter(-2, curMapX, curMapY, curMapX, curMapY, timer.level, curPos, missileRn)) {
          this.timers.missileFilterObject = OBJECT_ID_NULL;
          return;
        }
      }

      const monster = this.dungeon.findFirstMonster(current);
      if (monster !== OBJECT_ID_EOF) {
        if (this.ctx.systems.missileEncounter.processMissileEncounter(-1, curMapX, curMapY, curMapX, curMapY, timer.level, curPos, missileRn)) {
          this.timers.missileFilterObject = OBJECT_ID_NULL;
          return;
        }
      }

      if ((missile.rangeRemaining & 0xff) <= deltaEnergy) {
        const filterProjectile = (missile.projectileObject & 0xffff) as ObjectID;
        this.ctx.systems.missileEncounter.missileEncounterFilter(5, current, curPos, missileRn, filterProjectile, -1);
        this.processObjectFromMissile(missileRn, null, current);
        this.timers.missileFilterObject = OBJECT_ID_NULL;
        return;
      }

      missile.rangeRemaining = (missile.rangeRemaining - deltaEnergy) & 0xff;
      if ((missile.damageRemaining & 0xff) <= deltaEnergy) {
        missile.damageRemaining = 0;
      } else {
        missile.damageRemaining = (missile.damageRemaining - deltaEnergy) & 0xff;
      }
    }

    let missileDir = initialDir & 0x3;
    let curPos = decoded.position & 0x3;
    let leavingThisCell = false;
    let nextRoomType: number = RoomType.OPEN;
    let outOfBounds = false;

    do {
      missileDir = (timer.timerWord8 >> 10) & 0x3;
      curPos = decodeObjectID(this.timers.missileFilterObject).position & 0x3;
      leavingThisCell = (missileDir === curPos) || (((missileDir + 1) & 3) === curPos);
      curMapX = origMapX;
      curMapY = origMapY;
      outOfBounds = false;

      if (leavingThisCell) {
        curMapX += missileDir === 1 ? 1 : missileDir === 3 ? -1 : 0;
        curMapY += missileDir === 2 ? 1 : missileDir === 0 ? -1 : 0;

        const map = this.dungeon.getMap(timer.level);
        if (!map || curMapX < 0 || curMapY < 0 || curMapX >= map.descriptor.width || curMapY >= map.descriptor.height) {
          nextRoomType = 8;
          outOfBounds = true;
        } else {
          const nextCellFlags = map.cellFlags[curMapX][curMapY];
          nextRoomType = (nextCellFlags >> 5) & 0x7;
          const origCellFlags = map.cellFlags[origMapX][origMapY];
          const nextIsStoneWall = nextRoomType === RoomType.STONE;
          const nextIsFalseWall = nextRoomType === RoomType.FALSEWALL;
          const falseWallIsSolid = (nextCellFlags & 0x5) === 0;
          const nextIsStairs = nextRoomType === RoomType.STAIRS;
          const origIsStairs = ((origCellFlags >> 5) & 0x7) === RoomType.STAIRS;
          if (nextIsStoneWall || (nextIsFalseWall && falseWallIsSolid) || (nextIsStairs && origIsStairs)) {
            if (this.ctx.systems.missileEncounter.processMissileEncounter(nextRoomType, origMapX, origMapY, origMapX, origMapY, timer.level, curPos, missileRn)) {
              this.timers.missileFilterObject = OBJECT_ID_NULL;
              return;
            }
          }
        }
      }
    } while (((timer.timerWord8 >> 10) & 0x3) !== missileDir);

    if ((missileDir & 1) === (curPos & 1)) {
      curPos = (curPos + 3) & 0x3;
    } else {
      curPos = (curPos + 1) & 0x3;
    }

    if (leavingThisCell) {
      if (outOfBounds) {
        const dropPos = new Position(origMapX, origMapY, timer.level);
        this.processObjectFromMissile(missileRn, null, dropPos);
        this.timers.missileFilterObject = OBJECT_ID_NULL;
        return;
      }

      // `MoveObject(missileFilterObject, origMapX, origMapY, curMapX, curMapY, NULL, NULL)`
      // (`doc/CSBwin-src/Timer.cpp:382-397`), which reads the direction off the copy, and
      // `d.NewX`, `d.NewY`, `d.NewDir`, `d.NewPos` and `d.NewLevel` back from it. A missile
      // it places always comes back placed: it has no unchanged-room return.
      this.timers.missileFilterObject = encodeObjectID(curPos, DBType.MISSILE, decoded.index);
      const moved = this.ctx.systems.worldMove.moveObject(
        this.timers.missileFilterObject, origMapX, origMapY, curMapX, curMapY, timer.level,
      );
      if (!moved.placed || !moved.position || moved.newDir === undefined) {
        throw new Error('MissileTimer: MoveObject did not place the missile');
      }
      const newPos = moved.position;
      const newDir = moved.newDir & 0x3;
      const newRn = moved.placed;

      timer.object = newRn;
      this.timers.missileFilterObject = newRn;
      timer.uByte6 = newPos.x & 0xff;
      timer.uByte7 = newPos.y & 0xff;
      timer.level = newPos.z & 0xff;
      timer.timerWord8 = encodeMissileTimerWord8(newPos.x, newPos.y, newDir, deltaEnergy);
    } else {
      const map = this.dungeon.getMap(timer.level);
      if (map) {
        const cellFlag = map.cellFlags[curMapX][curMapY];
        if (((cellFlag >> 5) & 0x7) === RoomType.DOOR) {
          if (this.ctx.systems.missileEncounter.processMissileEncounter(RoomType.DOOR, curMapX, curMapY, curMapX, curMapY, timer.level, curPos, missileRn)) {
            this.timers.missileFilterObject = OBJECT_ID_NULL;
            return;
          }
        }
      }

      const oldPos = new Position(curMapX, curMapY, timer.level);
      const newRn = encodeObjectID(curPos & 0x3, DBType.MISSILE, decoded.index);
      this.dungeon.removeObjectFromCell(oldPos, missileRn);
      if (!this.dungeon.addObjectToCell(oldPos, newRn)) {
        this.timers.missileFilterObject = OBJECT_ID_NULL;
        return;
      }
      timer.object = newRn;
      this.timers.missileFilterObject = newRn;
    }

    timer.time = (timer.time + 1) >>> 0;
    // CSBWin stores the *return* of SetTimer here
    // (`pDBMissile->timerIndex(gameTimers.SetTimer(&missileFilterTimer))`,
    // doc/CSBwin-src/Timer.cpp:429), and so must we: the queue keeps a copy.
    const queued = this.timers.addTimer(timer);
    missile.timerIndex = queued.index & 0xffff;
    this.timers.missileFilterObject = OBJECT_ID_NULL;
  }

  /**
   * `ProcessObjectFromMissile`'s no-monster arm drops the object at `missile.pos()`
   * (`doc/CSBwin-src/Timer.cpp:156-157`) — the *missile RN's own* stored corner, not
   * the `objectPos`/`curPos` a caller threads through for filtering and cloud
   * placement. The two diverge exactly once: `MissileTimer`'s door branch computes an
   * advanced `curPos` (`Timer.cpp:370-377`) to pass as `ProcessMissileEncounter`'s
   * `objectPos` — CSBWin uses that advanced value for a shattered-potion's cloud, but
   * the missile's own `.pos()` is never written to it (that write is guarded by
   * `leavingThisCell`, which is false on this path) — so a weapon or misc item stopped
   * by a closed door falls at the corner it was already resting at, one hop short of
   * where `objectPos` points. Deriving the drop corner from `missileRn` here, instead
   * of trusting the caller's `posInCell`, reproduces that split without threading a
   * second parameter through every encounter path.
   */
  processObjectFromMissile(missileRn: ObjectID, dest: MissileDropTarget, position: Position): void {
    const missile = this.dungeon.getMissileRecord(missileRn);
    if (!missile) return;
    const projectile = (missile.projectileObject & 0xffff) as ObjectID;
    const projectileIsMagic = isMagicSpellRn(projectile);
    const projectileDbType = projectileIsMagic ? DBType.CLOUD : decodeObjectID(projectile).category;

    this.dungeon.removeObjectFromCell(position, missileRn);

    if (!projectileIsMagic && projectileDbType !== DBType.CLOUD) {
      if (dest && dest.monster !== OBJECT_ID_EOF) {
        this.addObjectToMonsterPossession(dest.monster, projectile);
      } else {
        this.dropMissileObject(projectile, position, decodeObjectID(missileRn).position & 0x3);
      }
    }

    this.dungeon.deleteDBEntry(missileRn);
  }

  /**
   * `TT_24` (`doc/CSBwin-src/CSBCode.cpp:6494`) — the object's time is up: out of the
   * cell and its record freed. Nothing happens once the game is won, which leaves the
   * Fluxcages around Lord Chaos standing through the endgame.
   */
  private processExpireObject(timer: TimerEntry): void {
    if (this.ctx.state.gameWon) return;
    // `timeEnt.timerObj8()`: the object, which this port keeps on `object`, as every
    // creator of a `TT_24` / `TT_25` puts it there (`CreateFluxcage`, Code11f52.cpp:1535).
    const rn = timer.object ?? OBJECT_ID_EOF;
    if (rn === OBJECT_ID_EOF || rn === OBJECT_ID_NULL) return;
    const position = new Position(timer.uByte6 & 0xff, timer.uByte7 & 0xff, timer.level & 0xff);
    this.dungeon.removeObjectFromCell(position, rn);
    this.dungeon.deleteDBEntry(rn as ObjectID);
  }

  /**
   * `ProcessTT_25` (`doc/CSBwin-src/Timer.cpp:436`) — one tick of a cloud's life.
   *
   * Every branch either **reschedules** the timer one tick later, or falls out of the
   * switch, and falling out is how a cloud dies: the record leaves the cell and the DB
   * entry is freed. So each cloud type's own rule is also its lifespan.
   *
   *  - **Monster death** (`CT_DEATH`, 40) shrinks by 40 a tick while its value is over
   *    55, then stops. A death cloud starts at 255, so it lives 5 ticks and visibly
   *    shrinks the whole way — the renderer scales the puff by `value`.
   *  - **Poison** (`CT_POISON`, 7) hurts whoever is standing in it, then shrinks by 3
   *    until it is under 6. It is the long-lived one.
   *  - **Fireball** (0) and **lightning** (2) do not persist at all: they get one tick
   *    to burst a door open and are gone.
   *  - **Dispell** (3) hurts non-material monsters only, and never lingers.
   *  - The Vi altar's cloud (100) walks its own type upward each tick, which is what
   *    animates it, and reschedules forever until its type leaves the range.
   */
  private processTT_25(timer: TimerEntry): void {
    const x = timer.uByte6;
    const y = timer.uByte7;
    const cloudRn = timer.object;
    if (cloudRn === undefined) return;
    const cloud = this.dungeon.getCloudRecord(cloudRn);
    const position = new Position(x, y, timer.level);
    if (!cloud) return;

    const roomType = (this.dungeon.getCellFlag(position) >> 5) & 7;
    const party = this.ctx.party.state;
    const partyHere =
      timer.level === party.position.z && x === party.position.x && y === party.position.y;

    const monsterRn = this.dungeon.findFirstMonster(position);
    const monster = monsterRn !== OBJECT_ID_EOF ? this.dungeon.getCreatureRecord(monsterRn) : null;
    const monsterType = monster ? monster.creatureType : -1;
    const desc = monster ? this.ctx.tables.monsterDesc[monsterType] : null;

    const kind = (0xff80 + (cloud.cloudType & 0x7f)) & 0xffff;

    // How hard the cloud bites this tick, from what is left of it.
    let damage: number;
    if (kind === RN_POISON_CLOUD) {
      damage = Math.max(1, Math.min(Math.trunc(cloud.value / 32), 4) + this.random.bool());
    } else {
      damage = Math.trunc(cloud.value / 2) + 1;
      damage = damage + this.random.below(damage) + 1;
    }

    let reschedule = false;

    switch (kind) {
      case RN_LIGHTNING:
      case RN_FIREBALL: {
        // CSBWin marks its own "Note fall-through" here: lightning halves the damage
        // and drops through into the fireball case, unless halving left nothing.
        if (kind === RN_LIGHTNING) {
          damage = Math.trunc(damage / 2);
          if (damage === 0) break;
        }
        if (roomType === RoomType.DOOR) this.ctx.systems.missileEncounter.hitDoor(position, damage, true);
        break;
      }

      case RN_DISPELL_MISSILE:
        // Dispell only touches what is not really there.
        if (monster && desc && monsterNonMaterial(desc)) {
          this.ctx.systems.monsterDamage.damageMonsterGroup(monster, timer.level, x, y, damage, true, false);
        }
        break;

      case RN_FFE4:
        cloud.cloudType = (cloud.cloudType + 1) & 0x7f;
        this.ctx.sounds.queueSound(5, x, y, 1);
        reschedule = true;
        break;

      case RN_MONSTER_DEATH:
        if (cloud.value > 55) {
          cloud.value = (cloud.value - 40) & 0xff;
          reschedule = true;
        }
        break;

      case RN_POISON_CLOUD: {
        if (partyHere) {
          this.ctx.systems.monsterAttack.damageAllCharacters(damage, 0, 0);
        } else if (monster) {
          const poison = this.ctx.systems.monsterDamage.determinePoisonDamage(monsterType, damage);
          if (poison !== 0) {
            const result = this.ctx.systems.monsterDamage.damageMonsterGroup(monster, timer.level, x, y, poison, true, false);
            // Survivors notice: TT_M3 is CSBWin's "damaged by a cloud or a door".
            if (result !== 2 && poison > 2) {
              this.ctx.systems.monsterAI.processTimers29to41({
                mapX: x,
                mapY: y,
                level: timer.level,
                timerFunction: TimerFunction.TT_M3,
                timeUntilAlternateUpdate: 0,
              });
            }
          }
        }
        if (cloud.value < 6) break;
        cloud.value = (cloud.value - 3) & 0xff;
        reschedule = true;
        break;
      }
    }

    if (reschedule) {
      this.timers.createTimer(
        TimerFunction.TT_25,
        x,
        y,
        timer.uByte8,
        timer.uByte9,
        (timer.time + 1) >>> 0,
        timer.level,
        cloudRn,
      );
      return;
    }

    this.dungeon.removeObjectFromCell(position, cloudRn);
    this.dungeon.deleteDBEntry(cloudRn);
  }

  /** `ProcessTT_BASH_DOOR` (`doc/CSBwin-src/Timer.cpp:1492`) — `HitDoor`'s delayed arm lands. */
  private processBashDoor(timer: TimerEntry): void {
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;
    setDoorState(map, timer.uByte6, timer.uByte7, 5);
  }

  private addObjectToMonsterPossession(monsterRn: ObjectID, objectRn: ObjectID): void {
    const monster = this.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return;
    const head = monster.possession ?? OBJECT_ID_EOF;
    if (head === OBJECT_ID_EOF || head === OBJECT_ID_NULL) {
      monster.possession = objectRn;
      this.dungeon.setDBRecordLink(objectRn, OBJECT_ID_EOF);
      return;
    }
    let current = head;
    for (;;) {
      const next = this.dungeon.getDBRecordLink(current);
      if (next === OBJECT_ID_EOF) break;
      current = next;
    }
    this.dungeon.setDBRecordLink(current, objectRn);
    this.dungeon.setDBRecordLink(objectRn, OBJECT_ID_EOF);
  }

  /**
   * `ProcessObjectFromMissile`'s no-monster arm (`doc/CSBwin-src/Timer.cpp:151-159`):
   * a thrown object landing at the end of its flight is
   * `MoveObject(objD6.pos(missile.pos()), -2, 0, mapX, mapY, NULL, NULL)` — the
   * teleporter/pit loop, then `PlaceOrRemoveObjectInRoom`, so it moves on from an active
   * teleporter and presses a pad. `oldX` is -2, not -1, so a relative teleporter turns
   * its corner (`Code11f52.cpp:3000-3006`). A spell or a cloud is not dropped (`:138`).
   */
  private dropMissileObject(projectileObject: ObjectID, position: Position, posInCell: number): void {
    if (projectileObject >= 0xff80) return;
    const decoded = decodeObjectID(projectileObject);
    if (decoded.category === DBType.CLOUD) return;
    const dropped = encodeObjectID(posInCell, decoded.category, decoded.index);
    this.ctx.systems.worldMove.moveObject(dropped, -2, 0, position.x, position.y, position.z);
  }

  private wiggleEverything(mapX: number, mapY: number, level: number): void {
    const position = new Position(mapX, mapY, level);

    if (this.isPartyAt(position)) {
      this.wiggleParty(position);
    }

    // `MoveObject(objD4, mapX, mapY, mapX, mapY)` (`Timer.cpp:2446-2450`).
    const monster = this.dungeon.findFirstMonster(position);
    if (monster !== OBJECT_ID_EOF) {
      this.ctx.systems.monsters.moveMonster(monster, mapX, mapY, mapX, mapY, level);
    }

    // `FindFirstDrawableObject` (`doc/CSBwin-src/CSBCode.cpp:5140`), then count what
    // lies beyond a monster: that many links are walked, whatever they hold, so an
    // object moved back into this cell is not moved twice (`Timer.cpp:2451-2465`).
    let first = this.dungeon.findFirstObject(position);
    while (first !== OBJECT_ID_EOF && decodeObjectID(first).category < DBType.CREATURE) {
      first = this.dungeon.getDBRecordLink(first);
    }
    let count = 0;
    for (let rn = first; rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (decodeObjectID(rn).category > DBType.CREATURE) count++;
    }
    for (let rn = first, next = first; rn !== OBJECT_ID_EOF && count !== 0; rn = next) {
      count--;
      next = this.dungeon.getDBRecordLink(rn);
      const type = decodeObjectID(rn).category;
      if (type <= DBType.CREATURE) continue;
      // `MoveObject(objD4, mapX, mapY, mapX, mapY)`: `placed` / `position` are
      // `d.NewPos` / `d.NewX`, `d.NewY`, `d.NewLevel`, or null when the object stayed.
      const moved = this.ctx.systems.worldMove.moveObject(rn as ObjectID, mapX, mapY, mapX, mapY, level);
      if (moved.placed === null || moved.position === null) continue;
      const to = moved.position;
      if (type === DBType.MISSILE) {
        // Its timer's square and direction in `timerWord8`, the placed ID, the level
        // (`:2474-2489`).
        const missile = this.dungeon.getMissileRecord(moved.placed);
        const timer = missile ? this.timers.getTimer(missile.timerIndex) : null;
        if (timer) {
          timer.timerWord8 = (timer.timerWord8 & 0xf000) | (to.x & 0x1f) | ((to.y & 0x1f) << 5)
            | (((moved.newDir ?? 0) & 0x3) << 10);
          timer.object = moved.placed;
          timer.uByte6 = to.x & 0xff;
          timer.uByte7 = to.y & 0xff;
          timer.level = to.z & 0xff;
        }
      } else if (type === DBType.CLOUD) {
        // Every `TT_25` / `TT_24` naming the cloud follows it (`:2491-2510`). CSBWin's
        // `RN` compare ignores the corner, which lives in the indirect index; here it
        // is part of the ID, so the timer is handed the placed ID outright.
        for (const entry of this.timers.getTimers()) {
          if (entry.function !== TimerFunction.TT_25 && entry.function !== TimerFunction.TT_24) continue;
          if (entry.object === undefined || !rnEquals(entry.object, rn)) continue;
          entry.uByte6 = to.x & 0xff;
          entry.uByte7 = to.y & 0xff;
          entry.object = moved.placed;
          entry.level = to.z & 0xff;
        }
      }
    }
  }

  /** `MoveObject(RN(RNnul), mapX, mapY, mapX, mapY, NULL, NULL)` (`Timer.cpp:2443`). */
  private wiggleParty(position: Position): void {
    this.ctx.systems.worldMove.moveParty(position.x, position.y, position.x, position.y);
  }

  private activateDsa(timer: TimerEntry): void {
    const target = new Position(timer.uByte6, timer.uByte7, timer.level);
    for (let rn = this.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec || getActuatorType(rec) !== 47) continue;
      this.ctx.systems.dsa.processTimer5(rn, timer, target);
    }
  }
}
