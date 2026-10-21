/**
 * The box behind each hand in the champion bar and each body part in the inventory.
 *
 * `DrawCharacterPossession` draws a box behind slots 0 to 5 before the icon, the graphic
 * it keeps in `LOCAL_20` (`doc/CSBwin-src/Character.cpp:1155-1221`): 34 while the part is
 * wounded, else 33, and 35, the cyan box, for the weapon hand of the champion whose attack
 * menu is open. It does so for the two hands in the champion bar as for the six body
 * parts of the open inventory, with an object in the slot or not.
 *
 * The cyan box goes as `TAG01b1c0` closes the menu, after a PASS or an attack, before the
 * tick that draws the buttons over the menu: CSBWin 20230608 clears the ordinal before
 * `TAG01b1c0`'s redraw so that it does (`doc/CSBwin-src/Character.cpp:4904-4923`).
 *
 * The screen is drawn with the real graphics; each slot's box is read back from the ring
 * of pixels around its icon and named by the graphic whose ring it is.
 *
 * Run: `npm test -- --only=dump-hand-boxes.ts`
 */
import { Direction, Position } from '../src/core/types';
import { Party } from '../src/engine/Party';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { closeAttackMenu, executeAttack, prepareAttack, takeAttackOption } from '../src/renderer/ui/Attack';
import { drawTopBarHandIcons } from '../src/renderer/ui/Character';
import { drawPossessionBox } from '../src/renderer/ui/Draw';
import { drawInventoryScreen, getInventorySlotRect } from '../src/renderer/ui/Inventory';
import { type UIState } from '../src/renderer/ui/UIState';
import type { Rect } from '../src/data/tables/UITables';
import { check, finish } from './lib/check';
import { gameTablesOf, newGame, presetHeroesOf, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

const BOXES = [33, 34, 35];

async function main(): Promise<void> {
  const data = stockDungeon();

  const graphics = stockGraphics();

  const heroes = presetHeroesOf(data, graphics).filter((h) => (h.inventory?.length ?? 0) > 0);
  if (heroes.length < 2) throw new Error('dungeon.dat carries fewer than two equipped preset heroes');
  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  for (let i = 0; i < 2; i++) {
    party.addChampion(createChampionFromPreset(heroes[i], i, assignPresetHeroPossessions(heroes[i].inventory, gameTablesOf(graphics))));
  }

  const cache = new Map();
  const game = newGame(data, graphics);
  const ui: UIState = newUIState(graphics, game.ctx, {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
  });
  ui.ctx.party.state = party.state;
  const iconSlots = ui.uiTables.graphic232.iconDisplay;

  /** The 18x18 frame's outer ring around a 16x16 icon at `rect`. */
  function ring(pixels: Uint8Array, rect: Rect): string {
    const out: number[] = [];
    for (let x = rect.x1 - 1; x <= rect.x2 + 1; x++) out.push(pixels[(rect.y1 - 1) * 320 + x]!, pixels[(rect.y2 + 1) * 320 + x]!);
    for (let y = rect.y1; y <= rect.y2; y++) out.push(pixels[y * 320 + rect.x1 - 1]!, pixels[y * 320 + rect.x2 + 1]!);
    return out.join(',');
  }
  const probe: Rect = { x1: 100, y1: 100, x2: 115, y2: 115 };
  const rings = new Map<string, number>();
  for (const box of BOXES) {
    const screen = createPaletteIndexViewportBuffer(320, 200, 7);
    ui.screenIndexBuffer = screen;
    drawPossessionBox(ui, probe, box);
    rings.set(ring(screen.pixels, probe), box);
  }
  check(rings.size === BOXES.length, 'graphics 33, 34 and 35 have rings of their own');

  function boxAt(pixels: Uint8Array, rect: Rect): string {
    return String(rings.get(ring(pixels, rect)) ?? 'none');
  }
  /** The champion bar's four hands, `chIdx.hand box`. */
  function bar(): string[] {
    const screen = createPaletteIndexViewportBuffer(320, 200, 7);
    ui.screenIndexBuffer = screen;
    drawTopBarHandIcons(ui);
    const out: string[] = [];
    for (let slot = 0; slot < 4; slot++) {
      const icon = iconSlots[slot]!;
      out.push(boxAt(screen.pixels, { x1: icon.pixelX, y1: icon.pixelY, x2: icon.pixelX + 15, y2: icon.pixelY + 15 }));
    }
    return out;
  }
  /** The open inventory's six body parts. */
  function inventory(chIdx: number): string[] {
    const screen = createPaletteIndexViewportBuffer(320, 200, 7);
    ui.screenIndexBuffer = screen;
    ui.partyState.selectedCharacterIndex = chIdx;
    drawInventoryScreen(ui);
    ui.partyState.selectedCharacterIndex = -1;
    const out: string[] = [];
    for (let slot = 0; slot < 6; slot++) out.push(boxAt(screen.pixels, getInventorySlotRect(iconSlots, slot)!));
    return out;
  }
  function show(label: string, boxes: string[]): string {
    const line = boxes.join(' ');
    console.log(`${label.padEnd(36)}\t${line}`);
    return line;
  }

  const [c0, c1] = party.state.champions;
  console.log('=== the champion bar: ready and weapon hand of champions 1 and 2 ===');
  check(show('all well', bar()) === '33 33 33 33', 'an unwounded hand has the plain box');
  c1!.wounds = 0b10;
  check(show("champion 2's weapon hand wounded", bar()) === '33 33 33 34',
    'a wounded hand has the marked box, as in the inventory (Character.cpp:1195-1204)');
  c0!.wounds = 0b01;
  c1!.wounds = 0;
  check(show("champion 1's ready hand wounded", bar()) === '34 33 33 33', 'an empty-handed wound too (:1155-1167)');

  console.log('');
  console.log("=== champion 1's inventory: slots 0-5 ===");
  c0!.wounds = 0b100100;
  check(show('head and feet wounded', inventory(0)) === '33 33 34 33 33 34',
    'the inventory marks the wounded parts');
  c0!.wounds = 0;
  check(show('all well', inventory(0)) === '33 33 33 33 33 33', 'and boxes every other one plainly');

  console.log('');
  console.log('=== the attack menu ===');
  prepareAttack(ui, 0);
  check(ui.ctx.interface.attackingCharacterOrdinal === 1, "champion 1's menu is open");
  check(show("champion 1's menu", bar()) === '33 35 33 33', 'the weapon hand of the attacker is boxed in cyan (:1207-1209)');
  check(show("champion 1's inventory, menu open", inventory(0)) === '33 35 33 33 33 33',
    'in the inventory too: D7W == 1 whichever screen the slot is on');
  c0!.wounds = 0b10;
  check(show('the attacking hand wounded', bar()) === '33 35 33 33', 'the cyan box wins over the wound');
  c0!.wounds = 0;
  executeAttack(ui, -1);
  check(show('PASS, before the tick', bar()) === '33 33 33 33',
    'a PASS takes the cyan box away at once (Character.cpp:4904-4923, 2023)');
  prepareAttack(ui, 1);
  check(show("champion 2's menu", bar()) === '33 33 33 35', "champion 2's menu boxes champion 2's hand");
  takeAttackOption(ui, 0);
  check(ui.ctx.interface.attackingCharacterOrdinal === 0, 'the attack closed the menu');
  check(show('attack, before the tick', bar()) === '33 33 33 33', 'and took the cyan box away');
  prepareAttack(ui, 0);
  closeAttackMenu(ui);
  check(show('closed by TAG01b1c0 from elsewhere', bar()) === '33 33 33 33', 'any close does');

  finish();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
