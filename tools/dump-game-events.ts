/**
 * The statistics' events (`src/ui/gameEvents.ts`, `PLAN.md` Phase 17 step 4), built from
 * the real engine: the Hall of Champions' joins on `dm-atari`'s level 0, a new game's
 * first tick, a won and a lost game, and a genuine CSBWin save whose champions this page
 * never saw join.
 *
 * Asserts the rules of anonymity, which are the code's and not only the FAQ's: an event
 * holds the player id, the set, the playthrough, the build and its payload, nothing more;
 * a name typed on the Reincarnate screen is never sent, the champion going by their
 * mirror's name, flagged; and a champion nobody saw join is named only by one of the
 * set's mirrors. And that an event can fail without failing the game.
 *
 * And that the server takes every event the engine made as it is (`server/events.ts`): the
 * page and the server agree on its shape, field for field.
 *
 * Run: npx tsx tools/dump-game-events.ts
 */

import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { Direction, Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { PresetHero } from '../src/data/HeroExtractor';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import type { Game } from '../src/engine/Game';
import type { JoinedChampion } from '../src/engine/GameHost';
import { DELTA_X, DELTA_Y } from '../src/engine/MonsterPerception';
import { determineMastery } from '../src/engine/skills';
import { GameEvents, mirrorNames, type GameEvent, type LostPayload, type PartyPayload, type WonPayload } from '../src/ui/gameEvents';
import { checkEvent } from '../server/events.ts';
import { check, finish } from './lib/check';
import { dataSetNamed } from './lib/dataSets';
import { newGame, presetHeroesOfGame, stockGraphics } from './lib/game';
import { savePath } from './lib/saves';

const RESURRECT = 160;
const REINCARNATE = 161;
/** A name only the player could have typed. */
const TYPED_NAME = 'PLAYERNAME';
const TYPED_TITLE = 'THE TYPED TITLE';
const PLAYER = '00000000-0000-4000-8000-000000000000';
const BUILD = 'test';

const DM = dataSetNamed('dm-atari');
/** Every event a harness sent where it was not told to send elsewhere. */
const everySent: GameEvent[] = [];
const dungeonDat = new Uint8Array(readFileSync(joinPath(DM.dir, 'dungeon.dat')));

interface Harness {
  game: Game;
  events: GameEvents;
  sent: GameEvent[];
  /** The events still on their way: each awaits the mirrors. */
  settle: () => Promise<void>;
}

function harness(options: { mirrors?: () => Promise<ReadonlySet<string>>; send?: (event: GameEvent) => void } = {}): Harness {
  const sent: GameEvent[] = [];
  let events!: GameEvents;
  let reincarnating = -1;
  const game = newGame(new DungeonLoader().loadDungeonDat(dungeonDat), stockGraphics(), {
    championJoined: (joined: JoinedChampion) => events.championJoined(joined),
    openReincarnateScreen: (chIdx) => { reincarnating = chIdx; },
  });
  game.setRandomSeed(0x12345678);
  const names = mirrorNames(dungeonDat, game);
  events = new GameEvents({
    game,
    set: DM.id,
    build: BUILD,
    player: () => PLAYER,
    mirrors: options.mirrors ?? (async () => names),
    send: options.send ?? ((event) => { sent.push(event); everySent.push(event); }),
  });
  (game as unknown as { reincarnating: () => number }).reincarnating = () => reincarnating;
  return { game, events, sent, settle: () => new Promise((done) => setTimeout(done, 0)) };
}

/** Stand the party before `hero`'s mirror, click it, and answer the menu with `button`. */
function join(game: Game, hero: PresetHero, button: number): void {
  const facing = (hero.location.wall + 2) & 3;
  const party = game.ctx.party.state;
  party.position = new Position(hero.location.x - DELTA_X[facing], hero.location.y - DELTA_Y[facing], hero.location.map);
  party.facing = facing as Direction;
  const hall = game.systems.hallOfChampions;
  if (!hall.addCharacter(hero.portraitIndex)) throw new Error(`${hero.name}'s mirror took no champion`);
  hall.resurrectReincarnateCancel(button);
  if (button === REINCARNATE) {
    const chIdx = (game as unknown as { reincarnating: () => number }).reincarnating();
    hall.reincarnateNamed(chIdx, TYPED_NAME, TYPED_TITLE);
  }
}

function heroNamed(game: Game, name: string): PresetHero {
  const hero = presetHeroesOfGame(game).find((h) => h.name === name);
  if (!hero) throw new Error(`no mirror of ${name}`);
  return hero;
}

const COMMON_KEYS = 'build,payload,player,playthrough,set,type';

/** Every event's own fields, and no typed text anywhere in it. */
function checkAnonymous(event: GameEvent, what: string): void {
  check(Object.keys(event).sort().join() === COMMON_KEYS, `${what}: the event holds ${COMMON_KEYS} and nothing else`);
  const json = JSON.stringify(event);
  check(!json.includes(TYPED_NAME) && !json.includes(TYPED_TITLE), `${what}: no name or title the player typed`);
  check(new TextEncoder().encode(json).length <= 4096, `${what}: the body is at most 4 KB (${json.length} bytes)`);
}

async function main(): Promise<void> {
  /* ------------------------------------------------- the mirrors ----- */
  {
    const { game } = harness();
    const names = mirrorNames(dungeonDat, game);
    console.log(`=== ${DM.id}'s mirrors: ${[...names].join(', ')} ===`);
    check(names.size === 24, "dm-atari's 24 mirrors are 24 names");
    check(names.has('HALK') && names.has('WU TSE'), "HALK and WU TSE are among them, as their hero texts spell them");
  }

  /* ------------------------------------------------- a new game ----- */
  {
    const { game, events, sent, settle } = harness();
    events.tick();
    await settle();
    check(sent.length === 0, 'a tick of a game not read as new sends nothing');
    events.newGameRead();
    events.tick();
    events.tick();
    await settle();
    console.log(`started: ${JSON.stringify(sent)}`);
    check(sent.length === 1 && sent[0]!.type === 'started', "a new game's first tick sends `started`, and the next one nothing");
    const started = sent[0]!;
    check(started.player === PLAYER && started.set === 'dm-atari' && started.build === BUILD,
      'it names the player, the set and the build');
    check(started.playthrough === game.ctx.state.block1.randomGameID, "and the game's playthrough, `d.RandomGameID`");
    check(JSON.stringify(started.payload) === '{}', 'with nothing else');
    checkAnonymous(started, 'started');
    events.newGameRead();
    events.savedGameRead();
    events.tick();
    await settle();
    check(sent.length === 1, 'a save read before the first tick makes the game no new one');
  }

  /* ------------------------------------------------- the Hall, then the end ----- */
  {
    const { game, events, sent, settle } = harness();
    join(game, heroNamed(game, 'HALK'), RESURRECT);
    join(game, heroNamed(game, 'WU TSE'), REINCARNATE);
    await settle();
    for (const event of sent) console.log(`${event.type}: ${JSON.stringify(event.payload)}`);
    check(sent.length === 2 && sent.every((e) => e.type === 'party'), 'each champion who joins sends `party`');
    const [first, second] = sent.map((e) => e.payload as PartyPayload);
    check(JSON.stringify(first!.champions) === '[{"name":"HALK"}]', 'HALK resurrected: the party is HALK');
    check(JSON.stringify(second!.champions) === '[{"name":"HALK"},{"name":"WU TSE","reincarnated":true}]',
      "WU TSE reincarnated: by the mirror's name, flagged, while the champion carries the typed one");
    check(game.ctx.party.state.champions[1]!.name === TYPED_NAME, 'the champion is named as the player typed');
    sent.forEach((event) => checkAnonymous(event, 'party'));

    game.ctx.state.tickCount = 123456;
    game.setPlayTime(3_600_000);
    sent.length = 0;
    events.ended(true);
    await settle();
    console.log(`won: ${JSON.stringify(sent[0]?.payload)}`);
    check(sent.length === 1 && sent[0]!.type === 'won', 'a won game sends `won`');
    const won = sent[0]!.payload as WonPayload;
    check(won.gameTime === 123456, 'with the game clock, `d.Time`');
    check(won.playTime === 3_600_000, "and the player's time in the game");
    check(won.champions.map((c) => c.name).join() === 'HALK,WU TSE', 'and the party, by their mirrors');
    check(won.champions[1]!.reincarnated === true && won.champions[0]!.reincarnated === undefined,
      'the reincarnated one flagged, and only that one');
    const expected = game.ctx.party.state.champions.map((champion) =>
      [0, 1, 2, 3].map((skill) => determineMastery(champion, skill | 0xc000, { partySleeping: false })));
    check(JSON.stringify(won.champions.map((c) => c.masteries)) === JSON.stringify(expected),
      "and each one's four masteries, as the won screen shows them");
    check(won.champions.every((c) => c.masteries.length === 4 && c.masteries.every((m) => m >= 1)),
      'four masteries each, none below NEOPHYTE');
    checkAnonymous(sent[0]!, 'won');

    sent.length = 0;
    game.ctx.party.state.position = new Position(7, 9, 3);
    events.ended(false);
    await settle();
    console.log(`lost: ${JSON.stringify(sent[0]?.payload)}`);
    check(sent.length === 1 && sent[0]!.type === 'lost', 'a lost game sends `lost`');
    const lost = sent[0]!.payload as LostPayload;
    check(lost.level === 3 && lost.x === 7 && lost.y === 9, 'with the level and square the party died on');
    check(lost.gameTime === 123456 && lost.champions.length === 2, 'its clock and its party');
    checkAnonymous(sent[0]!, 'lost');
  }

  /* ------------------------------------------------- a saved game's party ----- */
  {
    const { game, events, sent, settle } = harness();
    applyCsbwinSave(game, new Uint8Array(readFileSync(savePath('csbgame-early-2hero-renamed.dat'))));
    const names = game.ctx.party.state.champions.map((c) => c.name);
    console.log(`csbgame-early-2hero-renamed.dat's party: ${names.join(', ')}`);
    events.ended(true);
    await settle();
    const reported = (sent[0]!.payload as WonPayload).champions;
    console.log(`reported: ${JSON.stringify(reported.map((c) => c.name))}`);
    const mirrors = mirrorNames(dungeonDat, game);
    check(reported.every((c, i) => c.name === (mirrors.has(names[i]!) ? names[i] : null)),
      "a champion nobody saw join goes by their own name only where it is a mirror's, and by null otherwise");
    check(reported.some((c) => c.name === null) && reported.some((c) => c.name !== null),
      'the save has one of each');
  }

  /* ------------------------------------------------- failures ----- */
  {
    const { game, sent, settle } = harness({ mirrors: () => Promise.reject(new Error('no dungeon.dat')) });
    join(game, heroNamed(game, 'HALK'), RESURRECT);
    await settle();
    check(sent.length === 1 && JSON.stringify((sent[0]!.payload as PartyPayload).champions) === '[{"name":null}]',
      'mirrors that cannot be read name nobody, and the event still goes');
  }
  {
    const { game, events, settle } = harness({ send: () => { throw new Error('offline'); } });
    let threw = false;
    try {
      join(game, heroNamed(game, 'HALK'), RESURRECT);
      events.newGameRead();
      events.tick();
      events.ended(false);
      await settle();
    } catch {
      threw = true;
    }
    check(!threw, 'a send that throws reaches neither the game nor the page');
  }

  /* ------------------------------------------------- the server's check ----- */
  {
    const game = harness().game;
    const rules = { sets: new Set([DM.id]), mirrors: () => mirrorNames(dungeonDat, game) };
    const types = new Set(everySent.map((event) => event.type));
    const changed = everySent.filter((event) => JSON.stringify(checkEvent(JSON.stringify(event), rules)) !== JSON.stringify(event));
    console.log(`\n=== the server's check: ${everySent.length} events (${[...types].join(', ')}), ${changed.length} refused or changed ===`);
    for (const event of changed) console.log(`  ${JSON.stringify(event)}: ${JSON.stringify(checkEvent(JSON.stringify(event), rules))}`);
    check(types.size === 4 && changed.length === 0, "the server stores every type of the engine's events as the page sent it");
  }

  finish();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
