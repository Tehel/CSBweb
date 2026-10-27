/**
 * Prove the page's one animation clock, `Presenter` (`src/renderer/Presenter.ts`), and the
 * chewing mouth on it. Without a display, its frames are every 16 ms.
 *
 * 1. **One compose a frame.** Two animations under way are one compose a frame, after
 *    both; an animation's last frame, the one its step ends on, composes nothing; and a
 *    pre-game screen's VBL wait (`frames`) never composes.
 * 2. **After the screen.** What is drawn from the canvas (the CRT effect, `drawAfter`)
 *    is drawn once at the next frame however often it was asked, after the compose.
 * 3. **Cancelled.** `cancel`, a game set up again or ended, drops the animations under
 *    way with no frame more, even from inside a frame, and keeps the VBL waits.
 * 4. **The chew.** A mouth press starts the chew (`Feeding.ts`): a compose a frame while
 *    it lasts, one more once the mouth is gone, then none; and a cancel in the middle
 *    leaves nothing more to draw, as at the game's end (`main.ts`'s `showCredits`).
 * 5. **At rest.** With nothing asked, no frame runs.
 *
 * Run: `npm test -- --only=presenter.ts`
 */
import { OBJNI_APPLE } from '../../src/core/objectNameIndex';
import { DBType, OBJECT_ID_EOF, type ObjectID } from '../../src/core/types';
import { Presenter } from '../../src/renderer/Presenter';
import { handleMouthPress } from '../../src/renderer/ui/Feeding';
import { resolveObjectNameIndex } from '../../src/renderer/ui/Objects';
import type { UIState } from '../../src/renderer/ui/UIState';
import type { Game } from '../../src/engine/Game';
import { check, finish } from '../lib/check';
import { freshGame } from '../lib/dsa';
import { stockGraphics } from '../lib/game';
import { newUIState } from '../lib/ui';

const FRAME_MS = 16;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What a presenter did, in order: `compose`, `after`, and each step's name. */
function recording(): { log: string[]; presenter: Presenter } {
  const log: string[] = [];
  return { log, presenter: new Presenter(() => log.push('compose')) };
}

/** A step named `name` that runs `frames` frames, then ends on the next. */
function counted(log: string[], name: string, frames: number): () => boolean {
  let left = frames;
  return () => {
    log.push(name);
    return left-- > 0;
  };
}

async function oneComposeAFrame(): Promise<void> {
  console.log('=== 1. one compose a frame ===');
  const { log, presenter } = recording();
  presenter.animate(counted(log, 'a', 2));
  presenter.animate(counted(log, 'b', 1));
  presenter.frames(counted(log, 'vbl', 3));
  await wait(FRAME_MS * 12);
  console.log(`  ${log.join(' ')}`);
  check(log.join(' ') === 'a b vbl compose a b vbl compose a vbl vbl',
    'two animations are one compose a frame, after both; a last frame composes nothing; a VBL wait never composes');
}

async function afterTheScreen(): Promise<void> {
  console.log('=== 2. after the screen ===');
  const { log, presenter } = recording();
  const crt = (): void => { log.push('after'); };
  presenter.drawAfter(crt);
  presenter.animate(counted(log, 'a', 1));
  presenter.drawAfter(crt);
  presenter.drawAfter(crt);
  await wait(FRAME_MS * 8);
  console.log(`  ${log.join(' ')}`);
  check(log.join(' ') === 'a compose after a', 'asked three times, drawn once, after the compose, and not again unasked');
}

async function cancelled(): Promise<void> {
  console.log('=== 3. cancelled ===');
  {
    const { log, presenter } = recording();
    presenter.animate(counted(log, 'a', 5));
    presenter.frames(counted(log, 'vbl', 2));
    presenter.cancel();
    await wait(FRAME_MS * 8);
    console.log(`  before a frame: ${log.join(' ')}`);
    check(log.join(' ') === 'vbl vbl vbl', 'the animation dropped before its first frame, the VBL wait kept');
  }
  {
    const { log, presenter } = recording();
    presenter.animate(counted(log, 'a', 5));
    presenter.animate(() => {
      log.push('end');
      presenter.cancel();
      return true;
    });
    await wait(FRAME_MS * 8);
    console.log(`  from inside a frame: ${log.join(' ')}`);
    check(log.join(' ') === 'a end', 'a cancel inside a frame draws nothing of it, and no frame follows');
  }
}

/** Champion 0 fed an apple with the mouth, on an interface whose clock is `presenter`. */
function feedApple(game: Game, presenter: Presenter): UIState {
  const ui = newUIState(stockGraphics(), game.ctx, { animate: (step) => presenter.animate(step) });
  const records = game.ctx.dungeon.getData().databases.misc.records;
  let rn: ObjectID | null = null;
  for (let miscType = 0; miscType < 128 && rn === null; miscType++) {
    records.push({ nextObject: OBJECT_ID_EOF, specialState: 0, important: false, miscType });
    const candidate = game.ctx.dungeon.rnMaps.rn(DBType.MISC, records.length - 1);
    if (resolveObjectNameIndex(ui, candidate) === OBJNI_APPLE) rn = candidate;
    else records.pop();
  }
  if (rn === null) throw new Error('no misc type is an apple');
  const party = game.ctx.party.state;
  party.cursorOwner = 0;
  party.selectedCharacterIndex = 0;
  party.objectInHand = rn;
  handleMouthPress(ui);
  return ui;
}

async function theChew(): Promise<void> {
  console.log('=== 4. the chew ===');
  {
    const { log, presenter } = recording();
    const ui = feedApple(freshGame(), presenter);
    check(ui.mouthChewStartMs !== null, 'the mouth press starts the chew');
    const span = ui.mouthChewEndMs - ui.mouthChewStartMs!;
    await wait(span + FRAME_MS * 8);
    const composes = log.length;
    console.log(`  a chew of ${span.toFixed(0)} ms: ${composes} composes, the mouth ${ui.mouthChewStartMs === null ? 'gone' : 'still up'}`);
    check(ui.mouthChewStartMs === null && composes >= 2 && composes <= Math.ceil(span / FRAME_MS) + 2,
      'a compose a frame while it lasts, and one more once the mouth is gone');
    await wait(FRAME_MS * 4);
    check(log.length === composes, 'then none');
  }
  {
    const { log, presenter } = recording();
    const ui = feedApple(freshGame(), presenter);
    await wait(FRAME_MS * 3);
    presenter.cancel();
    const composes = log.length;
    await wait(ui.mouthChewEndMs - ui.mouthChewStartMs! + FRAME_MS * 4);
    console.log(`  cancelled after ${composes} composes: ${log.length - composes} more`);
    check(composes >= 1 && log.length === composes, 'a chew cancelled, as at the game\'s end, draws nothing more');
  }
}

async function atRest(): Promise<void> {
  console.log('=== 5. at rest ===');
  const { log, presenter } = recording();
  let frames = 0;
  presenter.frames(() => { frames++; return false; });
  await wait(FRAME_MS * 6);
  console.log(`  one frame asked: ${frames} run, ${log.length} composes`);
  check(frames === 1 && log.length === 0, 'a frame asked is one frame, and nothing asked is none');
}

await oneComposeAFrame();
await afterTheScreen();
await cancelled();
await theChew();
await atRest();
finish();
