/**
 * Keyboard bindings for the DM interface.
 *
 * CSBWin's own keys are the four `KeyXlate` tables in graphics.dat `0x231`, which
 * `TAG0196da` searches (`doc/CSBwin-src/CSBCode.cpp:8515-8574`, `translateKey` below):
 * they bind Atari keyscans. Awake, F1-F4 open the inventories, Ctrl-S the disk menu and
 * Esc freezes; Insert and Clr/Home turn, and the four arrows step and strafe; asleep,
 * Return and Esc wake. No PC key is any of these until `config.txt` says so:
 * `ReadConfigFile` (`doc/CSBwin-src/CSBUI.cpp:761`) reads it into a `KEYXLATE` table
 * (`doc/CSBwin-src/CSBUI.cpp:534`), whose `KEY` and `SCAN` lines turn a PC key into the
 * Atari keyscan the tables hold (`:1099-1160`). Here that half is the actions named for
 * a keyscan (`TABLE_KEYSCAN`): a key bound to one goes through the tables, which decide
 * its button in each mode. An `MSCAN` line binds one scancode to a screen point and a mouse button
 * (`doc/CSBwin-src/CSBUI.cpp:803-816`), and `UIM_KEYDOWN` turns the key into a click
 * there — `OnMouseSwitchAction(2, x, y)` followed by `OnMouseSwitchAction(0)`
 * (`doc/CSBwin-src/CSBUI.cpp:1161-1179`), exactly the pair `UIM_LEFT_BUTTON_DOWN` and
 * `UIM_LEFT_BUTTON_UP` raise. So every such binding is a click on a panel, and the
 * panel's own handler decides what it means.
 *
 * `DEFAULT_KEY_BINDINGS` is the port's `config.txt`, and the default of the player's
 * settings, whose table holds the only keys the game answers (`setKeyBindings`): a key
 * bound to no action does nothing, the Reincarnate screen's and the save menu's typing
 * aside. F1-F4 select the caster, as the shipped `config.txt` makes them clicks on
 * the caster tabs, so `Byte18400`'s binding of them to the inventories (buttons 7-10) is
 * never reached. The panel actions call the handlers a click reaches rather than synthesising coordinates: the
 * coordinates in a `config.txt` are hardcoded, and ours would have to be read back out
 * of the runtime button lists to say the same thing. The guards below are therefore
 * lifted from `handleMouseButton` (`src/renderer/ui/Mouse.ts`) so the two routes stay
 * equivalent — in particular `d.PotentialCharacterOrdinal` makes every panel inert
 * (`doc/CSBwin-src/Mouse.cpp:1717-1789`).
 *
 * The panel keys are those of the `config.txt` CSBWin's Windows build ships
 * (`CSB_Windows_x86-32_20151213.zip`, `doc/PROVEN_FACTS.md` → "CSBWin has no keyboard
 * controls"): Q/A/Z, W/S/X, E/D/C and R/F/V for the attacks, 1-6 for the runes, `~` to
 * take one back, Space to cast, Tab to pass, and F1-F4 for the caster. The port adds 7-0
 * for the inventories, which that file leaves unbound.
 *
 * Every binding here is a `KeyboardEvent.code`, the physical key, as `config.txt`'s are
 * Windows virtual keys and scancodes: the keys sit where CSBWin's sit on a US keyboard,
 * whatever the layout. On AZERTY the attacks are A Z E R / Q S D F / W X C V, the
 * digits answer unshifted, and `²` takes a rune back. A key with a modifier is the
 * browser's (`GameInput.keyDown`), so a binding never needs one.
 *
 * The attack keys are a column per champion — Q/A/Z for the first, W/S/X, E/D/C and
 * R/F/V for the others — one key per attack row. With that champion's menu open a key
 * performs its row; otherwise it opens the menu.
 *
 * ⚠️ One deliberate divergence, and it is the reason for the direct calls: an attack key
 * pressed while *another* champion's attack menu is open replaces that menu. A click
 * cannot do that — with a menu open the panel area is the option list, not the four
 * champion buttons (`handleAttackAreaClick`) — so there is no click to synthesise.
 */
import { selectMagicCaster } from '../../engine/Party';
import { attackMenuButton, prepareAttack } from './Attack';
import { magicSelection } from './MagicPanel';
import { showHideInventory } from '../../engine/ShowHideInventory';
import { UIState } from './UIState';

/** A champion's place in the party, 0-3. */
type Champion = 0 | 1 | 2 | 3;

/**
 * The actions a key sends to the graphics.dat tables, as the shipped `config.txt`'s `KEY`
 * and `SCAN` lines do: each one's Atari keyscan, in the form `TAG0196da` compares, the
 * ASCII code in the low byte or, for a key with none, the scancode in the high byte
 * (`if ((key&0xffff) == 0) key >>= 8`, `doc/CSBwin-src/CSBCode.cpp:8525`). The moves are
 * the arrows', Insert's and Clr/Home's, the keyscans the file sends for K , J L M . and
 * the keypad. Down and up are the keyscans 3D2D1D's `config.txt` sends for `-` and `=`
 * (`scan 1 00000c 490000`, `scan 1 00000d 4a0000`), which no table binds: only a dungeon
 * that sets `bThreeDMovements` answers them (`translateKey`).
 */
const TABLE_KEYSCAN = {
  'move.forward': 0x4800,
  'move.backward': 0x5000,
  'move.turnLeft': 0x5200,
  'move.turnRight': 0x4700,
  'move.strafeLeft': 0x4b00,
  'move.strafeRight': 0x4d00,
  'move.down': 0x4900,
  'move.up': 0x4a00,
  freeze: 0x1b,
  wake: 0x0d,
} as const;
type TableAction = keyof typeof TABLE_KEYSCAN;

/**
 * What a key can be bound to.
 *
 * - `attack.<champion>.<row>`: the champion's attack menu, opened, or its row performed
 *   when it is open (`attackKey`).
 * - `inventory.<champion>`: the champion's inventory, opened or closed (buttons 7-10).
 * - `rune.<n>`: rune `n` of the incantation's current step, magic buttons 101-106.
 * - `runeBack`: magic button 107, the last rune taken back; `cast`: button 108.
 * - `pass`: PASS, button 112 of the attack menu.
 * - `caster.<champion>`: the champion who casts, `config.txt`'s clicks at x 512-515, which
 *   `_HandleMagicClick` takes as champion 0-3 (`doc/CSBwin-src/Magic.cpp:600-690`).
 * - `move.*`, `freeze`, `wake`: a keyscan sent to the tables (`TABLE_KEYSCAN`), which
 *   queue the step or turn, the freeze or the waking their button stands for.
 * - `quickSave`, `quickLoad`: what F5 and F9 ask of the page.
 * - `map`: the map dialog, opened or closed (`MapDialog.ts`), with MAP VIEW on. No preset
 *   binds it.
 * - `champions`: the champion dialog, opened or closed (`ChampionDialog.ts`), with
 *   CHAMPION VIEW on. No preset binds it.
 */
export type KeyAction =
  | `attack.${Champion}.${0 | 1 | 2}`
  | `inventory.${Champion}`
  | `rune.${0 | 1 | 2 | 3 | 4 | 5}`
  | 'runeBack'
  | 'cast'
  | 'pass'
  | `caster.${Champion}`
  | TableAction
  | 'quickSave'
  | 'quickLoad'
  | 'map'
  | 'champions';

/** An action's two keys, each a `KeyboardEvent.code`, or `''` for none. */
export type KeySlots = readonly [string, string];

/** Every action's keys: what a screen that rebinds keys, or a preset, reads and writes. */
export type KeyBindings = Readonly<Record<KeyAction, KeySlots>>;

/**
 * The default preset: the shipped `config.txt`'s keys, at their places on a US keyboard,
 * and 7-0 for the inventories. The attacks are a column per champion, one key per row.
 * The moves are K , J L M . and the keypad's 4-9 as the file's `scan` lines bind them,
 * which NumLock does not change: keypad 7 turns left, 9 right, 8 and 5 step forward and
 * back, 4 and 6 strafe. `-` and `=` go a level down and up, as 3D2D1D's `config.txt` binds
 * them, in a dungeon that sets `bThreeDMovements`. The arrows are not moves, where the file's scancodes make them
 * keypad 8, 4 and 6 (`DEBT.md` H, "The keys are the port's table"). Pause freezes,
 * which the file's one other `KEY` line gives Esc: Esc opens the settings
 * (`GameInput.keyDown`, `DEBT.md` H). Return wakes no one, since the file has no line for
 * it. The rune key is virtual key 0xc0, left of 1, which types `` ` `` and `~` on a US
 * keyboard.
 */
export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  'attack.0.0': ['KeyQ', ''],
  'attack.0.1': ['KeyA', ''],
  'attack.0.2': ['KeyZ', ''],
  'attack.1.0': ['KeyW', ''],
  'attack.1.1': ['KeyS', ''],
  'attack.1.2': ['KeyX', ''],
  'attack.2.0': ['KeyE', ''],
  'attack.2.1': ['KeyD', ''],
  'attack.2.2': ['KeyC', ''],
  'attack.3.0': ['KeyR', ''],
  'attack.3.1': ['KeyF', ''],
  'attack.3.2': ['KeyV', ''],
  'inventory.0': ['Digit7', ''],
  'inventory.1': ['Digit8', ''],
  'inventory.2': ['Digit9', ''],
  'inventory.3': ['Digit0', ''],
  'rune.0': ['Digit1', ''],
  'rune.1': ['Digit2', ''],
  'rune.2': ['Digit3', ''],
  'rune.3': ['Digit4', ''],
  'rune.4': ['Digit5', ''],
  'rune.5': ['Digit6', ''],
  runeBack: ['Backquote', ''],
  cast: ['Space', ''],
  pass: ['Tab', ''],
  'caster.0': ['F1', ''],
  'caster.1': ['F2', ''],
  'caster.2': ['F3', ''],
  'caster.3': ['F4', ''],
  'move.forward': ['KeyK', 'Numpad8'],
  'move.backward': ['Comma', 'Numpad5'],
  'move.turnLeft': ['KeyJ', 'Numpad7'],
  'move.turnRight': ['KeyL', 'Numpad9'],
  'move.strafeLeft': ['KeyM', 'Numpad4'],
  'move.strafeRight': ['Period', 'Numpad6'],
  'move.down': ['Minus', ''],
  'move.up': ['Equal', ''],
  freeze: ['Pause', ''],
  wake: ['', ''],
  quickSave: ['F5', ''],
  quickLoad: ['F9', ''],
  map: ['', ''],
  champions: ['', ''],
};

/** The default preset's moves on the keypad alone: K , J L M . free. */
export const KEYPAD_KEY_BINDINGS: KeyBindings = {
  ...DEFAULT_KEY_BINDINGS,
  'move.forward': ['Numpad8', ''],
  'move.backward': ['Numpad5', ''],
  'move.turnLeft': ['Numpad7', ''],
  'move.turnRight': ['Numpad9', ''],
  'move.strafeLeft': ['Numpad4', ''],
  'move.strafeRight': ['Numpad6', ''],
};

/**
 * The moves on the arrows, as the Atari's cursor block has them (`TABLE_KEYSCAN`): up
 * steps forward, down back, left and right strafe. The Atari turns on Insert and
 * Clr/Home, the keys above its left and right arrows; here Delete and Page Down, the
 * keys above the PC's. The keypad stays the second key, as the default preset's.
 */
export const ARROWS_KEY_BINDINGS: KeyBindings = {
  ...DEFAULT_KEY_BINDINGS,
  'move.forward': ['ArrowUp', 'Numpad8'],
  'move.backward': ['ArrowDown', 'Numpad5'],
  'move.turnLeft': ['Delete', 'Numpad7'],
  'move.turnRight': ['PageDown', 'Numpad9'],
  'move.strafeLeft': ['ArrowLeft', 'Numpad4'],
  'move.strafeRight': ['ArrowRight', 'Numpad6'],
};

/**
 * The named key tables a player can pick: CSBWIN is `DEFAULT_KEY_BINDINGS`, KEYPAD and
 * ARROWS move it to the keypad alone or to the arrows. A table changed by hand is
 * `custom`, and is its own.
 */
export const KEY_PRESETS = {
  csbwin: DEFAULT_KEY_BINDINGS,
  keypad: KEYPAD_KEY_BINDINGS,
  arrows: ARROWS_KEY_BINDINGS,
} as const satisfies Record<string, KeyBindings>;

/** A preset's name, or `custom` for a table of the player's. */
export type KeyPreset = keyof typeof KEY_PRESETS | 'custom';

/**
 * The action each code of `bindings` does: the reverse map a key press is looked up in,
 * and where a screen finds a code already bound elsewhere. A code in two slots is the
 * first action's, in the table's order.
 */
export function actionsByCode(bindings: KeyBindings): ReadonlyMap<string, KeyAction> {
  const byCode = new Map<string, KeyAction>();
  for (const [action, slots] of Object.entries(bindings) as Array<[KeyAction, KeySlots]>) {
    for (const code of slots) if (code !== '' && !byCode.has(code)) byCode.set(code, action);
  }
  return byCode;
}

/** Whether an action can take `code`: Esc is the settings' (`GameInput.keyDown`), and no code is no key. */
export function isBindableKey(code: string): boolean {
  return code !== '' && code !== 'Escape';
}

/**
 * `bindings` with `code` in `action`'s slot `slot`, and taken out of every other slot, so
 * a code is one action's at most. A code no action can take changes nothing.
 */
export function bindKey(bindings: KeyBindings, action: KeyAction, slot: 0 | 1, code: string): KeyBindings {
  if (!isBindableKey(code)) return bindings;
  return mapSlots(bindings, (a, i, bound) => (a === action && i === slot ? code : bound === code ? '' : bound));
}

/** `bindings` with `action`'s slot `slot` emptied. */
export function clearKey(bindings: KeyBindings, action: KeyAction, slot: 0 | 1): KeyBindings {
  return mapSlots(bindings, (a, i, bound) => (a === action && i === slot ? '' : bound));
}

function mapSlots(bindings: KeyBindings, slotCode: (action: KeyAction, slot: 0 | 1, code: string) => string): KeyBindings {
  const table = {} as Record<KeyAction, KeySlots>;
  for (const [action, [first, second]] of Object.entries(bindings) as Array<[KeyAction, KeySlots]>) {
    table[action] = [slotCode(action, 0, first), slotCode(action, 1, second)];
  }
  return table;
}

/** The bindings in force, which every key is looked up in: the player's (`setKeyBindings`). */
let actionOfCode = actionsByCode(DEFAULT_KEY_BINDINGS);

/** The bindings every key is looked up in from now on: the player's settings set them. */
export function setKeyBindings(bindings: KeyBindings): void {
  actionOfCode = actionsByCode(bindings);
}

/** The action a `KeyboardEvent.code` is bound to, or null. */
export function keyAction(code: string): KeyAction | null {
  return actionOfCode.get(code) ?? null;
}

function isTableAction(action: KeyAction): action is TableAction {
  return action in TABLE_KEYSCAN;
}

/**
 * What one of the port's own keys asks of the page: F5's quick-save, F9's quick-load, the
 * map and the champions.
 */
type PortKeyAction = 'quickSave' | 'quickLoad' | 'map' | 'champions';

function isPortAction(action: KeyAction): action is PortKeyAction {
  return action === 'quickSave' || action === 'quickLoad' || action === 'map' || action === 'champions';
}

/** Whether `action` is a panel's: an attack, an inventory, the magic or PASS. */
function isPanelAction(action: KeyAction): boolean {
  return !isTableAction(action) && !isPortAction(action);
}

/** What a `KeyboardEvent.code` asks of the page, or null for a key bound to none of the port's actions. */
export function portKeyAction(code: string): PortKeyAction | null {
  const action = keyAction(code);
  return action !== null && isPortAction(action) ? action : null;
}

/**
 * The keyscan a `KeyboardEvent.code` sends the key tables, or 0 for a key bound to no
 * table action. No action sends `Byte18400`'s Ctrl-S, `0x13`: CSBWin's shipped
 * `config.txt` has no `key 1` line for it, and `UIM_CHAR` queues only a character a line
 * translates (`doc/CSBwin-src/CSBUI.cpp:1099-1135`), so the disk menu is the disk icon's
 * alone, there as here.
 */
export function keyScanOf(code: string): number {
  const action = keyAction(code);
  return action !== null && isTableAction(action) ? TABLE_KEYSCAN[action] : 0;
}

/**
 * The table half of `TAG0196da` (`doc/CSBwin-src/CSBCode.cpp:8515-8574`): the button
 * `d.pKeyXlate2`, then `d.pKeyXlate1`, binds `keyscan` to, or 0. With no `pKeyXlate2`,
 * no key is anything. CSBWin goes on past a match: every `pKeyXlate1` match is written
 * too, one queue slot further back each time, so a key bound twice would leave only the
 * last match queued, over the entry queued before it (`:8533-8574`). No keyscan is bound
 * twice in either pair of tables (`tools/dump-key-bindings.ts`), so the first match is
 * what CSBWin queues.
 *
 * Then, `if (bThreeDMovements)`, the keyscan `0x4900` is button `0x1124`, a level down,
 * and `0x4a00` is `0x1125`, up (`:8575-8595`), in every mode the tables answer, asleep
 * too. Neither keyscan is in a table (`tools/dump-key-bindings.ts`), so neither is two
 * matches.
 */
export function translateKey(ui: UIState, keyscan: number): number {
  if (!ui.keyXlate2 || keyscan === 0) return 0;
  for (const entry of ui.keyXlate2) if (entry.keyscan === keyscan) return entry.mouse;
  for (const entry of ui.keyXlate1 ?? []) if (entry.keyscan === keyscan) return entry.mouse;
  if (ui.ctx.rules.bThreeDMovements) {
    if (keyscan === TABLE_KEYSCAN['move.up']) return 0x1125;
    if (keyscan === TABLE_KEYSCAN['move.down']) return 0x1124;
  }
  return 0;
}

/** The button the current key tables bind a `KeyboardEvent.code`'s keyscan to, or 0. */
export function tableKeyButton(ui: UIState, code: string): number {
  return translateKey(ui, keyScanOf(code));
}

/**
 * Offer a `KeyboardEvent.code` to the interface. Returns whether the table claims it —
 * a bound key is claimed whatever the game state, the way a bound scancode is consumed
 * in `UIM_KEYDOWN` whether or not the click it becomes lands on anything.
 *
 * The caller must have dealt with the modal screens first: while the Reincarnate or
 * save/load screen is up they take the keyboard whole.
 */
export function handleUIKey(ui: UIState, code: string): boolean {
  // While a script holds the loop, CSBWin's pass is suspended in `wvbl`
  // (doc/CSBwin-src/system.cpp:639-661) and its UI only queues: the key becomes a click
  // (`UIM_KEYDOWN`, `CSBUI.cpp:1141-1185`) that the first pass after the script takes. So
  // the key is claimed, and does nothing: a known loss (`DEBT.md` H, "Three inputs bypass
  // the mouse queue"). After the fusion no pass comes before the credits, so nothing is
  // lost there. After `_MagicSelection`, which holds the loop three VBLs (about 50 ms) for
  // a rune's flash (`magicSelectionScript`), a rune key pressed that soon after the last is
  // dropped where CSBWin would cast it; only deliberately fast typing does that. If it ever
  // matters, keep the key rather than drop it: either queue it through the mouse queue as
  // the click it stands for (`Game.onMouseClick` at the key's button rectangle, which
  // `buttons18060` gives, so `handleMagicClick` answers it in its pass), or hold the keys
  // that arrive during a script in a small queue of their own and replay them, in order,
  // once `isRunningScript` turns false.
  const action = keyAction(code);
  if (action === null || !isPanelAction(action)) return false;
  if (ui.ctx.systems.mainLoop.isRunningScript()) return true;

  const [kind, first, second] = action.split('.');
  const n = Number(first);
  switch (kind) {
    case 'attack': attackKey(ui, n, Number(second)); break;
    case 'inventory': toggleInventory(ui, n); break;
    case 'rune': magicButton(ui, 101 + n); break;
    case 'caster': selectCaster(ui, n); break;
    case 'runeBack': magicButton(ui, 107); break;
    case 'cast': magicButton(ui, 108); break;
    case 'pass': pass(ui); break;
  }
  return true;
}

/** `d.PotentialCharacterOrdinal` — a champion only provisionally in the party. */
function championPending(ui: UIState): boolean {
  return ui.partyState.potentialChampionIndex >= 0;
}

/**
 * An attack key: with `chIdx`'s menu open, the attack of row `option`; otherwise that
 * champion's menu opens, replacing whatever was there. `prepareAttack` refuses a dead or
 * busy champion and a weapon with no attacks, and the menu already on screen is left
 * alone when it does.
 */
function attackKey(ui: UIState, chIdx: number, option: number): void {
  const party = ui.partyState;
  if (championPending(ui)) return;
  if (chIdx >= party.champions.length) return;
  if (ui.ctx.interface.attackingCharacterOrdinal === chIdx + 1) {
    // The attack options are button ids 113-115, flashed and taken as a click's are.
    attackMenuButton(ui, 113 + option);
    return;
  }
  prepareAttack(ui, chIdx);
}

/**
 * PASS, which closes the open attack menu. `config.txt`'s TAB is a click at (0x131, 0x50),
 * inside PASS; with no menu open the point is in the attack area above the four hands
 * (`d.Buttons17952` start at y 86), so it does nothing.
 */
function pass(ui: UIState): void {
  if (championPending(ui)) return;
  if (ui.ctx.interface.attackingCharacterOrdinal === 0) return;
  attackMenuButton(ui, 112);
}

/** Button ids 7-10 — the same toggle, and the same "replace" the click path gives. */
function toggleInventory(ui: UIState, chIdx: number): void {
  const party = ui.partyState;
  if (championPending(ui)) return;
  if (chIdx >= party.champions.length) return;
  showHideInventory(ui.ctx, chIdx);
}

/** Button id 100 — the rune keypad, live only once a caster is selected. */
function magicButton(ui: UIState, buttonId: number): void {
  if (championPending(ui)) return;
  if (ui.partyState.magicCasterIndex === -1) return;
  magicSelection(ui, buttonId);
}

/**
 * The caster tabs. A tab is only drawn for a living champion with mana to spend
 * (`drawSpellControls`; a deliberate divergence, `DEBT.md` → H, "No caster tab without
 * mana"), so only those can be picked — the keys reach exactly the tabs
 * `handleMagicClick` does.
 */
function selectCaster(ui: UIState, chIdx: number): void {
  const party = ui.partyState;
  if (championPending(ui)) return;
  const champion = party.champions[chIdx];
  // `SelectMagicCaster` refuses a champion whose `HP()` is 0 (`doc/CSBwin-src/Magic.cpp:727`).
  if (!champion || (champion.attributes.health | 0) === 0) return;
  if (champion.attributes.maxMana === 0) return;
  selectMagicCaster(party, chIdx);
}
