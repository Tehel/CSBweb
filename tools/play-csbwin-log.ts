/**
 * A CSBWin `playfile.log` played into the port, as `PLAYFILE` feeds `HandleMouseEvents`
 * (doc/CSBwin-src/Recording.cpp:226-826, Mouse.cpp:1493-1505, :1548-1630), until its end
 * or the first entry whose recorded random is neither the port's `d.RandomNumber` nor its
 * draws since the entry before. Not evidence: the diagnostic of `DEBT.md` F24, which holds
 * what it finds. It stands the page up without the DOM over `dm-atari`, as
 * `tools/lib/playback.ts` does, and reaches into `Game`'s privates for what CSBWin's
 * playback changes: the queue fed from the file, `lastTime` and the frozen discard
 * skipped, a waiting step put back (`PLAYFILE::Backspace`), the Reincarnate screen fed the
 * file's `0x4444` lines (`Code13ea4.cpp:86-108`), and `extraTicks` off (`CSBUI.cpp:985`).
 *
 *   npx tsx tools/play-csbwin-log.ts <playfile.log> [--extra-ticks] [--no-dm-rules]  [--resync] [--fake] [--trace=<from>-<to>] [--profile=<name>]
 *
 * The log's `#DMRules` and `#NoDMRules` set `DM_rules` where play meets them, as
 * `PLAYFILE::Play` does (doc/CSBwin-src/Recording.cpp:289-299); `--no-dm-rules` ignores them
 * and turns the set's `DMRulesDesignOption` off.
 *
 * `--profile=<name>` plays at that CSBWin version's profile (`PROFILES`,
 * `src/engine/Behaviour.ts`), `csbwin-11.014` for an 11.0xx run (`DEBT.md` R18, step 5),
 * instead of 2023's source, which the engine follows.
 * `--set=<id>` plays on another data set than `dm-atari`; `--save=<file>` starts from that
 * CSBWin save instead of a new game, read at the log's first `0x6669` (a CSB run's
 * `csbgame.dat`, which the log's first clicks resume). A save the run's author cut out of
 * the log, `0x2223` or `0x2224`, does what the save did (`Recording.cpp:734-761`); a save
 * the log holds is made on the port's save menu, which its disk icon opens (`diskMenuSave`).
 *
 * `--trace=<from>-<to>`: every game draw from `d.Time` <from> to <to>, in hex, with its
 * callers, and the engine's AI and attack trace in between.
 * `--fake`: a drift where the port is short of draws, up to 1000, is made up with draws,
 * and the play goes on, each printed: the map of where the port draws too little.
 * `--resync`: an absolute random that differs is taken, as CSBWin's
 * "Sequence/timing error" answered No takes it, and the play goes on.
 */
import { VBL_FREQUENCY } from '../src/core/constants';
import { CsbRandom } from '../src/core/random';
import { loadGameFiles } from '../src/data/DataSetFiles';
import { emptyDungeonData } from '../src/data/DungeonLoader';
import { extractGraphicsTables } from '../src/data/tables/GraphicsTables';
import { csbGraphicsOpener } from '../src/engine/FileSignatures';
import { Game } from '../src/engine/Game';
import { behaviourAt, ENGINE_LEVEL, knownProfile, PROFILES } from '../src/engine/Behaviour';
import { applySaveBytes } from '../src/engine/SaveGameFile';
import { applyPlayfileLine, PLAYFILE_LINES } from '../src/engine/PlayfileLine';
import { readFileSync } from 'node:fs';
import { GameSaves } from '../src/engine/GameSaves';
import { buildGameTables } from '../src/engine/GameTables';
import { NO_FULLSCREEN } from '../src/lib/fullscreen';
import { GameInput } from '../src/renderer/GameInput';
import { GameScreen } from '../src/renderer/GameScreen';
import { Presenter } from '../src/renderer/Presenter';
import { ScrollingText } from '../src/renderer/csbwin/ScrollingText';
import { hostDrawing } from '../src/renderer/ui/HostDrawing';
import { openReincarnateScreen, reincarnateClick, reincarnateKey } from '../src/renderer/ui/ReIncarnate';
import { askBeginAdventure } from '../src/renderer/ui/SaveMenu';
import { UIMode } from '../src/renderer/ui/UIState';
import { Settings, applyToGame } from '../src/settings/Settings';
import { ManualClock } from './lib/clock';
import { STOCK_DATA_SET, dataSetNamed, diskFiles } from './lib/dataSets';
import { diskMenuSave } from './lib/csbwinRun';
import { memoryStore } from './lib/saves';
import { readPlayfile, type PlayEntry } from './lib/playfile';

const args = process.argv.slice(2);
const extraTicks = args.includes('--extra-ticks');
const dmRules = !args.includes('--no-dm-rules');
const resync = args.includes('--resync');
const fake = args.includes('--fake');
const profileArg = args.find((a) => a.startsWith('--profile='))?.slice(10) ?? null;
if (!knownProfile(profileArg)) throw new Error(`--profile=${profileArg}: not one of ${PROFILES.map((profile) => profile.name).join(', ')}`);
const traceArg = args.find((a) => a.startsWith('--trace='))?.slice(8).split('-').map((n) => parseInt(n, 16));
const { version, items } = readPlayfile(args[0]!);

// `numRandomCalls` (doc/CSBwin-src/CSBCode.cpp:1190-1225): the game's draws; `DrawViewport`
// restores it with `d.RandomNumber` (Viewport.cpp:6712-6714), so the view's are left out.
let calls = 0;
let gameCalls = 0;
let gameRandom: CsbRandom | null = null;
const proto = CsbRandom.prototype as unknown as { advance(this: CsbRandom): number };
const advance = proto.advance;
proto.advance = function (this: CsbRandom) {
  calls++;
  if (this === gameRandom) {
    gameCalls++;
    const t = game.ctx.state.tickCount;
    if (inTrace()) console.log(`  draw ${t.toString(16)}: ` + new Error().stack!.split('\n').slice(2, 12)
      .map((l) => /at (?:\S+\.)?([\w$<>]+) \(.*?(\w+)\.ts:(\d+)/.exec(l)).filter((m) => m && m[2] !== 'random')
      .map((m) => `${m![1]}:${m![3]}`).join(' < '));
  }
  return advance.call(this);
};
function inTrace(): boolean {
  const t = game.ctx.state.tickCount;
  return !!traceArg && t >= traceArg[0]! && t <= traceArg[1]!;
}
const lcg = (s: number) => (Math.imul(s, 0xbb40e62d) + 11) >>> 0;
function drawsBetween(from: number, to: number, max = 100000): number | null {
  for (let n = 0, s = from >>> 0; n <= max; n++, s = lcg(s)) if (s === to >>> 0) return n;
  return null;
}

const setArg = args.find((a) => a.startsWith('--set='))?.slice(6);
const saveArg = args.find((a) => a.startsWith('--save='))?.slice(7);
const set = setArg ? dataSetNamed(setArg) : STOCK_DATA_SET;
const files = diskFiles(set);
const loaded = await loadGameFiles(set, files);
const dungeonDat = (await files.read('dungeon.dat'))!;
const graphicsTables = extractGraphicsTables(loaded.graphicsLoader);
const tables = buildGameTables(graphicsTables);
const clock = new ManualClock();
const messages = new ScrollingText(tables.byte1830);
let screen: GameScreen | null = null;
const drawing = hostDrawing(() => screen?.ui ?? null);
const renderView = (): void => {
  if (!screen || game.mainLoopHasReturned()) return;
  const party = game.ctx.party;
  screen.syncParty();
  screen.drawViewport(party.state.position, party.state.facing, game.ctx.state.word1868);
};
let ended: string | null = null;
const game = new Game(emptyDungeonData(), tables, {
  messages, clock,
  sleepChanged: (sleeping) => { screen?.setUIMode(sleeping ? UIMode.Sleeping : UIMode.Adventure); messages.setPartySleeping(sleeping); },
  openReincarnateScreen: (chIdx) => { if (screen) openReincarnateScreen(screen.ui, chIdx); },
  ...drawing,
  championJoined: () => saves.championJoined(),
  die: (error) => { throw error; },
  drawViewport: renderView,
  showCredits: (won) => { ended = `credits, d.Word11694 ${won}`; },
  // The engine's AI and attack trace, inside `--trace`'s window.
  trace: (line) => { if (inTrace()) console.log(line); },
  tracing: traceArg !== undefined,
});
loaded.csbGraphicsLoader.opener = csbGraphicsOpener(game.ctx);
game.ctx.sounds.csbGraphics = loaded.csbGraphicsLoader;
game.ctx.overlay.csbGraphics = loaded.csbGraphicsLoader;
loaded.csbGraphicsLoader.cannotOpen = () => { game.ctx.overlay.active = false; };
const saves = new GameSaves(game, set, files, memoryStore(), {
  portraitOf: drawing.portraitOf,
  askBeginAdventure: (source) => { if (screen) askBeginAdventure(screen.ui, source); },
}, () => {}, new CsbRandom());
const settings = new Settings(null);
const presenter = new Presenter(() => screen?.animationFrame(game.mainLoopHasReturned()));
const image = { width: 320, height: 200, data: new Uint8ClampedArray(320 * 200 * 4) };
const canvas = { getContext: () => ({ createImageData: () => image, putImageData: () => {} }) };
const no = () => { throw new Error('not in a playback'); };
screen = new GameScreen(canvas as unknown as ConstructorParameters<typeof GameScreen>[0], {
  graphicsLoader: loaded.graphicsLoader, tables: graphicsTables, ctx: game.ctx,
  csbGraphicsLoader: loaded.csbGraphicsLoader, messages, hintOracle: loaded.hintOracle,
}, {
  onReincarnated: () => {}, onListSaves: () => saves.list(), onListEverySave: () => saves.listEverySet(),
  onReadSave: no, onMakeNewAdventure: no, onHasNewFaces: async () => false, onSaveGame: no,
  isPrison: () => saves.inPrison(), onExportSave: no, onDeleteSave: no, onImportSave: no,
  onRestoreSave: no, onRestoreFailed: (e) => { throw e; }, onOpenHintOracle: no, onSleepSave: () => {},
  onExit: () => {}, settings, isCrtAvailable: () => false, fullscreen: NO_FULLSCREEN,
  keyboardLayout: () => null, onTeleport: null,
}, presenter, () => {});
new GameInput({ game, screen, refreshScreen: () => {}, onQuickSave: no, onQuickLoad: no, onDevLevel: null }).install();
settings.subscribe((values) => applyToGame(game, values));
game.onTick(() => {
  const { selectedCharacterIndex, sleeping } = game.ctx.party.state;
  if (selectedCharacterIndex < 0 && !sleeping) renderView();
});
game.ctx.rules.dmRulesDesignOption = dmRules && set.dmRules;
game.ctx.behaviour = behaviourAt(ENGINE_LEVEL, profileArg);
const ctx = game.ctx;

// --- PLAYFILE ---
let at = 0;               // next item
let pending: PlayEntry | null = null; // m_time != -1
let oldCallCount = 0;
let drift: string | null = null;
let checked = 0, absChecked = 0, countChecked = 0, resyncs = 0, fakes = 0;
const history: string[] = [];
const hx = (n: number, w = 4) => n.toString(16).padStart(w, '0');
const where = () => { const p = ctx.party.state; return `L${p.position.z ?? '?'} (${p.position.x},${p.position.y}) f${p.facing}`; };

function play(): PlayEntry | null {
  for (;;) {
    if (!pending) {
      const item = items[at++];
      if (!item) { ended ??= 'end of the playfile'; return null; }
      if (!('num' in item)) {
        // `#DMRules` and `#NoDMRules` set `DM_rules` where play meets them (Recording.cpp:289-299).
        if (dmRules && (item.option === '#DMRules' || item.option === '#NoDMRules')) ctx.rules.dmRules = item.option === '#DMRules';
        console.log(`  option ${item.option} at d.Time ${ctx.state.tickCount}, DM rules ${ctx.rules.dmRules}`);
        continue;
      }
      pending = item;
    }
    const e = pending;
    if (e.time > ctx.state.tickCount) return null;
    const seed = ctx.random.getSeed();
    const since = gameCalls - oldCallCount;
    if (e.time !== 0 && ![0x2222, 0xd7, 0x3333, 0x5555, 0x6668, 0xffff].includes(e.num)) {
      checked++;
      if (e.ran === seed) absChecked++;
      else if (e.ran === since) countChecked++;
      else {
        const n = drawsBetween(seed, e.ran);
        const msg = `line ${e.line}: d.Time ${hx(e.time, 8)} ${hx(e.x)} ${hx(e.y)} button ${hx(e.num)}: recorded ${hx(e.ran, 8)}, port d.RandomNumber ${hx(seed, 8)}, ${since} draws since the last entry (${gameCalls} game draws so far)` +
          (n !== null ? `; the recorded value is ${n} draws ahead of the port` : '') + `; party ${where()}`;
        const missing = e.ran < 0x10000 ? e.ran - since : n;
        if (fake && missing !== null && missing > 0 && missing <= 1000) {
          console.log(`  FAKE ${missing} draw(s) at line ${e.line}, d.Time ${hx(e.time)}, party ${where()}, after: ${history.at(-1) ?? ''}`);
          for (let i = 0; i < missing; i++) ctx.random.next();
          fakes++;
          continue;
        }
        if (!resync || e.ran < 0x10000) { drift = msg; return null; }
        console.log(`  RESYNC ${msg}`); resyncs++;
        ctx.random.setSeed(e.ran);
      }
    }
    oldCallCount = gameCalls;
    pending = null;
    history.push(`${e.line}: t ${hx(e.time, 8)} ${hx(e.x)} ${hx(e.y)} ${hx(e.num)} ${hx(e.ran, 8)}  ${where()}`);
    if (history.length > 12) history.shift();
    if (e.num === 0xd7) { ended = 'game over (0xd7)'; return null; }
    if (e.num === 0x3333) { ctx.random.setSeed(((e.x << 16) | (e.y & 0xffff)) >>> 0); continue; }
    // A save in the log: the disk icon opened the port's save menu, whose save stands for
    // the disk menu's (`diskMenuSave`).
    if (screen!.ui.saveMenu?.mode === 'full' && diskMenuSave(game, screen!.ui, e.num, e.line)) continue;
    if (e.num === 0x6668 || e.num === 0x6669) continue; // a save's or a read's signature, only recorded (Recording.cpp:723-727)
    // The recorder's own draws, and what a save cut out of the log did (Recording.cpp:650-761).
    if (PLAYFILE_LINES.has(e.num)) { applyPlayfileLine(ctx, e.num, e.y); continue; }
    if (e.num === 0x5555 || e.num === 0xdddd) throw new Error(`unsupported ${hx(e.num)} at line ${e.line}`);
    return e;
  }
}

// HandleMouseEvents with a playfile open, the port's body with CSBWin's playback branches.
const g = game as unknown as {
  handleMouseEvents(delta: number): number; systems: { movement: { gravityMove(): number; moveParty(a: unknown): { refused?: boolean; inhibited?: boolean } } };
  translateMouseClick(e: unknown): boolean; recordFileRecord(e: unknown): void; moveParty(a: unknown): { refused: boolean };
  mouseEventHandlers: { unclick(): void; button(n: number, x: number, y: number): void } | null; lastInputTime: number;
};
if (!extraTicks) {
  // `if (extraTicks) d.clockTick = 1;` left out (CSBCode.cpp:7953-7956, :8171-8174).
  const cur = g.systems.movement.moveParty.bind(g.systems.movement); g.systems.movement.moveParty = (a) => { const before = ctx.loop.clockTick; const r = cur(a); if (!r.inhibited && ctx.loop.clockTick && !before) ctx.loop.clockTick = before; return r; };
}
const origHandle = g.handleMouseEvents.bind(game);
g.handleMouseEvents = (delta: number): number => {
  if (drift || ended) return 0;
  const queue = ctx.mouseQueue;
  if (ctx.loop.gravityMove) return origHandle(delta);
  queue.discardAllInput();
  const e = play();
  if (!e) return 0;
  queue.enqueueKey(e.num);
  const head = queue.head(); head.x = e.x; head.y = e.y;
  const num = e.num;
  const party = ctx.party.state;
  if (num >= 3 && num <= 6 && (party.partyMoveDisableTimer !== 0 || (party.word11712 !== 0 && ((party.facing + num - 3) & 3) === party.word11714))) {
    pending = { ...e, time: ctx.state.tickCount }; // PLAYFILE::Backspace
    history.pop();
    return 0;
  }
  // Hand the rest to the port's own body: lastTime and the frozen discard are skipped under playback.
  const savedLast = g.lastInputTime; g.lastInputTime = 0;
  const frozen = ctx.loop.gameFrozen; ctx.loop.gameFrozen = false;
  const result = origHandle(delta);
  if (ctx.loop.gameFrozen === false) ctx.loop.gameFrozen = frozen && num !== 148 ? frozen : ctx.loop.gameFrozen;
  if (g.lastInputTime === 0) g.lastInputTime = savedLast;
  // The Reincarnate screen reads the playfile itself (Code13ea4.cpp:86-108).
  while (screen!.ui.reincarnate) {
    const k = play();
    if (!k) break;
    if (k.num !== 0x4444) throw new Error(`reincarnate got ${hx(k.num)} at line ${k.line}`);
    if (k.x !== 0) reincarnateKey(screen!.ui, String.fromCharCode(k.x));
    else for (let i = 0; i < 3 && screen!.ui.reincarnate; i++) reincarnateClick(screen!.ui, 206, 151);
  }
  return result;
};

// --- the start: a new game, the playfile's 0x3333 seed, then ReadEntireGame's two draws;
// or, with --save=, that file read (a CSB run's csbgame.dat) once the log's menu clicks
// have chosen it, at its first 0x6669 ---
gameRandom = (ctx as unknown as { random: CsbRandom }).random;
if (saveArg) {
  applySaveBytes(game, new Uint8Array(readFileSync(saveArg)));
  at = items.findIndex((it) => 'num' in it && it.num === 0x6669) + 1;
  console.log(`${version}: ${items.length} lines; extraTicks ${extraTicks}, DM rules ${dmRules}, profile ${profileArg ?? 'none'}; ${saveArg} read, d.Time ${ctx.state.tickCount}, seed ${hx(ctx.random.getSeed(), 8)}`);
} else {
  game.readDungeonDat(dungeonDat);
  const first = items.findIndex((it) => 'num' in it && it.num === 0x3333);
  const seedEntry = items[first] as PlayEntry;
  at = first + 1;
  ctx.random.setSeed(((seedEntry.x << 16) | (seedEntry.y & 0xffff)) >>> 0);
  const d0 = ctx.random.next() & 0xffff, d1 = ctx.random.next() & 0xffff;
  ctx.state.block1.randomGameID = (d0 * d1) >>> 0;
  console.log(`${version}: ${items.length} lines; extraTicks ${extraTicks}, DM rules ${dmRules}, profile ${profileArg ?? 'none'}; seed ${hx(ctx.random.getSeed(), 8)}`);
}
oldCallCount = gameCalls;
const firstMove = items.slice(at).find((it) => 'num' in it) as PlayEntry;
console.log(`  draws from the seed after the read to line ${firstMove.line}'s value: ${drawsBetween(ctx.random.getSeed(), firstMove.ran)}`);
game.start(true);
const VBL_MS = Math.ceil(1000 / VBL_FREQUENCY);
const t0 = performance.now();
let vbls = 0;
while (!drift && !ended && vbls < 60 * 60 * 60 * 3) { clock.advance(VBL_MS); vbls++; }
console.log(`ran ${vbls} VBLs in ${((performance.now() - t0) / 1000).toFixed(1)} s; d.Time ${ctx.state.tickCount}; ${checked} entries checked (${absChecked} by d.RandomNumber, ${countChecked} by draw count), ${resyncs} resyncs, ${fakes} fakes`);
console.log(`  line ${(items[Math.min(at, items.length) - 1] as PlayEntry | undefined)?.line ?? '?'} of the file; party ${where()}`);
console.log(drift ? `DRIFT ${drift}` : `ENDED ${ended}`);
console.log('last entries taken:\n  ' + history.join('\n  '));
