/**
 * A square of the dungeon in words: what it is, where it leads, what lies on it, what its
 * actuators need and act on, what acts on it, and where the objects its locks need are.
 * The map dialog shows it beside the map (`src/renderer/ui/MapDialog.ts`), and
 * `tools/peek-dungeon.ts` prints the same words. It is the port's own, as the map is, but
 * every rule it states is CSBWin's, cited where the words are made; where a meaning is
 * not certain, it says nothing rather than guess.
 *
 * A square is named by its map's index and its column and row on that map, as actuator
 * targets, timers and `peek-dungeon` count them; a level is named as the player counts
 * it, `L1` the dungeon's first (the descriptor counts from 0).
 *
 * The text is in sentence case; the map dialog folds it to the font's capitals.
 */
import { OBJNI_NOT_AN_OBJECT } from '../core/objectNameIndex';
import {
  DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, getRoomType, locationRelFromInteger, type ObjectID,
} from '../core/types';
import {
  ActuatorAction,
  getActuatorAction,
  getActuatorDelay,
  getActuatorDisableTime,
  getActuatorDsaSelector,
  getActuatorDsaState,
  getActuatorParameterA,
  getActuatorParameterB,
  getActuatorState,
  getActuatorTargetPos,
  getActuatorTargetX,
  getActuatorTargetY,
  getActuatorType,
  getActuatorValue,
  isActuatorLocalActionOnly,
  isActuatorNormallyClosed,
  isActuatorOnceOnly,
  PORTRAIT_INACTIVE,
} from '../data/actuatorHelpers';
import { readHeroText, type HeroText } from '../data/HeroExtractor';
import type {
  ActuatorRecord, ContainerRecord, CreatureRecord, DoorRecord, TeleporterRecord, TextRecord,
} from '../data/dungeonTypes';
import { dsaTargets, type DsaTargets, type DsaValue } from './DsaTargets';
import type { DungeonState } from './DungeonState';
import type { GameTables } from './GameTables';
import { MonsterType } from './monsterTypes';
import { GetBasicObjectType, NameIndex } from './objectIndex';
import { TimerFunction, type TimerEntry } from './TimerQueue';

/** A square: its map's index, its column and its row. */
export interface CellRef {
  readonly map: number;
  readonly x: number;
  readonly y: number;
}

/** One line of a square's info: `indent` steps in, and the square it names, if any. */
export interface InfoLine {
  readonly text: string;
  readonly indent: number;
  readonly link?: CellRef;
}

/** The party, where the info reads it: its square, its facing and what it carries. */
export interface CellInfoParty {
  readonly position: Position;
  readonly facing: number;
  readonly champions: readonly { readonly possessions: readonly ObjectID[] }[];
  readonly objectInHand: ObjectID;
}

export interface CellInfoSource {
  readonly dungeon: DungeonState;
  readonly tables: GameTables;
  /** The objects' names, by `OBJ_NAME_INDEX`. */
  readonly objectNames: readonly string[];
  readonly party: CellInfoParty | null;
  /**
   * The game's clock: its live timers and `d.Time` (`ctx.state.tickCount`), which tell a
   * resting generator from a ready one. None for a dungeon read alone, whose generators
   * are all ready.
   */
  readonly clock?: CellInfoClock;
}

/** What the info reads of the timers: a timer's square, its time and its object. */
export interface CellInfoClock {
  readonly timers: readonly Pick<TimerEntry, 'function' | 'time' | 'level' | 'uByte6' | 'uByte7' | 'object'>[];
  readonly time: number;
}

/**
 * What the map dialog can mark on a level: the squares with a monster generator, with a
 * group of monsters, or with an item, as their info lists them.
 */
export type CellMark = 'generator' | 'monster' | 'item';

/** A wall's four sides, by the actuator's corner: the side the party faces it from. */
const SIDES = ['N', 'E', 'S', 'W'] as const;

/** The most places an object needed is listed at, before "and n more". */
export const MAX_PLACES = 6;

/* ------------------------------------------------------------------ the square ---- */

/**
 * The flag byte's attribute bits, as `CSBTypes.h` documents them per room type
 * (`doc/CSBwin-src/CSBTypes.h:182-214`); open floor's bit 3 is the random floor
 * decoration (`doc/CSBWIN_DECORATIONS_REFERENCE.md`). Every bit, for `peek-dungeon`.
 */
export function describeFlag(flag: number): string {
  const type = (flag >> 5) & 7;
  const a = flag & 0xf;
  const bits = (pairs: [number, string][]): string => pairs.filter(([b]) => a & b).map(([, s]) => s).join(', ') || 'none';
  const room = RoomType[type] ?? `type ${type}`;
  const objects = flag & 0x10 ? ', has objects' : '';
  switch (type) {
    case RoomType.STONE: return `${room}${objects}; random decoration on ${bits([[1, 'W'], [2, 'S'], [4, 'E'], [8, 'N']])}`;
    case RoomType.OPEN: return `${room}${objects}; ${a & 8 ? 'random floor decoration allowed' : 'no random floor decoration'}`;
    case RoomType.PIT: return `${room}${objects}; ${a & 8 ? 'open' : 'closed'}${a & 1 ? ', false' : ''}${a & 4 ? ', obscure' : ''}`;
    case RoomType.STAIRS: return `${room}${objects}; ${a & 4 ? 'up' : 'down'}, ${a & 8 ? 'N/S' : 'E/W'}`;
    case RoomType.DOOR: return `${room}${objects}; state ${a & 7} (${DOOR_STATES[a & 7] ?? '?'}), ${a & 8 ? 'N/S' : 'E/W'}`;
    case RoomType.TELEPORTER: return `${room}${objects}; ${a & 8 ? 'active' : 'inactive'}, ${a & 4 ? 'visible' : 'invisible'}`;
    case RoomType.FALSEWALL: return `${room}${objects}; ${a & 4 ? 'open' : 'closed'}${a & 1 ? ', imaginary' : ''}`;
    default: return `${room}${objects}; attributes ${a.toString(2).padStart(4, '0')}`;
  }
}

const DOOR_STATES = ['open', 'almost open', 'half open', 'almost closed', 'closed', 'bashed'];

/**
 * The square in a few words, from the same bits as `describeFlag`: a pit that is false
 * lets nothing fall even open, an obscure one is hard to see; a false wall open lets the
 * party through unseen, an imaginary one is seen and lets it through.
 */
export function squareWords(flag: number): string {
  const a = flag & 0xf;
  switch (getRoomType(flag)) {
    case RoomType.STONE: return 'Wall';
    case RoomType.OPEN: return 'Floor';
    case RoomType.PIT:
      return `${a & 8 ? 'Open' : 'Closed'} ${a & 1 ? 'false ' : ''}pit${a & 4 ? ', hidden' : ''}`;
    case RoomType.STAIRS: return `Stairs ${a & 4 ? 'up' : 'down'}`;
    case RoomType.DOOR: return `Door, ${DOOR_STATES[a & 7] ?? `state ${a & 7}`}`;
    case RoomType.TELEPORTER: return `Teleporter, ${a & 8 ? 'on' : 'off'}${a & 4 ? '' : ', invisible'}`;
    case RoomType.FALSEWALL: return a & 4 ? 'False wall, open' : a & 1 ? 'False wall, imaginary' : 'False wall';
    default: return `Room type ${getRoomType(flag)}`;
  }
}

/* ------------------------------------------------------------------- actuators ---- */

/**
 * What presses an actuator, in words, and the object type it compares its value with
 * (`GetBasicObjectType`), or null for a type that compares none. The same type means
 * different things on a floor and in a wall: a pad is judged by `PressurePadOrAlcove`
 * (`doc/CSBwin-src/Code11f52.cpp:3720`), a wall by `TouchWall` when clicked
 * (`doc/CSBwin-src/Mouse.cpp:291`) and by `PressurePadOrAlcove` when something is put in
 * its alcove. A generator and the launchers are only acted on (`doc/CSBwin-src/CSB.h:930-1048`).
 * A normally closed actuator fires on the opposite outcome. Null for a type with no words.
 */
export function actuatorTrigger(
  a: ActuatorRecord, room: number, names: (objNI: number) => string,
): { words: string; objectType: number | null } | null {
  const value = getActuatorValue(a);
  const type = getActuatorType(a);
  const name = withArticle(names(value));
  if (room === RoomType.OPEN) {
    switch (type) {
      case 1: return { words: 'Pad: party, monster or item', objectType: null };
      case 2: return { words: 'Pad: party or monster', objectType: null };
      case 3:
        return { words: value === 0 ? 'Pad: the party' : `Pad: the party facing ${SIDES[(value - 1) & 3]}`, objectType: null };
      case 4: return { words: `Pad: ${name} put on it`, objectType: value };
      case 6: return { words: generatorWords(a), objectType: null };
      case 7: return { words: 'Pad: a monster', objectType: null };
      case 8: return { words: `Pad: the party carrying ${name}`, objectType: value };
      case 9: return { words: 'Pad: the party stepping on', objectType: null };
      default: return null;
    }
  }
  if (room === RoomType.STONE) {
    switch (type) {
      case 1: return { words: 'Switch', objectType: null };
      case 2: return { words: `Switch: click holding anything; alcove: ${name}`, objectType: value };
      case 3: return { words: `Switch: click with ${name}, kept`, objectType: value };
      case 4: case 11: return { words: `Lock: ${name}, taken`, objectType: value };
      case 5: return { words: 'Combination: fires when its bits match', objectType: null };
      case 6: return { words: `Counter at ${value}, fires at 0`, objectType: null };
      case 7: case 9: case 14: case 15: return { words: 'Missile launcher', objectType: null };
      case 8: case 10: return { words: 'Spell launcher', objectType: null };
      case 12: return { words: 'Gives an item to an empty hand', objectType: null };
      case 13: return { words: `Holder: ${name}`, objectType: value };
      case 16: return { words: `Swaps ${name} in hand for what is here`, objectType: value };
      case 17: return { words: `Lock: ${name}, taken, then gone`, objectType: value };
      case 127: return { words: 'Champion mirror', objectType: null };
      default: return null;
    }
  }
  return null;
}

/**
 * A monster generator, as a timer on its square fires it (`doc/CSBwin-src/Timer.cpp:1771-1820`):
 * `CreateMonster` takes the value's low five bits as the monster type
 * (`doc/CSBwin-src/Monster.cpp:130`); the delay is the count, or with its bit 3 a random
 * count of 1 to its low three bits; a normally closed one makes them invisible. Then a
 * once-only generator is spent, and one with a disable time rests that many ticks, 64 per
 * step past 126 from 128 on.
 */
function generatorWords(a: ActuatorRecord): string {
  const delay = getActuatorDelay(a);
  const count = (delay & 8) !== 0 ? `1 to ${delay & 7}` : String(delay);
  const invisible = isActuatorNormallyClosed(a) ? ', invisible' : '';
  const disable = getActuatorDisableTime(a);
  const rest = isActuatorOnceOnly(a) ? ', once'
    : disable === 0 ? '' : `, then off ${disable >= 128 ? 64 * (disable - 126) : disable} ticks`;
  return `Generator: ${count} x ${monsterName(getActuatorValue(a) & 0x1f)}${invisible}${rest}`;
}

/**
 * Whether an actuator sends its action to its target, so that `word6` is a target:
 * the pads `PressurePadOrAlcove` judges (`doc/CSBwin-src/Code11f52.cpp:3720`), the walls
 * `TouchWall` presses (`doc/CSBwin-src/Mouse.cpp:291`), and the counter and the
 * combination a timer turns (`OperateCounterActuator`, `doc/CSBwin-src/Timer.cpp:1603`),
 * each through `QueueSwitchAction` (`doc/CSBwin-src/Code11f52.cpp:3601`), which sends it
 * to the target on its own level. A local action has no target, and a generator's or a
 * launcher's `word6` is its disable time or its energy (`doc/CSBwin-src/CSB.h:1014-1023`).
 */
export function actuatorHasTarget(a: ActuatorRecord, room: number): boolean {
  if (isActuatorLocalActionOnly(a)) return false;
  const type = getActuatorType(a);
  if (room === RoomType.OPEN) return [1, 2, 3, 4, 7, 8, 9].includes(type);
  if (room === RoomType.STONE) return [1, 2, 3, 4, 5, 6, 11, 12, 13, 16, 17].includes(type);
  return false;
}

/**
 * What an action does to a square of `room`: SET opens a door (`ProcessTT_DOOR`,
 * `doc/CSBwin-src/Timer.cpp:1556`), a pit (`ProcessTT_PITROOM`, `:2520`) and a false wall
 * (`ProcessTT_FALSEWALL`, `:1390`), and turns a teleporter on (`ProcessTT_TELEPORTER`,
 * `:2390`); CLEAR does the opposite. On a wall or a floor it is handed to what is there.
 */
const VERBS: Readonly<Record<number, readonly [string, string, string]>> = {
  [RoomType.DOOR]: ['opens', 'closes', 'opens or closes'],
  [RoomType.PIT]: ['opens', 'closes', 'opens or closes'],
  [RoomType.FALSEWALL]: ['opens', 'closes', 'opens or closes'],
  [RoomType.TELEPORTER]: ['turns on', 'turns off', 'turns on or off'],
  [RoomType.STONE]: ['sets', 'clears', 'toggles'],
  [RoomType.OPEN]: ['sets', 'clears', 'toggles'],
};

const ROOM_NOUNS: Readonly<Record<number, string>> = {
  [RoomType.DOOR]: 'door', [RoomType.PIT]: 'pit', [RoomType.FALSEWALL]: 'false wall',
  [RoomType.TELEPORTER]: 'teleporter', [RoomType.STONE]: 'wall', [RoomType.OPEN]: 'floor',
};

/**
 * An actuator's action on the square it targets, `target` that square's flag byte. A
 * switch is closed when pressed, or when released if normally closed, and acts when
 * closed; a CONSTPRESSURE sends SET when closed and CLEAR when open, so a normally closed
 * one clears while pressed (`PressurePadOrAlcove`, `doc/CSBwin-src/Code11f52.cpp:3878-3895`). On a wall it is sent to one side
 * (`QueueSwitchAction`, `:3601`). Null for a target that takes no action, stairs.
 */
export function actuatorEffect(a: ActuatorRecord, target: number): string | null {
  const room = getRoomType(target);
  const verbs = VERBS[room];
  if (!verbs) return null;
  const action = getActuatorAction(a);
  const held = action === ActuatorAction.CONSTPRESSURE;
  const closed = isActuatorNormallyClosed(a);
  const verb = held ? verbs[closed ? 1 : 0] : verbs[action]!;
  const side = room === RoomType.STONE ? ` ${SIDES[getActuatorTargetPos(a)]} side` : '';
  const when = held ? ' while pressed' : closed ? ' at release' : '';
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${ROOM_NOUNS[room]}${side}${when}`;
}

/* --------------------------------------------------------------------- the info ---- */

/** An actuator aimed at a square: where it is. */
interface Sender {
  readonly rn: ObjectID;
  readonly x: number;
  readonly y: number;
  readonly room: number;
}

/** A square a DSA's programs name, and what they do there. */
interface DsaUse {
  readonly words: string;
  readonly at: CellRef;
}

/** A DSA naming a square: where it is, its words, and what it does to that square. */
interface DsaSender extends CellRef {
  readonly side: string;
  readonly script: string;
  readonly words: string[];
}

/** Where an object lies, and in what. */
interface Place extends CellRef {
  readonly where: string;
}

/**
 * The info of the squares of one dungeon. The indexes it builds (what aims at each
 * square, where each object type lies) are built at their first use and kept: a dialog
 * makes one per opening, while the clock is held.
 */
export class CellInfo {
  private readonly senders = new Map<number, Map<number, Sender[]>>();
  private places: Map<number, Place[]> | null = null;
  private arrivals: Map<string, CellRef[]> | null = null;
  private resting: Map<number, number> | null = null;
  private readonly dsaPrograms = new Map<number, DsaTargets>();
  private dsaSenders: Map<string, DsaSender[]> | null = null;
  private readonly marks = new Map<string, Set<number>>();

  constructor(private readonly source: CellInfoSource) {}

  /** A level, counted from 0 as the map's descriptor counts it, and a square on it: `L3 (12,7)`. */
  levelName(map: number): string {
    return `L${this.source.dungeon.getMap(map)?.descriptor.level ?? map}`;
  }

  /** The info of the square `at`, a line at a time. */
  describe(at: CellRef): InfoLine[] {
    const { dungeon } = this.source;
    const map = dungeon.getMap(at.map);
    if (!map || at.x < 0 || at.y < 0 || at.x >= map.descriptor.width || at.y >= map.descriptor.height) return [];
    const flag = map.cellFlags[at.x]![at.y]!;
    const room = getRoomType(flag);
    const objects = [...this.chain(dungeon.findFirstObject(new Position(at.x, at.y, at.map)))];
    const rotator = room === RoomType.TELEPORTER && objects.some((rn) => this.sendsHome(at, rn));
    const words = rotator ? squareWords(flag).replace('Teleporter', 'Rotator') : squareWords(flag);
    const out: InfoLine[] = [{ text: `(${at.x},${at.y}) ${words}`, indent: 0 }];
    const party = this.source.party;
    if (party && party.position.z === at.map && party.position.x === at.x && party.position.y === at.y) {
      out.push({ text: 'The party is here', indent: 0 });
    }

    this.leads(at, flag, out);
    for (const rn of objects) {
      const category = dungeon.rnMaps.dbType(rn);
      if (category === DBType.DOOR) this.door(rn, out);
      if (category === DBType.TELEPORTER) this.teleporter(at, rn, out);
    }
    for (const rn of objects) {
      if (dungeon.rnMaps.dbType(rn) === DBType.ACTUATOR) this.actuator(at, rn, room, out);
    }
    const record = room === RoomType.STONE ? undefined : objects.find((rn) => dungeon.rnMaps.dbType(rn) === DBType.TEXT);
    const mirrors = record === undefined ? [] : this.mirrorsFacing(at);
    for (const rn of objects) {
      if (dungeon.rnMaps.dbType(rn) !== DBType.TEXT) continue;
      if (rn === record && mirrors.length) this.record(at, mirrors, out);
      else this.text(rn, room, out);
    }
    const things: InfoLine[] = [];
    for (const rn of objects) this.thing(rn, 1, things);
    if (things.length) out.push({ text: 'On it:', indent: 0 }, ...things);
    this.actedOnBy(at, out);
    this.arrivedFrom(at, out);
    return out;
  }

  /**
   * The squares of `map` that hold what `mark` names, by `x * 32 + y`: a generator, ready
   * or resting (`isGenerator`); a group of monsters; an item, what `thing`
   * names, on a floor or in a wall's alcove, a chest with what it holds, but not an item a
   * monster carries, nor a champion's in the wall of the mirror that holds them.
   */
  marked(map: number, mark: CellMark): ReadonlySet<number> {
    const key = `${map},${mark}`;
    let cells = this.marks.get(key);
    if (cells) return cells;
    cells = new Set();
    this.marks.set(key, cells);
    const { dungeon } = this.source;
    const level = dungeon.getMap(map);
    if (!level) return cells;
    const actuatorType = (rn: ObjectID): number | null => {
      const a = dungeon.rnMaps.dbType(rn) === DBType.ACTUATOR ? dungeon.getActuatorRecord(rn) : null;
      return a ? getActuatorType(a) : null;
    };
    for (let x = 0; x < level.descriptor.width; x++) {
      for (let y = 0; y < level.descriptor.height; y++) {
        const room = getRoomType(level.cellFlags[x]![y]!);
        const objects = [...this.chain(dungeon.findFirstObject(new Position(x, y, map)))];
        const holds = mark === 'generator' ? room === RoomType.OPEN && objects.some((rn) => this.isGenerator(rn, room))
          : mark === 'monster' ? objects.some((rn) => dungeon.rnMaps.dbType(rn) === DBType.CREATURE)
          : !(room === RoomType.STONE && objects.some((rn) => actuatorType(rn) === 127))
            && objects.some((rn) => dungeon.rnMaps.dbType(rn) !== DBType.CREATURE && this.itemName(rn) !== null);
        if (holds) cells.add(x * 32 + y);
      }
    }
    return cells;
  }

  /* -------------------------------------------------------------- the sections ---- */

  /**
   * Where stairs and a pit lead: one level down, or up for stairs up, at the same square of
   * the dungeon, found by `IncrementLevel` (`doc/CSBwin-src/CSBCode.cpp:4774`), as
   * `TraverseStairway` (`:7820`) and a fall (`PitGoesSomewhere`,
   * `doc/CSBwin-src/Code11f52.cpp:2812`) find it. A false pit lets nothing fall
   * (`doc/CSBwin-src/CSBTypes.h:182-214`).
   */
  private leads(at: CellRef, flag: number, out: InfoLine[]): void {
    const room = getRoomType(flag);
    if (room !== RoomType.STAIRS && room !== RoomType.PIT) return;
    if (room === RoomType.PIT && (flag & 1) !== 0) return;
    const delta = room === RoomType.STAIRS && (flag & 4) !== 0 ? -1 : 1;
    const to = this.source.dungeon.incrementLevel(new Position(at.x, at.y, at.map), delta);
    if (!to) return;
    const link = { map: to.z, x: to.x, y: to.y };
    out.push({ text: `${room === RoomType.PIT ? 'Falls' : 'Leads'} to ${this.place(link)}`, indent: 0, link });
  }

  /** A door's `DB0` flags (`doc/CSBwin-src/CSB.h:821-851`). */
  private door(rn: ObjectID, out: InfoLine[]): void {
    const d = this.source.dungeon.getRecord(rn) as DoorRecord | null;
    if (!d) return;
    if (d.hasButton) out.push({ text: 'Has a button', indent: 0 });
    const breaks = [d.destructibleByChop && 'blows', d.destructibleByFireball && 'fireballs'].filter(Boolean);
    if (breaks.length) out.push({ text: `Breaks to ${breaks.join(' and ')}`, indent: 0 });
  }

  /**
   * A teleporter's destination, what it takes and how it turns them (`DB1`,
   * `src/data/dungeonTypes.ts`): to a facing when absolute, else by quarter turns
   * clockwise (`MoveObject`, `doc/CSBwin-src/Code11f52.cpp:3002-3012`). A rotator only
   * turns.
   */
  private teleporter(at: CellRef, rn: ObjectID, out: InfoLine[]): void {
    const t = this.source.dungeon.getRecord(rn) as TeleporterRecord | null;
    if (!t) return;
    const scope = SCOPES[t.scope & 3];
    const rotation = t.rotation & 3;
    const link = { map: t.destMap, x: t.destX, y: t.destY };
    if (this.sendsHome(at, rn)) {
      const text = t.absoluteRotation ? `Turns ${scope} to face ${SIDES[rotation]}`
        : rotation ? `Turns ${scope} ${TURNS[rotation]}` : `Leaves ${scope} as they are`;
      out.push({ text, indent: 0 });
      return;
    }
    const turn = t.absoluteRotation ? `, facing ${SIDES[rotation]}` : rotation ? `, turned ${TURNS[rotation]}` : '';
    out.push({ text: `Sends ${scope} to ${this.place(link)}${turn}`, indent: 0, link });
  }

  /** `rn` is a teleporter sending to `at`, its own square: a rotator, which only turns. */
  private sendsHome(at: CellRef, rn: ObjectID): boolean {
    const { dungeon } = this.source;
    if (dungeon.rnMaps.dbType(rn) !== DBType.TELEPORTER) return false;
    const t = dungeon.getRecord(rn) as TeleporterRecord | null;
    return !!t && t.destMap === at.map && t.destX === at.x && t.destY === at.y;
  }

  private actuator(at: CellRef, rn: ObjectID, room: number, out: InfoLine[]): void {
    const { dungeon } = this.source;
    const a = dungeon.getActuatorRecord(rn);
    if (!a) return;
    const where = room === RoomType.STONE ? `${SIDES[dungeon.rnMaps.pos(rn) & 3]} side: ` : '';
    if (this.isGenerator(rn, room)) {
      const rest = this.restingOf().get(rn);
      out.push({ text: generatorWords(a), indent: 0 });
      out.push({ text: rest === undefined ? 'Ready' : `Resting, ${rest} ticks to go`, indent: 1 });
      return;
    }
    if (getActuatorType(a) === 47) {
      out.push({ text: `${where}${this.dsaWords(at.map, a)}`, indent: 0 });
      this.dsaNames(at.map, rn, a, out);
      return;
    }
    if (room === RoomType.STONE && getActuatorType(a) === 127) {
      this.mirror(at, rn, a, where, out);
      return;
    }
    const trigger = actuatorTrigger(a, room, (objNI) => this.objectName(objNI));
    if (!trigger) return;
    out.push({ text: `${where}${trigger.words}`, indent: 0 });
    this.target(at.map, a, room, 1, out);
    if (trigger.objectType !== null) this.objectPlaces(trigger.objectType, 1, out);
  }

  /** The line of an actuator's target, a link, when it has one that takes an action. */
  private target(map: number, a: ActuatorRecord, room: number, indent: number, out: InfoLine[]): void {
    if (!actuatorHasTarget(a, room)) return;
    const level = this.source.dungeon.getMap(map);
    const x = getActuatorTargetX(a);
    const y = getActuatorTargetY(a);
    const flag = level?.cellFlags[x]?.[y];
    if (flag === undefined) return;
    const effect = actuatorEffect(a, flag);
    if (effect) out.push({ text: `${effect} (${x},${y})`, indent, link: { map, x, y } });
  }

  /** A DSA: its description and its state (`DB3::DSAselector`, `DSAstate`, `doc/CSBwin-src/CSB.h:1051-1053`). */
  private dsaWords(map: number, a: ActuatorRecord): string {
    const { dungeon } = this.source;
    const index = dungeon.getDsaLevelIndex(map, getActuatorDsaSelector(a));
    const dsa = index === null ? null : dungeon.getData().dsaIndex?.entries[index] ?? null;
    const description = dsa?.description.trim();
    return `Script${description ? ` "${description}"` : ''}, state ${getActuatorDsaState(a)}`;
  }

  /**
   * The squares a DSA's programs name (`DsaTargets`), each a link, at most `MAX_PLACES`,
   * and whether it computes others as it runs, which are not followed.
   */
  private dsaNames(map: number, rn: ObjectID, a: ActuatorRecord, out: InfoLine[]): void {
    const { uses, computed } = this.dsaUses(map, rn, a);
    for (const u of uses.slice(0, MAX_PLACES)) out.push({ text: `${u.words} ${this.place(u.at)}`, indent: 1, link: u.at });
    if (uses.length > MAX_PLACES) out.push({ text: `and ${uses.length - MAX_PLACES} more`, indent: 1 });
    if (computed) out.push({ text: 'And squares it computes as it runs', indent: 1 });
  }

  /**
   * What the DSA actuator `rn` on `map` names: its DSA's programs read
   * (`dsaTargets`), once a DSA, and their parameters read off `rn`. A location off the
   * dungeon's levels names nothing.
   */
  private dsaUses(map: number, rn: ObjectID, a: ActuatorRecord): { uses: DsaUse[]; computed: boolean } {
    const { dungeon } = this.source;
    const index = dungeon.getDsaLevelIndex(map, getActuatorDsaSelector(a));
    const dsa = index === null ? null : dungeon.getData().dsaIndex?.entries[index] ?? null;
    if (index === null || !dsa) return { uses: [], computed: false };
    let targets = this.dsaPrograms.get(index);
    if (!targets) {
      targets = dsaTargets(dsa.states.flatMap((state) => (state?.actions ?? []).map((action) => action.program)));
      this.dsaPrograms.set(index, targets);
    }
    let computed = targets.computed;
    const uses: DsaUse[] = [];
    const seen = new Set<string>();
    for (const u of targets.uses) {
      const value = this.dsaValue(u.from, rn, targets);
      if (value === null) {
        computed = true;
        continue;
      }
      const locr = locationRelFromInteger(value);
      const level = dungeon.getMap(locr.l);
      if (!level || locr.x >= level.descriptor.width || locr.y >= level.descriptor.height) continue;
      const key = `${u.words}|${locr.l},${locr.x},${locr.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uses.push({ words: u.words, at: { map: locr.l, x: locr.x, y: locr.y } });
    }
    return { uses, computed };
  }

  /**
   * A value a program reads as a location, or null when it is not known: a parameter its
   * DSA stores is a variable. A parameter is read as `loadParameter` reads it
   * (`src/engine/dsa/DsaMachine.ts`, `doc/CSBwin-src/DSA.cpp:1139-1180`): `where` 0 and 1
   * the actuator's A and B, each two more a DSA further along its square's chain.
   */
  private dsaValue(from: DsaValue, rn: ObjectID, targets: DsaTargets): number | null {
    if (from.kind === 'constant') return from.value;
    if (from.kind === 'self' || targets.storesAnyParameter || targets.stored.has(from.where)) return null;
    const { dungeon } = this.source;
    let r = rn;
    let slot = from.where;
    while (slot > 1) {
      r = dungeon.getDBRecordLink(r);
      if (r === OBJECT_ID_EOF) return null;
      if (dungeon.rnMaps.dbType(r) !== DBType.ACTUATOR) continue;
      const next = dungeon.getActuatorRecord(r);
      if (!next || getActuatorType(next) !== 47) continue;
      slot -= 2;
    }
    const rec = dungeon.getActuatorRecord(r);
    if (!rec) return null;
    return slot === 0 ? getActuatorParameterA(rec) : getActuatorParameterB(rec);
  }

  /**
   * A Hall of Champions mirror: the champion it gives, read as `AddCharacter` reads them,
   * from the square before it (`heroAt`), and whether it is active: one whose state has
   * `PORTRAIT_InActive` gives no one (`doc/CSBwin-src/Mouse.cpp:515-517`). A mirror that
   * has given its champion is type 0, with every actuator of its wall
   * (`doc/CSBwin-src/CSBCode.cpp:6750-6795`), and is not shown.
   */
  private mirror(at: CellRef, rn: ObjectID, a: ActuatorRecord, where: string, out: InfoLine[]): void {
    const front = this.front(at, this.source.dungeon.rnMaps.pos(rn));
    const hero = this.heroAt(front);
    out.push({ text: `${where}Champion mirror: ${heroWords(hero)}`, indent: 0 });
    out.push({ text: (getActuatorState(a) & PORTRAIT_INACTIVE) !== 0 ? 'Inactive' : 'Active', indent: 1 });
    if (front) out.push({ text: `Record at (${front.x},${front.y})`, indent: 1, link: front });
  }

  /** The record of the champions of `mirrors`, the first text of `at`, which faces them. */
  private record(at: CellRef, mirrors: readonly { x: number; y: number; side: number }[], out: InfoLine[]): void {
    out.push({ text: `Champion record: ${heroWords(this.heroAt(at))}`, indent: 0 });
    for (const m of mirrors) {
      out.push({ text: `For the mirror at (${m.x},${m.y}) ${SIDES[m.side]} side`, indent: 1, link: { map: at.map, x: m.x, y: m.y } });
    }
  }

  /**
   * The square a wall's side faces, where the party stands to click it: one step from the
   * wall the way the side looks (`d.DeltaX`, `d.DeltaY`): `_ResurrectReincarnateCancel`
   * finds the mirror one step ahead of the party, on the side facing it
   * (`doc/CSBwin-src/CSBCode.cpp:6722-6731`, `:6749`). Null off the map.
   */
  private front(at: CellRef, side: number): CellRef | null {
    const { tables, dungeon } = this.source;
    const x = at.x + tables.deltaX[side & 3]!;
    const y = at.y + tables.deltaY[side & 3]!;
    const level = dungeon.getMap(at.map);
    if (!level || x < 0 || y < 0 || x >= level.descriptor.width || y >= level.descriptor.height) return null;
    return { map: at.map, x, y };
  }

  /** The type-127 actuators on the walls around `at` whose side faces it. */
  private mirrorsFacing(at: CellRef): { x: number; y: number; side: number }[] {
    const { dungeon } = this.source;
    const level = dungeon.getMap(at.map);
    const found: { x: number; y: number; side: number }[] = [];
    if (!level) return found;
    for (let direction = 0; direction < 4; direction++) {
      const wall = this.front(at, direction);
      if (!wall || getRoomType(level.cellFlags[wall.x]![wall.y]!) !== RoomType.STONE) continue;
      const side = (direction + 2) & 3;
      for (const rn of this.chain(dungeon.findFirstObject(new Position(wall.x, wall.y, at.map)))) {
        if (dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR || (dungeon.rnMaps.pos(rn) & 3) !== side) continue;
        const a = dungeon.getActuatorRecord(rn);
        if (a && getActuatorType(a) === 127) {
          found.push({ x: wall.x, y: wall.y, side });
          break;
        }
      }
    }
    return found;
  }

  /**
   * The champion `AddCharacter` reads standing on `at` (`doc/CSBwin-src/Character.cpp:536-550`):
   * the square's first text, at any corner, as `DecodeText(…, 0x8002, 990)` makes it, or
   * `legalHero` for none (`readHeroText`, as `HallOfChampions` reads it).
   */
  private heroAt(at: CellRef | null): HeroText {
    const { dungeon, tables } = this.source;
    if (at) {
      for (const rn of this.chain(dungeon.findFirstObject(new Position(at.x, at.y, at.map)))) {
        if (dungeon.rnMaps.dbType(rn) !== DBType.TEXT) continue;
        const t = dungeon.getTextRecord(rn);
        return readHeroText(t ? dungeon.decodeTextBytes(t, 0x8002, 990, tables.textDecode) : null);
      }
    }
    return readHeroText(null);
  }

  /** A text: a wall's inscription, or a message on a floor, and whether it is hidden. */
  private text(rn: ObjectID, room: number, out: InfoLine[]): void {
    const { dungeon, tables } = this.source;
    const t = dungeon.getRecord(rn) as TextRecord | null;
    if (!t) return;
    const words = (dungeon.decodeTextString(t, 0x8001, tables.textDecode) ?? '').replace(/\s+/g, ' ').trim();
    const head = room === RoomType.STONE ? `${SIDES[dungeon.rnMaps.pos(rn) & 3]} side: text` : 'Message';
    out.push({ text: `${head}${t.visible ? '' : ' (hidden)'}: "${words}"`, indent: 0 });
  }

  /** An item, with what a chest holds, or a group of monsters, with what they carry. */
  private thing(rn: ObjectID, indent: number, out: InfoLine[]): void {
    const { dungeon } = this.source;
    const category = dungeon.rnMaps.dbType(rn);
    if (category === DBType.CREATURE) {
      const c = dungeon.getRecord(rn) as CreatureRecord | null;
      if (!c) return;
      out.push({ text: `${c.numMonM1 + 1} x ${monsterName(c.creatureType)}`, indent });
      for (const p of this.chain(c.possession)) this.thing(p, indent + 1, out);
      return;
    }
    const name = this.itemName(rn);
    if (name === null) return;
    out.push({ text: name, indent });
    if (category === DBType.CHEST) {
      const chest = dungeon.getRecord(rn) as ContainerRecord | null;
      for (const p of this.chain(chest?.containedObject ?? OBJECT_ID_NULL)) this.thing(p, indent + 1, out);
    }
  }

  /**
   * The actuators on `at`'s map aimed at it, and the DSAs of any level whose programs
   * name it, each a link to its square.
   */
  private actedOnBy(at: CellRef, out: InfoLine[]): void {
    const senders = this.sendersOf(at.map).get(at.x * 32 + at.y) ?? [];
    const scripts = this.dsaSendersOf().get(`${at.map},${at.x},${at.y}`) ?? [];
    if (!senders.length && !scripts.length) return;
    out.push({ text: 'Acted on by:', indent: 0 });
    for (const s of scripts) {
      const where = s.map === at.map ? `(${s.x},${s.y})` : this.place(s);
      out.push({ text: `${where}${s.side}: ${s.script}`, indent: 1, link: { map: s.map, x: s.x, y: s.y } });
      for (const words of s.words) out.push({ text: `${words} (${at.x},${at.y})`, indent: 2 });
    }
    const { dungeon } = this.source;
    for (const s of senders) {
      const a = dungeon.getActuatorRecord(s.rn)!;
      const side = s.room === RoomType.STONE ? ` ${SIDES[dungeon.rnMaps.pos(s.rn) & 3]} side` : '';
      const trigger = actuatorTrigger(a, s.room, (objNI) => this.objectName(objNI));
      const link = { map: at.map, x: s.x, y: s.y };
      out.push({ text: `(${s.x},${s.y})${side}: ${trigger?.words ?? `type ${getActuatorType(a)}`}`, indent: 1, link });
      const flag = dungeon.getMap(at.map)!.cellFlags[at.x]![at.y]!;
      const effect = actuatorEffect(a, flag);
      if (effect) out.push({ text: effect, indent: 2 });
      if (trigger?.objectType !== null && trigger?.objectType !== undefined) this.objectPlaces(trigger.objectType, 2, out);
    }
  }

  /** The teleporters that send something to `at`, each a link to its square. */
  private arrivedFrom(at: CellRef, out: InfoLine[]): void {
    const from = (this.arrivalsOf().get(`${at.map},${at.x},${at.y}`) ?? [])
      .filter((f) => f.map !== at.map || f.x !== at.x || f.y !== at.y);
    if (!from.length) return;
    out.push({ text: 'Teleporters to here:', indent: 0 });
    for (const link of from) out.push({ text: this.place(link), indent: 1, link });
  }

  /**
   * Where the objects of `objectType` are, as `GetBasicObjectType` reads them: on a
   * square, in a chest, carried by a monster or by the party. The party's map first, then
   * the nearest maps, at most `MAX_PLACES`.
   */
  private objectPlaces(objectType: number, indent: number, out: InfoLine[]): void {
    const places = this.placesOf().get(objectType) ?? [];
    if (!places.length) {
      out.push({ text: `No ${this.objectName(objectType)} anywhere`, indent });
      return;
    }
    out.push({ text: `${this.objectName(objectType)} at:`, indent });
    const here = this.source.party?.position.z ?? 0;
    const sorted = [...places].sort((p, q) => Math.abs(p.map - here) - Math.abs(q.map - here) || p.map - q.map || p.y - q.y || p.x - q.x);
    for (const p of sorted.slice(0, MAX_PLACES)) {
      out.push({ text: `${this.place(p)}${p.where}`, indent: indent + 1, link: { map: p.map, x: p.x, y: p.y } });
    }
    if (sorted.length > MAX_PLACES) out.push({ text: `and ${sorted.length - MAX_PLACES} more`, indent: indent + 1 });
  }

  /* --------------------------------------------------------------- the indexes ---- */

  /** `map`'s actuators with a target, by the target's `x * 32 + y`. */
  private sendersOf(map: number): Map<number, Sender[]> {
    let index = this.senders.get(map);
    if (index) return index;
    index = new Map();
    this.senders.set(map, index);
    const { dungeon } = this.source;
    const level = dungeon.getMap(map);
    if (!level) return index;
    const { width, height } = level.descriptor;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const room = getRoomType(level.cellFlags[x]![y]!);
        for (const rn of this.chain(dungeon.findFirstObject(new Position(x, y, map)))) {
          if (dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
          const a = dungeon.getActuatorRecord(rn);
          if (!a || !actuatorHasTarget(a, room)) continue;
          const key = getActuatorTargetX(a) * 32 + getActuatorTargetY(a);
          const list = index.get(key) ?? [];
          list.push({ rn, x, y, room });
          index.set(key, list);
        }
      }
    }
    return index;
  }

  /** The DSAs of the dungeon by the squares their programs name, `map,x,y` (`dsaUses`). */
  private dsaSendersOf(): Map<string, DsaSender[]> {
    if (this.dsaSenders) return this.dsaSenders;
    const index = new Map<string, DsaSender[]>();
    this.dsaSenders = index;
    const { dungeon } = this.source;
    dungeon.getData().maps.forEach((level, map) => {
      for (let x = 0; x < level.descriptor.width; x++) {
        for (let y = 0; y < level.descriptor.height; y++) {
          const room = getRoomType(level.cellFlags[x]![y]!);
          for (const rn of this.chain(dungeon.findFirstObject(new Position(x, y, map)))) {
            if (dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
            const a = dungeon.getActuatorRecord(rn);
            if (!a || getActuatorType(a) !== 47) continue;
            const side = room === RoomType.STONE ? ` ${SIDES[dungeon.rnMaps.pos(rn) & 3]} side` : '';
            const named = new Map<string, DsaSender>();
            for (const u of this.dsaUses(map, rn, a).uses) {
              const key = `${u.at.map},${u.at.x},${u.at.y}`;
              let sender = named.get(key);
              if (!sender) {
                sender = { map, x, y, side, script: this.dsaWords(map, a), words: [] };
                named.set(key, sender);
                index.set(key, [...(index.get(key) ?? []), sender]);
              }
              sender.words.push(u.words);
            }
          }
        }
      }
    });
    return index;
  }

  /** Every item of the dungeon by its `GetBasicObjectType`, and the teleporters by destination. */
  private placesOf(): Map<number, Place[]> {
    if (this.places) return this.places;
    const places = new Map<number, Place[]>();
    this.places = places;
    const { dungeon, tables, party } = this.source;
    const seen = new Set<number>();
    const add = (rn: ObjectID, at: CellRef, where: string): void => {
      for (const r of this.chain(rn)) {
        if (seen.has(r)) continue;
        seen.add(r);
        const category = dungeon.rnMaps.dbType(r);
        if (category === DBType.CREATURE) {
          const c = dungeon.getRecord(r) as CreatureRecord | null;
          if (c) add(c.possession, at, ` carried by ${monsterName(c.creatureType)}`);
          continue;
        }
        const type = GetBasicObjectType(dungeon, tables.objDescObjectType, r);
        if (type !== OBJNI_NOT_AN_OBJECT) {
          const list = places.get(type) ?? [];
          list.push({ ...at, where });
          places.set(type, list);
        }
        if (category === DBType.CHEST) {
          const chest = dungeon.getRecord(r) as ContainerRecord | null;
          if (chest) add(chest.containedObject, at, ` in ${this.itemName(r) ?? 'a chest'}`);
        }
      }
    };
    const maps = dungeon.getData().maps;
    maps.forEach((level, map) => {
      for (let x = 0; x < level.descriptor.width; x++) {
        for (let y = 0; y < level.descriptor.height; y++) add(dungeon.findFirstObject(new Position(x, y, map)), { map, x, y }, '');
      }
    });
    if (party) {
      const at = { map: party.position.z, x: party.position.x, y: party.position.y };
      // A possession is one object, not a chain's head: its link is not followed.
      const held = [party.objectInHand, ...party.champions.flatMap((c) => c.possessions)];
      for (const rn of held) {
        if (rn === OBJECT_ID_NULL || rn === OBJECT_ID_EOF || seen.has(rn)) continue;
        seen.add(rn);
        const type = GetBasicObjectType(dungeon, tables.objDescObjectType, rn);
        if (type !== OBJNI_NOT_AN_OBJECT) {
          const list = places.get(type) ?? [];
          list.push({ ...at, where: ', the party has it' });
          places.set(type, list);
        }
        if (dungeon.rnMaps.dbType(rn) === DBType.CHEST) {
          const chest = dungeon.getRecord(rn) as ContainerRecord | null;
          if (chest) add(chest.containedObject, at, ', the party has it');
        }
      }
    }
    return places;
  }

  /**
   * A floor actuator that is a generator: one of type 6, ready, or one resting, which a
   * generator that fired with a disable time is, its type 0 until its timer turns it back
   * (`doc/CSBwin-src/Timer.cpp:1805-1820`). Every other word of it is kept, so it is shown
   * whole. A once-only generator that fired is type 0 for good, and nothing tells it from
   * any other actuator of type 0, a wall's ornament or a spent pad: it is not shown.
   */
  private isGenerator(rn: ObjectID, room: number): boolean {
    if (room !== RoomType.OPEN) return false;
    const a = this.source.dungeon.getActuatorRecord(rn);
    return !!a && (getActuatorType(a) === 6 || this.restingOf().has(rn));
  }

  /**
   * The resting generators, by RN, and the ticks left until each is ready. Each
   * `TT_ReactivateGenerator` timer names the actuator it will turn back into a generator
   * as `ProcessTT_ReactivateGenerator` finds it (`doc/CSBwin-src/Timer.cpp:1835-1874`):
   * among its square's actuators of type 0, the one the timer's object names, else the
   * first; at the timer's time, `d.Time` then being at least that.
   */
  private restingOf(): Map<number, number> {
    if (this.resting) return this.resting;
    const resting = new Map<number, number>();
    this.resting = resting;
    const { dungeon, clock } = this.source;
    for (const t of clock?.timers ?? []) {
      if (t.function !== TimerFunction.TT_REACTIVATE_GENERATOR) continue;
      let first: ObjectID | null = null;
      let found: ObjectID | null = null;
      for (const rn of this.chain(dungeon.findFirstObject(new Position(t.uByte6, t.uByte7, t.level)))) {
        if (dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
        const a = dungeon.getActuatorRecord(rn);
        if (!a || getActuatorType(a) !== 0) continue;
        first ??= rn;
        if (rn === t.object) { found = rn; break; }
      }
      const rn = found ?? first;
      if (rn === null) continue;
      const left = Math.max(0, t.time - clock!.time);
      resting.set(rn, Math.min(left, resting.get(rn) ?? left));
    }
    return resting;
  }

  /** The teleporters of the dungeon by their destination, `map,x,y`. */
  private arrivalsOf(): Map<string, CellRef[]> {
    if (this.arrivals) return this.arrivals;
    const arrivals = new Map<string, CellRef[]>();
    this.arrivals = arrivals;
    const { dungeon } = this.source;
    dungeon.getData().maps.forEach((level, map) => {
      for (let x = 0; x < level.descriptor.width; x++) {
        for (let y = 0; y < level.descriptor.height; y++) {
          if (getRoomType(level.cellFlags[x]![y]!) !== RoomType.TELEPORTER) continue;
          for (const rn of this.chain(dungeon.findFirstObject(new Position(x, y, map)))) {
            if (dungeon.rnMaps.dbType(rn) !== DBType.TELEPORTER) continue;
            const t = dungeon.getRecord(rn) as TeleporterRecord | null;
            if (!t) continue;
            const key = `${t.destMap},${t.destX},${t.destY}`;
            arrivals.set(key, [...(arrivals.get(key) ?? []), { map, x, y }]);
          }
        }
      }
    });
    return arrivals;
  }

  /* ------------------------------------------------------------------- helpers ---- */

  private place(at: CellRef): string {
    return `${this.levelName(at.map)} (${at.x},${at.y})`;
  }

  /** An object type's name (`OBJ_NAME_INDEX`). */
  private objectName(objNI: number): string {
    return this.source.objectNames[objNI] ?? `object ${objNI}`;
  }

  /** An item's name as the game prints it (`NameIndex`), or null for a non-item. */
  private itemName(rn: ObjectID): string | null {
    const { dungeon, tables, party } = this.source;
    const index = NameIndex(dungeon, tables, party?.facing ?? 0, rn);
    return index !== OBJNI_NOT_AN_OBJECT ? this.objectName(index) : null;
  }

  /** A chain, guarded against a loop in a damaged file. */
  private *chain(first: ObjectID): Generator<ObjectID> {
    const seen = new Set<number>();
    const { dungeon } = this.source;
    for (let rn = first; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL && !seen.has(rn); rn = dungeon.getDBRecordLink(rn)) {
      seen.add(rn);
      yield rn;
    }
  }
}

/** What a teleporter takes, `DB1`'s scope (`src/data/dungeonTypes.ts`, `TeleporterRecord.scope`). */
const SCOPES = ['items', 'monsters', 'items and party', 'everything'];

/** A relative teleporter's quarter turns, clockwise as the facings count (N, E, S, W). */
const TURNS = ['', 'right', 'around', 'left'];

/**
 * A champion as a mirror gives them: the name and the title, as the game prints them
 * ("HALK THE BARBARIAN"), or, for a record that fails `AddCharacter`'s checks or a square
 * with none, `legalHero`'s, said so.
 */
function heroWords(hero: HeroText): string {
  const words = hero.title ? `${hero.name} ${hero.title}` : hero.name;
  return hero.illegal ? `${words} (no valid record)` : words;
}

/** A name with its indefinite article: "a gold key", "an iron key". */
function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

/** A monster type's name, from `MONSTERTYPE`'s: `mon_SlimeDevil` is "Slime devil". */
export function monsterName(type: number): string {
  const name = (MonsterType[type] ?? `monster ${type}`).replace(/^mon_/, '');
  const words = name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  return /^\d/.test(words) ? `monster ${words}` : words.charAt(0).toUpperCase() + words.slice(1);
}
