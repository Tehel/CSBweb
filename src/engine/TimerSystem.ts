import { decodeObjectID, encodeObjectID, DBType, Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, withObjectPosition, type LocationRel, type ObjectID } from '../core/types';
import { PotionType, SoundIndex } from '../core/constants';

/**
 * `soundDOOROPENING` (doc/CSBwin-src/CSB.h:626) — what the party hears when a closing
 * door springs back off them.
 */
const SOUND_DOOR_OPENING = 18;
/** The ordinal `ProcessTT_1` queues when a door rebounds off a monster (`QueueSound(4, …)`). */
const SOUND_DOOR_STRUGGLE = 4;
/** `soundTELEPORT` (doc/CSBwin-src/CSB.h:625). */
const SOUND_TELEPORT = 17;
import type { CsbRandom } from '../core/random';
import { sw } from '../core/intCast';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import type { PartyState } from './gameTypes';
import { characterAtPosition } from './AddCharacter';
import {
  RN_DISPELL_MISSILE, RN_FIREBALL, RN_LIGHTNING, RN_MONSTER_DEATH, RN_POISON,
  RN_POISON_BOLT, RN_POISON_CLOUD, RN_ZO_SPELL, RN_FFE4,
  isMagicSpellRn, isNonPhysicalSpellRn,
} from '../core/spellRn';
import { findChampionByFingerprint } from './Party';
import type {
  ActuatorRecord,
  CreatureRecord,
  Item16Record,
  MapData,
  MissileRecord,
  TeleporterRecord,
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
import { TimerFunction, type TimerEntry, TimerQueue } from './TimerQueue';
import { monsterFireResistance } from '../renderer/csbwin/ObjectTables';
import { AttackType, MonsterType, StateOfFear } from './monsterTypes';
import { MonsterDamageResult } from './MonsterDamage';
import { DELTA_X, DELTA_Y } from './MonsterPerception';
import {
  monsterAbsorbsDaggersEtc,
  monsterHorizontalSize,
  monsterLevitating,
  monsterNonMaterial,
  monsterVerticalSize,
} from '../renderer/csbwin/ObjectTables';
import { DescIndex, IsAKey } from './objectIndex';
import { constructPredefinedMissile, decodeMissileTimerWord8, encodeMissileTimerWord8, spellObjectId } from './missileHelpers';
import { ordinalOfMonsterAtPosition } from './monsterPosition';
import { CloudType } from './cloudTypes';
import { setPartyFacing } from './Party';


const WEAPON_DAGGER = 8;
const WEAPON_ARROW = 27;
const WEAPON_SLAYER = 28;
const WEAPON_POISON_DART = 31;
const WEAPON_THROWING_STAR = 32;

/**
 * The wound mask a missile carries, a literal at `DamageCharacter(objectPos, D5W, 12,
 * …)` (`doc/CSBwin-src/Code11f52.cpp:2046`). Bits 2 and 3 are the torso and the legs.
 *
 * (The champion *wound sound*, ordinal `chIdx + 9`, belongs to the monster's melee
 * attack — `doc/CSBwin-src/Monster.cpp:4584`, ported in `MonsterAttack`. A missile
 * strike queues no sound of its own.)
 */
const MISSILE_WOUND_MASK = 12;

/**
 * What `MoveObject`'s loop knows about a monster group it is moving
 * (`doc/CSBwin-src/Code11f52.cpp:2796-3131`): where it stands (`oldX < 0`: nowhere
 * yet), the level its `ITEM16` belongs to (`AttachedLevel_4`), and whether it has none
 * (`!item16Attached`).
 */
interface MonsterMove {
  record: CreatureRecord;
  oldX: number;
  oldY: number;
  attachedLevel: number;
  noItem16: boolean;
}

type MissileDropTarget = { monster: ObjectID } | null;

export class TimerSystem {
  private missileFilterObject = OBJECT_ID_EOF;
  /**
   * `d.Time` as the timer system last saw it. `CreateCloud` schedules relative to it,
   * and it can be reached from outside a `processTimers` pass (a missile impact, a
   * monster death), so it is also set by `setNow`.
   */
  private now = 0;
  private missileFilterTimer: TimerEntry | null = null;
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
    const party = this.ctx.party.state;
    const chIdx = timer.uByte5 & 0xff;
    const champ = party.champions[chIdx];
    if (!champ) return;
    if (champ.busyTimerIndex === timer.index) {
      champ.busyTimerIndex = -1;
      champ.actionDisabledUntil = 0;
    }
    // The `TT_11` case (doc/CSBwin-src/CSBCode.cpp:6466-6475): `EnableCharacterAction`,
    // then `TAG0115ee(chIdx, uByte6 - 1)` when `uByte6 != 0` — the slot a throw emptied.
    this.enableCharacterAction(chIdx);
    const refillSlot = timer.uByte6 & 0xff;
    if (refillSlot !== 0) this.ctx.systems.character.refillPossessionSlot(chIdx, refillSlot - 1);
  }

  /**
   * `EnableCharacterAction` (`doc/CSBwin-src/Timer.cpp:2638`) — the champion is free
   * again: the attack's defence penalty goes, and a bow that has just been fired reloads
   * from the quiver. Not ported (`DEBT.md` C36): the closing `attackType = -1`
   * (`:2680`), and the unconditional `busyTimer = -1` (`:2645`), which the caller does
   * only for the champion's own timer.
   */
  private enableCharacterAction(chIdx: number): void {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return;
    if (champion.attackType !== -1) champion.attackStatModifier = 0;
    if ((champion.attributes.health | 0) !== 0) {
      // A bow that has just been fired reloads itself from slot 12, then from
      // slots 7-9, taking the first object of the matching ammunition class
      // (`TAG0153c2`, `doc/CSBwin-src/Timer.cpp:2656-2672`).
      const character = this.ctx.systems.character;
      if (champion.attackType === AttackType.atk_SHOOT && (champion.possessions[0] ?? OBJECT_ID_NULL) === OBJECT_ID_NULL) {
        for (const slot of [12, 7, 8, 9]) {
          if (character.matchingAmmunition(champion, slot)) {
            const ammo = character.removeCharacterPossession(chIdx, slot);
            if (ammo !== OBJECT_ID_NULL) character.setChampionHand(champion, 0, ammo);
            break;
          }
        }
      }
    }
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
   * caller's half.
   */
  cancelPoisonTimers(chIdx: number): void {
    if (chIdx === -1) return;
    for (const timer of [...this.timers.getTimers()]) {
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
          this.setDoorState(map, x, y, 0);
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
            this.setDoorState(map, x, y, doorState === 0 ? 0 : doorState - 1);
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

    const prevState = doorState;
    const delta = action === ActuatorAction.SET ? -1 : 1;
    doorState = Math.max(0, Math.min(4, doorState + delta));
    this.setDoorState(map, x, y, doorState);
    if (prevState !== doorState) {
      const distance = this.getPartyDistance(x, y, timer.level);
      if (distance !== null) this.ctx.host.playSound(SoundIndex.DOOR, 0, distance);
    }

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

  private getPartyDistance(x: number, y: number, level: number): number | null {
    const party = this.ctx.party.state;
    if (party.position.z !== level) return null;
    const dx = Math.abs((party.position.x ?? 0) - x);
    const dy = Math.abs((party.position.y ?? 0) - y);
    return dx + dy;
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
      this.createCloud(RN_FFE4, 0, location.x, location.y, location, pos);
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
    const target = bones as number;
    for (let rn = this.dungeon.findFirstObject(location); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (rn !== target) continue;
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

  private setDoorState(map: MapData, x: number, y: number, doorState: number): void {
    const cellFlag = map.cellFlags[x][y];
    const newCellFlag = (cellFlag & 0xf8) | (doorState & 0x7);
    map.cellFlags[x][y] = newCellFlag;
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
      if (timer.object !== undefined && rn === timer.object) {
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

    if (this.missileFilterObject !== OBJECT_ID_EOF) {
      throw new Error('MissileFilter already active');
    }

    this.missileFilterObject = missileRn;
    this.missileFilterTimer = timer;

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
        if (this.processMissileEncounter(-2, curMapX, curMapY, curMapX, curMapY, curPos, missileRn)) {
          this.clearMissileFilterState();
          return;
        }
      }

      const monster = this.dungeon.findFirstMonster(current);
      if (monster !== OBJECT_ID_EOF) {
        if (this.processMissileEncounter(-1, curMapX, curMapY, curMapX, curMapY, curPos, missileRn)) {
          this.clearMissileFilterState();
          return;
        }
      }

      if ((missile.rangeRemaining & 0xff) <= deltaEnergy) {
        const filterProjectile = (missile.projectileObject & 0xffff) as ObjectID;
        this.missileEncounterFilter(5, current, curPos, missileRn, filterProjectile, -1);
        this.processObjectFromMissile(missileRn, null, current);
        this.clearMissileFilterState();
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
      curPos = decodeObjectID(this.missileFilterObject).position & 0x3;
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
            if (this.processMissileEncounter(nextRoomType, origMapX, origMapY, origMapX, origMapY, curPos, missileRn)) {
              this.clearMissileFilterState();
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
        this.clearMissileFilterState();
        return;
      }

      const oldPos = new Position(origMapX, origMapY, timer.level);
      const moveResult = this.moveMissileToCell(new Position(curMapX, curMapY, timer.level), curPos, missileDir);
      const newPosInCell = moveResult.posInCell & 0x3;
      const newDir = moveResult.dir & 0x3;
      const newPos = moveResult.position;
      const newRn = encodeObjectID(newPosInCell, DBType.MISSILE, decoded.index);

      this.dungeon.removeObjectFromCell(oldPos, missileRn);
      if (!this.dungeon.addObjectToCell(newPos, newRn)) {
        this.clearMissileFilterState();
        return;
      }

      timer.object = newRn;
      this.missileFilterObject = newRn;
      timer.uByte6 = newPos.x & 0xff;
      timer.uByte7 = newPos.y & 0xff;
      timer.level = newPos.z & 0xff;
      timer.timerWord8 = encodeMissileTimerWord8(newPos.x, newPos.y, newDir, deltaEnergy);
    } else {
      const map = this.dungeon.getMap(timer.level);
      if (map) {
        const cellFlag = map.cellFlags[curMapX][curMapY];
        if (((cellFlag >> 5) & 0x7) === RoomType.DOOR) {
          if (this.processMissileEncounter(RoomType.DOOR, curMapX, curMapY, curMapX, curMapY, curPos, missileRn)) {
            this.clearMissileFilterState();
            return;
          }
        }
      }

      const oldPos = new Position(curMapX, curMapY, timer.level);
      const newRn = encodeObjectID(curPos & 0x3, DBType.MISSILE, decoded.index);
      this.dungeon.removeObjectFromCell(oldPos, missileRn);
      if (!this.dungeon.addObjectToCell(oldPos, newRn)) {
        this.clearMissileFilterState();
        return;
      }
      timer.object = newRn;
      this.missileFilterObject = newRn;
    }

    timer.time = (timer.time + 1) >>> 0;
    // CSBWin stores the *return* of SetTimer here
    // (`pDBMissile->timerIndex(gameTimers.SetTimer(&missileFilterTimer))`,
    // doc/CSBwin-src/Timer.cpp:429), and so must we: the queue keeps a copy.
    const queued = this.timers.addTimer(timer);
    missile.timerIndex = queued.index & 0xffff;
    this.clearMissileFilterState();
  }

  /**
   * `d.MonsterDamageResult` — the result of the most recent `DamageMonster` call.
   *
   * CSBWin keeps this in globals because `CheckMoveFromMissile` needs to know whether
   * the encounter it just resolved wiped out the whole group, and the call chain
   * between them does not carry a return value
   * (`doc/CSBwin-src/Code11f52.cpp:2742`).
   */
  private monsterDamageResult: MonsterDamageResult = MonsterDamageResult.NO_MONSTER_DIED;

  /**
   * Whether the last `DamageMonster` wiped out the whole group.
   *
   * A method rather than an inline comparison because the field changes inside
   * `processMissileEncounter`, which `tsc`'s narrowing does not see through: after the
   * reset beside a call, it would narrow the field to `NO_MONSTER_DIED` and reject the
   * comparison.
   */
  private groupWasWipedOut(): boolean {
    return (this.monsterDamageResult as number) === MonsterDamageResult.ALL_MONSTERS_DIED;
  }

  checkMoveFromMissile(oldPos: Position, newPos: Position | null, movedObject: ObjectID | null): void {
    if (this.missileFilterObject !== OBJECT_ID_EOF) return;

    const party = this.ctx.party.state;
    const movedObjectType = movedObject === null ? -2 : -1;
    const whoLeavesCell = [0, 0, 0, 0];
    const whoLeavesNewCell = [0, 0, 0, 0];

    if (movedObject === null) {
      for (const champion of party.champions) {
        if (!champion.alive) continue;
        const pos = champion.partyPosition & 0x3;
        whoLeavesCell[pos] = (pos + 1) & 0xff;
      }
    } else {
      const decoded = decodeObjectID(movedObject);
      if (decoded.category !== DBType.CREATURE) return;
      if (oldPos.z !== party.position.z) return;
      const monster = this.dungeon.getCreatureRecord(movedObject);
      if (!monster) return;
      const hasHp = (monster.hp ?? []).some((hp) => (hp ?? 0) > 0);
      if (!hasHp) return;
      for (let pos = 0; pos < 4; pos++) {
        if (ordinalOfMonsterAtPosition(this.dungeon, this.ctx.tables.monsterDesc, monster, pos) !== 0) {
          whoLeavesCell[pos] = (pos + 1) & 0xff;
        }
      }
    }

    let numCellsToTry = 1;
    const sameLevelNewPos = newPos && newPos.z === oldPos.z ? newPos : null;
    if (sameLevelNewPos) {
      const distanceTraveled = Math.abs(oldPos.x - sameLevelNewPos.x) + Math.abs(oldPos.y - sameLevelNewPos.y);
      if (distanceTraveled === 1) {
        const headPosLeft = this.primaryDirectionFromMove(oldPos, sameLevelNewPos);
        const headPosRight = (headPosLeft + 1) & 0x3;
        const tailPosLeft = (headPosLeft + 3) & 0x3;
        const tailPosRight = (headPosLeft + 2) & 0x3;

        if (whoLeavesCell[headPosLeft]) {
          whoLeavesNewCell[tailPosLeft] = whoLeavesCell[headPosLeft];
          numCellsToTry = 2;
        } else {
          whoLeavesCell[headPosLeft] = whoLeavesCell[tailPosLeft];
        }

        if (whoLeavesCell[headPosRight]) {
          whoLeavesNewCell[tailPosRight] = whoLeavesCell[headPosRight];
          numCellsToTry = 2;
        } else {
          whoLeavesCell[headPosRight] = whoLeavesCell[tailPosRight];
        }
      }
    }

    let missileX = oldPos.x;
    let missileY = oldPos.y;
    const level = oldPos.z;

    for (let cellIdx = 0; cellIdx < numCellsToTry; cellIdx++) {
      let timerDeleted = true;
      while (timerDeleted) {
        timerDeleted = false;
        const missiles = this.findMissilesAt(new Position(missileX, missileY, level));
        for (const missileRn of missiles) {
          const missile = this.dungeon.getMissileRecord(missileRn);
          if (!missile) continue;
          const timer = this.timers.getTimer(missile.timerIndex);
          if (!timer) continue;
          if (timer.function === TimerFunction.TT_MISSILE0) continue;
          const missilePos = decodeObjectID(missileRn).position & 0x3;
          const leaving = whoLeavesCell[missilePos];
          if (leaving === 0) continue;

          this.missileFilterObject = missileRn;
          this.missileFilterTimer = timer;
          const hit = this.processMissileEncounter(
            movedObjectType,
            oldPos.x,
            oldPos.y,
            missileX,
            missileY,
            (leaving - 1) & 0xff,
            missileRn,
          );
          this.clearMissileFilterState();

          if (hit) {
            this.timers.deleteTimer(missile.timerIndex);
            if (this.groupWasWipedOut()) {
              // The whole group died to the missile, so the thing being moved no
              // longer exists (doc/CSBwin-src/Code11f52.cpp:2740-2746).
              this.movedObjectWasDestroyed = true;
              return;
            }
            timerDeleted = true;
            break;
          }
        }
      }

      if (numCellsToTry > 1 && cellIdx === 0 && sameLevelNewPos) {
        missileX = sameLevelNewPos.x;
        missileY = sameLevelNewPos.y;
        for (let i = 0; i < 4; i++) whoLeavesCell[i] = whoLeavesNewCell[i];
      }
    }
  }

  private moveMissileToCell(
    position: Position,
    posInCell: number,
    direction: number,
  ): { position: Position; posInCell: number; dir: number } {
    const result = this.resolveCellEffects(position, DBType.MISSILE, posInCell, 0, direction, false);
    return {
      position: result.position,
      posInCell: result.objectPos & 0x3,
      dir: result.missileDir ?? direction,
    };
  }

  private processMissileEncounter(
    cellType: number,
    objX: number,
    objY: number,
    missileX: number,
    missileY: number,
    objectPos: number,
    missileRn: ObjectID,
  ): boolean {
    const missile = this.dungeon.getMissileRecord(missileRn);
    if (!missile) return false;
    const position = new Position(missileX, missileY, this.missileFilterTimer?.level ?? 0);
    const filterProjectile = (missile.projectileObject & 0xffff) as ObjectID;
    // `d.MonsterDamageResult = NO_MONSTER_DIED;` (`doc/CSBwin-src/Code11f52.cpp:1770`).
    this.monsterDamageResult = MonsterDamageResult.NO_MONSTER_DIED;
    // `RNprojectile` stays the potion all through the switch below: a Ven or Ful potion
    // becomes its cloud (`obj_26`) only in the shared tail (`:2060-2063`), so the blow it
    // lands first — on a champion, a monster or a door — is a thrown object's.
    const projectile = (missile.projectileObject & 0xffff) as ObjectID;
    const projectileDbType = this.isMagicSpell(projectile)
      ? DBType.CLOUD
      : decodeObjectID(projectile).category;

    let convertedPotion = false;
    let convertedPower = 0;
    let convertedProjectile = projectile;

    if (projectileDbType === DBType.POTION) {
      const potion = this.dungeon.getPotionRecord(projectile);
      if (potion) {
        if ((potion.potionType | 0) === PotionType.VEN_POTION) {
          convertedProjectile = RN_POISON_CLOUD;
          convertedPower = potion.power & 0xff;
          convertedPotion = true;
        } else if ((potion.potionType | 0) === PotionType.FUL_BOMB) {
          convertedProjectile = RN_FIREBALL;
          convertedPower = potion.power & 0xff;
          convertedPotion = true;
        }
      }
    }

    const tailProjectile = convertedPotion ? (convertedProjectile & 0xffff) as ObjectID : projectile;

    const nonPoisonSpell =
      projectileDbType === DBType.CLOUD &&
      projectile !== RN_POISON &&
      projectile !== RN_POISON_BOLT;

    let absorbedMonster: ObjectID | null = null;
    switch (cellType) {
      case RoomType.FALSEWALL:
        if (this.missileEncounterFilter(3, position, objectPos, missileRn, filterProjectile, -1) === 1) {
          return false;
        }
        break;
      case RoomType.STONE:
        if (this.missileEncounterFilter(4, position, objectPos, missileRn, filterProjectile, -1) === 1) {
          return false;
        }
        break;
      case 8:
        this.missileEncounterFilter(6, position, objectPos, missileRn, filterProjectile, -1);
        break;
      case RoomType.DOOR: {
        // `doc/CSBwin-src/Code11f52.cpp:1844-1935`.
        const map = this.dungeon.getMap(position.z);
        if (!map) return false;
        const cellFlag = map.cellFlags[objX]?.[objY] ?? 0;
        const doorState = cellFlag & 0x7;
        const doorRn = this.dungeon.findFirstDoor(new Position(objX, objY, position.z));
        const door = doorRn !== OBJECT_ID_EOF ? this.dungeon.getDoorRecordByIndex(decodeObjectID(doorRn).index) : null;
        if (!door) return false;

        // A Zo spell at a door that is not broken works its button, if it has one, and
        // is spent either way.
        if (doorState !== 5 && projectile === RN_ZO_SPELL) {
          if (door.hasButton) {
            this.timers.createTimer(TimerFunction.TT_DOOR, objX, objY, 0, ActuatorAction.TOGGLE, (this.now + 1) >>> 0, position.z);
          }
          break;
        }
        if (doorState === 5 || doorState <= 1) return false;
        // `D0B = BITS8_15(d.DoorTOC[doorType]); if (D0W & 2)` — bit 1 of the high byte
        // marks a door missiles can pass: a non-physical spell always does, a thrown
        // object if it still has range to beat `STRandom(128)`, fits in a pouch and is
        // not a key.
        const tocHigh = (this.dungeon.doorTOC(position.z, door.doorType, this.ctx.tables.doorCharacteristics) >> 8) & 0xff;
        if (tocHigh & 2) {
          let passes: boolean;
          if (projectileDbType === DBType.CLOUD) {
            passes = isNonPhysicalSpellRn(projectile);
          } else {
            const w72 = this.random.below(128);
            passes =
              (missile.rangeRemaining & 0xff) > w72 &&
              (this.objDescWord4(projectile) & 0x100) !== 0 &&
              !IsAKey(this.dungeon, this.ctx.tables, this.ctx.party.state.facing, projectile);
          }
          if (passes) return false;
        }
        const force = sw(this.determineMagicDamage(missile, projectile).damage + 1);
        if (this.missileEncounterFilter(2, position, objectPos, missileRn, filterProjectile, -1) === 1) {
          return false;
        }
        this.hitDoor(new Position(objX, objY, position.z), force + this.random.below(force), false, 0);
        break;
      }
      case -2: {
        // `objectPos = CharacterAtPosition(objectPos); if (objectPos < 0) return 0;`
        // (`doc/CSBwin-src/Code11f52.cpp:1948-1952`). The corner the missile arrived at
        // names the champion, and an empty one — or one holding only a corpse, since
        // `CharacterAtPosition` skips the dead — lets the missile fly on. From here on
        // `objectPos` *is* a champion index, including in the filter call below.
        const chIdx = characterAtPosition(this.ctx.party.state.champions, objectPos & 0x3);
        if (chIdx < 0) return false;
        if (this.missileEncounterFilter(7, position, objectPos, missileRn, filterProjectile, chIdx) === 1) {
          return false;
        }
        // `D5W = DetermineMagicDamage(pDBmissile, RNprojectile); D4W = D5W;` — the
        // party is the only arm that sets `D4W`, which is what makes the shared tail
        // at `:2044` a party-only `DamageCharacter`.
        const magic = this.determineMagicDamage(missile, projectile);
        if (magic.damage !== 0) {
          this.applyMissileDamageToParty({
            chIdx,
            damage: magic.damage,
            kind: magic.kind,
            poisonStrength: magic.poisonStrength,
          });
        }
        // The missile is spent either way: a dispel missile does a champion no damage
        // at all (`DetermineMagicDamage` returns 0 for it) and still lands.
        return this.finishMissileEncounter(missileRn, absorbedMonster, position, objectPos, tailProjectile, convertedPotion, convertedPower, nonPoisonSpell, objX, objY);
      }
      case -1: {
        // The monster arm (`doc/CSBwin-src/Code11f52.cpp:1960-2042`).
        const monsterRn = this.dungeon.findFirstMonster(position);
        if (monsterRn === OBJECT_ID_EOF) return false;
        const monster = this.dungeon.getCreatureRecord(monsterRn);
        if (!monster) return false;
        // The member in the corner the missile reached. Nobody there lets it fly on —
        // unless the group is drawn as one full-cell figure, when member 1 takes it.
        let monsterOrdinal = ordinalOfMonsterAtPosition(this.dungeon, this.ctx.tables.monsterDesc, monster, objectPos);
        if (monsterOrdinal === 0) {
          if (!monster.drawAsSize4) return false;
          monsterOrdinal = 1;
        }
        if (this.missileEncounterFilter(1, position, objectPos, missileRn, filterProjectile, monsterOrdinal - 1) === 1) {
          return false;
        }
        const monsterType = monster.creatureType;
        const desc = this.ctx.tables.monsterDesc[monsterType];
        if (!desc) return false;

        // A fireball feeds a Black Flame: `hitPoints6 = Smaller(1000, hp + magic)`, and
        // the missile is simply gone — no damage, no sound, no explosion (`:1976-1996`).
        // CSBWin's potion bookkeeping in this branch is unreachable: `RNprojectile` is
        // the potion itself, never `RNFireball`, while a bomb is in flight.
        if (projectile === RN_FIREBALL && monsterType === MonsterType.mon_BlackFlame) {
          const i = monsterOrdinal - 1;
          const magic = this.determineMagicDamage(missile, projectile);
          monster.hp[i] = sw(Math.min(1000, (monster.hp[i] ?? 0) + magic.damage)) & 0xffff;
          this.processObjectFromMissile(missileRn, null, position);
          return true;
        }
        if (monsterNonMaterial(desc) && projectile !== RN_DISPELL_MISSILE) return false;

        // `D0L = 64 * (DetermineMagicDamage(...) & 0xffff); D5W = (D0L & 0xffff) / D1W`,
        // with `D1W = defense08`, 0 read as 1 (`:2006-2012`). A blow that rounds to 0
        // skips `DamageMonster` but the missile still lands.
        const magic = this.determineMagicDamage(missile, projectile);
        const defense = desc.defense08 === 0 ? 1 : desc.defense08;
        const blow = sw(Math.trunc(((64 * (magic.damage & 0xffff)) & 0xffff) / defense));
        if (blow !== 0) {
          // `DeterminePoisonDamage(mt_60, d.Word12962)` — the poison strength the
          // `DetermineMagicDamage` call above just set.
          const poison = sw(this.ctx.systems.monsterDamage.determinePoisonDamage(monsterType, magic.poisonStrength));
          const result = this.ctx.systems.monsterDamage.damageMonster(
            monster, monsterOrdinal - 1, position.z, objX, objY, blow + poison, true, false,
          );
          // "At least one monster in group remains": the survivors react.
          if (result !== MonsterDamageResult.ALL_MONSTERS_DIED) {
            this.ctx.systems.monsterAI.processTimers29to41({
              mapX: objX,
              mapY: objY,
              level: position.z,
              timerFunction: TimerFunction.TT_M2,
              timeUntilAlternateUpdate: 0,
            });
          }
          this.monsterDamageResult = result;
          // A dagger, arrow, slayer, poison dart or throwing star sticks in a monster
          // that absorbs them — but only if nobody died of the blow (`:2031-2042`).
          if (
            !nonPoisonSpell &&
            result === MonsterDamageResult.NO_MONSTER_DIED &&
            projectileDbType === DBType.WEAPON &&
            monsterAbsorbsDaggersEtc(desc)
          ) {
            const wt = (this.dungeon.getWeaponRecord(projectile)?.weaponType ?? -1) | 0;
            if (
              wt === WEAPON_DAGGER ||
              wt === WEAPON_ARROW ||
              wt === WEAPON_SLAYER ||
              wt === WEAPON_POISON_DART ||
              wt === WEAPON_THROWING_STAR
            ) {
              absorbedMonster = monsterRn;
            }
          }
        }
        return this.finishMissileEncounter(missileRn, absorbedMonster, position, objectPos, tailProjectile, convertedPotion, convertedPower, nonPoisonSpell, objX, objY);
      }
      default:
        break;
    }

    return this.finishMissileEncounter(missileRn, absorbedMonster, position, objectPos, tailProjectile, convertedPotion, convertedPower, nonPoisonSpell, objX, objY);
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
  private processObjectFromMissile(missileRn: ObjectID, dest: MissileDropTarget, position: Position): void {
    const missile = this.dungeon.getMissileRecord(missileRn);
    if (!missile) return;
    const projectile = (missile.projectileObject & 0xffff) as ObjectID;
    const projectileIsMagic = this.isMagicSpell(projectile);
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

  private missileEncounterFilter(
    type: number,
    position: Position,
    posInCell: number,
    missile: number,
    projectile: ObjectID,
    index: number,
  ): number {
    const direction = ((this.missileFilterTimer?.timerWord8 ?? 0) >> 10) & 0x3;
    return this.ctx.systems.dsa.processMissileEncounterFilter({
      type,
      position,
      posInCell: posInCell & 0x3,
      missile,
      projectile,
      direction,
      index,
    }) | 0;
  }

  private clearMissileFilterState(): void {
    this.missileFilterObject = OBJECT_ID_EOF;
    this.missileFilterTimer = null;
  }

  private findMissilesAt(position: Position): ObjectID[] {
    const missiles: ObjectID[] = [];
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category === DBType.MISSILE) missiles.push(rn);
    }
    return missiles;
  }

  private primaryDirectionFromMove(oldPos: Position, newPos: Position): number {
    if (newPos.x > oldPos.x) return Direction.EAST;
    if (newPos.x < oldPos.x) return Direction.WEST;
    if (newPos.y > oldPos.y) return Direction.SOUTH;
    return Direction.NORTH;
  }

  /**
   * The tail of `ProcessMissileEncounter`'s party arm
   * (`doc/CSBwin-src/Code11f52.cpp:2044-2056`):
   *
   * ```cpp
   * if (D4W != 0) {
   *   D0W = DamageCharacter(objectPos, D5W, 12, d.Word12964);
   *   if (D0W != 0 && d.Word12962 != 0 && STRandomBool())
   *     PoisonCharacter(objectPos, d.Word12962);
   * }
   * ```
   *
   * Everything above it — which champion, how much, which mitigation, how much
   * poison — was decided in `TimerSystem.determineMagicDamage`; this only applies
   * it. Going through `DamageCharacter` rather than subtracting from `health` is
   * the whole point: it is what runs armour, wounds, the shields, the wake-up, and
   * `KillCharacter`. Until it did, a champion killed by a missile left no bones and
   * no possessions, and a party wiped by one did not lose the game.
   *
   * The **wound mask is 12**, a literal at the call site: bits 2 and 3, the torso
   * and the legs. A missile cannot wound a hand, a head or a foot.
   */
  private applyMissileDamageToParty(options: {
    chIdx: number;
    damage: number;
    kind: number;
    poisonStrength: number;
  }): void {
    // No `d.LastMonsterAttackTime` here: only `MonsterAttacks` sets it
    // (`doc/CSBwin-src/Monster.cpp:982`), and this port does so in `MonsterAttack`.
    const dealt = this.ctx.systems.monsterAttack.damageCharacter(
      options.chIdx,
      options.damage | 0,
      MISSILE_WOUND_MASK,
      options.kind | 0,
    );
    if (dealt === 0) return;
    // `STRandomBool()` — a poisoned missile infects only half the time.
    if ((options.poisonStrength | 0) !== 0 && this.random.bool() !== 0) {
      this.ctx.systems.monsterAttack.poisonCharacter(options.chIdx, options.poisonStrength | 0);
    }
  }

  private finishMissileEncounter(
    missileRn: ObjectID,
    destMonster: ObjectID | null,
    position: Position,
    objectPos: number,
    projectile: ObjectID,
    convertedPotion: boolean,
    convertedPower: number,
    nonPoisonSpell: boolean,
    objX: number,
    objY: number,
  ): boolean {
    const missile = this.dungeon.getMissileRecord(missileRn);
    if (!missile) return false;
    const dest: MissileDropTarget = destMonster !== null ? { monster: destMonster } : null;

    if (nonPoisonSpell || convertedPotion) {
      let size = convertedPotion ? convertedPower : (missile.rangeRemaining & 0xff);
      if (projectile === RN_LIGHTNING) {
        size = Math.floor(size / 2);
        if (size <= 0) {
          this.processObjectFromMissile(missileRn, dest, position);
          return true;
        }
      }
      const cloudPos = projectile === RN_POISON_CLOUD ? 255 : objectPos & 0xff;
      this.createCloud(projectile, size, objX, objY, position, cloudPos);
    } else {
      this.playMissileImpactSound(projectile, position);
    }

    if (convertedPotion) {
      this.dungeon.deleteDBEntry(missile.projectileObject);
      missile.projectileObject = (projectile & 0xffff) as ObjectID;
    }

    this.processObjectFromMissile(missileRn, dest, position);
    return true;
  }

  /**
   * Public entry to `CreateCloud` for the monster death cloud
   * (`doc/CSBwin-src/Code11f52.cpp:1376`, called from `DamageMonster`). The cloud
   * machinery lives here because that is where every other cloud is made.
   */
  createDeathCloud(projectile: ObjectID, size: number, position: Position, posInCell: number): void {
    this.createCloud(projectile, size, position.x, position.y, position, posInCell);
  }

  /**
   * `CreateFluxcage` (`doc/CSBwin-src/Code11f52.cpp:1515`).
   *
   * Not `CreateCloud`: a Fluxcage gets no `TT_25` life of its own — it never shrinks
   * and does no damage — only a single `TT_24` that removes it after 100 ticks. It
   * also goes into the cell centred (`RNempty` position) rather than in a corner.
   */
  createFluxcage(position: Position, startTime: number): ObjectID | null {
    const rn = this.createCloudRecord(CloudType.CT_FLUXCAGE, 0, 255);
    if (rn === null) return null;
    if (!this.dungeon.addObjectToCell(position, rn)) {
      this.dungeon.deleteDBEntry(rn as ObjectID);
      return null;
    }
    this.timers.createTimer(
      TimerFunction.TT_24,
      position.x,
      position.y,
      0,
      0,
      (startTime + 100) >>> 0,
      position.z,
      rn,
    );
    return rn as ObjectID;
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
   * `CreateCloud` / `TAG00dea8` (`doc/CSBwin-src/Code11f52.cpp:1376`).
   *
   * The cloud is a DB15 record in the cell plus a `TT_25` timer that gives it its
   * life. Without the timer — which is how this stood until now — the record sits in
   * the cell at full size for the rest of the game, rendering a permanent puff and
   * dealing no damage at all.
   *
   * A fireball or a lightning bolt also does its damage *here*, at the moment the
   * cloud appears, not on the timer.
   */
  private createCloud(
    projectile: ObjectID,
    size: number,
    objX: number,
    objY: number,
    position: Position,
    posInCell: number,
  ): void {
    if (objX < 0 || objY < 0) return;
    // `P1.GetSpellType()` (doc/CSBwin-src/Code11f52.cpp:1428).
    const rn = this.createCloudRecord(projectile & 0x7f, size, posInCell);
    if (rn === null) return;
    this.playCloudSound(projectile, size, position);
    this.dungeon.addObjectToCell(position, rn);

    // The Vi altar's cloud gets 5 ticks before its first turn; everything else 1.
    const delay = projectile === RN_FFE4 ? 5 : 1;
    this.timers.createTimer(
      TimerFunction.TT_25,
      position.x,
      position.y,
      0,
      0,
      (this.now + delay) >>> 0,
      position.z,
      rn,
    );

    if (projectile !== RN_LIGHTNING && projectile !== RN_FIREBALL) return;

    // A fireball's blast, dealt once. Lightning deals half.
    let damage = Math.trunc(size / 2) + 1;
    damage = damage + this.random.below(damage);
    if (projectile !== RN_FIREBALL) {
      damage = Math.trunc(damage / 2);
      if (damage === 0) return;
    }

    const party = this.ctx.party.state;
    if (position.z === party.position.z && objX === party.position.x && objY === party.position.y) {
      this.ctx.systems.monsterAttack.damageAllCharacters(damage, 63, 1);
      return;
    }

    const monsterRn = this.dungeon.findFirstMonster(new Position(objX, objY, position.z));
    if (monsterRn === OBJECT_ID_EOF) return;
    const monster = this.dungeon.getCreatureRecord(monsterRn);
    if (!monster) return;
    const desc = this.ctx.tables.monsterDesc[monster.creatureType];
    if (!desc) return;
    const fireResistance = monsterFireResistance(desc);
    if (fireResistance === 15) return;
    if (monsterNonMaterial(desc)) damage >>= 2;
    damage -= this.random.below(2 * fireResistance + 1);
    if (damage <= 0) return;
    this.monsterDamageResult =
      this.ctx.systems.monsterDamage.damageMonsterGroup(monster, position.z, objX, objY, damage, true, false);
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
        if (roomType === RoomType.DOOR) this.hitDoor(position, damage, true);
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

  /**
   * `HitDoor` (`doc/CSBwin-src/Code11f52.cpp:2263`) — a blow that may burst a door open.
   *
   * `explosion` picks which of the door's two "destructible by" flags is consulted:
   * a fireball's blast tests `canOpenWithFireball`, an axe blow `canOpenWithAxe`. The
   * force must also beat the door type's entry in `DoorTOC`.
   *
   * With a `delay` — `Attack.cpp`'s melee bash passes 2 (`doc/CSBwin-src/Attack.cpp:1803-1808`)
   * — the door does not shatter now: a `TT_BASH_DOOR` timer at `time + delay` does it.
   * A fireball passes none and the door goes at once.
   */
  hitDoor(position: Position, force: number, explosion: boolean, delay = 0, time = this.now): boolean {
    const doorRn = this.dungeon.findFirstObject(position);
    if (doorRn === OBJECT_ID_EOF) return false;
    const door = this.dungeon.getDoorRecordByIndex(decodeObjectID(doorRn).index);
    if (!door) return false;

    if (explosion ? !door.destructibleByFireball : !door.destructibleByChop) return false;
    const toc = this.dungeon.doorTOC(position.z, door.doorType, this.ctx.tables.doorCharacteristics) & 0xff;
    if (force < toc) return false;

    const map = this.dungeon.getMap(position.z);
    if (!map) return false;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return false;
    // Bottom three bits 4 means a closed door; 5 is the shattered state.
    if ((cellFlag & 7) !== 4) return false;
    if (delay !== 0) {
      this.timers.createTimer(TimerFunction.TT_BASH_DOOR, position.x, position.y, 0, 0, (time + delay) >>> 0, position.z);
    } else {
      this.setDoorState(map, position.x, position.y, 5);
    }
    return true;
  }

  /** `ProcessTT_BASH_DOOR` (`doc/CSBwin-src/Timer.cpp:1492`) — `HitDoor`'s delayed arm lands. */
  private processBashDoor(timer: TimerEntry): void {
    const map = this.dungeon.getMap(timer.level);
    if (!map) return;
    this.setDoorState(map, timer.uByte6, timer.uByte7, 5);
  }

  private createCloudRecord(cloudType: number, size: number, posInCell: number): ObjectID | null {
    const bit7 = (posInCell & 0xff) === 255;
    // `FindEmptyDB15Entry` (`doc/CSBwin-src/CSBCode.cpp:5073`).
    const index = this.dungeon.findEmptyDBEntry('clouds', {
      nextObject: OBJECT_ID_EOF,
      value: size & 0xff,
      cloudType: cloudType & 0x7f,
      bit7,
    });
    return index === null ? null : encodeObjectID(bit7 ? 0 : (posInCell & 0x3), DBType.CLOUD, index);
  }

  /**
   * The tail of `ProcessMissileEncounter`'s shared ending (`doc/CSBwin-src/
   * Code11f52.cpp:2101-2121`) — the sound for a plain object's impact, when nothing
   * spawned a cloud. These `soundNum` values are **ordinals** into `d.sound1772`
   * (`graphic232`'s sound table), not raw SND item numbers — `queueSound` is what
   * resolves an ordinal to the actual sample and its distance falloff. This used to
   * call `playSound` with a hand-picked `SoundIndex` constant per branch, which
   * silently substituted a *different* sample for the non-weapon, non-poison-bolt
   * case (`SoundIndex.FIREBALL_EXPLODE`, ordinal 5's sound, instead of ordinal 4's) —
   * so a dropped scroll or piece of food played an explosion.
   */
  private playMissileImpactSound(projectile: ObjectID, position: Position): void {
    let soundNum: number;
    if (!this.isMagicSpell(projectile) && decodeObjectID(projectile).category === DBType.WEAPON) {
      soundNum = 0;
    } else if (projectile === RN_POISON_BOLT) {
      soundNum = 13;
    } else {
      soundNum = 4;
    }
    this.ctx.sounds.queueSound(soundNum, position.x, position.y, 1);
  }

  /**
   * `CreateCloud`'s own sound (`doc/CSBwin-src/Code11f52.cpp:1432-1447`) —
   * `QueueSound(size>80 ? 5 : 20, missileX, missileY, 1)` for a fireball, poison
   * bolt or lightning bolt, `QueueSound(13, ...)` for anything else (skipping a
   * monster-death cloud, which is silent). Ordinals 5 and 20 both resolve to the
   * same SND item — a small blast is the same sample at a shorter falloff distance,
   * not a different one — so this used to substitute `SoundIndex.SPELL_EXPLODE`
   * (ordinal 13's sample) for the small case, turning a modest fireball into
   * whatever ordinal 13 sounds like instead of a quieter version of its own blast.
   */
  private playCloudSound(projectile: ObjectID, size: number, position: Position): void {
    if (projectile === RN_FIREBALL || projectile === RN_POISON || projectile === RN_LIGHTNING) {
      this.ctx.sounds.queueSound(size > 80 ? 5 : 20, position.x, position.y, 1);
      return;
    }
    if (projectile !== RN_MONSTER_DEATH) {
      this.ctx.sounds.queueSound(13, position.x, position.y, 1);
    }
  }

  /**
   * `DetermineMagicDamage` (`doc/CSBwin-src/Code11f52.cpp:1557`) — how hard a missile
   * lands, and the two globals that go with it.
   *
   * CSBWin returns the damage and leaves `d.Word12962` (a poison strength) and
   * `d.Word12964` (the `DamageCharacter` *kind*, which selects how armour and the
   * shields mitigate) behind in globals; they are returned together here because they
   * are one answer and reading them separately is how they get out of step.
   *
   * The three arms are not variations on one formula:
   *
   * - **A thrown weapon** contributes its `WEAPONDESC.uByte3`, anything else thrown a
   *   random 0-3, and both add half the object's weight. `kind` stays 3.
   * - **Poison cloud** (`RNPoison`) rolls 0-15, keeps that + 10 as the *poison
   *   strength*, and adds a further 0-31 to the damage.
   * - **A non-physical spell** (`>= RNDispellMissile`) sets `kind` 5 and returns
   *   early: 0 damage, except `RNPoisonBolt`, which returns **1** and carries the
   *   missile's whole remaining range as poison. That early return is why a dispel
   *   missile passes through a champion without hurting them.
   * - **Anything else magical** is `2×(0..15) + 10` at `kind` 1, quintupled at `kind`
   *   7 for lightning.
   *
   * The common tail then folds in the remaining range, adds two small random terms,
   * and floors the result at half itself — so a nearly spent missile still stings.
   *
   * Public because CSBWin's is a free function used by both the party and the monster
   * arm, and because `tools/dump-champion-death.ts` reads its three outputs directly —
   * none of them is observable from outside once the damage has been applied.
   */
  determineMagicDamage(
    missile: MissileRecord,
    projectile: ObjectID,
  ): { damage: number; kind: number; poisonStrength: number } {
    let poisonStrength = 0;
    let kind = 3;
    const range = missile.rangeRemaining & 0xff;
    // `if (object.IsMagicSpell()) dbType = dbCLOUD; else dbType = object.dbType();`
    const dbType = this.isMagicSpell(projectile)
      ? DBType.CLOUD
      : decodeObjectID(projectile as ObjectID).category;

    let d6: number;
    if (dbType !== DBType.CLOUD) {
      if (dbType === DBType.WEAPON) {
        d6 = this.ctx.systems.characterStats.weaponDescFor(projectile)?.uByte3 ?? 0;
        kind = 3;
      } else {
        d6 = this.random.zeroTo3();
      }
      d6 = sw(d6 + Math.trunc(this.ctx.systems.characterStats.getObjectWeight(projectile) / 2));
    } else if (projectile === RN_POISON) {
      d6 = this.random.next() & 15;
      poisonStrength = sw(d6 + 10);
      d6 = sw(d6 + this.random.below(32));
    } else if (isNonPhysicalSpellRn(projectile)) {
      kind = 5;
      if (projectile === RN_POISON_BOLT) return { damage: 1, kind, poisonStrength: range };
      return { damage: 0, kind, poisonStrength };
    } else {
      kind = 1;
      d6 = sw(this.random.below(16) + this.random.below(16) + 10);
      if (projectile === RN_LIGHTNING) {
        kind = 7;
        d6 = sw(5 * d6);
      }
    }

    d6 = sw(Math.trunc((d6 + range) / 16) + 1);
    const spread = this.random.below(Math.trunc(d6 / 2) + 1);
    d6 = sw(d6 + this.random.zeroTo3() + spread);
    // `D1W = 32 - damageRemaining/8; D6W = Larger(D6W/2, D6W-D1W)` — the floor at half
    // is what stops a long flight reducing the blow to nothing.
    const falloff = sw(32 - Math.trunc((missile.damageRemaining & 0xff) / 8));
    d6 = sw(Math.max(Math.trunc(d6 / 2), d6 - falloff));
    return { damage: d6, kind, poisonStrength };
  }

  private isMagicSpell(objectId: number): boolean {
    return isMagicSpellRn(objectId);
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
    this.moveObject(dropped, -2, 0, position.x, position.y, position.z);
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
      const moved = this.moveObject(rn as ObjectID, mapX, mapY, mapX, mapY, level);
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
          if (entry.object === undefined
            || withObjectPosition(entry.object as ObjectID, 0) !== withObjectPosition(rn as ObjectID, 0)) continue;
          entry.uByte6 = to.x & 0xff;
          entry.uByte7 = to.y & 0xff;
          entry.object = moved.placed;
          entry.level = to.z & 0xff;
        }
      }
    }
  }

  /**
   * Append the party's new square to the footprint trail.
   *
   * CSBWin does this inside `MoveObject` whenever the party is the thing being
   * moved and the party is non-empty (doc/CSBwin-src/Code11f52.cpp:3222-3247), so
   * it fires for every kind of relocation — walking, teleporters, pits, DSAs.
   */
  notePartyMoved(): void {
    if (this.ctx.party.state.champions.length === 0) return;
    const position = this.ctx.party.state.position;
    this.ctx.footprints.recordPartyMove(
      this.ctx.state.tickCount,
      position.z,
      position.x,
      position.y,
      this.ctx.party.state.magicFootprintsActive !== 0,
    );
  }

  private wiggleParty(position: Position): void {
    const party = this.ctx.party.state;
    const result = this.resolveCellEffects(position, -1, 0, party.facing, undefined, true);
    if (!result.moved) return;

    const oldPos = new Position(position.x, position.y, position.z);
    this.checkMoveFromMissile(oldPos, result.position, null);
    party.position = result.position;
    setPartyFacing(party, result.facing);

    const unchanged = this.isSamePosition(oldPos, result.position);
    if (!unchanged) this.notePartyMoved();
    this.ctx.systems.actuators.triggerObjectMove(oldPos, OBJECT_ID_NULL, false, unchanged, party.facing);
    this.ctx.systems.actuators.triggerObjectMove(result.position, OBJECT_ID_NULL, true, unchanged, party.facing);
  }

  resolvePartyMove(position: Position, facing: number): { position: Position; facing: number; moved: boolean } {
    const result = this.resolveCellEffects(position, -1, 0, facing, undefined, true);
    return { position: result.position, facing: result.facing & 0x3, moved: result.moved };
  }

  resolvePartyMoveWithTeleporter(
    position: Position,
    facing: number,
    teleporter: TeleporterRecord,
  ): { position: Position; facing: number; moved: boolean } {
    const result = this.resolveCellEffects(position, -1, 0, facing, undefined, true, undefined, teleporter);
    return { position: result.position, facing: result.facing & 0x3, moved: result.moved };
  }

  /**
   * `MoveObject(object, oldX, oldY, newX, newY, NULL, NULL)`
   * (`doc/CSBwin-src/Code11f52.cpp:2796-3457`) for anything that is not the party, on
   * level `level` (`d.LoadedLevel`, CSBWin's `AttachedLevel_4`). `oldX < 0` places an
   * object that lies nowhere, `newX < 0` lifts one without placing it.
   *
   * A monster may be lifted here — `CheckMoveFromMissile` on the party's level
   * (`:2847-2853`), then the removal (`:3258-3296`); nothing of the monster branch runs
   * for `newX < 0` (`:3297`). *Placing* a monster is that branch
   * (`:3327-3424`), which is `MonsterSystem.moveMonster`; it is refused here.
   *
   * What is placed goes through the teleporter / pit loop (`resolveCellEffects`); a
   * levitating thing — a missile, a flying monster — neither falls nor presses a pad
   * (`RemoveObjectFromRoom` / `AddObjectToRoom` instead of `PlaceOrRemoveObjectInRoom`,
   * `:3272-3274`, `:3427-3429`), and a cloud is not levitating (`Levitating`,
   * `:2417-2437`), so it falls. `PlaceOrRemoveObjectInRoom`'s `unchangedRoom` is whether
   * the party stands on the square (`:3278-3293`, `:3433-3448`). A teleporter turns an
   * object's corner only when `oldX != -1` (`:3000-3006`); stairs take anything but a
   * missile down and out, and turn its corner whatever `oldX` is (`:3108-3131`). The
   * missile's timer is its caller's business.
   *
   * Returns CSBWin's `1` as `removed` when `CheckMoveFromMissile` destroyed the group,
   * and otherwise the ID as it was placed and where, or `null` for a lift or an
   * unchanged room (`:3180-3215`). For a missile, `newDir` is `d.NewDir`: its timer's
   * direction as `TeleportMissile` left it (`:2878-2884`, `:2392-2411`).
   */
  moveObject(
    object: ObjectID,
    oldX: number,
    oldY: number,
    newX: number,
    newY: number,
    level: number,
  ): { removed: boolean; placed: ObjectID | null; position: Position | null; newDir?: number } {
    const decoded = decodeObjectID(object);
    const type = decoded.category;
    if (type === DBType.CREATURE && newX >= 0) {
      throw new Error('moveObject: placing a monster is MonsterSystem.moveMonster');
    }
    const party = this.ctx.party.state;
    const levitated = type === DBType.MISSILE
      || (type === DBType.CREATURE && this.isMonsterLevitating(this.dungeon.getCreatureRecord(object)));
    const partyOn = (x: number, y: number, z: number): boolean =>
      z === (party.position.z | 0) && x === (party.position.x | 0) && y === (party.position.y | 0);

    if (oldX >= 0 && type === DBType.CREATURE && level === (party.position.z | 0)) {
      const to = newX >= 0 ? new Position(newX, newY, level) : null;
      if (this.checkMonsterMoveFromMissile(new Position(oldX, oldY, level), to, object)) {
        return { removed: true, placed: null, position: null };
      }
    }

    let moved = object;
    let destination: Position | null = null;
    let newDir: number | undefined;
    if (newX >= 0) {
      let missileDir: number | undefined;
      if (type === DBType.MISSILE) {
        const missile = this.dungeon.getMissileRecord(object);
        const word8 = missile ? this.timers.getTimerWord8(missile.timerIndex) : null;
        if (word8 !== null) missileDir = decodeMissileTimerWord8(word8).dir;
      }
      const result = this.resolveCellEffects(
        new Position(newX, newY, level), type, decoded.position, party.facing, missileDir, !levitated, undefined, undefined, oldX,
      );
      destination = result.position;
      newDir = result.missileDir;
      const corner = result.objectPos & 0x3;
      moved = encodeObjectID(corner, type, decoded.index);
      const unchangedRoom = destination.z === level && destination.x === oldX && destination.y === oldY;
      if (unchangedRoom && corner === decoded.position && type !== DBType.MISSILE) {
        return { removed: false, placed: null, position: null };
      }
    }

    if (oldX >= 0) {
      const old = new Position(oldX, oldY, level);
      this.dungeon.removeObjectFromCell(old, object);
      if (!levitated) this.ctx.systems.actuators.triggerObjectMove(old, moved, false, partyOn(oldX, oldY, level), party.facing);
    }
    if (!destination) return { removed: false, placed: null, position: null };

    this.dungeon.addObjectToCell(destination, moved);
    if (type !== DBType.MISSILE) {
      this.ctx.systems.actuators.triggerObjectMove(
        destination, moved, true, partyOn(destination.x, destination.y, destination.z), party.facing,
      );
    }
    return { removed: false, placed: moved, position: destination, newDir };
  }

  /**
   * The loop of `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2896-3131`) for a monster,
   * for `MonsterSystem.moveMonster`: the destination taken through teleporter chains, pit
   * falls and stairs by the same `resolveCellEffects` the party and every object go through.
   *
   * `oldX, oldY` on `level` is where the group stands (`oldX < 0`: it is being placed
   * from nowhere). Its `ITEM16` is attached when that is the party's level and the group
   * is in the dungeon (`item16Attached`, `:2864`), and every teleporter of a chain
   * rotates the group through that `ITEM16`, however far the chain has taken it (`:2988`).
   *
   * The result is CSBWin's locals at the end of the loop:
   *
   * - `code` is `LOCAL_14`, set only by `TeleportMonster` (`:2988`): `groupIndex + 2`
   *   for a fear-state-6 group on the party's level, 1 for any other teleport, 0 when
   *   none happened. A pit fall leaves it alone.
   * - `audible` is `LOCAL_26`, whether the last teleporter buzzed (`:2965`).
   * - `groupDied` is `LOCAL_18` (`:3099-3100`): the fall killed the whole group, and
   *   the loop stopped at the square below.
   */
  resolveMonsterDestination(
    destination: Position,
    monsterRn: ObjectID,
    oldX: number,
    oldY: number,
  ): { position: Position; code: number; audible: boolean; groupDied: boolean } {
    const rec = this.dungeon.getCreatureRecord(monsterRn);
    const decoded = decodeObjectID(monsterRn);
    const canFall = !this.isMonsterLevitating(rec);
    const facing = rec?.facing ?? 0;
    const partyLevel = this.ctx.party.state.position.z;
    const item16Attached = destination.z === partyLevel && oldX >= 0;
    const result = this.resolveCellEffects(
      destination,
      DBType.CREATURE,
      decoded.position & 0x3,
      facing,
      undefined,
      canFall,
      rec ? { record: rec, oldX, oldY, attachedLevel: destination.z, noItem16: !item16Attached } : undefined,
    );
    return {
      position: result.position,
      code: result.teleportCode,
      audible: result.teleportAudible,
      groupDied: result.groupDied,
    };
  }

  /**
   * Set by `checkMoveFromMissile` when the encounter destroyed the group that was
   * being moved — CSBWin's `return 1` from `CheckMoveFromMissile`.
   */
  private movedObjectWasDestroyed = false;

  /**
   * `CheckMonsterVersusMissiles` (`doc/CSBwin-src/Monster.cpp:4462`).
   *
   * A monster shuffling to a different corner of its cell may walk onto a missile
   * that is sitting in the corner it is moving to. Resolves every missile at that
   * position, stopping early if the group is wiped out.
   *
   * Returns true when the whole group died, which is what the caller needs in order
   * to abandon the rest of the turn.
   */
  checkMonsterVersusMissiles(mapX: number, mapY: number, position: number, level: number): boolean {
    this.monsterDamageResult = MonsterDamageResult.NO_MONSTER_DIED;
    const cell = new Position(mapX, mapY, level);

    // Restart the scan after each hit: resolving one missile mutates the cell chain.
    for (let guard = 0; guard < 64; guard++) {
      let hitSomething = false;
      for (
        let rn = this.dungeon.findFirstObject(cell);
        rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
        rn = this.dungeon.getDBRecordLink(rn)
      ) {
        const decoded = decodeObjectID(rn);
        if (decoded.category !== DBType.MISSILE) continue;
        if ((decoded.position & 0x3) !== (position & 0x3)) continue;
        const missile = this.dungeon.getMissileRecord(rn);
        const timerIndex = missile?.timerIndex;
        if (this.processMissileEncounter(-1, mapX, mapY, mapX, mapY, position & 0x3, rn)) {
          if (timerIndex !== undefined) this.timers.deleteTimer(timerIndex);
          hitSomething = true;
          break;
        }
      }
      if (!hitSomething) break;
      if (this.groupWasWipedOut()) break;
    }
    return this.groupWasWipedOut();
  }

  /** `CheckMoveFromMissile` for a monster leaving a square. */
  checkMonsterMoveFromMissile(from: Position, to: Position | null, monsterRn: ObjectID): boolean {
    this.movedObjectWasDestroyed = false;
    this.monsterDamageResult = MonsterDamageResult.NO_MONSTER_DIED;
    this.checkMoveFromMissile(from, to, monsterRn);
    return this.movedObjectWasDestroyed;
  }

  private resolveCellEffects(
    start: Position,
    objectType: number,
    objectPos: number,
    facing: number,
    missileDir: number | undefined,
    allowFall: boolean,
    monster?: MonsterMove,
    pretendTeleporter?: TeleporterRecord,
    /** `MoveObject`'s `oldX`: -1 keeps an item's corner through a teleporter (`:3000-3006`). */
    oldX?: number,
  ): {
    position: Position;
    objectPos: number;
    facing: number;
    missileDir?: number;
    moved: boolean;
    teleportAudible: boolean;
    /** `LOCAL_14`: `TeleportMonster`'s value for the last teleport, else 0. */
    teleportCode: number;
    /** `LOCAL_18`: a pit fall killed the whole group. */
    groupDied: boolean;
  } {
    let position = new Position(start.x, start.y, start.z);
    let curFacing = facing & 0x3;
    let curPos = objectPos & 0x3;
    let curDir = missileDir;
    let moved = false;
    let teleportCode = 0;
    let groupDied = false;
    // `LOCAL_26 = DB1A2->audible()` — remembered because it decides TT_60 vs TT_61
    // if the monster then has to wait for its destination (Code11f52.cpp:2965).
    let teleportAudible = false;
    let forcedTeleporter = pretendTeleporter ?? null;

    for (let step = 0; step < 1000; step++) {
      const teleporter = forcedTeleporter ?? this.getActiveTeleporterAt(position);
      if (forcedTeleporter) forcedTeleporter = null;
      const canTeleport = objectType < 0 || objectType >= DBType.CREATURE;
      if (teleporter && canTeleport && this.teleporterAllowsObject(teleporter, objectType)) {
        const destination = this.getTeleporterDestination(teleporter);
        if (!destination) break;

        const rotation = teleporter.rotation & 0x3;
        const prev = position;

        if (objectType === -1) {
          curFacing = teleporter.absoluteRotation ? rotation : (curFacing + rotation) & 0x3;
          teleportAudible = teleporter.sound;
          if (teleporter.sound) {
            const distance = this.getPartyDistance(position.x, position.y, position.z);
            if (distance !== null) this.ctx.host.playSound(SoundIndex.TELEPORT, 0, distance);
          }
        } else if (objectType === DBType.MISSILE) {
          if (teleporter.absoluteRotation) {
            curDir = rotation;
          } else {
            curDir = ((curDir ?? 0) + rotation) & 0x3;
            curPos = (curPos + rotation) & 0x3;
          }
        } else if (objectType === DBType.CREATURE) {
          const result = monster ? this.teleportMonster(monster, teleporter) : null;
          if (result) {
            curFacing = result.facing & 0x3;
            teleportCode = result.code;
            teleportAudible = teleporter.sound;
            if (teleporter.sound) {
              const distance = this.getPartyDistance(position.x, position.y, position.z);
              if (distance !== null) this.ctx.host.playSound(SoundIndex.TELEPORT, 1, distance);
            }
          } else {
            curFacing = teleporter.absoluteRotation ? rotation : (curFacing + rotation) & 0x3;
            teleportAudible = teleporter.sound;
            if (teleporter.sound) {
              const distance = this.getPartyDistance(position.x, position.y, position.z);
              if (distance !== null) this.ctx.host.playSound(SoundIndex.TELEPORT, 1, distance);
            }
          }
        } else {
          if (!teleporter.absoluteRotation && oldX !== -1) {
            curPos = (curPos + rotation) & 0x3;
          }
        }

        position = destination;
        moved = true;
        if (this.isSamePosition(prev, position)) break;
        continue;
      }

      if (allowFall && this.isActivePitAt(position)) {
        // `PitGoesSomewhere` (`doc/CSBwin-src/Code11f52.cpp:2777`) is exactly this
        // test: a pit with nothing under it is not a pit.
        const next = this.dungeon.incrementLevel(position, 1);
        if (!next) break;
        position = next;
        moved = true;
        // The fall hurts (`doc/CSBwin-src/Code11f52.cpp:3053-3106`). A group is hurt
        // at `oldX, oldY`, where it is still linked: nothing has moved in the database yet.
        if (objectType === -1) this.partyFallsIntoPit();
        else if (objectType === DBType.CREATURE && monster) {
          const hurt = this.monsterFallsIntoPit(monster);
          groupDied = hurt === MonsterDamageResult.ALL_MONSTERS_DIED;
          if (groupDied) break;
          if (hurt === MonsterDamageResult.SOME_NOT_ALL_MONSTERS_DIED) {
            this.ctx.systems.monsterDamage.flushPendingDroppings(monster.record.creatureType, position.z, position.x, position.y);
          }
        }
        continue;
      }

      // The stairs (`:3108-3131`): a monster or an object — not the party, not a missile
      // — goes one level down unless bit 2 says the stairs go up, then one square out
      // through `ExitStairsDirection`, its corner turned to face the stairs. The loop
      // goes on from the square it lands on.
      const cellFlag = this.dungeon.getCellFlag(position);
      if (((cellFlag >> 5) & 0x7) === RoomType.STAIRS && objectType >= DBType.CREATURE && objectType !== DBType.MISSILE) {
        if ((cellFlag & 0x04) === 0) {
          // `IncrementLevel` finds no level only in a malformed dungeon, where CSBWin would
          // `LoadLevel(-1)`; the object stays on the stairs instead.
          const below = this.dungeon.incrementLevel(position, 1);
          if (!below) break;
          position = below;
        }
        const exit = this.dungeon.getExitStairsDirection(position, this.ctx.party.state.facing as Direction);
        position = new Position(position.x + DELTA_X[exit]!, position.y + DELTA_Y[exit]!, position.z);
        const back = (exit + 2) & 0x3;
        curPos = ((((curPos - back + 1) & 2) >> 1) + back) & 0x3;
        moved = true;
        continue;
      }

      break;
    }

    return {
      position, objectPos: curPos, facing: curFacing, missileDir: curDir, moved, teleportAudible, teleportCode, groupDied,
    };
  }

  private getActiveTeleporterAt(position: Position): TeleporterRecord | null {
    const map = this.dungeon.getMap(position.z);
    if (!map) return null;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return null;
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType !== RoomType.TELEPORTER) return null;
    if ((cellFlag & 0x08) === 0) return null;

    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.TELEPORTER) continue;
      return this.dungeon.getTeleporterRecord(rn);
    }

    return null;
  }

  private getTeleporterDestination(teleporter: TeleporterRecord): Position | null {
    const destLevel = teleporter.destMap & 0xff;
    const destX = teleporter.destX & 0x1f;
    const destY = teleporter.destY & 0x1f;

    for (let idx = 0; idx < this.dungeon.getMapCount(); idx++) {
      const map = this.dungeon.getMap(idx as number);
      if (!map) continue;
      const desc = map.descriptor;
      if (desc.level !== destLevel) continue;
      if (destX < 0 || destY < 0) continue;
      if (destX >= desc.width || destY >= desc.height) continue;
      return new Position(destX, destY, idx as number);
    }

    return null;
  }

  private teleporterAllowsObject(teleporter: TeleporterRecord, objectType: number): boolean {
    const scope = teleporter.scope & 0x3;
    if (objectType === -1) return scope === 2 || scope === 3;
    if (objectType === DBType.CREATURE) return scope === 1 || scope === 3;
    return scope === 0 || scope === 2 || scope === 3;
  }

  /**
   * `d.SupressPitDamage` (`doc/CSBwin-src/Data.h:790`) — set for the length of one
   * deliberate climb down a rope, which costs stamina instead of blood.
   */
  private supressPitDamage = false;

  /** Run `move` with `d.SupressPitDamage` set, as `atk_CLIMBDOWN` does. */
  withSupressedPitDamage<T>(move: () => T): T {
    this.supressPitDamage = true;
    try {
      return move();
    } finally {
      this.supressPitDamage = false;
    }
  }

  /**
   * The party falls (`doc/CSBwin-src/Code11f52.cpp:3057-3086`).
   *
   * A climb down costs each living champion stamina in proportion to how loaded they
   * are — `25 * load / MaxLoad + 1` — which `AdjustStamina` turns into real damage
   * only if it exhausts them. An uncontrolled fall is `DamageAllCharacters(20, 48, 2)`
   * instead: mask 48 is the legs and feet, kind 2 halves the armour.
   *
   * CSBWin clears the flag here, not at the call site, because one climb can fall
   * through a whole chain of pits and only the first drop is free.
   */
  private partyFallsIntoPit(): void {
    const party = this.ctx.party.state;
    if (party.champions.length === 0) return;

    if (this.supressPitDamage) {
      for (let chIdx = 0; chIdx < party.champions.length; chIdx++) {
        const champ = party.champions[chIdx];
        if (!champ) continue;
        if ((champ.attributes?.health ?? 0) === 0) continue;
        const maxLoad = this.ctx.systems.characterStats.maxLoad(champ);
        if (maxLoad <= 0) continue;
        const load = this.ctx.systems.characterStats.characterLoad(champ);
        // `(25 * load) & 0xffff` first — CSBWin does the multiply in a word.
        const cost = Math.trunc(((25 * load) & 0xffff) / maxLoad) + 1;
        this.ctx.systems.monsterAttack.adjustStamina(chIdx, cost);
      }
    } else {
      const hurt = this.ctx.systems.monsterAttack.damageAllCharacters(20, 48, 2);
      if (hurt !== 0) {
        this.ctx.sounds.queueSound(6, party.position.x, party.position.y, 0);
      }
    }
    this.supressPitDamage = false;
  }

  /**
   * A monster group falls (`doc/CSBwin-src/Code11f52.cpp:3088-3104`):
   * `DamageMonsterGroup(pDB4, oldX, oldY, 20, 0, !item16Attached)` on the level its
   * `ITEM16` belongs to. `P5 = 0` defers the last member's death to `MoveObject`, which
   * deletes the group after the loop, and a dead member's droppings to `TAG00b522`,
   * which drops them where the group landed. A group placed from nowhere (`oldX < 0`)
   * is hurt at `(-1, 0)`, so its death clouds are not made (`CreateCloud`, `:1400`).
   */
  private monsterFallsIntoPit(monster: MonsterMove): number {
    return this.ctx.systems.monsterDamage.damageMonsterGroup(
      monster.record, monster.attachedLevel, monster.oldX, monster.oldY, 20, false, monster.noItem16,
    );
  }

  private isActivePitAt(position: Position): boolean {
    const map = this.dungeon.getMap(position.z);
    if (!map) return false;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return false;
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType !== RoomType.PIT) return false;
    if ((cellFlag & 0x08) === 0) return false;
    return (cellFlag & 0x01) === 0;
  }

  private isMonsterLevitating(rec: CreatureRecord | null): boolean {
    if (!rec) return false;
    const desc = this.ctx.tables.monsterDesc[rec.creatureType];
    if (!desc) return false;
    return monsterLevitating(desc);
  }

  private isSamePosition(a: Position, b: Position): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
  }

  /**
   * `TeleportMonster` (`doc/CSBwin-src/Code11f52.cpp:2308-2387`) — turn the group, and
   * each member's corner, as the teleporter says. The facing and position bytes are
   * the `ITEM16`'s unless `noItem16`, whatever level the chain has reached: CSBWin
   * passes `AttachedLevel_4` and `!item16Attached` for every teleporter (`:2988`).
   *
   * Returns `groupIndex() + 2` for a fear-state-6 group whose attached level is the
   * party's — read after the write, so with `noItem16` it is the new position byte —
   * and 1 otherwise. Whether the monster may live on the destination level is not
   * this function's business: `MoveObject` asks after the loop (`:3147`).
   */
  private teleportMonster(
    move: MonsterMove,
    teleporter: TeleporterRecord,
  ): { facing: number; code: number } {
    const monster = move.record;
    const item16 = move.noItem16 ? null : this.getMonsterItem16(monster, move.attachedLevel);
    const useItem16 = item16 !== null;
    const rotation = teleporter.rotation & 0x3;
    const absolute = teleporter.absoluteRotation;

    let facings = useItem16 ? (item16!.facings & 0xff) : this.encodeFacingByte(monster.facing);
    let positions = useItem16 ? (item16!.positions & 0xff) : (monster.groupIndex & 0xff);

    let newFacings = absolute ? rotation : (facings + rotation) & 0x3;
    let newPositions = positions;

    if (positions !== 0xff) {
      const desc = this.ctx.tables.monsterDesc[monster.creatureType];
      const horizontalSize = desc ? monsterHorizontalSize(desc) : 0;
      const numMonM1 = monster.numMonM1 & 0x3;
      let facingShift = facings & 0xff;
      let posShift = positions & 0xff;
      let posDelta = (newFacings + 4 - facingShift) & 0x3;

      for (let idx = 0; idx <= numMonM1; idx++) {
        const facingValue = absolute ? rotation : (facingShift + rotation) & 0x3;
        newFacings = this.setPackedBits(newFacings, idx, facingValue);

        if (horizontalSize === 0) {
          posDelta = absolute ? 0 : 1;
          if (posDelta !== 0) posDelta = rotation;
        }

        if (posDelta !== 0) {
          const newPos = (posShift + posDelta) & 0x3;
          newPositions = this.setPackedBits(newPositions, idx, newPos);
        }

        facingShift >>= 2;
        posShift >>= 2;
      }
    }

    if (useItem16) {
      item16!.facings = newFacings & 0xff;
      if (positions !== 0xff) item16!.positions = newPositions & 0xff;
    } else {
      monster.facing = newFacings & 0x3;
      // With no ITEM16 attached, `groupIndex` is the packed positions byte.
      if (positions !== 0xff) monster.groupIndex = newPositions & 0xff;
    }

    const partyLevel = this.ctx.party.state.position.z;
    const code = move.attachedLevel === partyLevel && monster.fear === StateOfFear.StateOfFear6
      ? monster.groupIndex + 2
      : 1;
    return { facing: newFacings & 0x3, code };
  }

  private getMonsterItem16(monster: CreatureRecord, level: number): Item16Record | null {
    const partyLevel = this.ctx.party.state.position.z;
    if (level !== partyLevel) return null;
    return this.dungeon.getAttachedItem16(monster);
  }

  private encodeFacingByte(facing: number): number {
    const face = facing & 0x3;
    return (face | (face << 2) | (face << 4) | (face << 6)) & 0xff;
  }

  private setPackedBits(value: number, index: number, bits: number): number {
    const shift = (index & 0x3) * 2;
    const mask = 0x3 << shift;
    return (value & ~mask) | ((bits & 0x3) << shift);
  }

  /** `d.ObjDesc[object.DescIndex()].word4` — where the object may be carried. */
  private objDescWord4(rn: ObjectID): number {
    const descIndex = DescIndex(this.dungeon, rn);
    return descIndex === -1 ? 0 : this.ctx.tables.objDescWord4[descIndex] ?? 0;
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
