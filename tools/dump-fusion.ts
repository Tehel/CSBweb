/**
 * `atk_FUSE` and `_Fusion` (doc/CSBwin-src/Attack.cpp:1963-1972, `:133-213`): the dispell
 * cloud on the square in front of the party, and Lord Chaos's escape from it.
 *
 * An arena on Lord Chaos's own level (12, where `monsterAllowedOnLevel` lets him stand):
 * seven squares by seven, empty of objects, made open around (6, 13), a Lord Chaos made
 * there, and the party on (6, 14) facing north, so the fusion lands on him. Every case is a fresh game.
 *
 * 1. **No Lord Chaos.** One dispell cloud, and nothing else (`:158-160`).
 * 2. **Off the map.** No cloud at all: the square is checked first (`:150-157`).
 * 3. **Free.** He steps next door, to the first square of the shuffled directions that
 *    is open, unoccupied and neither a Fluxcage nor a wall (`:163-199`). The tool
 *    replays the shuffle from the random seed after the cloud, `STRandom(i + 1)` for i
 *    from 3 down to 1, and his movement timers start where he lands.
 * 4. **Caged on three sides, the party on the fourth.** Nothing next door is free, but
 *    the square behind the party is: he jumps over the party (`:200-212`).
 * 5. **Caged on two sides, a monster on the third.** He jumps over the monster: the
 *    near square may be occupied, only not a Fluxcage or a wall.
 * 6. **Boxed in.** The square behind the party is stone: he stays, "toast" (`:213`),
 *    and `_FusionSequence` (`:2220`) holds the loop to the credits, `executeAttack`'s
 *    tail left undone: the game won, an open inventory hidden before the first view
 *    (run with one open and with none), the light and shields up, the cages on his square
 *    and the party's gone, the type at each of its 33 views, sound 17 thirteen times,
 *    `d.Word1868` set from the view after the Grey Lord's first, every other monster on
 *    the level deleted, the four texts of cell (0, 0) printed in the order of their letters
 *    780 VBLs apart, "THE END.", and `ShowCredits(1)` after its 4713 VBLs. A third run takes
 *    the "B" text off the cell, and only "A" is printed
 *    (`doc/PROVEN_FACTS.md` → "`_FusionSequence`: the end of the game"). Two more runs
 *    print onto a real `ScrollingText`, one that has printed nothing (`d.PrintRow` 0) and
 *    one that has scrolled and whose rows have timed out (`d.PrintRow` 3): every text is
 *    whole on the strip within three scrolls and stays until the next is printed, and
 *    "THE END." is there when the credits come, which is the port's own
 *    (`DEBT.md` H, "The ending's speech is shown whole").
 * 7. **A wall next door** blocks the square two away in that direction, open as it is.
 *
 * Run: `npx tsx tools/dump-fusion.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../src/core/types';
import { CsbRandom } from '../src/core/random';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { CloudType } from '../src/engine/cloudTypes';
import type { Game } from '../src/engine/Game';
import { createGameHost, type MessageSink } from '../src/engine/GameHost';
import { CHARFLAG_PORTRAIT_CHANGED, emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { DELTA_X, DELTA_Y } from '../src/engine/MonsterPerception';
import { AttackType, MonsterType } from '../src/engine/monsterTypes';
import { TimerFunction } from '../src/engine/TimerQueue';
import { ScrollingText } from '../src/renderer/csbwin/ScrollingText';
import { check, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';
import { newGame, stockGraphics, runVbl, TICK_DUE } from './lib/game';

const LEVEL = 12;
/** The only centres on level 12 with no object within three squares: (5-6, 13-14). */
const CX = 6;
const CY = 13;
const DIRECTION = ['north', 'east', 'south', 'west'];

function champion(): Champion {
  return {
    ...addCharacterDefaults(),
    name: 'FUSER',
    attributes: {
      health: 200, maxHealth: 200, stamina: 200, maxStamina: 200, mana: 200, maxMana: 200,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: 0,
  };
}

interface Arena {
  game: Game;
  /** `showCredits` as the host was asked it. */
  credits: boolean[];
  /** `showHideInventory` as the host was asked it: the argument, and the views drawn before. */
  inventory: Array<{ chIdx: number; views: number }>;
  /** `drawCharacterState` with `CHARFLAG_portraitChanged`: the champion, and the views drawn before. */
  portraits: Array<{ chIdx: number; views: number }>;
  /** `PrintLines` as the host was asked it, the VBL it came in, and the strip as it found it. */
  printed: Array<{ color: number; text: string; frame: number; strip: string }>;
  /** The views drawn so far (`drawViewport`). */
  views: number;
  /** Called on each `drawViewport`, the host's share of `_ProcessTimersViewportAndSound`. */
  drawn: () => void;
  frames: number;
  /** The random seed right after `atk_FUSE`'s dispell cloud: where `_Fusion`'s shuffle starts. */
  seedAfterCloud: number | null;
}

function setRoom(game: Game, x: number, y: number, roomType: RoomType): void {
  const map = game.ctx.dungeon.getMap(LEVEL)!;
  map.cellFlags[x]![y] = (roomType << 5) | (map.cellFlags[x]![y]! & 0x10);
}

/** What the strip shows, as one line: its rows end to end, a space between two. */
function shown(strip: ScrollingText | null): string {
  if (!strip) return '';
  return strip.snapshot().map((row) => row.trim()).filter((row) => row !== '').join(' ').replace(/ +/g, ' ');
}

/** The VBLs of one scroll: seven scanlines, and the VBL that clears `d.PushTextUp`. */
const SCROLL_VBLS = 8;

/**
 * A strip as a game that has printed leaves it: five lines printed, so the fifth scrolled
 * (`d.PrintRow` 3), and every row timed out since.
 */
function scrolledStrip(): ScrollingText {
  const strip = new ScrollingText();
  for (let line = 0; line < 5; line++) {
    strip.printLines(15, `\nLINE ${line}`, 0);
    for (let vbl = 0; vbl < SCROLL_VBLS; vbl++) {
      strip.vblInterrupt();
      strip.clockTick(0);
    }
  }
  if (shown(strip) !== 'LINE 1 LINE 2 LINE 3 LINE 4') throw new Error(`the strip did not scroll: ${shown(strip)}`);
  strip.clockTick(71);
  if (strip.hasText()) throw new Error('the strip\'s rows did not time out');
  return strip;
}

function arena(withLordChaos: boolean, strip: ScrollingText | null = null): Arena {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const hooks = { credits: [] as boolean[], drawn: (): void => {} };
  const sink: MessageSink = strip ?? createGameHost().messages;
  const game = newGame(data, stockGraphics(), {
    showCredits: (word11694) => hooks.credits.push(word11694),
    drawCharacterState: (chIdx, charFlags) => {
      if ((charFlags & CHARFLAG_PORTRAIT_CHANGED) !== 0) a.portraits.push({ chIdx, views: a.views });
    },
    showHideInventory: (chIdx) => a.inventory.push({ chIdx, views: a.views }),
    messages: {
      printLinefeed: () => sink.printLinefeed(),
      quePrintLines: (color, text) => sink.quePrintLines(color, text),
      printLines: (color, text, time) => {
        a.printed.push({ color, text, frame: a.frames, strip: shown(strip) });
        sink.printLines(color, text, time);
      },
      setNewSpeed: (oldSpeed, newSpeed, time) => sink.setNewSpeed(oldSpeed, newSpeed, time),
      resetTime: (newTime, time) => sink.resetTime(newTime, time),
      clockTick: (time) => sink.clockTick(time),
      printNextQueued: (time) => sink.printNextQueued(time),
      vblInterrupt: () => sink.vblInterrupt(),
    },
    drawViewport: () => {
      a.views++;
      a.drawn();
    },
  });
  game.setRandomSeed(0x12345678);
  game.systems.hallOfChampions.addChampion(champion());
  for (let x = CX - 3; x <= CX + 3; x++) {
    for (let y = CY - 3; y <= CY + 3; y++) {
      if (game.ctx.dungeon.findFirstMonster(new Position(x, y, LEVEL)) !== OBJECT_ID_EOF) {
        throw new Error(`the arena holds a monster at (${x},${y})`);
      }
      setRoom(game, x, y, RoomType.OPEN);
    }
  }
  game.ctx.party.state.position = new Position(CX, CY + 1, LEVEL);
  game.ctx.party.state.facing = 0;
  game.loadNewPartyLevel();
  if (withLordChaos) placeMonster(game, MonsterType.mon_LordChaos, CX, CY);
  const a: Arena = {
    game, seedAfterCloud: null, credits: hooks.credits, inventory: [], portraits: [], printed: [], views: 0, drawn: hooks.drawn, frames: 0,
  };
  const encounter = game.ctx.systems.missileEncounter;
  const createCloud = encounter.createCloud.bind(encounter);
  encounter.createCloud = (...args: Parameters<typeof createCloud>): void => {
    createCloud(...args);
    a.seedAfterCloud = game.ctx.random.getSeed();
  };
  return a;
}

function placeMonster(game: Game, type: number, x: number, y: number): ObjectID {
  const rn = createMonsterAt(game, {
    value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 0, mapX: x, mapY: y, level: LEVEL,
    invisible: false, drawAsSize4: false,
  });
  if (rn === null) throw new Error(`no ${MonsterType[type]} at (${x},${y})`);
  game.ctx.timers.deleteMonsterMovementTimers(x, y, LEVEL);
  return rn;
}

function cage(game: Game, x: number, y: number): void {
  if (game.systems.missileEncounter.createFluxcage(new Position(x, y, LEVEL), game.ctx.state.tickCount) === null) {
    throw new Error(`no Fluxcage at (${x},${y})`);
  }
}

function dispellClouds(game: Game, x: number, y: number): number {
  const dungeon = game.ctx.dungeon;
  let n = 0;
  for (let rn = dungeon.findFirstObject(new Position(x, y, LEVEL)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (game.ctx.dungeon.rnMaps.dbType(rn) !== DBType.CLOUD) continue;
    if (dungeon.getCloudRecord(rn)?.cloudType === CloudType.CT_DISPELL) n++;
  }
  return n;
}

/** Where Lord Chaos stands in the arena, or null. */
function lordChaosAt(game: Game): { x: number; y: number } | null {
  for (let x = CX - 3; x <= CX + 3; x++) {
    for (let y = CY - 3; y <= CY + 3; y++) {
      const rn = game.ctx.dungeon.findFirstMonster(new Position(x, y, LEVEL));
      if (rn === OBJECT_ID_EOF) continue;
      if (game.ctx.dungeon.getCreatureRecord(rn)?.creatureType === MonsterType.mon_LordChaos) return { x, y };
    }
  }
  return null;
}

function movementTimerAt(game: Game, x: number, y: number): boolean {
  return game.ctx.timers.getTimers().some((t) =>
    t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
    && t.level === LEVEL && t.uByte6 === x && t.uByte7 === y);
}

function fuse(a: Arena): { x: number; y: number } | null {
  a.game.systems.attack.attack(0, AttackType.atk_FUSE);
  const at = lordChaosAt(a.game);
  console.log(`  Lord Chaos ${at ? `at (${at.x},${at.y})` : 'nowhere'}; dispell clouds on (${CX},${CY}): ${dispellClouds(a.game, CX, CY)}`);
  return at;
}

function checkNoLordChaos(): void {
  console.log('=== 1. no Lord Chaos in front (Attack.cpp:158-160) ===');
  const a = arena(false);
  fuse(a);
  check(dispellClouds(a.game, CX, CY) === 1, 'one dispell cloud on the square in front');
}

function checkOffTheMap(): void {
  console.log('');
  console.log('=== 2. the square in front is off the map (Attack.cpp:150-157) ===');
  const a = arena(false);
  a.game.ctx.party.state.position = new Position(CX, 0, LEVEL);
  a.game.systems.attack.attack(0, AttackType.atk_FUSE);
  console.log(`  createCloud called: ${a.seedAfterCloud !== null}`);
  check(a.seedAfterCloud === null, 'no cloud at all');
}

function checkFree(): void {
  console.log('');
  console.log('=== 3. free: he steps next door (Attack.cpp:163-199), over eight seeds ===');
  const landed = new Set<string>();
  let southFirst = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const a = arena(true);
    a.game.setRandomSeed(seed * 0x1000193);
    const at = fuse(a);
    const random = new CsbRandom();
    random.setSeed(a.seedAfterCloud!);
    const direction = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = random.below(i + 1);
      [direction[i], direction[j]] = [direction[j]!, direction[i]!];
    }
    // South is the party's square, occupied; the other three are open and free.
    if (direction[0] === 2) southFirst++;
    const first = direction.find((d) => d !== 2)!;
    const want = { x: CX + DELTA_X[first]!, y: CY + DELTA_Y[first]! };
    console.log(`    shuffled ${direction.map((d) => DIRECTION[d]).join(', ')}: expected (${want.x},${want.y})`);
    check(at !== null && at.x === want.x && at.y === want.y, `seed ${seed}: he is on the first free square of the shuffled directions`);
    check(at !== null && movementTimerAt(a.game, at.x, at.y), `seed ${seed}: and his movement timers start there`);
    check(dispellClouds(a.game, CX, CY) === 1, `seed ${seed}: the dispell cloud is on the square he left`);
    if (at) landed.add(`${at.x},${at.y}`);
  }
  console.log(`  landed on ${[...landed].join(' ')}; south shuffled first ${southFirst} times`);
  check(landed.size === 3 && southFirst > 0, 'the seeds reach all three free squares, and skip the party\'s at least once');
}

function checkOverTheParty(): void {
  console.log('');
  console.log('=== 4. caged on three sides: he jumps over the party (Attack.cpp:200-212) ===');
  const a = arena(true);
  cage(a.game, CX, CY - 1);
  cage(a.game, CX + 1, CY);
  cage(a.game, CX - 1, CY);
  const at = fuse(a);
  check(at !== null && at.x === CX && at.y === CY + 2, 'he lands behind the party, two squares south');
  check(movementTimerAt(a.game, CX, CY + 2), 'and his movement timers start there');
}

function checkOverAMonster(): void {
  console.log('');
  console.log('=== 5. caged on two sides, a monster on the third: he jumps over it ===');
  const a = arena(true);
  cage(a.game, CX, CY - 1);
  cage(a.game, CX + 1, CY);
  const other = [...Array(27).keys()].find((t) => t !== MonsterType.mon_LordChaos && a.game.ctx.dungeon.monsterAllowedOnLevel(t, LEVEL))!;
  placeMonster(a.game, other, CX - 1, CY);
  console.log(`  a ${MonsterType[other] ?? other} on (${CX - 1},${CY})`);
  setRoom(a.game, CX, CY + 2, RoomType.STONE);
  const at = fuse(a);
  check(at !== null && at.x === CX - 2 && at.y === CY, 'he lands two squares west, past the monster');
}

/**
 * The creature type at each `_ProcessTimersViewportAndSound` of `_FusionSequence`
 * (`Attack.cpp:2280-2388`): Lord Chaos through the six fireballs, `mon_25` through the six
 * dispells, the flicker (for `D6W` 3, 2 and 1, four types each shown `D6W - 1` times,
 * `mon_25` on odd `D7w`), `mon_25` for the last fireball and dispell, then the Grey Lord,
 * through the deletions and one view for each text of cell (0, 0) printed.
 */
function expectedTypes(texts: number): number[] {
  const types: number[] = [];
  const lc = MonsterType.mon_LordChaos;
  const m25 = MonsterType.mon_25;
  for (let n = 0; n < 8; n++) types.push(lc);
  for (let n = 0; n < 7; n++) types.push(m25);
  for (let d6 = 3; d6 !== 0; d6--) {
    for (let d7 = 4; d7 !== 0; d7--) {
      for (let d5 = d6 - 1; d5 !== 0; d5--) types.push((d7 & 1) !== 0 ? m25 : lc);
    }
  }
  types.push(m25, m25, m25);
  for (let n = 0; n < 3 + texts; n++) types.push(MonsterType.mon_GreyLord);
  return types;
}

/** The VBLs of `_FusionSequence`'s `VBLDelay`s, but the texts' (`Attack.cpp:2305-2389`, `:2427`). */
const SEQUENCE_VBLS = 6 * 31 + 31 + 6 * 31 + (4 * 2 + 4 * 1) * 31 + 25 + 50 + 50 + 31 + 31 + 31 + 600;
/** Each text's `VBLDelay(780)` (`Attack.cpp:2415`). */
const TEXT_VBLS = 780;
/**
 * The texts on cell (0, 0) of level 12, chained D, C, B, A, as `DecodeText(…, 0x8001)` gives
 * them: a linefeed, the letter, the text. "THANK YOU MY FRIENDS." holds two spaces.
 */
const ENDING_TEXTS: Record<string, { idx: number; text: string }> = {
  A: { idx: 0x66, text: 'THANK YOU MY FRIENDS.  YOU HAVE BANISHED CHAOS AND REJECTED THE FALSE PATH OF UNCOMPROMISING ORDER.' },
  B: { idx: 0x68, text: 'ONLY BY LEARNING THE TRUTH AND SEEKING THE PATH OF BALANCE DID YOU GUESS THE TRUE NATURE OF THE FIRESTAFF.' },
  C: { idx: 0x5d, text: 'BY YOUR BRAVE DEEDS I AM MADE WHOLE AGAIN AND HARMONY IS RESTORED TO THE WORLD.' },
  D: { idx: 0x77, text: 'YOUR NAMES WILL BE RECORDED IN THE GREAT HALL AND REMEMBERED BY THE FUTURE GENERATIONS YOU HAVE MADE POSSIBLE.' },
};

function checkBoxedIn(inventoryOpen: boolean, withoutB = false, stripState: 'fresh' | 'scrolled' | null = null): void {
  console.log('');
  console.log('=== 6. boxed in: toast (Attack.cpp:213), and _FusionSequence (:2220) to the credits,'
    + ` ${inventoryOpen ? 'the inventory open' : 'no inventory open'}${withoutB ? ', the "B" text taken off cell (0, 0)' : ''}`
    + `${stripState === null ? '' : `, onto a strip that has ${stripState === 'fresh' ? 'printed nothing' : 'scrolled, its rows timed out'}`} ===`);
  const strip = stripState === null ? null : stripState === 'fresh' ? new ScrollingText() : scrolledStrip();
  const a = arena(true, strip);
  const game = a.game;
  if (withoutB) game.ctx.dungeon.removeObjectFromCell(new Position(0, 0, LEVEL), game.ctx.dungeon.rnMaps.rn(DBType.TEXT, ENDING_TEXTS.B!.idx));
  const letters = withoutB ? ['A'] : ['A', 'B', 'C', 'D'];
  cage(game, CX, CY - 1);
  cage(game, CX + 1, CY);
  cage(game, CX - 1, CY);
  cage(game, CX, CY);
  cage(game, CX, CY + 1);
  setRoom(game, CX, CY + 2, RoomType.STONE);
  game.savedGameRead();
  const types: number[] = [];
  const lordChaos = game.ctx.dungeon.getCreatureRecord(game.ctx.dungeon.findFirstMonster(new Position(CX, CY, LEVEL)))!;
  const word1868: boolean[] = [];
  a.drawn = () => {
    types.push(lordChaos.creatureType);
    word1868.push(game.ctx.state.word1868);
  };
  if (inventoryOpen) game.ctx.party.state.selectedCharacterIndex = 0;
  const sounds: number[] = [];
  const queueSound = game.ctx.sounds.queueSound.bind(game.ctx.sounds);
  game.ctx.sounds.queueSound = (ordinal, x, y, delta, level) => {
    sounds.push(ordinal);
    queueSound(ordinal, x, y, delta, level);
  };
  const others = monstersOnLevel(game) - 1;
  const champion = game.ctx.party.state.champions[0]!;
  const stamina = champion.attributes.stamina;
  const attackType = champion.attackType;
  const tick = game.ctx.state.tickCount;

  game.ctx.systems.character.executeAttack(0, AttackType.atk_FUSE);
  const at = lordChaosAt(game);
  console.log(`  Lord Chaos ${at ? `at (${at.x},${at.y})` : 'nowhere'}; hit points ${lordChaos.hp[0]}; ticks ${game.ctx.state.tickCount - tick}`);
  check(at !== null && at.x === CX && at.y === CY, 'he stays where he is');
  check(!movementTimerAt(game, CX, CY), 'and no movement timer starts for him');
  check(game.isRunningScript(), '_FusionSequence holds the loop');
  check(game.ctx.state.gameWon, 'd.Word11694 is set');
  const party = game.ctx.party.state;
  check(party.brightness === 200 && party.partyShield === 100 && party.spellShield === 100 && party.fireShield === 100,
    'd.Brightness is 200, and the three shields 100');
  check(a.portraits.length === 1 && a.portraits[0]!.chIdx === 0 && a.portraits[0]!.views === 0,
    'MarkAllPortraitsChanged draws the box afresh before the first view (Attack.cpp:2279)');
  check(lordChaos.hp[0]! > 9000 && lordChaos.hp[0]! <= 10000, 'his hit points are 10000, less the first fireball');
  check(!game.systems.attack.isCellFluxcage(CX, CY) && !game.systems.attack.isCellFluxcage(CX, CY + 1),
    'the Fluxcages on his square and the party\'s are gone');
  check(game.systems.attack.isCellFluxcage(CX, CY - 1) && game.systems.attack.isCellFluxcage(CX + 1, CY),
    'and the ones around him stay');
  check(champion.attributes.stamina === stamina && champion.attackType === attackType,
    'the attack\'s tail does not run: no stamina spent, no attack type recorded');
  console.log(`  showHideInventory ${JSON.stringify(a.inventory)}`);
  check(inventoryOpen
    ? a.inventory.length === 1 && a.inventory[0]!.chIdx === 4 && a.inventory[0]!.views === 0
    : a.inventory.length === 0,
  inventoryOpen
    ? 'ShowHideInventory(4) hides the open inventory, before the first view (Attack.cpp:2269-2272)'
    : 'with no inventory open, ShowHideInventory is not called');

  let creditsAt = 0;
  const wantCredits = SEQUENCE_VBLS + letters.length * TEXT_VBLS;
  /** What the strip shows after each VBL, by its number. */
  const strips: string[] = [''];
  for (let n = 1; n <= wantCredits + 20; n++) {
    a.frames++;
    runVbl(game, TICK_DUE);
    strips.push(shown(strip));
    if (a.credits.length > 0 && creditsAt === 0) creditsAt = n;
  }
  const want = expectedTypes(letters.length);
  console.log(`  types ${types.join(' ')}`);
  console.log(`  credits ${creditsAt} VBLs after the attack (expected ${wantCredits}); asked ${JSON.stringify(a.credits)}; ticks ${game.ctx.state.tickCount - tick}`);
  console.log(`  sound 17 ${sounds.filter((n) => n === 17).length} times; monsters on the level ${monstersOnLevel(game)} (other than him before: ${others})`);
  check(types.join() === want.join(), `${want.length} views, each with the type the sequence gives him then`);
  console.log(`  d.Word1868 ${word1868.map((w) => (w ? 1 : 0)).join('')}`);
  const unset = want.length - 2 - letters.length;
  check(word1868.length === want.length && word1868.every((w, i) => w === (i >= unset)),
    'd.Word1868 is set for the views after the Grey Lord\'s first, and the texts\' (Attack.cpp:2364-2369)');
  check(game.ctx.state.tickCount - tick === want.length, 'each view is a turn of the clock');
  check(sounds.filter((n) => n === 17).length === 13, 'sound 17 once before the dispells and once for each of the twelve flickers');
  check(others > 0 && monstersOnLevel(game) === 1 && greyLordAt(game, CX, CY), 'every other monster on the level is deleted');
  for (const p of a.printed) console.log(`  printed at VBL ${p.frame}, colour ${p.color}: ${JSON.stringify(p.text)}`);
  if (strip) checkStrip(a, strips, letters, creditsAt, stripState === 'fresh');
  const wantPrinted = [
    ...letters.map((l) => ({ color: 15, text: `\n${ENDING_TEXTS[l]!.text}` })),
    { color: 0, text: '\n' }, { color: 15, text: 'THE END.' }, { color: 0, text: '\n' },
  ];
  check(JSON.stringify(a.printed.map(({ color, text }) => ({ color, text }))) === JSON.stringify(wantPrinted),
    withoutB
      ? 'with no "B", only the "A" text is printed: the letters stop at the gap (Attack.cpp:2398-2422)'
      : 'the four texts in the order of their letters, each letter a linefeed, then "THE END." between linefeeds (Attack.cpp:2398-2426)');
  const frames = a.printed.map((p) => p.frame);
  const endAt = frames[letters.length]!;
  check(frames.slice(0, letters.length).every((f, i) => frames[i + 1]! - f === TEXT_VBLS)
    && frames.slice(letters.length).every((f) => f === endAt),
  'each text stays 780 VBLs before the next line, and the three of "THE END." come together');
  check(creditsAt === wantCredits && creditsAt - endAt === 600, 'ShowCredits(1) after the VBLs the sequence waits, 600 of them after "THE END."');
  check(a.credits.join() === 'true', 'once, with d.Word11694 set');
  check(!game.canRestartFromSavegame() && game.mainLoopHasReturned(), 'd.CanRestartFromSavegame is cleared, and MainLoop is over');
}

/**
 * What the strip showed of the ending, which is the port's own (`DEBT.md` H, "The ending's
 * speech is shown whole"): each text whole within three scrolls of its `PrintLines`, a scroll
 * for each of the three rows the longest wraps into, and still whole when the next line is
 * printed, and "THE END." there when the credits come.
 * `strips[n]` is the strip after VBL `n`.
 */
function checkStrip(a: Arena, strips: string[], letters: string[], creditsAt: number, fresh: boolean): void {
  const within = 3 * SCROLL_VBLS;
  const first = a.printed[0]!.frame;
  console.log(`  the strip after the first text's VBL: ${JSON.stringify(strips[first])}`);
  check(fresh ? strips[first]!.includes(ENDING_TEXTS.A!.text.replace(/ +/g, ' ')) : strips[first] === '',
    fresh
      ? 'd.PrintRow 0: the first text needs no scroll, and is whole in the VBL it is printed'
      : 'd.PrintRow 3: every row of the first text is a scroll, and none is placed in the VBL it is printed');
  letters.forEach((letter, i) => {
    const text = ENDING_TEXTS[letter]!.text.replace(/ +/g, ' ');
    const from = a.printed[i]!.frame;
    const next = a.printed[i + 1]!;
    let whole = -1;
    for (let n = from; n < next.frame && whole < 0; n++) {
      if (strips[n]!.includes(text)) whole = n - from;
    }
    console.log(`  "${letter}" whole ${whole < 0 ? 'never' : `${whole} VBLs after its PrintLines`}; when the next line is printed the strip holds ${JSON.stringify(next.strip)}`);
    check(whole >= 0 && whole <= within, `"${letter}" is whole on the strip within ${within} VBLs, three scrolls, of its PrintLines`);
    check(next.strip.includes(text), `"${letter}" is still whole when the next line is printed`);
  });
  const end = a.printed[letters.length]!.frame;
  let seen = -1;
  for (let n = end; n < creditsAt && seen < 0; n++) {
    if (strips[n]!.endsWith('THE END.')) seen = n - end;
  }
  console.log(`  "THE END." on the strip ${seen < 0 ? 'never' : `${seen} VBLs after its PrintLines`}; the VBL before the credits the strip holds ${JSON.stringify(strips[creditsAt - 1])}`);
  check(seen >= 0 && seen <= within, `"THE END." is on the strip within ${within} VBLs of its PrintLines`);
  check(creditsAt > 0 && strips[creditsAt - 1]!.endsWith('THE END.'), 'and is its last line when the credits come');
}

function monstersOnLevel(game: Game): number {
  const map = game.ctx.dungeon.getMap(LEVEL)!;
  let n = 0;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      if (game.ctx.dungeon.findFirstMonster(new Position(x, y, LEVEL)) !== OBJECT_ID_EOF) n++;
    }
  }
  return n;
}

function greyLordAt(game: Game, x: number, y: number): boolean {
  const rn = game.ctx.dungeon.findFirstMonster(new Position(x, y, LEVEL));
  return rn !== OBJECT_ID_EOF && game.ctx.dungeon.getCreatureRecord(rn)?.creatureType === MonsterType.mon_GreyLord;
}

function checkWall(): void {
  console.log('');
  console.log('=== 7. a wall next door blocks the square beyond it ===');
  for (const wall of [RoomType.STONE, RoomType.FALSEWALL]) {
    const a = arena(true);
    cage(a.game, CX, CY - 1);
    cage(a.game, CX + 1, CY);
    setRoom(a.game, CX - 1, CY, wall);
    setRoom(a.game, CX, CY + 2, RoomType.STONE);
    const at = fuse(a);
    check(at !== null && at.x === CX && at.y === CY,
      `he stays: the square two west is open, but the one next to him is ${wall === RoomType.STONE ? 'a wall' : 'a false wall'}`);
  }
}

function main(): void {
  checkNoLordChaos();
  checkOffTheMap();
  checkFree();
  checkOverTheParty();
  checkOverAMonster();
  checkBoxedIn(false);
  checkBoxedIn(true);
  checkBoxedIn(false, true);
  checkBoxedIn(false, false, 'fresh');
  checkBoxedIn(false, false, 'scrolled');
  checkWall();
  finish();
}

main();
