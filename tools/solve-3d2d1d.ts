/**
 * Solve 3D2D1D (`static/gamefiles/3D2D1D/`). This is a model of the CSBWin movement the port
 * does not have yet (vertical moves and gravity, `DEBT.md` G30), and a shortest-route search
 * over it. It computes the routes in `static/gamefiles/3D2D1D/WALKTHROUGH.md`, and it
 * checks that document against the model. `ANALYSIS.md` beside it explains the puzzles.
 *
 * Like `peek-dungeon.ts`, this is **not evidence** about the port. It models CSBWin itself,
 * outside the engine, because the engine cannot move vertically or fall yet. It is not in
 * `tools/run-checks.mjs`. Once G30 is paid, a `watch-*.ts` should replay the walkthrough
 * through the real `Game`.
 *
 * Modelled from CSBWin:
 *  - `MoveParty` (`doc/CSBwin-src/CSBCode.cpp:8031-8437`): the move history
 *    (`:8128-8164`), the sideways and vertical arms (`:8255-8308`) and the wall bump
 *    (`:8309-8377`).
 *  - `GravityMove` (`doc/CSBwin-src/Mouse.cpp:1259-1370`).
 *  - Teleporters (`Code11f52.cpp:2950-3025`) and the type-9 pads (`:3840-3844`).
 *  - Wall clicks (`TouchWall`, `Mouse.cpp:291`), `QueueSwitchAction`
 *    (`Code11f52.cpp:3601-3671`), the DSA dispatch of `ProcessTT_STONEROOM`
 *    (`Timer.cpp:2222`) and `ProcessTT_TELEPORTER`.
 *  - The four DSA commands the dungeon uses: MESSAGE, OVERRIDE, COPYTELEPORTER and GOSUB
 *    (`DSA.cpp`, layouts at `Data.h:1904-2140`).
 *
 * Not modelled: the monsters' AI (a search pins the Screamers to one square), timing
 * beyond order, stamina, food and the party's move delay. None of these changes where a
 * move ends.
 *
 * Run: `npx tsx tools/solve-3d2d1d.ts <command>`
 *
 *   solve          every leg of the playthrough, as the walkthrough's key blocks
 *   replay [file]  replay WALKTHROUGH.md (or `file`) in the model; exit 1 on a mismatch
 *   table          the 1D corridor: where each step leads, and the shortest ways through
 *   reach          the 3D maze's resting squares, and which Screamer squares open map 5 (9,3)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import {
  ActuatorAction, getActuatorAction, getActuatorDsaSelector, getActuatorDsaState, getActuatorParameterA,
  getActuatorParameterB, getActuatorTargetPos, getActuatorTargetX, getActuatorTargetY, getActuatorType,
  getActuatorValue, isActuatorLocalActionOnly, setActuatorDsaState,
} from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { ActuatorRecord, DungeonData, TeleporterRecord } from '../src/data/dungeonTypes';
import { DungeonState } from '../src/engine/DungeonState';

const DIR = 'static/gamefiles/3D2D1D';
const data: DungeonData = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(DIR, 'dungeon.dat'))));
const NLEV = data.maps.length;
const width = (l: number): number => data.maps[l]!.descriptor.width;
const height = (l: number): number => data.maps[l]!.descriptor.height;

/* ------------------------------------------------------------------ the world ----- */

interface Teleporter { destMap: number; destX: number; destY: number; scope: number; rotation: number; absolute: boolean }
/** An actuator of a square, in chain order, as a copy: the model changes DSA states. */
interface Actuator { pos: number; rec: ActuatorRecord }

/** What the model changes: cell flags, teleporters, actuators, where monsters stand. */
interface World {
  flags: number[][][];
  teleporters: Map<string, Teleporter>;
  actuators: Map<string, Actuator[]>;
  monsters: Set<string>;
}

const key = (l: number, x: number, y: number): string => `${l},${x},${y}`;

function loadWorld(): World {
  const dungeon = new DungeonState(data);
  const world: World = { flags: [], teleporters: new Map(), actuators: new Map(), monsters: new Set() };
  for (let l = 0; l < NLEV; l++) {
    world.flags.push([]);
    for (let x = 0; x < width(l); x++) {
      world.flags[l]!.push([]);
      for (let y = 0; y < height(l); y++) {
        world.flags[l]![x]!.push(Number(data.maps[l]!.cellFlags[x]![y]));
        const seen = new Set<number>();
        for (let rn: ObjectID = dungeon.findFirstObject(new Position(x, y, l));
          rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL && !seen.has(rn);
          rn = dungeon.getDBRecordLink(rn)) {
          seen.add(rn);
          const { category, index, position } = dungeon.rnMaps.decode(rn);
          const k = key(l, x, y);
          if (category === DBType.TELEPORTER && !world.teleporters.has(k)) {
            const t = data.databases.teleporters.records[index] as TeleporterRecord;
            world.teleporters.set(k, {
              destMap: t.destMap, destX: t.destX, destY: t.destY, scope: t.scope & 3, rotation: t.rotation, absolute: t.absoluteRotation,
            });
          } else if (category === DBType.ACTUATOR) {
            const list = world.actuators.get(k) ?? [];
            list.push({ pos: position, rec: { ...(data.databases.actuators.records[index] as ActuatorRecord) } });
            world.actuators.set(k, list);
          } else if (category === DBType.CREATURE) {
            world.monsters.add(k);
          }
        }
      }
    }
  }
  return world;
}

function cloneWorld(w: World): World {
  return {
    flags: w.flags.map((col) => col.map((cells) => cells.slice())),
    teleporters: new Map([...w.teleporters].map(([k, t]) => [k, { ...t }])),
    actuators: new Map([...w.actuators].map(([k, list]) => [k, list.map((a) => ({ pos: a.pos, rec: { ...a.rec } }))])),
    monsters: new Set(w.monsters),
  };
}

/** `GetCellFlags`: off the map is stone (`CSBCode.cpp:4677-4725`). */
function flagsAt(w: World, l: number, x: number, y: number): number {
  if (l < 0 || l >= NLEV || x < 0 || y < 0 || x >= width(l) || y >= height(l)) return 0;
  return w.flags[l]![x]![y]!;
}
const roomType = (flags: number): RoomType => ((flags >> 5) & 7) as RoomType;

/* ------------------------------------------------------------------ the party ----- */

interface Party {
  l: number; x: number; y: number; facing: number;
  /** `moveHistory[0..2]`: the axes, most recently used first. 0 east-west, 1 north-south, 2 vertical. */
  order: number[];
  /** `moveHistory[3]`: bit `axis` set when the last move along it went east, south or down. */
  signs: number;
}

const copyParty = (p: Party): Party => ({ ...p, order: p.order.slice() });
const partyKey = (p: Party): string => `${p.l},${p.x},${p.y},${p.order.join('')},${p.signs}`;
const at = (p: Party): string => `${p.l}:${p.x},${p.y}`;

/** Absolute directions: 0-3 north, east, south, west; 4 down (`-`, 0x1124); 5 up (`+`, 0x1125). */
const DIRECTION = ['N', 'E', 'S', 'W', 'Dn', 'Up'];
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

interface Events { bumps: number }
const noEvents = (): Events => ({ bumps: 0 });

/** `MoveParty` for an absolute direction. `gravity` is CSBWin's `gravityMove`. */
function moveParty(w: World, p: Party, dir: number, gravity: boolean, ev: Events): void {
  if (!gravity) {
    // `CSBCode.cpp:8128-8164`: axis and sign recorded before anything is tested.
    const axis = dir <= 3 ? (dir + 1) & 1 : 2;
    const delta = dir <= 3 ? ((dir + 1) & 2) >> 1 : (dir & 1) ^ 1;
    p.signs |= 1 << axis;
    if (delta === 0) p.signs ^= 1 << axis;
    if (p.order[2] === axis) { p.order[2] = p.order[1]!; p.order[1] = axis; }
    if (p.order[1] === axis) { p.order[1] = p.order[0]!; p.order[0] = axis; }
  }
  if (dir <= 3) {
    const nx = p.x + DX[dir]!, ny = p.y + DY[dir]!;
    const f = flagsAt(w, p.l, nx, ny);
    const t = roomType(f);
    const blocked = t === RoomType.STONE
      || (t === RoomType.DOOR && (f & 7) !== 0 && (f & 7) !== 1 && (f & 7) !== 5)
      || (t === RoomType.FALSEWALL && (f & 4) === 0 && (f & 1) === 0);
    if (blocked) { ev.bumps++; return; }
    if (w.monsters.has(key(p.l, nx, ny))) return;
    arrive(w, p, p.l, nx, ny, ev);
    return;
  }
  // `UpdateXY`/`IncrementLevel`: x and y kept, every map being at offset (0,0).
  const nl = dir === 4 ? p.l + 1 : p.l - 1;
  const shaft = nl >= 0 && nl < NLEV && p.x < width(nl) && p.y < height(nl)
    && roomType(dir === 5 ? flagsAt(w, nl, p.x, p.y) : flagsAt(w, p.l, p.x, p.y)) === RoomType.PIT;
  if (!shaft) { ev.bumps++; return; }
  if (w.monsters.has(key(nl, p.x, p.y))) return;
  arrive(w, p, nl, p.x, p.y, ev);
}

/** The party lands on a square: its teleporter (chained), then its type-9 pads. */
function arrive(w: World, p: Party, l: number, x: number, y: number, ev: Events, depth = 0): void {
  p.l = l; p.x = x; p.y = y;
  const f = flagsAt(w, l, x, y);
  const t = w.teleporters.get(key(l, x, y));
  if (roomType(f) === RoomType.TELEPORTER && (f & 8) && t && t.scope >= 2 && depth < 20) {
    p.facing = t.absolute ? t.rotation : (p.facing + t.rotation) & 3;
    arrive(w, p, t.destMap, t.destX, t.destY, ev, depth + 1);
    return;
  }
  for (const a of w.actuators.get(key(l, x, y)) ?? []) {
    if (getActuatorType(a.rec) === 9 && getActuatorValue(a.rec) <= 20) queueSwitchAction(w, l, a.rec);
  }
  deliverAll(w);
}

/** `GravityMove`: the next gravity step as an absolute direction, or -1 when nothing moves. */
function gravityStep(w: World, p: Party): number {
  for (let i = 2; i >= 0; i--) {
    const axis = p.order[i]!;
    const delta = (p.signs & (1 << axis)) ? 1 : -1;
    let l = p.l, x = p.x, y = p.y;
    if (axis === 0) x += delta; else if (axis === 1) y += delta; else l += delta;
    if (x < 0 || y < 0 || l < 0 || l >= NLEV || x > width(l) - 1 || y > height(l) - 1) continue;
    const here = roomType(flagsAt(w, p.l, p.x, p.y));
    const there = roomType(flagsAt(w, l, x, y));
    if (axis <= 1) { if (there !== RoomType.PIT && there !== RoomType.OPEN) continue; }
    else if (delta === 1) { if (here !== RoomType.PIT) continue; }
    else if (there !== RoomType.PIT) continue;
    if (w.monsters.has(key(l, x, y))) continue;
    if (axis === 0) return delta === 1 ? 1 : 3;
    if (axis === 1) return delta === 1 ? 2 : 0;
    return delta === 1 ? 4 : 5;
  }
  return -1;
}

/** One key press and the gravity after it, to rest. Returns the squares passed. */
function press(w: World, p: Party, dir: number, ev: Events): string[] {
  const path: string[] = [];
  moveParty(w, p, dir, false, ev);
  path.push(at(p));
  for (let n = 0; n < 500; n++) {
    const g = gravityStep(w, p);
    if (g < 0) return path;
    moveParty(w, p, g, true, ev);
    path.push(at(p));
  }
  throw new Error('gravity does not settle');
}

/* ------------------------------------------------------------------ switches, DSAs -- */

interface Message { l: number; x: number; y: number; pos: number; action: ActuatorAction }
const pending: Message[] = [];

/** `QueueSwitchAction`, for a non-local actuator (a local one only rotates a list). */
function queueSwitchAction(w: World, l: number, rec: ActuatorRecord): void {
  if (isActuatorLocalActionOnly(rec)) return;
  const x = getActuatorTargetX(rec), y = getActuatorTargetY(rec);
  queue(w, l, x, y, getActuatorTargetPos(rec), getActuatorAction(rec));
}

/** A message is addressed to a corner only in stone or a false wall (`Code11f52.cpp:3601-3671`). */
function queue(w: World, l: number, x: number, y: number, pos: number, action: ActuatorAction): void {
  const t = roomType(flagsAt(w, l, x, y));
  pending.push({ l, x, y, pos: t === RoomType.STONE || t === RoomType.FALSEWALL ? pos : 0, action });
}

function deliverAll(w: World): void {
  for (let n = 0; pending.length; n++) {
    if (n > 1000) throw new Error('message storm');
    const m = pending.shift()!;
    const t = roomType(flagsAt(w, m.l, m.x, m.y));
    if (t === RoomType.TELEPORTER) {
      // `ProcessTT_TELEPORTER`: the active bit. The pulses here move items only.
      const f = w.flags[m.l]![m.x]![m.y]!;
      const on = m.action === ActuatorAction.TOGGLE ? !(f & 8) : m.action === ActuatorAction.SET;
      w.flags[m.l]![m.x]![m.y] = on ? f | 8 : f & ~8;
    } else if (t === RoomType.STONE) {
      // `ProcessTT_STONEROOM`: every type-47 actuator of the square, whatever its corner.
      for (const a of w.actuators.get(key(m.l, m.x, m.y)) ?? []) {
        if (getActuatorType(a.rec) === 47) runDsa(w, m.l, a.rec, 3 * m.pos + m.action);
      }
    }
  }
}

const location = (v: number) => ({ l: (v >> 10) & 63, x: (v >> 5) & 31, y: v & 31, p: (v >> 16) & 3 });

/** `ProcessDSATimer6` and `Execute` for this dungeon's four commands. */
function runDsa(w: World, l: number, rec: ActuatorRecord, column: number): void {
  const dsa = data.dsaIndex!.entries[data.dsaLevelIndex![l]![getActuatorDsaSelector(rec)]!]!;
  let override: number | null = null;
  const target = (type: number) => {
    if (type > 1) throw new Error(`DSA target type ${type}`);
    const r = location(type === 0 ? getActuatorParameterA(rec) : getActuatorParameterB(rec));
    if (override !== null) { r.p = override; override = null; }
    return r;
  };
  // A GOSUB's own next state is discarded (`EX_GOSUB`, `DSA.cpp`); the first command's wins.
  const execute = (state: number, col: number): number => {
    const program = dsa.states[state]?.actions.find((a) => a.column === col)?.program;
    if (!program) return state;
    let final: number | null = null;
    for (let pc = 0; pc < program.length;) {
      const word = program[pc++]!;
      let next: number;
      switch (word & 63) {
        case 1: { // MESSAGE: type 2 bits, delay 2, target 2, next state 4
          next = state + ((word << 16) >> 28);
          if (((word >> 8) & 3) === 3) pc++; // an explicit delay word
          const r = target((word >> 10) & 3);
          const type = (word >> 6) & 3;
          if (type !== 0) queue(w, r.l, r.x, r.y, r.p, (type - 1) as ActuatorAction);
          break;
        }
        case 2: // OVERRIDE: what 3 bits (1 = position), value 3, next state 4
          if (((word >> 6) & 7) !== 1) throw new Error('DSA override');
          override = (word >> 9) & 7;
          next = state + ((word << 16) >> 28);
          break;
        case 4: { // COPYTELEPORTER: from 2 bits, to 2, next state 6
          const from = target((word >> 6) & 3), to = target((word >> 8) & 3);
          next = state + ((word << 16) >> 26);
          const src = w.teleporters.get(key(from.l, from.x, from.y)), dst = w.teleporters.get(key(to.l, to.x, to.y));
          if (src && dst) {
            Object.assign(dst, src);
            w.flags[to.l]![to.x]![to.y] = w.flags[from.l]![from.x]![from.y]!;
          }
          break;
        }
        case 5: // GOSUB: row 6 bits, column 1, next state 3
          if (((word >> 6) & 63) === 63 || ((word >> 12) & 1)) throw new Error('DSA gosub form');
          next = state + ((word << 16) >> 29);
          execute((word >> 6) & 63, 0);
          break;
        default:
          throw new Error(`DSA command ${word & 63}`);
      }
      if (final === null && next >= 0) final = next;
    }
    return final ?? state;
  };
  setActuatorDsaState(rec, execute(getActuatorDsaState(rec), column));
}

/**
 * A wall clicked empty-handed: `TouchWall` queues every actuator on the face, then
 * `RotateActuatorList` moves the first behind the last when one was a local action 2.
 * The 1D levers (type 2, normally closed) are the only use here.
 */
function clickWall(w: World, l: number, x: number, y: number, face: number): void {
  const list = w.actuators.get(key(l, x, y)) ?? [];
  let rotate = false;
  for (const a of list) {
    if (a.pos !== face || getActuatorType(a.rec) === 0) continue;
    if (isActuatorLocalActionOnly(a.rec)) rotate = true;
    else queueSwitchAction(w, l, a.rec);
  }
  deliverAll(w);
  if (rotate) {
    const i = list.findIndex((a) => a.pos === face);
    const last = list.map((a) => a.pos).lastIndexOf(face);
    if (i >= 0 && last > i) list.splice(last, 0, list.splice(i, 1)[0]!);
  }
}

/* ------------------------------------------------------------------ search -------- */

interface Step { dir: number; end: string; bumps: number }
interface Route { steps: Step[]; end: Party; bumps: number }

const BUMP_COST = 3;

/**
 * Dijkstra over (square, gravity memory) in a world no move changes. Cost is presses
 * plus `BUMP_COST` per bump, so the route bumps only when bumping saves presses.
 */
function solve(w: World, start: Party, goal: (p: Party) => boolean): Route | null {
  const dist = new Map<string, number>([[partyKey(start), 0]]);
  const came = new Map<string, { from: string; step: Step; party: Party }>();
  const buckets: Array<Array<{ k: string; p: Party }>> = [[{ k: partyKey(start), p: copyParty(start) }]];
  for (let c = 0; c < buckets.length; c++) {
    for (const { k, p } of buckets[c] ?? []) {
      if (dist.get(k) !== c) continue;
      if (goal(p)) {
        const steps: Step[] = [];
        for (let kk = k; came.has(kk); kk = came.get(kk)!.from) steps.unshift(came.get(kk)!.step);
        return { steps, end: p, bumps: steps.reduce((n, s) => n + s.bumps, 0) };
      }
      for (let dir = 0; dir < 6; dir++) {
        const q = copyParty(p);
        const ev = noEvents();
        press(w, q, dir, ev);
        const nc = c + 1 + BUMP_COST * ev.bumps;
        const nk = partyKey(q);
        if ((dist.get(nk) ?? Infinity) <= nc) continue;
        dist.set(nk, nc);
        came.set(nk, { from: k, step: { dir, end: at(q), bumps: ev.bumps }, party: q });
        (buckets[nc] ??= []).push({ k: nk, p: q });
      }
    }
  }
  return null;
}

/** Every state reachable from `start`: where the party rests, and every square it passes. */
function explore(w: World, start: Party): { rest: Set<string>; passed: Set<string> } {
  const seen = new Set<string>([partyKey(start)]);
  const rest = new Set<string>(), passed = new Set<string>();
  const todo = [start];
  while (todo.length) {
    const p = todo.pop()!;
    rest.add(at(p));
    for (let dir = 0; dir < 6; dir++) {
      const q = copyParty(p);
      for (const s of press(w, q, dir, noEvents())) passed.add(s);
      if (!seen.has(partyKey(q))) { seen.add(partyKey(q)); todo.push(q); }
    }
  }
  return { rest, passed };
}

/* ------------------------------------------------------------------ the playthrough - */

/** The nine squares of map 6 the Screamers can walk. */
const SCREAMER_SQUARES = [[13, 5], [12, 5], [11, 5], [11, 6], [11, 7], [10, 7], [9, 7], [9, 8], [9, 9]];

type Key = number | 'lever';
type Goal = [number, number, number];

/**
 * The walkthrough, step by step. A `leg` is solved (or, in `replay`, read from the next
 * key block of the document); `keys` is a fixed sequence with its own block; `prose` is a
 * sequence the document gives in its text; `world` is what a click changes.
 */
type Part =
  | { kind: 'leg'; title: string; goal: Goal; robust?: boolean }
  | { kind: 'keys'; title: string; keys: Key[] }
  | { kind: 'prose'; keys: number[]; goal: Goal }
  | { kind: 'world'; apply: (w: World, p: Party) => void };

const N = 0, E = 1, S = 2, W = 3;
/** A door's state bits to 0, open. */
const openDoor = (l: number, x: number, y: number) => (w: World): void => { w.flags[l]![x]![y] = w.flags[l]![x]![y]! & 0xf8; };
/** A flag bit set: a false wall's 4 (open), a teleporter's 8 (active). */
const setFlag = (l: number, x: number, y: number, bit: number) => (w: World): void => { w.flags[l]![x]![y] = w.flags[l]![x]![y]! | bit; };
const screamersOn = (l: number, x: number, y: number) => (w: World): void => { w.monsters.clear(); w.monsters.add(key(l, x, y)); };

const PLAYTHROUGH: Part[] = [
  { kind: 'leg', title: 'A. start to (9,2), the mirror', goal: [0, 9, 2] },
  { kind: 'leg', title: 'B. to (7,3), the false-wall switch', goal: [0, 7, 3] },
  { kind: 'world', apply: setFlag(0, 7, 4, 4) },                              // the false wall opens
  { kind: 'leg', title: 'C. to map 7 (11,13), the green button', goal: [7, 11, 13] },
  { kind: 'leg', title: 'D. to map 6 (11,5), the generator switch', goal: [6, 11, 5] },
  { kind: 'world', apply: screamersOn(6, 13, 5) },                       // made at once
  { kind: 'leg', title: 'E. to map 6 (9,9), to wait', goal: [6, 9, 9] },
  { kind: 'world', apply: screamersOn(6, 9, 8) },                        // they come to (9,8)
  { kind: 'leg', title: 'F. to map 5 (9,3), the chest', goal: [5, 9, 3] },
  { kind: 'leg', title: 'G. to map 0 (3,2), the ruby keyhole', goal: [0, 3, 2], robust: true },
  { kind: 'world', apply: openDoor(0, 5, 4) },
  { kind: 'leg', title: 'H. to (5,5), gold key 1', goal: [0, 5, 5] },
  { kind: 'leg', title: 'I. to (11,4), the 2D switch', goal: [0, 11, 4] },
  { kind: 'world', apply: (w, p) => { setFlag(0, 11, 4, 8)(w); Object.assign(p, { l: 8, x: 29, y: 20, facing: 0 }); } },
  { kind: 'leg', title: 'J. map 8 to (30,29), gold key 2', goal: [8, 30, 29] },
  { kind: 'leg', title: 'K. to (30,20), the exit door', goal: [8, 30, 20] },
  { kind: 'world', apply: openDoor(8, 30, 21) },
  { kind: 'prose', keys: [S, S], goal: [0, 10, 4] },
  { kind: 'leg', title: 'L. to (15,5), the 1D switch', goal: [0, 15, 5] },
  { kind: 'world', apply: (w, p) => { setFlag(0, 15, 5, 8)(w); Object.assign(p, { l: 9, x: 1, y: 5, facing: 0 }); } },
  { kind: 'keys', title: 'M1. the corridor, to gold key 3', keys: [N, 'lever', E, E, 'lever', E, E, 'lever', E, S] },
  { kind: 'keys', title: 'M2. the corridor, back', keys: [N, W, N, 'lever', W, 'lever', W, W, S] },
  { kind: 'world', apply: openDoor(9, 0, 6) },
  { kind: 'prose', keys: [S, S], goal: [0, 3, 2] },
  { kind: 'leg', title: 'N. to (12,7), the first gold keyhole', goal: [0, 12, 7] },
  { kind: 'world', apply: openDoor(0, 12, 8) },
  { kind: 'leg', title: 'O. to (12,9), the second', goal: [0, 12, 9] },
  { kind: 'world', apply: openDoor(0, 13, 9) },
  { kind: 'leg', title: 'P. to (14,9), the third', goal: [0, 14, 9] },
  { kind: 'world', apply: openDoor(0, 15, 9) },
  { kind: 'leg', title: 'Q. to (17,9), the end', goal: [0, 17, 9] },
];

const startParty = (): Party => ({
  l: data.header.startPosition.z, x: data.header.startPosition.x, y: data.header.startPosition.y,
  facing: data.header.facing, order: [0, 1, 2], signs: 0, // `moveHistory`'s initial value (`data.cpp:246`)
});
const atGoal = (p: Party, g: Goal): boolean => p.l === g[0] && p.x === g[1] && p.y === g[2];
const token = (s: Step): string => `${DIRECTION[s.dir]}${s.bumps ? '!' : ''}→${s.end}`;

function keyBlock(tokens: string[]): string[] {
  const out = ['```'];
  for (let i = 0; i < tokens.length; i += 8) {
    out.push(`${String(i + 1).padStart(3)}  ${tokens.slice(i, i + 8).map((t) => t.padEnd(12)).join('').trimEnd()}`);
  }
  out.push('```');
  return out;
}

/** The legs' routes, and whether the robust one survives every Screamer square. */
function cmdSolve(): void {
  const w = loadWorld();
  const p = startParty();
  for (const part of PLAYTHROUGH) {
    if (part.kind === 'world') { part.apply(w, p); continue; }
    if (part.kind === 'prose') { for (const k of part.keys) press(w, p, k, noEvents()); continue; }
    if (part.kind === 'keys') {
      const tokens: string[] = [];
      for (const k of part.keys) {
        if (k === 'lever') { clickWall(w, 9, p.x, 3, S); tokens.push('lever'); continue; }
        const ev = noEvents();
        press(w, p, k, ev);
        tokens.push(token({ dir: k, end: at(p), bumps: ev.bumps }));
      }
      console.log([`### ${part.title}`, ...keyBlock(tokens)].join('\n'));
      continue;
    }
    const route = solve(w, p, (q) => atGoal(q, part.goal));
    if (!route) throw new Error(`${part.title}: unreachable`);
    console.log(`### ${part.title}: ${route.steps.length} presses, ${route.bumps} bumps`);
    if (part.robust) {
      const failing = [null, ...SCREAMER_SQUARES].filter((sq) => {
        const ww = cloneWorld(w);
        if (sq) screamersOn(6, sq[0]!, sq[1]!)(ww); else ww.monsters.clear();
        const q = copyParty(p);
        for (const s of route.steps) press(ww, q, s.dir, noEvents());
        return !atGoal(q, part.goal);
      });
      console.log(failing.length ? `(fails with the Screamers on ${failing.map((s) => s ? `(${s})` : 'none').join(' ')})`
        : '(works wherever the Screamers are)');
    }
    console.log(keyBlock(route.steps.map(token)).join('\n'));
    Object.assign(p, copyParty(route.end));
  }
}

/** Replay a walkthrough's key blocks in the model. Returns the number of mismatches. */
function cmdReplay(file: string): number {
  const blocks = [...readFileSync(resolve(file), 'utf8').matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const w = loadWorld();
  const p = startParty();
  let errors = 0, presses = 0, bumps = 0, used = 0;
  const fail = (what: string): void => { errors++; console.log(`MISMATCH ${what}`); };
  const go = (dir: number): Events => { const ev = noEvents(); press(w, p, dir, ev); presses++; bumps += ev.bumps; return ev; };
  for (const part of PLAYTHROUGH) {
    if (part.kind === 'world') { part.apply(w, p); continue; }
    if (part.kind === 'prose') {
      for (const k of part.keys) go(k);
      if (!atGoal(p, part.goal)) fail(`after the door: at ${at(p)}, expected ${part.goal}`);
      continue;
    }
    const block = blocks[used++];
    if (block === undefined) { fail(`no key block for ${part.title}`); break; }
    for (const line of block.split('\n')) {
      // `E→0:8,0` and `lever` tokens, as `solve` prints them.
      const tokens = [...line.matchAll(/\blever\b|(N|E|S|W|Dn|Up)(!?)→(\d+):(\d+),(\d+)/g)];
      if (!tokens.some((t) => t[1])) tokens.length = 0;
      for (const t of tokens) {
        if (!t[1]) { clickWall(w, 9, p.x, 3, S); continue; }
        const ev = go(DIRECTION.indexOf(t[1]));
        if ((ev.bumps > 0) !== (t[2] === '!')) fail(`${part.title}: ${t[0]} bump ${ev.bumps ? 'not marked' : 'marked, none happened'}`);
        if (at(p) !== `${t[3]}:${t[4]},${t[5]}`) fail(`${part.title}: ${t[0]} ended at ${at(p)}`);
      }
      if (tokens.length || part.kind !== 'keys') continue;
      // The corridor's blocks, written for people: "E → teleported to 9", "S → slides (29,5), …".
      const m = line.match(/^\s*(lever|N|E|S|W)\b(.*)$/);
      if (!m) continue;
      if (m[1] === 'lever') { clickWall(w, 9, p.x, 3, S); continue; }
      go(DIRECTION.indexOf(m[1]!));
      const tele = m[2]!.match(/teleported to (\d+)/);
      const squares = [...m[2]!.matchAll(/\((\d+),(\d+)\)/g)];
      const last = squares[squares.length - 1];
      const want = tele ? `9:${tele[1]},4` : last ? `${p.l}:${last[1]},${last[2]}` : null;
      if (want && at(p) !== want) fail(`${part.title}: ${line.trim()} ended at ${at(p)}`);
    }
    if (part.kind === 'leg' && !atGoal(p, part.goal)) fail(`${part.title}: ended at ${at(p)}`);
  }
  if (used !== blocks.length) fail(`${blocks.length} key blocks, ${used} used`);
  console.log(`${file}: ${used} key blocks, ${presses} presses, ${bumps} bumps, ${errors} mismatch${errors === 1 ? '' : 'es'}`);
  return errors;
}

/** The 1D corridor: each odd square's four exits, then the shortest ways from 1 to 29 and back. */
function cmdTable(): void {
  const exits = new Map<number, Array<number | null>>();
  console.log('| From | Lever down, W | Lever down, E | Lever up, W | Lever up, E |\n| --- | --- | --- | --- | --- |');
  for (let x = 1; x <= 29; x += 2) {
    const row: Array<number | null> = [];
    for (const up of [false, true]) for (const dir of [W, E]) {
      const w = loadWorld();
      const p: Party = { l: 9, x, y: 4, facing: 0, order: [1, 0, 2], signs: 0 };
      arrive(w, p, 9, x, 4, noEvents()); // the pad fires as the party lands
      if (up) clickWall(w, 9, x, 3, S);
      const ev = noEvents();
      press(w, p, dir, ev);
      row.push(ev.bumps ? null : p.x);
    }
    exits.set(x, row);
    console.log(`| ${x} | ${row.map((d) => d === null ? 'wall' : String(d)).join(' | ')} |`);
  }
  const LABEL = ['down W', 'down E', 'up W', 'up E'];
  for (const [from, to] of [[1, 29], [29, 1]]) {
    const prev = new Map<number, [number, number]>([[from!, [from!, -1]]]);
    for (const todo: number[] = [from!]; todo.length;) {
      const x = todo.shift()!;
      exits.get(x)?.forEach((d, i) => { if (d !== null && !prev.has(d)) { prev.set(d, [x, i]); todo.push(d); } });
    }
    const path: string[] = [];
    for (let x = to!; x !== from; x = prev.get(x)![0]) path.unshift(`${prev.get(x)![0]} (lever ${LABEL[prev.get(x)![1]]}) -> ${x}`);
    console.log(`\n${from} to ${to}: ${path.join(', ')}`);
  }
}

/** The 3D maze from its entrance: resting squares per level, and the Screamer squares that open map 5 (9,3). */
function cmdReach(): void {
  const w = loadWorld();
  const p = startParty();
  for (const part of PLAYTHROUGH.slice(0, 3)) {
    if (part.kind === 'world') part.apply(w, p);
    else if (part.kind === 'leg') Object.assign(p, copyParty(solve(w, p, (q) => atGoal(q, part.goal))!.end));
  }
  const { rest, passed } = explore(w, p);
  for (let l = 0; l <= 7; l++) console.log(`map ${l}: ${[...rest].filter((s) => s.startsWith(`${l}:`)).length} resting squares`);
  console.log(`map 5 (9,3): rest ${rest.has('5:9,3')}, passed ${passed.has('5:9,3')} (no monster)`);
  for (const [x, y] of SCREAMER_SQUARES) {
    const ww = cloneWorld(w);
    screamersOn(6, x!, y!)(ww);
    console.log(`Screamers on map 6 (${x},${y}): map 5 (9,3) ${explore(ww, p).rest.has('5:9,3') ? 'reachable' : 'unreachable'}`);
  }
}

/* ------------------------------------------------------------------ main ---------- */

const [command, arg] = process.argv.slice(2);
switch (command) {
  case 'solve': cmdSolve(); break;
  case 'replay': process.exitCode = cmdReplay(arg ?? `${DIR}/WALKTHROUGH.md`) ? 1 : 0; break;
  case 'table': cmdTable(); break;
  case 'reach': cmdReach(); break;
  default:
    console.log('usage: npx tsx tools/solve-3d2d1d.ts solve | replay [file] | table | reach');
    process.exitCode = command ? 1 : 0;
}
