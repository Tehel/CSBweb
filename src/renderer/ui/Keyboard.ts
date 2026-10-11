/**
 * Keyboard bindings for the DM interface.
 *
 * CSBWin's own keys are the four `KeyXlate` tables in graphics.dat `0x231`, which
 * `TAG0196da` searches (`doc/CSBwin-src/CSBCode.cpp:8515-8574`, `translateKey` below):
 * awake, F1-F4 open the inventories, Ctrl-S the disk menu and Esc freezes; Insert and
 * Clr/Home turn, and the four arrows step and strafe. Every other key is `config.txt`'s:
 * `ReadConfigFile` (`doc/CSBwin-src/CSBUI.cpp:761`) reads it into a `KEYXLATE` table
 * (`doc/CSBwin-src/CSBUI.cpp:534`), which is also what turns a PC key into the Atari
 * keyscan the tables hold (`SCAN`, `:1141-1160`) — `KEYSCAN` below is the port's stand-in
 * for that half. An `MSCAN` line binds one scancode to a screen point and a mouse button
 * (`doc/CSBwin-src/CSBUI.cpp:803-816`), and `UIM_KEYDOWN` turns the key into a click
 * there — `OnMouseSwitchAction(2, x, y)` followed by `OnMouseSwitchAction(0)`
 * (`doc/CSBwin-src/CSBUI.cpp:1161-1179`), exactly the pair `UIM_LEFT_BUTTON_DOWN` and
 * `UIM_LEFT_BUTTON_UP` raise. So every such binding is a click on a panel, and the
 * panel's own handler decides what it means.
 *
 * `handleUIKey`'s bindings are the port's `config.txt`. They claim no key a table binds but
 * F1-F4, which select the caster: the shipped `config.txt` makes them clicks on the caster
 * tabs, so `Byte18400`, which has them open the inventories (buttons 7-10), never sees
 * them, and `tableKeyButton` leaves them to `handleUIKey`. They call the handlers a click reaches rather than synthesising coordinates: the
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
import { MovementAction } from '../../engine/gameTypes';
import { attackMenuButton, prepareAttack } from './Attack';
import { magicSelection } from './MagicPanel';
import { handleInventoryToggle } from './Mouse';
import { UIState } from './UIState';

/** A champion's place in the party, 0-3. */
type Champion = 0 | 1 | 2 | 3;

/** The six moves the port binds outside the tables, and the movement each one queues. */
const MOVES = {
  'move.forward': MovementAction.MOVE_FORWARD,
  'move.backward': MovementAction.MOVE_BACKWARD,
  'move.turnLeft': MovementAction.TURN_LEFT,
  'move.turnRight': MovementAction.TURN_RIGHT,
  'move.strafeLeft': MovementAction.STRAFE_LEFT,
  'move.strafeRight': MovementAction.STRAFE_RIGHT,
} as const;
type MoveAction = keyof typeof MOVES;

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
 * - `move.*`: a movement queued, beside the arrows, Insert and Clr/Home the tables bind.
 * - `quickSave`, `quickLoad`: what F5 and F9 ask of the page.
 */
export type KeyAction =
  | `attack.${Champion}.${0 | 1 | 2}`
  | `inventory.${Champion}`
  | `rune.${0 | 1 | 2 | 3 | 4 | 5}`
  | 'runeBack'
  | 'cast'
  | 'pass'
  | `caster.${Champion}`
  | MoveAction
  | 'quickSave'
  | 'quickLoad';

/** An action's two keys, each a `KeyboardEvent.code`, or `''` for none. */
export type KeySlots = readonly [string, string];

/** Every action's keys: what a screen that rebinds keys, or a preset, reads and writes. */
export type KeyBindings = Readonly<Record<KeyAction, KeySlots>>;

/**
 * The default preset: the shipped `config.txt`'s keys, at their places on a US keyboard,
 * and 7-0 for the inventories. The attacks are a column per champion, one key per row.
 * The moves are K , J L M . and the keypad's 4-9 as the file's `scan` lines bind them,
 * which NumLock does not change: keypad 7 turns left, 9 right, 8 and 5 step forward and
 * back, 4 and 6 strafe. The rune key is virtual key 0xc0, left of 1, which types `` ` ``
 * and `~` on a US keyboard.
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
  quickSave: ['F5', ''],
  quickLoad: ['F9', ''],
};

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

const ACTION_OF_CODE = actionsByCode(DEFAULT_KEY_BINDINGS);

/** The action a `KeyboardEvent.code` is bound to, or null. */
export function keyAction(code: string): KeyAction | null {
  return ACTION_OF_CODE.get(code) ?? null;
}

function isMove(action: KeyAction): action is MoveAction {
  return action in MOVES;
}

/** Whether `action` is a panel's: an attack, an inventory, the magic or PASS. */
function isPanelAction(action: KeyAction): boolean {
  return !isMove(action) && action !== 'quickSave' && action !== 'quickLoad';
}

/**
 * What one of the port's own keys outside the panels does: a movement, or the quick-save
 * and quick-load that F5 and F9 ask of the page.
 */
export type PortKeyAction = MovementAction | 'quickSave' | 'quickLoad';

/** What a `KeyboardEvent.code` does outside the panels, or null for a key bound to none of it. */
export function portKeyAction(code: string): PortKeyAction | null {
  const action = keyAction(code);
  if (action === null) return null;
  if (isMove(action)) return MOVES[action];
  return action === 'quickSave' || action === 'quickLoad' ? action : null;
}

/**
 * The Atari keyscan of a `KeyboardEvent.code`, in the form `TAG0196da` compares: the ASCII
 * code in the low byte, or, for a key with none, the scancode in the high byte
 * (`if ((key&0xffff) == 0) key >>= 8`, `doc/CSBwin-src/CSBCode.cpp:8525`). These are the
 * keys the graphics.dat tables bind; `tools/dump-key-bindings.ts` proves every table entry
 * has one here.
 */
const KEYSCAN: Readonly<Record<string, number>> = {
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  Escape: 0x1b,
  F1: 0x3b00,
  F2: 0x3c00,
  F3: 0x3d00,
  F4: 0x3e00,
  Home: 0x4700, // Clr/Home
  ArrowUp: 0x4800,
  ArrowLeft: 0x4b00,
  ArrowRight: 0x4d00,
  ArrowDown: 0x5000,
  Insert: 0x5200,
};

/**
 * `code`'s keyscan in CSBWin's key tables, or 0 for a key they cannot hold. No key gives
 * `Byte18400`'s Ctrl-S, `0x13`: CSBWin's shipped `config.txt` has no `key 1` line for it,
 * and `UIM_CHAR` queues only a character a line translates
 * (`doc/CSBwin-src/CSBUI.cpp:1099-1135`), so the disk menu is the disk icon's alone, there
 * as here.
 */
export function keyScanOf(code: string): number {
  return KEYSCAN[code] ?? 0;
}

/**
 * The table half of `TAG0196da` (`doc/CSBwin-src/CSBCode.cpp:8515-8574`): the button
 * `d.pKeyXlate2`, then `d.pKeyXlate1`, binds `keyscan` to, or 0. With no `pKeyXlate2`,
 * no key is anything. CSBWin goes on past a match: every `pKeyXlate1` match is written
 * too, one queue slot further back each time, so a key bound twice would leave only the
 * last match queued, over the entry queued before it (`:8533-8574`). No keyscan is bound
 * twice in either pair of tables (`tools/dump-key-bindings.ts`), so the first match is
 * what CSBWin queues.
 */
export function translateKey(ui: UIState, keyscan: number): number {
  if (!ui.keyXlate2 || keyscan === 0) return 0;
  for (const entry of ui.keyXlate2) if (entry.keyscan === keyscan) return entry.mouse;
  for (const entry of ui.keyXlate1 ?? []) if (entry.keyscan === keyscan) return entry.mouse;
  return 0;
}

/**
 * The button the current key tables bind a `KeyboardEvent.code` to, or 0 — but 0 for the
 * caster keys, which `config.txt` takes before the tables (`caster.<champion>`).
 */
export function tableKeyButton(ui: UIState, code: string): number {
  if (keyAction(code)?.startsWith('caster.')) return 0;
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
  if (ui.attackingCharacterOrdinal === chIdx + 1) {
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
  if (ui.attackingCharacterOrdinal === 0) return;
  attackMenuButton(ui, 112);
}

/** Button ids 7-10 — the same toggle, and the same "replace" the click path gives. */
function toggleInventory(ui: UIState, chIdx: number): void {
  const party = ui.partyState;
  if (championPending(ui)) return;
  if (chIdx >= party.champions.length) return;
  handleInventoryToggle(ui, chIdx);
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
