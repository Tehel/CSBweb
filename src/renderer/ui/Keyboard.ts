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

/** Champion 0-3's attack keys, one per attack row: each opens the menu or performs its row. */
const ATTACK_KEYS = [['q', 'a', 'z'], ['w', 's', 'x'], ['e', 'd', 'c'], ['r', 'f', 'v']];
/** Open/close the inventory of champion 0-3. */
const INVENTORY_KEYS = ['7', '8', '9', '0'];
/** The six runes of the current incantation step — magic buttons 101-106. */
const RUNE_KEYS = ['1', '2', '3', '4', '5', '6'];
/**
 * Select the champion who is casting: `config.txt`'s clicks at x 512-515, which
 * `_HandleMagicClick` takes as champion 0-3 (`doc/CSBwin-src/Magic.cpp:600-690`).
 */
const CASTER_KEYS = ['F1', 'F2', 'F3', 'F4'];
/**
 * Magic button 107, the rune the incantation just took back. CSBWin's `config.txt` binds
 * virtual key 0xc0, the key that types both `` ` `` and `~`, so either takes a rune back.
 */
const RUNE_BACK_KEYS = ['`', '~'];
/** Magic button 108. */
const CAST_KEY = ' ';
/** PASS, button 112 of the attack menu. */
const PASS_KEY = 'Tab';

/**
 * What one of the port's own keys outside the panels does: a movement, or the quick-save
 * and quick-load that F5 and F9 ask of the page.
 */
export type PortKeyAction = MovementAction | 'quickSave' | 'quickLoad';

/**
 * The port's own keys outside the panels, beside the arrows, Insert and Clr/Home the tables
 * bind: K , J L M . move the party, F5 and F9 quick-save and quick-load. Letters are
 * lower-case.
 */
const PORT_KEYS: Readonly<Record<string, PortKeyAction>> = {
  k: MovementAction.MOVE_FORWARD,
  ',': MovementAction.MOVE_BACKWARD,
  j: MovementAction.TURN_LEFT,
  l: MovementAction.TURN_RIGHT,
  m: MovementAction.STRAFE_LEFT,
  '.': MovementAction.STRAFE_RIGHT,
  F5: 'quickSave',
  F9: 'quickLoad',
};

/** What a `KeyboardEvent.key` does among `PORT_KEYS`, or null for a key it does not bind. */
export function portKeyAction(key: string): PortKeyAction | null {
  return PORT_KEYS[key.length === 1 ? key.toLowerCase() : key] ?? null;
}

/** Whether `k`, lower-cased, is one of the panel bindings. */
function isUIKey(k: string): boolean {
  return [...ATTACK_KEYS, INVENTORY_KEYS, RUNE_KEYS, CASTER_KEYS]
    .some((keys) => keys.includes(k)) || RUNE_BACK_KEYS.includes(k) || k === CAST_KEY || k === PASS_KEY;
}

/**
 * The Atari keyscan of a `KeyboardEvent.key`, in the form `TAG0196da` compares: the ASCII
 * code in the low byte, or, for a key with none, the scancode in the high byte
 * (`if ((key&0xffff) == 0) key >>= 8`, `doc/CSBwin-src/CSBCode.cpp:8525`). These are the
 * keys the graphics.dat tables bind; `tools/dump-key-bindings.ts` proves every table entry
 * has one here.
 */
const KEYSCAN: Readonly<Record<string, number>> = {
  Enter: 0x0d,
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
 * `key`'s keyscan in CSBWin's key tables, or 0 for a key they cannot hold. No key gives
 * `Byte18400`'s Ctrl-S, `0x13`: CSBWin's shipped `config.txt` has no `key 1` line for it,
 * and `UIM_CHAR` queues only a character a line translates
 * (`doc/CSBwin-src/CSBUI.cpp:1099-1135`), so the disk menu is the disk icon's alone, there
 * as here.
 */
export function keyScanOf(key: string): number {
  return KEYSCAN[key] ?? 0;
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
 * The button the current key tables bind a `KeyboardEvent.key` to, or 0 — but 0 for the
 * caster keys, which `config.txt` takes before the tables (`CASTER_KEYS`).
 */
export function tableKeyButton(ui: UIState, key: string): number {
  if (CASTER_KEYS.includes(key)) return 0;
  return translateKey(ui, keyScanOf(key));
}

/**
 * Offer a `KeyboardEvent.key` to the interface. Returns whether the table claims it —
 * a bound key is claimed whatever the game state, the way a bound scancode is consumed
 * in `UIM_KEYDOWN` whether or not the click it becomes lands on anything.
 *
 * The caller must have dealt with the modal screens first: while the Reincarnate or
 * save/load screen is up they take the keyboard whole.
 */
export function handleUIKey(ui: UIState, key: string): boolean {
  const k = key.length === 1 ? key.toLowerCase() : key;
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
  if (ui.ctx.systems.mainLoop.isRunningScript()) return isUIKey(k);

  for (let chIdx = 0; chIdx < ATTACK_KEYS.length; chIdx++) {
    const option = ATTACK_KEYS[chIdx].indexOf(k);
    if (option >= 0) {
      attackKey(ui, chIdx, option);
      return true;
    }
  }

  let index = INVENTORY_KEYS.indexOf(k);
  if (index >= 0) {
    toggleInventory(ui, index);
    return true;
  }

  index = RUNE_KEYS.indexOf(k);
  if (index >= 0) {
    magicButton(ui, 101 + index);
    return true;
  }

  index = CASTER_KEYS.indexOf(k);
  if (index >= 0) {
    selectCaster(ui, index);
    return true;
  }

  if (RUNE_BACK_KEYS.includes(k)) {
    magicButton(ui, 107);
    return true;
  }

  if (k === CAST_KEY) {
    magicButton(ui, 108);
    return true;
  }

  if (k === PASS_KEY) {
    pass(ui);
    return true;
  }

  return false;
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
