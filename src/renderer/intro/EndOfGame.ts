/**
 * The end of the game, lost or won: `_ShowCredits(1)` over the last frame the adventure
 * drew (`ShowCredits.ts`), then, if a game is set up again, `MainLoop` once more on the
 * same `Game` and the same screen.
 */

import type { Game } from '../../engine/Game';
import { determineMastery } from '../../engine/skills';
import type { ScrollingText } from '../csbwin/ScrollingText';
import type { GameScreen } from '../GameScreen';
import { getChampionPortrait } from '../ui/Character';
import { runShowCredits, type BootSequenceDeps } from './BootSequence';
import { SOUND_DYING, type WonChampion } from './ShowCredits';

/** What the end takes: the boot's deps for the credits and a restart, the game and its message area. */
interface EndOfGameDeps extends Omit<BootSequenceDeps, 'skip' | 'title'> {
  game: Game;
  messages: ScrollingText;
}

/**
 * `_ShowCredits(1)`: the end of the game, lost or won, over the last frame the adventure
 * drew. The adventure's cursor is drawn into the screen, so it is lifted first, as
 * `STHideCursor(HC50)` lifts CSBWin's.
 *
 * A game that was saved or loaded can be restarted from it. Then the chooser or the
 * entrance has set up the next game, and `_StartCSB` runs `MainLoop` again
 * (doc/CSBwin-src/CSBCode.cpp:11555-11562), on the same `Game` and the same screen.
 */
export async function showEndOfGame(deps: EndOfGameDeps, word11694: boolean): Promise<void> {
  const { game, gameScreen: screen, messages } = deps;
  screen.setHoverPoint(null);
  screen.refreshOverlay();
  const end = await runShowCredits(deps, {
    queueDyingSound: () => queueDyingSound(game),
    canRestartFromSavegame: game.canRestartFromSavegame(),
    word11694,
    champions: word11694 ? wonChampions(game, screen) : [],
    // `_StartCSB` turns palette switching off before a lost game's credits
    // (doc/CSBwin-src/CSBCode.cpp:11558); the Atari leaves it as it was, as `MainLoop`'s won
    // game does (doc/ReDMCSB-src/GAMELOOP.C:329), and so does the port (`DEBT.md` H).
    palette11946: screen.composer.palette11946(),
  });
  if (end === 'terminate') return;
  messages.restart();
  screen.initializePlayState();
  game.resumeMainLoop();
  game.start();
}

/**
 * `QueueSound(6, d.partyX, d.partyY, 0); //Dying sound` (`doc/CSBwin-src/Code1f9e6.cpp:126`),
 * a lost game's first sound of its credits, and all a recording played back plays of them
 * (`playRecording`, `src/main.ts`).
 */
export function queueDyingSound(game: Game): void {
  const { x, y, z } = game.ctx.party.state.position;
  game.ctx.sounds.queueSound(SOUND_DYING, x, y, 0, z);
}

/** `d.CH16482[0 … d.NumCharacter - 1]` as the won screen shows them (`Code1f9e6.cpp:176-215`). */
function wonChampions(game: Game, screen: GameScreen): WonChampion[] {
  const partySleeping = game.ctx.party.state.sleeping;
  return game.ctx.party.state.champions.map((champion) => ({
    name: champion.name,
    title: champion.title,
    // `*(name + 9)`: the title's second byte, its raw field's where there is one.
    titleByte1: champion.titleField?.[1] ?? (champion.title.length > 1 ? champion.title.charCodeAt(1) : 0),
    portrait: getChampionPortrait(screen.ui, champion),
    masteries: [0, 1, 2, 3].map((skill) => determineMastery(champion, skill | 0xc000, { partySleeping })),
  }));
}
