/**
 * What a dungeon holds, counted from its data: its levels, the items on its squares by
 * kind, its monsters and their groups, and its DSAs with the operations their programs
 * call. The form that adds a set shows it (`src/ui/addDataSetForm.ts`), and
 * `tools/dump-dsa-census.ts` checks the DSA half against the port's operations.
 *
 * The objects counted are those a square's chain reaches, with what a monster carries
 * (`possession`) and what a container holds (`containedObject`): a record no chain links
 * is a free slot, not part of the dungeon.
 *
 * **The DSA census.** Every program decodes to its exact length with CSBWin's operand
 * layout, read off `EX_*` (`doc/CSBwin-src/DSA.cpp:575-1341`, `:1492-1516`, `:4987`) and
 * the command words (`doc/CSBwin-src/Data.h:1894-2399`). A field is a relative state
 * unless `IsMaxState`, which compares it with `-MAXSTATE`: in every command but `QUESTION`
 * that value is out of the field's signed range, so CSBWin never reads the extra word.
 * `Noop` (0), `2Dup` (23) and `I_FilteredCast` (120) have no case in `EX_AMPERSAND`'s
 * switch (`DSA.cpp:2393-4983`), and reach its default's "Illegal subcode in EX_AMPERSAND"
 * (`:4980-4982`): a program calling one, or a value `STKOP` lacks, calls an illegal
 * subcode.
 */
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../core/types';
import type { ContainerRecord, CreatureRecord, DungeonData } from '../data/dungeonTypes';
import { StkOp } from './dsa/DsaTypes';
import { DungeonState } from './DungeonState';

/** The `STKOP` values that are no `case` of `EX_AMPERSAND`'s switch, nor `I_Indirect`. */
export const NOT_OPERATIONS: ReadonlySet<number> = new Set<number>([StkOp.NOOP, StkOp.TWO_DUP, StkOp.I_FILTERED_CAST]);

/** The item databases, in `DBType` order: the kinds an item is counted under. */
export const ITEM_KINDS = ['weapons', 'clothing', 'scrolls', 'potions', 'containers', 'misc'] as const;
type ItemKind = typeof ITEM_KINDS[number];
const KIND_OF: Partial<Record<DBType, ItemKind>> = {
  [DBType.WEAPON]: 'weapons', [DBType.CLOTHING]: 'clothing', [DBType.SCROLL]: 'scrolls',
  [DBType.POTION]: 'potions', [DBType.CHEST]: 'containers', [DBType.MISC]: 'misc',
};

interface DsaCensus {
  /** The DSAs defined, and the programs of all their states. */
  dsas: number;
  programs: number;
  /** The programs that do not decode to their exact length. */
  undecoded: number;
  /** How often each command is used, by `DSACOMMAND` name. */
  commands: Map<string, number>;
  /** How often each `&` subcode is called, illegal ones included. */
  operations: Map<number, number>;
}

export interface DungeonCensus {
  /** The maps, and the levels they lie on: several maps may share a level. */
  maps: number;
  levels: number;
  items: Record<ItemKind, number>;
  /** The monster records, each a group of one to four, and the monsters in them. */
  groups: number;
  monsters: number;
  /** The `MONSTERTYPE`s the groups are of. */
  monsterTypes: number;
  dsa: DsaCensus;
}

/** `data` counted; it is read and never changed. */
export function dungeonCensus(data: DungeonData): DungeonCensus {
  const dungeon = new DungeonState(data);
  const items = Object.fromEntries(ITEM_KINDS.map((kind) => [kind, 0])) as Record<ItemKind, number>;
  const types = new Set<number>();
  let groups = 0;
  let monsters = 0;
  /** Every object once, so a damaged file's loop ends. */
  const seen = new Set<number>();
  const walk = (first: ObjectID): void => {
    for (let rn = first; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL && !seen.has(rn); rn = dungeon.getDBRecordLink(rn)) {
      seen.add(rn);
      const category = data.rnMaps.decode(rn).category;
      const kind = KIND_OF[category];
      if (kind) items[kind]++;
      if (category === DBType.CREATURE) {
        const creature = dungeon.getRecord(rn) as CreatureRecord | null;
        if (!creature) continue;
        groups++;
        monsters += creature.numMonM1 + 1;
        types.add(creature.creatureType);
        walk(creature.possession);
      } else if (category === DBType.CHEST) {
        const container = dungeon.getRecord(rn) as ContainerRecord | null;
        if (container) walk(container.containedObject);
      }
    }
  };
  data.maps.forEach((map, z) => {
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) walk(dungeon.findFirstObject(new Position(x, y, z)));
    }
  });
  return {
    maps: data.maps.length,
    levels: new Set(data.maps.map((map) => map.descriptor.level)).size,
    items,
    groups,
    monsters,
    monsterTypes: types.size,
    dsa: dsaCensus(data),
  };
}

/** `data`'s DSAs, each program decoded. */
export function dsaCensus(data: DungeonData): DsaCensus {
  const census: DsaCensus = { dsas: 0, programs: 0, undecoded: 0, commands: new Map(), operations: new Map() };
  for (const dsa of data.dsaIndex?.entries ?? []) {
    if (!dsa) continue;
    census.dsas++;
    for (const state of dsa.states) {
      for (const action of state?.actions ?? []) {
        census.programs++;
        if (!decode(action.program, census.commands, census.operations)) census.undecoded++;
      }
    }
  }
  return census;
}

/** The operations `census` calls, illegal subcodes apart, in `STKOP` order. */
export function operationsUsed(census: DsaCensus): number[] {
  return [...census.operations.keys()].filter((op) => !isIllegalSubcode(op)).sort((a, b) => a - b);
}

/** Whether `op` is no operation of `EX_AMPERSAND`'s: one of `NOT_OPERATIONS`, or no `STKOP`. */
export function isIllegalSubcode(op: number): boolean {
  return NOT_OPERATIONS.has(op) || StkOp[op] === undefined;
}

/**
 * `DSACOMMAND` (`Data.h:1710`): each command's relative-state field and its `MAXSTATE`
 * (`Data.h:1904-2399`), and the operand words its `EX_*` reads after the command word.
 */
interface CommandLayout {
  name: string;
  stateShift: number;
  stateBits: number;
  maxState: number;
  operands(word: number, program: Uint16Array, pc: number): number;
}

/** `GetTarget` (`DSA.cpp:593-634`): `TARGET_ABS` reads one word, two when 32-bit. */
function targetWords(target: number, thirtyTwo: boolean): number {
  return target === 2 ? (thirtyTwo ? 2 : 1) : 0;
}

const message = (thirtyTwo: boolean) => (word: number): number =>
  (((word >> 8) & 3) === 3 ? 1 : 0) + targetWords((word >> 10) & 3, thirtyTwo);
const copyTeleporter = (thirtyTwo: boolean) => (word: number): number =>
  targetWords((word >> 6) & 3, thirtyTwo) + targetWords((word >> 8) & 3, thirtyTwo);
const rowColumn = (word: number): number =>
  (((word >> 6) & 0x3f) === 63 ? 1 : 0) + ((word >> 12) & 1);
const none = (): number => 0;

const COMMANDS: Record<number, CommandLayout> = {
  1: { name: 'MESSAGE', stateShift: 12, stateBits: 4, maxState: -8, operands: message(false) },
  2: {
    name: 'OVERRIDE', stateShift: 12, stateBits: 4, maxState: -8,
    operands: (word) => (((word >> 6) & 7) === 1 && ((word >> 9) & 7) === 7 ? 1 : 0),
  },
  3: { name: 'NOOP', stateShift: 6, stateBits: 10, maxState: -512, operands: none },
  4: { name: 'COPYTELEPORTER', stateShift: 10, stateBits: 6, maxState: -32, operands: copyTeleporter(false) },
  5: { name: 'GOSUB', stateShift: 13, stateBits: 3, maxState: -4, operands: rowColumn },
  6: {
    name: 'LOAD', stateShift: 11, stateBits: 5, maxState: -16,
    // LOAD_INTEGER 26 and LOAD_ABS 27 read a word, LOAD_INTEGER32 30 two (`DSA.cpp:1100-1137`).
    operands: (word) => {
      const where = (word >> 6) & 0x1f;
      return where === 26 || where === 27 ? 1 : where === 30 ? 2 : 0;
    },
  },
  7: { name: 'FETCH', stateShift: 6, stateBits: 10, maxState: -512, operands: none },
  8: { name: 'EQUAL', stateShift: 6, stateBits: 10, maxState: -512, operands: none },
  9: {
    name: 'QUESTION', stateShift: 6, stateBits: 4, maxState: 2,
    // Both branches' words are stepped over whichever is taken (`DSA.cpp:869-928`).
    operands: (word) => (((word >> 11) & 3) !== 0 ? 1 : 0) + ((word >> 10) & 1)
      + (((word >> 14) & 3) !== 0 ? 1 : 0) + ((word >> 13) & 1),
  },
  11: { name: 'AMPERSAND', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  12: { name: 'JUMP', stateShift: 13, stateBits: 3, maxState: -4, operands: rowColumn },
  13: { name: 'STORE', stateShift: 11, stateBits: 5, maxState: -16, operands: none },
  14: { name: 'COPYTELEPORTER32', stateShift: 10, stateBits: 6, maxState: -32, operands: copyTeleporter(true) },
  15: { name: 'MESSAGE32', stateShift: 12, stateBits: 4, maxState: -8, operands: message(true) },
  // `numCase`, then four words a case (`DSA.cpp:1003-1033`).
  16: { name: 'CASE', stateShift: 6, stateBits: 10, maxState: -512, operands: (_w, p, pc) => 1 + 4 * (p[pc] ?? 0) },
  17: { name: 'VARIABLEFETCH', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  18: { name: 'VARIABLESTORE', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  19: { name: 'GLOBALFETCH', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  20: { name: 'GLOBALSTORE', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  21: { name: 'AMPERSAND2', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  22: { name: 'DESSAGE32', stateShift: 12, stateBits: 4, maxState: -8, operands: message(true) },
};

function signedField(word: number, shift: number, bits: number): number {
  const sign = 1 << (bits - 1);
  const value = (word >> shift) & ((1 << bits) - 1);
  return (value & (sign - 1)) - (value & sign);
}

/** Decode one program: false when a word is no command or the operands overrun it. */
function decode(program: Uint16Array, commands: Map<string, number>, operations: Map<number, number>): boolean {
  let pc = 0;
  while (pc < program.length) {
    const word = program[pc++] ?? 0;
    const layout = COMMANDS[word & 0x3f];
    if (!layout) return false;
    commands.set(layout.name, (commands.get(layout.name) ?? 0) + 1);
    if (signedField(word, layout.stateShift, layout.stateBits) === -layout.maxState) pc++;
    if (layout.name === 'AMPERSAND' || layout.name === 'AMPERSAND2') {
      const subcode = ((word >> 6) & 0x7f) + (layout.name === 'AMPERSAND2' ? 128 : 0);
      operations.set(subcode, (operations.get(subcode) ?? 0) + 1);
    }
    pc += layout.operands(word, program, pc);
  }
  return pc === program.length;
}
