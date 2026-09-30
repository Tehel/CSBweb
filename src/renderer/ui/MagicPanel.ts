/**
 * The spell panel.
 *
 * The UI half of CSBWin `doc/CSBwin-src/Magic.cpp`: the rune keypad, the incantation being
 * assembled, and its running mana cost. Casting itself lives in the engine: `CastMagic`
 * is `ui.onSpellCast`.
 * The attack buttons and the attack menu live in `ui/Attack.ts`, beside the rest of the
 * `Character.cpp` port.
 */
import { fillRectIndex, tag0088b2Index } from '../csbwin/CanvasBlitter';
import { drawTextLineIndex, drawTextLineIndexRaw } from '../csbwin/TextRenderer';
import { searchButtonList } from './HitTest';
import { UIState } from './UIState';
import { selectMagicCaster } from '../../engine/Party';
import { flashButtonScript, waitForButtonFlashScript, type LoopScript } from '../../engine/LoopState';

/**
 * The caster tabs `DrawSpellControls` inverts, as CSBWin writes them
 * (`doc/CSBwin-src/Character.cpp:5002-5085`): `[selected caster][champion]` is
 * `[x1, x2, y2]`, all from `y1 = 0x2a`. The caster's own tab is the wide one.
 */
const SPELL_CONTROL_TABS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[0xe9, 0x115, 0x31], [0x118, 0x123, 0x30], [0x126, 0x131, 0x30], [0x134, 0x13f, 0x30]],
  [[0xe9, 0x0f4, 0x30], [0x0f7, 0x123, 0x31], [0x126, 0x131, 0x30], [0x134, 0x13f, 0x30]],
  [[0xe9, 0x0f4, 0x30], [0x0f7, 0x102, 0x30], [0x105, 0x131, 0x31], [0x134, 0x13f, 0x30]],
  [[0xe9, 0x0f4, 0x30], [0x0f7, 0x102, 0x30], [0x105, 0x110, 0x30], [0x113, 0x13f, 0x31]],
];

/**
 * `DrawSpellControls` (`doc/CSBwin-src/Character.cpp:4984-5087`). The panel's strip is
 * cleared to 0, then `vblFlashButn` inverts plane 2 of each tab, which over the black is
 * index 4: the caster's own, with the name in it at `(x1 + 2, 0x30)`, and every other
 * champion's whose `HP()` is not zero. No caster, no tabs (`chIdx != 3`'s return).
 */
export function drawSpellControls(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.fontData || !ui.partyState) return;

  const screen = ui.screenIndexBuffer;
  const chIdx = ui.partyState.magicCasterIndex;
  const champions = ui.partyState.champions;
  fillRectIndex(screen, ui.uiTables.graphic230.word20242, 0);
  if (chIdx < 0 || chIdx > 3) return;

  const tabs = SPELL_CONTROL_TABS[chIdx]!;
  for (let i = 0; i < champions.length && i < 4; i++) {
    const champion = champions[i]!;
    // No tab without mana: a deliberate divergence (`DEBT.md` → H, "No caster tab without
    // mana").
    if (champion.attributes.maxMana === 0) continue;
    if (i !== chIdx && champion.attributes.health === 0) continue;
    const [x1, x2, y2] = tabs[i]!;
    fillRectIndex(screen, { x1, x2, y1: 0x2a, y2 }, 4);
    if (i === chIdx) drawTextLineIndex(screen, ui.fontData, x1 + 2, 0x30, 0, 4, champion.name);
  }
}

export function drawSpellPanel(ui: UIState): void {
  if (!ui.uiTables || !ui.screenIndexBuffer || !ui.fontData || !ui.partyState) return;

  const rect = ui.uiTables.graphic232.word12;

  fillRectIndex(ui.screenIndexBuffer, rect, 0);
  if (ui.partyState.magicCasterIndex < 0) return;

  let panelGraphic = ui.getGraphicBitmap(9);
  if (panelGraphic) {
    tag0088b2Index(
      panelGraphic,
      ui.screenIndexBuffer,
      {
        x1: rect.x1,
        y1: rect.y1,
        x2: rect.x2,
        y2: rect.y2,
        srcX: 0,
        srcY: 0,
        srcStride: panelGraphic.width,
        srcWidth: panelGraphic.width,
        srcHeight: panelGraphic.height,
      },
      -1
    );
  }

  const panelOverlay = ui.getGraphicBitmap(11);
  if (panelOverlay) {
    tag0088b2Index(
      panelOverlay,
      ui.screenIndexBuffer,
      {
        x1: rect.x1,
        y1: rect.y1,
        x2: rect.x2,
        y2: rect.y2,
        srcX: 0,
        srcY: 4,
        srcStride: panelOverlay.width,
        srcWidth: panelOverlay.width,
        srcHeight: panelOverlay.height,
      },
      0
    );
  }

  const caster = ui.partyState.champions[ui.partyState.magicCasterIndex];
  if (!caster || (caster.attributes.health | 0) === 0) return;

  drawSpellMenuCharacters(ui, caster.incantation.length);
  drawMagicIncantation(ui, caster.incantation);
}

/**
 * `DrawSpellMenuCharacters` (`doc/CSBwin-src/CSBCode.cpp:8946-8960`): the six runes of
 * the current step, from `D6W = 225`, each at `D6W += 14`.
 */
export function drawSpellMenuCharacters(ui: UIState, step: number): void {
  if (!ui.screenIndexBuffer || !ui.fontData) return;
  const y = 58;
  for (let i=0; i<6; i++) {
    const x = 225 + 14 * (i + 1);
    const ch = String.fromCharCode(96 + 6 * Math.min(step, 3) + i);
    drawTextLineIndexRaw(ui.screenIndexBuffer, ui.fontData, x, y, 4, 0, ch);
  }
}

/**
 * `DisplayMagicSelection` (`doc/CSBwin-src/Magic.cpp:776-796`): the incantation so far,
 * from `D6W = 232`, each at `D6W += 9`, blanks past its end.
 */
export function drawMagicIncantation(ui: UIState, incantation: number[]): void {
  if (!ui.screenIndexBuffer || !ui.fontData) return;
  const y = 70;
  for (let i=0; i<4; i++) {
    const x = 232 + 9 * (i + 1);
    const ch = (i >= incantation.length) ? ' ' : String.fromCharCode(incantation[i]);
    drawTextLineIndexRaw(ui.screenIndexBuffer, ui.fontData, x, y, 4, 0, ch);
  }
}

/**
 * `_MagicSelection` (`doc/CSBwin-src/Magic.cpp:545-575`): buttons 101-106 are the runes,
 * 107 takes the last one back and 108 casts. The cast needs only a first rune, and
 * `CastMagic` is the engine's (`ui.onSpellCast`), which sets `d.clockTick` and clears
 * the incantation. The function is `RESTARTABLE` and waits for VBLs around its flashes, so
 * the port runs it as a script (`magicSelectionScript`), which holds the loop as CSBWin's
 * pass is held inside it.
 */
export function magicSelection(ui: UIState, button: number): void {
  if (!ui.partyState || !ui.uiTables) return;
  const party = ui.partyState;
  if (button === 108) {
    const pcA0 = party.champions[party.magicCasterIndex];
    if (!pcA0 || (pcA0.incantation[0] ?? 0) === 0) return;
  }
  const script = magicSelectionScript(ui, button);
  ui.ctx.systems.mainLoop.runScript(script);
}

/**
 * `_MagicSelection` from its first flash on. The cast flashes its button
 * (`FlashButton(0xea, 0x12f, 0x3f, 0x49)`, `Magic.cpp:561`) and casts. A rune or the
 * take-back flashes `d.Word18552[4 * (button - 101)]`, waits a VBL, waits for the flash to
 * be put back, and only then changes the incantation (`:568-581`), so the keypad shows the
 * pressed rune inverted, not the next step's.
 */
function* magicSelectionScript(ui: UIState, button: number): LoopScript {
  const party = ui.partyState!;
  if (button === 108) {
    yield* flashButtonScript(ui.ctx, 0xea, 0x12f, 0x3f, 0x49);
    // `CastMagic`'s first act is `WaitForButtonFlash()` (`Magic.cpp:939`), which is waited
    // out here, where a VBL can pass. The engine's own call then finds the button put back.
    yield* waitForButtonFlashScript(ui.ctx);
    ui.onSpellCast?.(party.magicCasterIndex);
  } else {
    const D7 = button - 101;
    const pwA3 = ui.uiTables!.graphic231.word18552[D7]!;
    yield* flashButtonScript(ui.ctx, pwA3.x1, pwA3.x2, pwA3.y1, pwA3.y2);
    // `wvbl(_3_);`
    yield 1;
    yield* waitForButtonFlashScript(ui.ctx);
    if (D7 < 6) {
      tag01b990(ui, D7);
    } else {
      backspaceMagicSelection(ui);
    }
  }
  // The dispatcher drew the click's frame as the script started; the incantation changed since.
  ui.renderLastFrame();
}

/**
 * `TAG01b990` (`doc/CSBwin-src/CSBCode.cpp:8963-8995`): add rune `button` of the current
 * step. It costs `Byte19010[6 * step + button]` (`spellBaseMana`), and after the first
 * rune that times `Byte19016[first - 96]` (`spellFirstRuneScale`), shifted right by 3.
 * `byte33` is the step: every CSBWin writer keeps it at `strlen(incantation) & 3`.
 * `CHARFLAG_statsChanged` has no counterpart: the panels are redrawn every frame.
 */
export function tag01b990(ui: UIState, button: number): void {
  if (!ui.partyState || !ui.uiTables) return;
  const party = ui.partyState;
  const pcA3 = party.champions[party.magicCasterIndex];
  if (!pcA3) return;
  // A deliberate divergence (`DEBT.md` → H, "A fifth rune is refused"): CSBWin wraps
  // `byte33` and starts a new incantation (`doc/CSBwin-src/CSBCode.cpp:8985-8988`).
  if (pcA3.incantation.length > 3) return;
  const D7 = pcA3.incantation.length & 3;
  let D6 = ui.uiTables.graphic230.spellBaseMana[6 * D7 + button]!;
  if (D7 !== 0) {
    const D5 = pcA3.incantation[0]! - 96;
    const D1 = ui.uiTables.graphic230.spellFirstRuneScale[D5]!;
    D6 = (D6 * D1) >> 3;
  }
  if (D6 > pcA3.attributes.mana) return;
  pcA3.attributes.mana -= D6;
  pcA3.incantation[D7] = 6 * D7 + 96 + button;
}

/**
 * `BackspaceMagicSelection` (`doc/CSBwin-src/Magic.cpp:806-822`): the rune before
 * `byte33` goes. Its mana is not given back.
 */
export function backspaceMagicSelection(ui: UIState): void {
  if (!ui.partyState) return;
  const party = ui.partyState;
  const pcA3 = party.champions[party.magicCasterIndex];
  if (!pcA3 || pcA3.incantation.length === 0) return;
  const D7 = ((pcA3.incantation.length & 3) + 3) & 3;
  pcA3.incantation.length = D7;
}

/**
 * `_HandleMagicClick` (`doc/CSBwin-src/Magic.cpp:589-709`). A click at `y <= 48` is on
 * the caster tabs, which CSBWin hit-tests by fixed x ranges for each caster, not by the
 * rectangles it draws: with the fourth champion casting, everything left of 245 is the
 * first champion's. `clickX` 512-515 name a champion outright. Either way nothing below
 * is searched. A lower click is on the keypad.
 */
export function handleMagicClick(ui: UIState, clickX: number, clickY: number): void {
  if (!ui.uiTables || !ui.partyState) return;
  const party = ui.partyState;

  let D6 = -1;
  if (clickY <= 48) {
    const caster = party.magicCasterIndex;
    if (caster === 0) {
      if ((clickX >= 280 && clickX <= 291) || clickX === 513) D6 = 1;
      else if ((clickX >= 294 && clickX <= 305) || clickX === 514) D6 = 2;
      else if ((clickX >= 308 && clickX <= 319) || clickX === 515) D6 = 3;
    } else if (caster === 1) {
      if ((clickX >= 233 && clickX <= 244) || clickX === 512) D6 = 0;
      else if ((clickX >= 294 && clickX <= 305) || clickX === 514) D6 = 2;
      else if ((clickX >= 308 && clickX <= 319) || clickX === 515) D6 = 3;
    } else if (caster === 2) {
      if ((clickX >= 233 && clickX <= 244) || clickX === 512) D6 = 0;
      else if ((clickX >= 247 && clickX <= 258) || clickX === 513) D6 = 1;
      else if ((clickX >= 308 && clickX <= 319) || clickX === 515) D6 = 3;
    } else if (caster === 3) {
      if ((clickX >= 247 && clickX <= 258) || clickX === 513) D6 = 1;
      else if ((clickX >= 261 && clickX <= 272) || clickX === 514) D6 = 2;
      else if (clickX <= 244 || clickX === 512) D6 = 0;
    }
    if (D6 !== -1 && D6 < party.champions.length) {
      // The tabs `drawSpellControls` draws, and no others (`DEBT.md` → H, "No caster tab
      // without mana").
      if (party.champions[D6]!.attributes.maxMana !== 0) selectMagicCaster(party, D6);
    }
    return;
  }
  const D7 = searchButtonList(ui.uiTables.graphic231.buttons.buttons18060, clickX, clickY, 2);
  if (D7 !== 0) {
    magicSelection(ui, D7);
  }
}
