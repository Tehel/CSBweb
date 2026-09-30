/**
 * Look inside a dungeon: a level as an ASCII map, one square with everything on it, or a
 * search for an item, a monster or a text across every level.
 *
 * Like `probe-ui.mjs`, this is **not evidence** and asserts nothing: it is how to find
 * out what the data holds ("what is on (18,1) of map 11?") before reasoning about
 * behaviour. It is not in `tools/run-checks.mjs`. The `peek-dungeon` skill has the uses.
 *
 * The source is a `dungeon.dat` (plain or compressed), a genuine CSBWin save, or one of
 * the port's `.dmweb.json` saves, whose world is read from its `raw` CSBWin file. A save
 * shows where monsters actually are, where the party is, and the timers of a square.
 *
 * Run: `npx tsx tools/peek-dungeon.ts [--file F] [--graphics G] <command>`
 *
 *   levels                one line per map: level, size, offset, monster types allowed
 *   map <m>               the map drawn in ASCII, then its teleporters, stairs, monsters, items
 *   cell <m> <x> <y> [r]  the square's neighbourhood (radius r, default 3), its flag byte
 *                         decoded, every object on it, and (from a save) its timers
 *   find <text>           every item, monster or text whose name or words contain <text>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  decodeObjectID, DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, TilePosition,
} from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import {
  ActuatorAction, getActuatorAction, getActuatorDelay, getActuatorLocalActionType, getActuatorTargetPos,
  getActuatorTargetX, getActuatorTargetY, getActuatorType, getActuatorValue, isActuatorAudible,
  isActuatorLocalActionOnly, isActuatorNormallyClosed, isActuatorOnceOnly,
} from '../src/data/actuatorHelpers';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type {
  ActuatorRecord, ClothingRecord, CloudRecord, ContainerRecord, CreatureRecord, DoorRecord, DungeonData,
  MiscRecord, MissileRecord, PotionRecord, ScrollRecord, TeleporterRecord, TextRecord, TimerRecord, WeaponRecord,
} from '../src/data/dungeonTypes';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { MonsterType } from '../src/engine/monsterTypes';
import { NameIndex } from '../src/engine/objectIndex';
import { decodeBase64ToBytes } from '../src/engine/SaveGamePayload';
import { TimerFunction } from '../src/engine/TimerQueue';
import { gameTablesOf, graphicsTablesOf } from './lib/game';

const USAGE = `usage: npx tsx tools/peek-dungeon.ts [--file F] [--graphics G] <command>
  levels | map <m> | cell <m> <x> <y> [radius] | find <text>
  --file      dungeon.dat, a CSBWin save, or a .dmweb.json (default: the DM Atari dungeon.dat)
  --graphics  graphics.dat for the object names (default: the DM Atari one)`;

/* ------------------------------------------------------------------ loading ------- */

interface Party { x: number; y: number; level: number; facing: number }

interface World {
  data: DungeonData;
  dungeon: DungeonState;
  /** From a save: where the party is. From a `dungeon.dat`: where it starts. */
  party: Party;
  fromSave: boolean;
  /** A save's live timers (the queue's entries), else empty. */
  timers: TimerRecord[];
  time: number;
}

/** The loaders narrate every section on `console.log`; a peek wants only its answer. */
function quietly<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

function loadWorld(path: string): World {
  let bytes: Uint8Array = new Uint8Array(readFileSync(resolve(path)));
  if (path.endsWith('.json')) {
    const raw = (JSON.parse(new TextDecoder().decode(bytes)) as { raw?: unknown }).raw;
    if (typeof raw !== 'string') throw new Error(`${path} has no raw CSBWin file`);
    bytes = decodeBase64ToBytes(raw);
  }
  // A save carries checksummed blocks and a closing image; a `dungeon.dat` fails that.
  let world: ReturnType<typeof loadCsbwinWorld> | null = null;
  try { world = quietly(() => loadCsbwinWorld(bytes)); } catch { world = null; }
  if (world) {
    const b2 = world.save.block2;
    const timers = world.save.timers ?? [];
    const queue = world.save.timerQueue ?? [];
    return {
      data: world.dungeon,
      dungeon: new DungeonState(world.dungeon),
      party: { x: b2?.partyX ?? -1, y: b2?.partyY ?? -1, level: b2?.partyLevel ?? -1, facing: b2?.partyFacing ?? 0 },
      fromSave: true,
      timers: queue.map((i) => timers[i]).filter((t): t is TimerRecord => t !== undefined),
      time: b2?.time ?? 0,
    };
  }
  const data = quietly(() => new DungeonLoader().loadDungeonDat(bytes));
  const start = data.header.startPosition;
  return {
    data,
    dungeon: new DungeonState(data),
    party: { x: start.x, y: start.y, level: start.z, facing: data.header.facing },
    fromSave: false,
    timers: [],
    time: 0,
  };
}

/* ------------------------------------------------------------------ naming -------- */

class Namer {
  private readonly objectNames: string[];
  private readonly tables: ReturnType<typeof gameTablesOf>;

  constructor(private readonly world: World, graphics: GraphicsLoader) {
    this.tables = gameTablesOf(graphics);
    this.objectNames = graphicsTablesOf(graphics).objects.objectNames;
  }

  /** An item's name as the game prints it (`NameIndex`), or null for a non-item. */
  item(rn: ObjectID): string | null {
    const index = NameIndex(this.world.dungeon, this.tables, this.world.party.facing, rn);
    return index >= 0 ? this.objectNames[index] ?? `name#${index}` : null;
  }

  /** An object type (`OBJ_NAME_INDEX`, what `GetBasicObjectType` returns) by its name. */
  objectType(objNI: number): string {
    return this.objectNames[objNI] ?? `name#${objNI}`;
  }

  monster(type: number): string {
    return (MonsterType[type] ?? `type ${type}`).replace(/^mon_/, '');
  }

  text(rec: TextRecord): string {
    const s = this.world.dungeon.decodeTextString(rec, 0x8001, this.tables.textDecode);
    return (s ?? '').replace(/\n/g, ' / ');
  }

  scroll(rec: ScrollRecord): string {
    return (this.world.dungeon.decodeScrollText(rec, this.tables.textDecode) ?? '').replace(/\n/g, ' / ');
  }
}

/* ------------------------------------------------------------------ records ------- */

const DB_NAME: Partial<Record<DBType, keyof DungeonData['databases']>> = {
  [DBType.DOOR]: 'doors', [DBType.TELEPORTER]: 'teleporters', [DBType.TEXT]: 'texts',
  [DBType.ACTUATOR]: 'actuators', [DBType.CREATURE]: 'creatures', [DBType.WEAPON]: 'weapons',
  [DBType.CLOTHING]: 'clothing', [DBType.SCROLL]: 'scrolls', [DBType.POTION]: 'potions',
  [DBType.CHEST]: 'containers', [DBType.MISC]: 'misc', [DBType.MISSILE]: 'missiles', [DBType.CLOUD]: 'clouds',
};

function recordOf(data: DungeonData, rn: ObjectID): unknown {
  const { category, index } = decodeObjectID(rn);
  const db = DB_NAME[category as DBType];
  return db ? (data.databases[db].records as unknown[])[index] ?? null : null;
}

/** Walk a chain, guarding against a loop in a damaged file. */
function* chain(world: World, first: ObjectID): Generator<ObjectID> {
  const seen = new Set<number>();
  for (let rn = first; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL && !seen.has(rn); rn = world.dungeon.getDBRecordLink(rn)) {
    seen.add(rn);
    yield rn;
  }
}

function* squareObjects(world: World, m: number, x: number, y: number): Generator<ObjectID> {
  yield* chain(world, world.dungeon.findFirstObject(new Position(x, y, m)));
}

const hex = (v: number, w = 4): string => '0x' + v.toString(16).padStart(w, '0');
const SCOPE = ['items', 'monsters', 'items+party', 'everything'];
const ACTION = { [ActuatorAction.SET]: 'set', [ActuatorAction.CLEAR]: 'clear', [ActuatorAction.TOGGLE]: 'toggle', [ActuatorAction.CONSTPRESSURE]: 'hold' };

/**
 * The object an actuator compares its `value` with, as `GetBasicObjectType` of that
 * object, or null for a type whose value is something else. The same type means different
 * things on a floor and in a wall: a pad is judged by `PressurePadOrAlcove`
 * (`doc/CSBwin-src/Code11f52.cpp:3785-3804`), a wall by `TouchWall` when clicked
 * (`doc/CSBwin-src/Mouse.cpp:378-480`) and by `PressurePadOrAlcove` when something is put
 * in its alcove (`doc/CSBwin-src/Code11f52.cpp:3826-3838`). A normally closed actuator
 * fires on the opposite outcome.
 */
function actuatorNeeds(a: ActuatorRecord, room: number | undefined, names: Namer): string | null {
  const name = names.objectType(getActuatorValue(a));
  if (room === RoomType.OPEN) {
    switch (getActuatorType(a)) {
      case 4: return `needs ${name} put on the pad`;
      case 8: return `needs the party to carry ${name}`;
      default: return null;
    }
  }
  if (room === RoomType.STONE) {
    switch (getActuatorType(a)) {
      case 2: return `clicked with anything in hand; if an alcove, needs ${name} put in it`;
      case 3: return `clicked with ${name}, which stays in hand; if an alcove, needs anything but ${name} put in it`;
      case 4: case 11: return `clicked with ${name}, which it takes`;
      case 17: return `clicked with ${name}, which it takes, then gone`;
      case 13: return `holds ${name}`;
      case 16: return `swaps ${name} in hand for the first object here`;
      default: return null;
    }
  }
  return null;
}

/**
 * One object in words, with what it holds indented below it. `room` is the room type of
 * the square it lies on, which an actuator's meaning depends on.
 */
function describe(world: World, names: Namer, rn: ObjectID, indent: string, out: string[], room?: number): void {
  const { category, index, position } = decodeObjectID(rn);
  const head = `${indent}${DBType[category]} #${index} corner ${TilePosition[position] ?? position}:`;
  const rec = recordOf(world.data, rn);
  if (!rec) { out.push(`${head} (no record)`); return; }
  switch (category) {
    case DBType.DOOR: {
      const d = rec as DoorRecord;
      // CSBWin's `DB0` accessor names (`doc/CSBwin-src/CSB.h:818-848`).
      out.push(`${head} doorSwitch=${d.hasButton} canOpenWithAxe=${d.destructibleByChop} canOpenWithFireball=${d.destructibleByFireball}`);
      return;
    }
    case DBType.TELEPORTER: {
      const t = rec as TeleporterRecord;
      out.push(`${head} takes ${SCOPE[t.scope & 3]} to map ${t.destMap} (${t.destX},${t.destY}), ` +
        `rotation ${t.rotation} ${t.absoluteRotation ? 'absolute' : 'relative'}, sound ${t.sound ? 'on' : 'off'}`);
      return;
    }
    case DBType.TEXT: {
      const t = rec as TextRecord;
      out.push(`${head} ${t.visible ? 'visible' : 'hidden'} "${names.text(t)}"`);
      return;
    }
    case DBType.ACTUATOR: {
      const a = rec as ActuatorRecord;
      const words = `word2=${hex(a.word2)} word4=${hex(a.word4)} word6=${hex(a.word6)}${a.word8 !== undefined ? ` word8=${hex(a.word8)}` : ''}`;
      const flags = [isActuatorOnceOnly(a) && 'once', isActuatorAudible(a) && 'audible', isActuatorNormallyClosed(a) && 'normally closed']
        .filter(Boolean).join(' ');
      const needs = actuatorNeeds(a, room, names);
      const effect = isActuatorLocalActionOnly(a)
        ? `local action ${getActuatorLocalActionType(a)}`
        : `${ACTION[getActuatorAction(a)]} (${getActuatorTargetX(a)},${getActuatorTargetY(a)}) corner ${getActuatorTargetPos(a)} after ${getActuatorDelay(a)}`;
      out.push(`${head} type ${getActuatorType(a)} value ${getActuatorValue(a)}${needs ? ` (${needs})` : ''}; if read as a target: ${effect}${flags ? `; ${flags}` : ''} [${words}]`);
      return;
    }
    case DBType.CREATURE: {
      const c = rec as CreatureRecord;
      const n = c.numMonM1 + 1;
      const flags = [c.important && 'important', c.unique && 'unique', c.invisible && 'invisible', c.poisoned && 'poisoned'].filter(Boolean).join(' ');
      out.push(`${head} ${n} x ${names.monster(c.creatureType)} hp [${c.hp.slice(0, n).join(',')}] fear ${c.fear} facing ${c.facing} ` +
        `groupIndex ${c.groupIndex}${flags ? ` ${flags}` : ''}`);
      for (const p of chain(world, c.possession)) describe(world, names, p, indent + '    carries ', out);
      return;
    }
    case DBType.CHEST: {
      out.push(`${head} ${names.item(rn)}`);
      for (const p of chain(world, (rec as ContainerRecord).containedObject)) describe(world, names, p, indent + '    holds ', out);
      return;
    }
    case DBType.WEAPON: {
      const w = rec as WeaponRecord;
      const flags = [w.cursed && 'cursed', w.poisoned && 'poisoned', w.broken && 'broken', w.important && 'important', w.litTorch && 'lit'].filter(Boolean).join(' ');
      out.push(`${head} ${names.item(rn)} charges ${w.charges}${flags ? ` ${flags}` : ''}`);
      return;
    }
    case DBType.CLOTHING: {
      const c = rec as ClothingRecord;
      const flags = [c.cursed && 'cursed', c.broken && 'broken', c.important && 'important'].filter(Boolean).join(' ');
      out.push(`${head} ${names.item(rn)} charges ${c.charges}${flags ? ` ${flags}` : ''}`);
      return;
    }
    case DBType.SCROLL:
      out.push(`${head} ${names.item(rn)} "${names.scroll(rec as ScrollRecord)}"`);
      return;
    case DBType.POTION:
      out.push(`${head} ${names.item(rn)} power ${(rec as PotionRecord).power}`);
      return;
    case DBType.MISC:
      out.push(`${head} ${names.item(rn)} state ${(rec as MiscRecord).specialState}`);
      return;
    case DBType.MISSILE: {
      const m = rec as MissileRecord;
      out.push(`${head} range ${m.rangeRemaining} damage ${m.damageRemaining} timer ${m.timerIndex}`);
      describe(world, names, m.projectileObject, indent + '    flying: ', out);
      return;
    }
    case DBType.CLOUD: {
      const c = rec as CloudRecord;
      out.push(`${head} cloud type ${c.cloudType} value ${c.value}`);
      return;
    }
    default:
      out.push(`${head} ${JSON.stringify(rec)}`);
  }
}

/* ------------------------------------------------------------------ squares ------- */

/**
 * The flag byte's attribute bits, as `CSBTypes.h` documents them per room type
 * (`doc/CSBwin-src/CSBTypes.h:177-209`); open floor's bit 3 is the random floor
 * decoration (`doc/CSBWIN_DECORATIONS_REFERENCE.md`).
 */
function describeFlag(flag: number): string {
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
    case RoomType.DOOR: return `${room}${objects}; state ${a & 7} (${['open', 'almost open', 'half open', 'almost closed', 'closed', 'bashed'][a & 7] ?? '?'}), ${a & 8 ? 'N/S' : 'E/W'}`;
    case RoomType.TELEPORTER: return `${room}${objects}; ${a & 8 ? 'active' : 'inactive'}, ${a & 4 ? 'visible' : 'invisible'}`;
    case RoomType.FALSEWALL: return `${room}${objects}; ${a & 4 ? 'open' : 'closed'}${a & 1 ? ', imaginary' : ''}`;
    default: return `${room}${objects}; attributes ${a.toString(2).padStart(4, '0')}`;
  }
}

function flagAt(world: World, m: number, x: number, y: number): number {
  return (world.data.maps[m]!.cellFlags[x]?.[y] ?? 0) as number;
}

/** A square's map glyph: the party, then a monster, then the room, then items. */
function glyph(world: World, m: number, x: number, y: number): string {
  const p = world.party;
  if (p.level === m && p.x === x && p.y === y) return '@';
  const flag = flagAt(world, m, x, y);
  let hasItem = false;
  if (flag & 0x10) {
    for (const rn of squareObjects(world, m, x, y)) {
      const c = decodeObjectID(rn).category;
      if (c === DBType.CREATURE) return 'M';
      if (c >= DBType.WEAPON && c <= DBType.MISC) hasItem = true;
    }
  }
  const a = flag & 0xf;
  switch ((flag >> 5) & 7) {
    case RoomType.STONE: return '#';
    case RoomType.OPEN: return hasItem ? 'i' : '.';
    case RoomType.PIT: return a & 8 ? 'O' : 'o';
    case RoomType.STAIRS: return a & 4 ? '<' : '>';
    case RoomType.DOOR: return (a & 7) === 0 || (a & 7) === 5 ? 'd' : 'D';
    case RoomType.TELEPORTER: return a & 8 ? 'T' : 't';
    case RoomType.FALSEWALL: return 'F';
    default: return '?';
  }
}

const LEGEND = "# stone  . floor  i items  M monsters  @ party  O/o pit open/closed  < > stairs up/down\n" +
  "D d door closed/open  T t teleporter active/inactive  F false wall";

function drawMap(world: World, m: number, x0: number, y0: number, x1: number, y1: number, mark?: [number, number]): string[] {
  const out: string[] = [];
  const cols = Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i);
  out.push('     ' + cols.map((x) => (x >= 10 ? String(Math.floor(x / 10)) : ' ')).join(''));
  out.push('     ' + cols.map((x) => String(x % 10)).join(''));
  for (let y = y0; y <= y1; y++) {
    const row = cols.map((x) => glyph(world, m, x, y)).join('');
    const tag = mark && mark[1] === y ? `   <- (${mark[0]},${y})` : '';
    out.push(`${String(y).padStart(4)} ${row}${tag}`);
  }
  return out;
}

/* ------------------------------------------------------------------ commands ------ */

function mapOf(world: World, m: number): DungeonData['maps'][number] {
  const map = world.data.maps[m];
  if (!map) throw new Error(`no map ${m}: this dungeon has maps 0-${world.data.maps.length - 1}`);
  return map;
}

function cmdLevels(world: World, names: Namer): void {
  for (let m = 0; m < world.data.maps.length; m++) {
    const d = world.data.maps[m]!.descriptor;
    const kinds = (world.data.maps[m]!.monsterTypes ?? []).map((t) => names.monster(t)).join(', ');
    const here = world.party.level === m ? `  <- party (${world.party.x},${world.party.y})` : '';
    console.log(`map ${String(m).padStart(2)}: level ${d.level}, ${d.width}x${d.height} at (${d.offsetX},${d.offsetY}), ` +
      `difficulty ${d.difficulty}; monsters: ${kinds || 'none'}${here}`);
  }
}

function cmdMap(world: World, names: Namer, m: number): void {
  const d = mapOf(world, m).descriptor;
  console.log(`map ${m}: level ${d.level}, ${d.width}x${d.height} at (${d.offsetX},${d.offsetY})`);
  console.log(LEGEND);
  for (const line of drawMap(world, m, 0, 0, d.width - 1, d.height - 1)) console.log(line);
  const features: string[] = [];
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
    const flag = flagAt(world, m, x, y);
    const type = (flag >> 5) & 7;
    if (type === RoomType.STAIRS) features.push(`(${x},${y}) stairs ${flag & 4 ? 'up' : 'down'}`);
    if (type === RoomType.PIT) features.push(`(${x},${y}) ${describeFlag(flag)}`);
    for (const rn of squareObjects(world, m, x, y)) {
      const { category } = decodeObjectID(rn);
      if (category === DBType.TELEPORTER || category === DBType.CREATURE || (category >= DBType.WEAPON && category <= DBType.MISC)) {
        const lines: string[] = [];
        describe(world, names, rn, `(${x},${y}) `, lines);
        if (category === DBType.TELEPORTER) lines[0] += ` [${describeFlag(flag).split('; ')[1]}]`;
        features.push(...lines);
      }
    }
  }
  console.log(features.join('\n'));
}

function cmdCell(world: World, names: Namer, m: number, x: number, y: number, radius: number): void {
  const d = mapOf(world, m).descriptor;
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) throw new Error(`(${x},${y}) is outside map ${m}, ${d.width}x${d.height}`);
  console.log(`map ${m} (${x},${y})`);
  const x0 = Math.max(0, x - radius), x1 = Math.min(d.width - 1, x + radius);
  const y0 = Math.max(0, y - radius), y1 = Math.min(d.height - 1, y + radius);
  for (const line of drawMap(world, m, x0, y0, x1, y1, [x, y])) console.log(line);
  const flag = flagAt(world, m, x, y);
  console.log(`flag ${hex(flag, 2)}: ${describeFlag(flag)}`);
  for (const [dx, dy, side] of [[0, -1, 'N'], [1, 0, 'E'], [0, 1, 'S'], [-1, 0, 'W']] as const) {
    const nx = x + dx, ny = y + dy;
    const inside = nx >= 0 && ny >= 0 && nx < d.width && ny < d.height;
    console.log(`  ${side} (${nx},${ny}): ${inside ? describeFlag(flagAt(world, m, nx, ny)) : 'off the map'}`);
  }
  const lines: string[] = [];
  for (const rn of squareObjects(world, m, x, y)) describe(world, names, rn, '  ', lines, (flag >> 5) & 7);
  console.log(lines.length ? `objects:\n${lines.join('\n')}` : 'objects: none');
  // `QueueSwitchAction` sends a remote actuator's action to its target on the level it
  // is on (`doc/ACTUATORS.md` §4). Some types reuse word6 for other things (a
  // generator's disable time, a launcher's energy), so a match is a lead to check
  // against the type, not a certainty.
  const aimed: string[] = [];
  for (let ay = 0; ay < d.height; ay++) for (let ax = 0; ax < d.width; ax++) {
    for (const rn of squareObjects(world, m, ax, ay)) {
      if (decodeObjectID(rn).category !== DBType.ACTUATOR) continue;
      const a = recordOf(world.data, rn) as ActuatorRecord | null;
      if (!a || isActuatorLocalActionOnly(a) || getActuatorTargetX(a) !== x || getActuatorTargetY(a) !== y) continue;
      const room = (flagAt(world, m, ax, ay) >> 5) & 7;
      describe(world, names, rn, `  from (${ax},${ay}) ${RoomType[room]} `, aimed, room);
    }
  }
  console.log(aimed.length ? `actuators on this map aimed here:\n${aimed.join('\n')}` : 'actuators on this map aimed here: none');
  if (world.fromSave) {
    // Timers are not addressed uniformly: this lists the ones whose uByte6/uByte7 are
    // this square, which is how door, actuator and monster timers name theirs. A
    // missile's position is in timerWord8 instead, and is not matched here.
    const here = world.timers.filter((t) => t.level === m && t.uByte6 === x && t.uByte7 === y);
    console.log(`timers with uByte6/uByte7 = (${x},${y}) at time ${world.time}: ${here.length ? '' : 'none'}`);
    for (const t of here) {
      const fn = (t.function << 24) >> 24;
      console.log(`  ${TimerFunction[fn] ?? `function ${fn}`} at ${t.time} (+${t.time - world.time}) ` +
        `uByte5=${t.uByte5} word8=${hex(t.timerWord8)}`);
    }
  } else {
    console.log('(a dungeon.dat has no timers; pass --file <save> to see them)');
  }
}

function cmdFind(world: World, names: Namer, text: string): void {
  const needle = text.toLowerCase();
  let hits = 0;
  for (let m = 0; m < world.data.maps.length; m++) {
    const d = world.data.maps[m]!.descriptor;
    for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
      for (const rn of squareObjects(world, m, x, y)) {
        const lines: string[] = [];
        describe(world, names, rn, `map ${m} (${x},${y}) `, lines, (flagAt(world, m, x, y) >> 5) & 7);
        // A group or a chest matches on what it holds as well as on itself.
        if (lines.some((l) => l.toLowerCase().includes(needle))) {
          console.log(lines.join('\n'));
          hits++;
        }
      }
    }
  }
  console.log(`${hits} match${hits === 1 ? '' : 'es'} for "${text}"`);
}

/* ------------------------------------------------------------------ main ---------- */

function main(): void {
  // `| head` closes the pipe early; that is not an error.
  process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  const args = process.argv.slice(2);
  let file = 'static/gamefiles/dm-atari/dungeon.dat';
  let graphicsPath = 'static/gamefiles/dm-atari/graphics.dat';
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[++i] ?? file;
    else if (args[i] === '--graphics') graphicsPath = args[++i] ?? graphicsPath;
    else if (args[i] === '--help' || args[i] === '-h') { console.log(USAGE); return; }
    else rest.push(args[i]!);
  }
  const [command, ...params] = rest;
  const num = (i: number, name: string): number => {
    const v = Number(params[i]);
    if (!Number.isInteger(v)) throw new Error(`${command}: <${name}> must be a number\n${USAGE}`);
    return v;
  };

  const world = loadWorld(file);
  const graphics = new GraphicsLoader();
  quietly(() => graphics.loadFromArray(new Uint8Array(readFileSync(resolve(graphicsPath)))));
  const names = quietly(() => new Namer(world, graphics));
  const source = world.fromSave
    ? `save, party on map ${world.party.level} (${world.party.x},${world.party.y}) facing ${world.party.facing}, time ${world.time}`
    : `dungeon.dat, party starts on map ${world.party.level} (${world.party.x},${world.party.y})`;
  console.log(`${file}: ${source}`);

  switch (command) {
    case 'levels': cmdLevels(world, names); break;
    case 'map': cmdMap(world, names, num(0, 'm')); break;
    case 'cell': cmdCell(world, names, num(0, 'm'), num(1, 'x'), num(2, 'y'), params[3] ? num(3, 'radius') : 3); break;
    case 'find':
      if (!params.length) throw new Error(`find: what?\n${USAGE}`);
      cmdFind(world, names, params.join(' '));
      break;
    default: console.log(USAGE); process.exitCode = command ? 1 : 0;
  }
}

main();
