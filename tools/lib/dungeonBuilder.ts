/**
 * A dungeon taken apart and put back together: for a tool that builds a dungeon, from
 * others or from nothing, rather than for the game.
 *
 * `decompose` turns a world read by `DungeonLoader` into levels whose squares hold their
 * objects as nested values: each object its database, its corner, a copy of its record
 * and what it holds (a monster's possessions, a chest's contents, a missile's object, a
 * scroll's text, a text's words). Nothing in that form is an RN or a record index, so
 * levels of several dungeons can be put side by side, edited, grown and dropped.
 *
 * `compose` numbers it all again into a world `buildDungeonFile` writes: records in the
 * order the walk meets them, level by level, column by column, square by square down
 * each chain, an object's contents after it; RN slots the same way, from 1, as
 * `ConvertListOfObjects` numbers a dungeon's chains (`doc/CSBwin-src/SaveGame.cpp:2128-2230`),
 * then a slot for each scroll's text, as `convertScrolls` gives one (`:2356-2378`); the
 * object list and its column index from the squares that hold something, as
 * `GetObjectListIndex` reads them (`doc/CSBwin-src/CSBCode.cpp:5168-5192`); each text one
 * entry of the indirect index, as `ConvertToIndirectText` makes them (`:2433-2488`). Free
 * records are not carried: the new game gives every database its spares
 * (`DungeonState.addNewGameSpares`).
 *
 * The DSAs travel as they are: the world's `DSAIndex` (`dsas`) and each level's row of
 * `DSALevelIndex` (`dsaSelectors`), which a type 47 actuator's selector reads
 * (`ProcessDSATimer6`, `doc/CSBwin-src/DSA.cpp:5395`; `SummarizeRoomInfo`,
 * `Codea59a.cpp:115-128`). A DSA's program names levels by number, so a caller that
 * renumbers levels mends its programs itself.
 *
 * What it does not know about is refused rather than dropped: an `EXPOOL` record.
 */
import { RnMaps } from '../../src/core/RnMaps';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position } from '../../src/core/types';
import type { Direction, ObjectID } from '../../src/core/types';
import { ActuatorAction, getActuatorType, isActuatorLocalActionOnly } from '../../src/data/actuatorHelpers';
import { ComputeTextLength, textStart } from '../../src/data/CsbwinDungeonConversions';
import { databaseRecords, rnMapsOf } from '../../src/data/CsbwinObjectIndex';
import type {
  ActuatorRecord, DatabaseRecord, Databases, DsaDefinition, DungeonData, MapDescriptor, ScrollRecord, TeleporterRecord, TextRecord,
} from '../../src/data/dungeonTypes';

/** One object on a square, or held by another. */
export interface BObject {
  db: DBType;
  /** Its corner of the square, 0-3: `RN::pos()`. */
  pos: number;
  /** A copy of its record. The links in it are rewritten by `compose`. */
  record: DatabaseRecord;
  /** A monster's possessions, a chest's contents, a missile's object: in chain order. */
  contents: BObject[];
  /** A text's words, its entry of the compressed text up to the word holding code 31. */
  words?: number[];
  /** A scroll's text: a TEXT object in no chain. */
  scrollText?: BObject;
}

export interface BLevel {
  /** A copy. `compose` sets `mapIndex` and `dataOffset`; the rest is the caller's. */
  descriptor: MapDescriptor;
  /** `[x][y]`, the flag byte. `compose` sets the has-objects bit from `cells`. */
  cellFlags: number[][];
  /** `[x][y]`, the square's chain. */
  cells: BObject[][][];
  monsterTypes: number[];
  wallDecorationTOC: number[];
  floorDecorationTOC: number[];
  doorDecorationTOC: number[];
  /**
   * The level's row of `DSALevelIndex` (`doc/CSBwin-src/data.cpp:100`), 32 selectors:
   * the number of a DSA of `BWorld.dsas`, `DSA_GRAPHIC` for a wall decoration of
   * `CSBgraphics.dat`, `DSA_NONE` for nothing. Absent when it names nothing.
   */
  dsaSelectors?: number[];
}

/** A `DSALevelIndex` entry naming nothing, as `ClearDSALevelIndex` leaves them (`SaveGame.cpp:273-284`). */
export const DSA_NONE = 0xffff;
/**
 * A `DSALevelIndex` entry that makes a type 47 actuator in a wall a `CSBgraphics.dat` wall
 * decoration, its `ParameterA` the section (`SummarizeRoomInfo`, `doc/CSBwin-src/Codea59a.cpp:115-128`).
 */
export const DSA_GRAPHIC = 255;
/** `DSALevelIndex`'s size (`doc/CSBwin-src/data.cpp:100`). */
const DSA_LEVELS = 64;
const DSA_SELECTORS = 32;

export interface BWorld {
  randomSeed: number;
  /** On level 0. */
  start: { x: number; y: number; facing: Direction };
  levels: BLevel[];
  /** `DSAIndex`, the DSAs by number. Absent when there are none. */
  dsas?: Array<DsaDefinition | null>;
}

const KEYS: Partial<Record<DBType, keyof Databases>> = {
  [DBType.DOOR]: 'doors', [DBType.TELEPORTER]: 'teleporters', [DBType.TEXT]: 'texts',
  [DBType.ACTUATOR]: 'actuators', [DBType.CREATURE]: 'creatures', [DBType.WEAPON]: 'weapons',
  [DBType.CLOTHING]: 'clothing', [DBType.SCROLL]: 'scrolls', [DBType.POTION]: 'potions',
  [DBType.CHEST]: 'containers', [DBType.MISC]: 'misc', [DBType.MISSILE]: 'missiles', [DBType.CLOUD]: 'clouds',
};

const clone = <T>(value: T): T => structuredClone(value);

/** The link field of the record that heads an object's contents, if its database has one. */
function contentsField(db: DBType): 'possession' | 'containedObject' | 'projectileObject' | null {
  if (db === DBType.CREATURE) return 'possession';
  if (db === DBType.CHEST) return 'containedObject';
  if (db === DBType.MISSILE) return 'projectileObject';
  return null;
}

/** A world read by `DungeonLoader`, taken apart. */
export function decompose(data: DungeonData): BWorld {
  if ((data.header.objectCounts[DBType.EXPOOL] ?? 0) !== 0) throw new Error('decompose: the dungeon has EXPOOL records');
  if (!data.indirectText || !data.newScrolls || !data.bigActuators) throw new Error('decompose: the world is not converted');

  const textOf = (record: TextRecord): number[] => {
    const start = textStart(data, record.textOffset);
    if (!start) throw new Error(`decompose: text entry ${record.textOffset} is missing`);
    return Array.from(start.words.slice(start.at, start.at + ComputeTextLength(start.words, start.at)));
  };
  const objectOf = (rn: ObjectID): BObject => {
    const { category: db, index, position } = data.rnMaps.decode(rn);
    const source = databaseRecords(data.databases, db)[index];
    if (!source) throw new Error(`decompose: slot ${rn} names record ${index} of database ${db}, which is missing`);
    const object: BObject = { db, pos: position, record: clone(source), contents: [] };
    const field = contentsField(db);
    if (field) object.contents = chain((source as unknown as Record<string, ObjectID>)[field]);
    if (db === DBType.TEXT) object.words = textOf(source as TextRecord);
    if (db === DBType.SCROLL) {
      const scroll = source as ScrollRecord;
      const text = data.databases.texts.records[scroll.textReference];
      if (!text) throw new Error(`decompose: scroll ${index} names text ${scroll.textReference}, which is missing`);
      object.scrollText = { db: DBType.TEXT, pos: 0, record: clone(text), contents: [], words: textOf(text) };
    }
    return object;
  };
  const chain = (head: ObjectID): BObject[] => {
    const out: BObject[] = [];
    for (let rn = head; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;) {
      const object = objectOf(rn);
      out.push(object);
      rn = object.record.nextObject;
    }
    return out;
  };

  const levels = data.maps.map((map, z): BLevel => {
    const { width, height } = map.descriptor;
    const selectors = data.dsaLevelIndex?.[z];
    const cells: BObject[][][] = [];
    for (let x = 0; x < width; x++) {
      cells[x] = [];
      let at = data.columnIndex[data.levelIndex[z] + x];
      for (let y = 0; y < height; y++) {
        cells[x][y] = (map.cellFlags[x][y] & 0x10) !== 0 ? chain(data.objectList[at++]) : [];
      }
    }
    return {
      descriptor: clone(map.descriptor),
      cellFlags: map.cellFlags.map((column) => [...column]),
      cells,
      monsterTypes: [...(map.monsterTypes ?? [])],
      wallDecorationTOC: [...(map.wallDecorationTOC ?? [])],
      floorDecorationTOC: [...(map.floorDecorationTOC ?? [])],
      doorDecorationTOC: [...(map.doorDecorationTOC ?? [])],
      ...(selectors?.some((dsa) => dsa !== DSA_NONE) ? { dsaSelectors: [...selectors] } : {}),
    };
  });
  const { startPosition, facing, randomSeed } = data.header;
  // `DSAIndex` up to its last DSA: a read gives all 256 entries.
  const entries = data.dsaIndex?.entries ?? [];
  let count = entries.length;
  while (count > 0 && !entries[count - 1]) count--;
  const dsas = count > 0 ? { dsas: clone(entries.slice(0, count)) } : {};
  return { randomSeed, start: { x: startPosition.x, y: startPosition.y, facing }, levels, ...dsas };
}

/** The world `decompose` took apart, or one built from levels of several, numbered again. */
export function compose(world: BWorld): DungeonData {
  const databases: Databases = {
    doors: { records: [], count: 0 }, teleporters: { records: [], count: 0 }, texts: { records: [], count: 0 },
    actuators: { records: [], count: 0 }, creatures: { records: [], count: 0 }, weapons: { records: [], count: 0 },
    clothing: { records: [], count: 0 }, scrolls: { records: [], count: 0 }, potions: { records: [], count: 0 },
    containers: { records: [], count: 0 }, misc: { records: [], count: 0 }, missiles: { records: [], count: 0 },
    clouds: { records: [], count: 0 },
  };
  const typeMap: number[] = [0xff];
  const indexMap: number[] = [0xffff];
  const indirectTextIndex: number[] = [];
  const compressedText: number[] = [];
  const scrolls: Array<{ record: ScrollRecord; text: BObject }> = [];

  const place = (object: BObject): number => {
    const key = KEYS[object.db];
    if (!key) throw new Error(`compose: no database for ${object.db}`);
    const records = databases[key].records as DatabaseRecord[];
    const record = clone(object.record);
    records.push(record);
    if (object.db === DBType.TEXT) {
      const text = record as TextRecord;
      text.textOffset = indirectTextIndex.length;
      indirectTextIndex.push(compressedText.length);
      compressedText.push(...(object.words ?? [0x7fff]));
    }
    return records.length - 1;
  };
  const slot = (db: DBType, pos: number, index: number): ObjectID => {
    typeMap.push(((pos & 3) << 4) | db);
    indexMap.push(index);
    return (typeMap.length - 1) as ObjectID;
  };
  /** A chain's records and slots, in walk order, linked; its head. */
  const lay = (objects: readonly BObject[]): ObjectID => {
    const laid = objects.map((object) => {
      const index = place(object);
      const rn = slot(object.db, object.pos, index);
      const record = databaseRecords(databases, object.db)[index];
      const field = contentsField(object.db);
      if (field) (record as unknown as Record<string, ObjectID>)[field] = lay(object.contents);
      if (object.db === DBType.SCROLL) {
        if (!object.scrollText) throw new Error('compose: a scroll without its text');
        scrolls.push({ record: record as ScrollRecord, text: object.scrollText });
      }
      return { record, rn };
    });
    laid.forEach(({ record }, i) => { record.nextObject = (laid[i + 1]?.rn ?? OBJECT_ID_EOF) as ObjectID; });
    return (laid[0]?.rn ?? OBJECT_ID_EOF) as ObjectID;
  };

  const objectList: ObjectID[] = [];
  const columnIndex: number[] = [];
  const levelIndex: number[] = [];
  world.levels.forEach((level) => {
    const { width, height } = level.descriptor;
    levelIndex.push(columnIndex.length);
    for (let x = 0; x < width; x++) {
      columnIndex.push(objectList.length);
      for (let y = 0; y < height; y++) {
        const objects = level.cells[x]?.[y] ?? [];
        level.cellFlags[x][y] = (level.cellFlags[x][y] & ~0x10) | (objects.length > 0 ? 0x10 : 0);
        if (objects.length > 0) objectList.push(lay(objects));
      }
    }
  });
  // A scroll's text: a record in no chain, linked `RNeof`, and a slot of its own after
  // every chain's.
  for (const { record, text } of scrolls) {
    const index = place(text);
    databases.texts.records[index].nextObject = OBJECT_ID_EOF;
    record.textReference = index;
    record.textObject = slot(DBType.TEXT, 0, index);
  }

  let dataOffset = 0;
  const maps = world.levels.map((level, mapIndex) => {
    const descriptor: MapDescriptor = {
      ...clone(level.descriptor),
      mapIndex,
      dataOffset: dataOffset & 0xffff,
      creatureTypesAllowed: level.monsterTypes.length,
      wallGraphicsCount: level.wallDecorationTOC.length,
      floorGraphicsCount: level.floorDecorationTOC.length,
      doorDecorationCount: level.doorDecorationTOC.length,
    };
    const { width, height } = descriptor;
    if (width < 1 || width > 32 || height < 1 || height > 32) throw new Error(`compose: map ${mapIndex} is ${width}x${height}`);
    dataOffset += width * height + level.monsterTypes.length + level.wallDecorationTOC.length +
      level.floorDecorationTOC.length + level.doorDecorationTOC.length;
    return {
      descriptor,
      cellFlags: level.cellFlags.map((column) => [...column]),
      monsterTypes: [...level.monsterTypes],
      wallDecorationTOC: [...level.wallDecorationTOC],
      floorDecorationTOC: [...level.floorDecorationTOC],
      doorDecorationTOC: [...level.doorDecorationTOC],
    };
  });

  const objectCounts = new Array<number>(16).fill(0);
  for (const [db, key] of Object.entries(KEYS)) {
    const database = databases[key as keyof Databases];
    database.count = database.records.length;
    objectCounts[Number(db)] = database.count;
  }
  const data: DungeonData = {
    header: {
      randomSeed: world.randomSeed,
      mapDataSize: dataOffset & 0xffff,
      numMaps: maps.length,
      word4Low: 0,
      textDataSize: indirectTextIndex.length,
      startPosition: new Position(world.start.x, world.start.y, 0),
      facing: world.start.facing,
      objectListSize: objectList.length,
      objectCounts,
    },
    maps,
    databases,
    textWords: compressedText,
    indirectTextIndex,
    compressedText,
    objectList,
    rnMaps: new RnMaps(() => undefined),
    columnIndex,
    levelIndex,
    item16: [],
    bigActuators: true,
    indirectText: true,
    newScrolls: true,
  };
  if (world.dsas) data.dsaIndex = { entries: clone(world.dsas) };
  if (world.levels.some((level) => level.dsaSelectors)) {
    if (world.levels.length > DSA_LEVELS) throw new Error(`compose: DSALevelIndex holds ${DSA_LEVELS} levels, not ${world.levels.length}`);
    data.dsaLevelIndex = Array.from({ length: DSA_LEVELS }, (_, z) => {
      const selectors = world.levels[z]?.dsaSelectors ?? new Array<number>(DSA_SELECTORS).fill(DSA_NONE);
      if (selectors.length !== DSA_SELECTORS) throw new Error(`compose: map ${z} has ${selectors.length} DSA selectors`);
      for (const dsa of selectors) {
        if (dsa === DSA_NONE || dsa === DSA_GRAPHIC) continue;
        if (!world.dsas?.[dsa]) throw new Error(`compose: map ${z} names DSA ${dsa}, which is missing`);
      }
      return [...selectors];
    });
  }
  data.rnMaps = rnMapsOf(() => data.databases, {
    length: typeMap.length, typeMap: Uint8Array.from(typeMap), indexMap: Uint16Array.from(indexMap),
  });
  return data;
}

// ---------------------------------------------------------------------------------------
// Objects made from nothing.

/** `RoomType` in the flag byte's top three bits. */
export const roomFlag = (roomType: number, attributes = 0): number => ((roomType & 7) << 5) | (attributes & 0x0f);
/** A teleporter square's attributes: `0x08` active, `0x04` visible (`CSBTypes.h`). */
export const TELEPORTER_ACTIVE = 0x08;
export const TELEPORTER_VISIBLE = 0x04;

export interface ActuatorSpec {
  type: number;
  value?: number;
  action?: ActuatorAction;
  once?: boolean;
  normallyClosed?: boolean;
  audible?: boolean;
  /** Ticks, 0-15. */
  delay?: number;
  /** `wallGraphicOrdinal`: 1 and up, an entry of the level's wall decoration table. */
  graphic?: number;
  target: { x: number; y: number; pos?: number };
}

/** A `DB3` (`doc/CSBwin-src/CSB.h:930-1078`) in its ten-byte form, aimed at a target. */
export function actuator(spec: ActuatorSpec, pos = 0): BObject {
  if ((spec.delay ?? 0) > 15) throw new Error('actuator: a delay is four bits');
  if ((spec.graphic ?? 0) > 15) throw new Error('actuator: a wall graphic ordinal is four bits');
  const record: ActuatorRecord = {
    nextObject: OBJECT_ID_EOF,
    word2: (spec.type & 0x7f) | ((spec.value ?? 0) << 7),
    word4: ((spec.once ? 1 : 0) << 2) | ((spec.action ?? ActuatorAction.SET) << 3) |
      ((spec.normallyClosed ? 1 : 0) << 5) | ((spec.audible ? 1 : 0) << 6) | ((spec.delay ?? 0) << 7) |
      ((spec.graphic ?? 0) << 12),
    word6: ((spec.target.pos ?? 0) << 4) | (spec.target.x << 6) | (spec.target.y << 11),
    word8: 0,
  };
  return { db: DBType.ACTUATOR, pos, record, contents: [] };
}

export interface DsaActuatorSpec {
  /** Bits 7-11 of `word2`: the entry of the level's `dsaSelectors`. */
  selector: number;
  /** `DSAstate`, bits 12-15 of `word2`: the state of a DSA whose `localState` is 0. */
  state?: number;
  /** `ParameterA`: `word4` and bits 0-1 of `word8`. A wall decoration's section. */
  parameterA?: number;
  /** `ParameterB`: `word6` and bits 2-3 of `word8`. */
  parameterB?: number;
}

/**
 * A type 47 `DB3`, a DSA's actuator (`doc/CSBwin-src/CSB.h:1051-1057`, its parameters
 * `data.cpp:1338-1358`), in its ten-byte form.
 */
export function dsaActuator(spec: DsaActuatorSpec, pos = 0): BObject {
  const a = spec.parameterA ?? 0;
  const b = spec.parameterB ?? 0;
  if (spec.selector < 0 || spec.selector >= DSA_SELECTORS) throw new Error('dsaActuator: a selector is five bits');
  if ((spec.state ?? 0) > 15) throw new Error('dsaActuator: a state is four bits');
  if (a < 0 || a >= 1 << 18 || b < 0 || b >= 1 << 18) throw new Error('dsaActuator: a parameter is 18 bits');
  const record: ActuatorRecord = {
    nextObject: OBJECT_ID_EOF,
    word2: 47 | (spec.selector << 7) | ((spec.state ?? 0) << 12),
    word4: a & 0xffff,
    word6: b & 0xffff,
    word8: ((a >> 16) & 3) | (((b >> 16) & 3) << 2),
  };
  return { db: DBType.ACTUATOR, pos, record, contents: [] };
}

export interface TeleporterSpec {
  map: number;
  x: number;
  y: number;
  rotation: number;
  absolute: boolean;
  /** 0 items, 1 creatures, 2 items and party, 3 everything. */
  scope: number;
  sound?: boolean;
}

/** A `DB1` (`doc/CSBwin-src/CSB.h:850-873`). */
export function teleporter(spec: TeleporterSpec): BObject {
  const record: TeleporterRecord = {
    nextObject: OBJECT_ID_EOF, sound: spec.sound ?? true, scope: spec.scope, absoluteRotation: spec.absolute,
    rotation: spec.rotation, destX: spec.x, destY: spec.y, destMap: spec.map, word4Low: 0,
  };
  return { db: DBType.TELEPORTER, pos: 0, record, contents: [] };
}

/** A `DB2` holding `words`: hidden unless `visible`. */
export function textObject(words: number[], visible: boolean): BObject {
  const record: TextRecord = { nextObject: OBJECT_ID_EOF, textOffset: 0, visible, word2Bits1_2: 0 };
  return { db: DBType.TEXT, pos: 0, record, contents: [], words };
}

/**
 * A message as `DecodeText` reads it back for a message (`typeOfText` 1,
 * `src/data/DecodeText.ts`): A-Z 0-25, space 26, `.` 27, then code 30 and the index of
 * the escape table entry (`byte10016`, 8 bytes each) holding the character, a line feed
 * code 28, the line break of a wall's text, 31 to end, three codes to a word from bit 10
 * down. Any other character is refused.
 */
export function encodeMessage(text: string, escapes: Uint8Array): number[] {
  const codes: number[] = [];
  for (const char of text) {
    if (char >= 'A' && char <= 'Z') codes.push(char.charCodeAt(0) - 65);
    else if (char === ' ') codes.push(26);
    else if (char === '.') codes.push(27);
    else if (char === '\n') codes.push(28);
    else {
      const entry = Array.from({ length: escapes.length / 8 }, (_, i) => i)
        .find((i) => escapes[i * 8] === char.charCodeAt(0) && escapes[i * 8 + 1] === 0);
      if (entry === undefined) throw new Error(`encodeMessage: no code for ${JSON.stringify(char)}`);
      codes.push(30, entry);
    }
  }
  codes.push(31);
  while (codes.length % 3 !== 0) codes.push(31);
  const words: number[] = [];
  for (let i = 0; i < codes.length; i += 3) words.push((codes[i] << 10) | (codes[i + 1] << 5) | codes[i + 2]);
  return words;
}

// ---------------------------------------------------------------------------------------
// Levels edited.

/**
 * Add `count` columns or rows of `flag` on one side of a level. On the north or west the
 * level's offset moves back by as much, so every square keeps its place in the dungeon,
 * and everything that names one of its squares follows it: actuators aimed on the level
 * (`actuatorAims`), teleporters of `world` aimed into it, and the party's start.
 */
export function growLevel(world: BWorld, z: number, side: 'north' | 'south' | 'west' | 'east', count: number, flag: number): void {
  const level = world.levels[z];
  const d = level.descriptor;
  const blankColumn = (): number[] => new Array<number>(d.height).fill(flag);
  if (side === 'east' || side === 'west') {
    const columns = Array.from({ length: count }, blankColumn);
    const cells = Array.from({ length: count }, () => Array.from({ length: d.height }, (): BObject[] => []));
    if (side === 'east') { level.cellFlags.push(...columns); level.cells.push(...cells); } else {
      level.cellFlags.unshift(...columns); level.cells.unshift(...cells);
    }
    d.width += count;
  } else {
    for (let x = 0; x < d.width; x++) {
      const flags = new Array<number>(count).fill(flag);
      const cells = Array.from({ length: count }, (): BObject[] => []);
      if (side === 'south') { level.cellFlags[x].push(...flags); level.cells[x].push(...cells); } else {
        level.cellFlags[x].unshift(...flags); level.cells[x].unshift(...cells);
      }
    }
    d.height += count;
  }
  const dx = side === 'west' ? count : 0;
  const dy = side === 'north' ? count : 0;
  if (dx === 0 && dy === 0) return;
  if (d.offsetX < dx || d.offsetY < dy) throw new Error(`growLevel: map ${z} would leave the dungeon`);
  d.offsetX -= dx;
  d.offsetY -= dy;
  if (z === 0) { world.start.x += dx; world.start.y += dy; }
  for (const [x, y, chain] of squaresOf(level)) {
    const stone = (level.cellFlags[x][y] >> 5) === 0;
    for (const object of chain) {
      if (object.db !== DBType.ACTUATOR) continue;
      const record = object.record as ActuatorRecord;
      if (!actuatorAims(record, stone)) continue;
      const tx = ((record.word6 >> 6) & 0x1f) + dx;
      const ty = ((record.word6 >> 11) & 0x1f) + dy;
      record.word6 = (record.word6 & 0x3f) | (tx << 6) | (ty << 11);
    }
  }
  world.levels.forEach((other) => {
    for (const object of objectsOf(other)) {
      if (object.db !== DBType.TELEPORTER) continue;
      const record = object.record as TeleporterRecord;
      if (record.destMap !== z) continue;
      record.destX += dx;
      record.destY += dy;
    }
  });
}

/**
 * Whether an actuator's `word6` is a target square (`QueueSwitchAction`,
 * `doc/CSBwin-src/Code11f52.cpp:3601-3671`), by its type and its square, as
 * `PressurePadOrAlcove` tells them apart (`:3720-3860`, `doc/ACTUATORS.md`). On a floor:
 * the pads 1-4 and 7-9 aim; a type 6 is a monster generator, whose `word6` is its own.
 * In a wall: the switches and locks 1-4 and 11, the gate 5 and the counter 6 aim; the
 * missile launchers 7-10, 14 and 15 keep their energy there. A local action, a mirror
 * (127), a DSA (47) and a spent actuator (0) aim at nothing. Any other type is refused,
 * so a level is never grown past an actuator nobody looked at.
 */
export function actuatorAims(record: ActuatorRecord, stone: boolean): boolean {
  const type = getActuatorType(record);
  if (isActuatorLocalActionOnly(record) || type === 0 || type === 47 || type === 127) return false;
  const aims = stone ? [1, 2, 3, 4, 5, 6, 11] : [1, 2, 3, 4, 7, 8, 9];
  const keeps = stone ? [7, 8, 9, 10, 14, 15] : [6];
  if (aims.includes(type)) return true;
  if (keeps.includes(type)) return false;
  throw new Error(`growLevel: an actuator of type ${type} ${stone ? 'in a wall' : 'on a floor'} needs looking at`);
}

/** Every object of a level, contents and scroll texts included. */
export function* objectsOf(level: BLevel): Generator<BObject> {
  function* walk(objects: BObject[]): Generator<BObject> {
    for (const object of objects) {
      yield object;
      yield* walk(object.contents);
    }
  }
  for (const column of level.cells) for (const cell of column) yield* walk(cell);
}

/** The squares of a level and their chains, `[x, y, chain]`. */
export function* squaresOf(level: BLevel): Generator<[number, number, BObject[]]> {
  for (let x = 0; x < level.cells.length; x++) {
    for (let y = 0; y < level.cells[x].length; y++) yield [x, y, level.cells[x][y]];
  }
}

/** A JSON of the world as `decompose` gives it, for comparing two. */
export function canonical(world: BWorld): string {
  return JSON.stringify(world, (key, value) => {
    // The links and the indices `compose` numbers again.
    if (key === 'nextObject' || key === 'possession' || key === 'containedObject' || key === 'projectileObject' ||
      key === 'textObject' || key === 'textReference' || key === 'textOffset' || key === 'mapIndex' ||
      key === 'dataOffset') return undefined;
    if (key === 'cellFlags') return (value as number[][]).map((column) => column.map((f) => f & ~0x10));
    return value;
  });
}
