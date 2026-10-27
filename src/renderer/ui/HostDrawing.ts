/**
 * What the engine's host draws on the interface: `GameHost`'s drawing half, documented
 * there, each once the engine has done its share of `d.`. The page's host (`src/main.ts`)
 * and the tools' (`tools/lib/ui.ts`) both draw through it.
 *
 * The interface is read at each call: the page builds its screen after its game, and
 * until then nothing is drawn, no flash holds the buttons and no portrait is known.
 */

import type { GameHost } from '../../engine/GameHost';
import { attackFlashHeld, drawLegalAttackTypesDrawing, flashAttackDamageDrawing, tag01b1c0Drawing } from './Attack';
import { getChampionPortrait, drawCharacterState } from './Character';
import { drawCharacterStateEyePanel } from './Inventory';
import { releaseEyeOrMouthDrawing, setUIMode, showHideInventoryDrawing, tag02076eDrawing, tag0207ccDrawing } from './Mouse';
import { savedGameRead, UIMode, type UIState } from './UIState';

export type HostDrawing = Pick<GameHost,
  | 'showHideInventory' | 'releaseEyeOrMouth' | 'tag02076e' | 'tag0207cc' | 'savedGameRead'
  | 'tag01b1c0' | 'drawLegalAttackTypes' | 'flashAttackDamage' | 'attackFlashHeld'
  | 'displayCharacterDamage' | 'tag011366' | 'drawCharacterState' | 'portraitOf'>;

export function hostDrawing(current: () => UIState | null): HostDrawing {
  const on = (draw: (ui: UIState) => void): void => {
    const ui = current();
    if (ui) draw(ui);
  };
  return {
    showHideInventory: () => on(showHideInventoryDrawing),
    releaseEyeOrMouth: (eye) => on((ui) => releaseEyeOrMouthDrawing(ui, eye)),
    tag02076e: () => on(tag02076eDrawing),
    tag0207cc: () => on(tag0207ccDrawing),
    // The read party is awake.
    savedGameRead: () => on((ui) => {
      savedGameRead(ui);
      setUIMode(ui, UIMode.Adventure);
    }),
    tag01b1c0: (chIdx) => on((ui) => tag01b1c0Drawing(ui, chIdx)),
    drawLegalAttackTypes: (options) => on((ui) => drawLegalAttackTypesDrawing(ui, options)),
    flashAttackDamage: (damage) => on((ui) => flashAttackDamageDrawing(ui, damage)),
    attackFlashHeld: () => {
      const ui = current();
      return ui ? attackFlashHeld(ui) : false;
    },
    displayCharacterDamage: (chIdx, damage) => on((ui) => {
      const inventoryOpen = ui.partyState.selectedCharacterIndex === chIdx;
      ui.characterDamage[chIdx] = { damage, inventoryOpen };
    }),
    tag011366: (chIdx) => on((ui) => { ui.characterDamage[chIdx] = null; }),
    drawCharacterState: (chIdx, charFlags) => on((ui) => {
      drawCharacterState(ui, chIdx, charFlags);
      drawCharacterStateEyePanel(ui, chIdx, charFlags);
    }),
    // `AddCharacter`'s portrait blit, deferred to save time. CSBWin copies a cell of basic
    // graphic 26 into the character record the moment a champion joins
    // (`doc/CSBwin-src/Character.cpp:487-496`), so `CHARDESC` always holds pixels. The
    // engine holds no graphics, so a champion it created carries the cell *index* instead,
    // and the pixels are resolved here when a save packs block 4.
    portraitOf: (champion) => {
      const ui = current();
      const bitmap = ui ? getChampionPortrait(ui, champion) : null;
      return bitmap ? Array.from(bitmap.pixels) : undefined;
    },
  };
}
