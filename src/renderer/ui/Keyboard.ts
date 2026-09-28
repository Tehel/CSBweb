/**
 * Keyboard bindings for the DM interface.
 *
 * CSBWin's own keys are the four `KeyXlate` tables in graphics.dat `0x231`, which
 * `TAG0196da` searches (`doc/CSBwin-src/CSBCode.cpp:8428-8475`, `translateKey` below):
 * awake, F1-F4 open the inventories, Ctrl-S the disk menu and Esc freezes; Insert and
 * Clr/Home turn, and the four arrows step and strafe. Every other key is `config.txt`'s:
 * `ReadConfigFile` (`doc/CSBwin-src/CSBUI.cpp:741`) reads it into a `KEYXLATE` table
 * (`doc/CSBwin-src/CSBUI.cpp:514`), which is also what turns a PC key into the Atari
 * keyscan the tables hold (`SCAN`, `:1120-1139`) — `KEYSCAN` below is the port's stand-in
 * for that half. An `MSCAN` line binds one scancode to a screen point and a mouse button
 * (`doc/CSBwin-src/CSBUI.cpp:783-796`), and `UIM_KEYDOWN` turns the key into a click
 * there — `OnMouseSwitchAction(2, x, y)` followed by `OnMouseSwitchAction(0)`
 * (`doc/CSBwin-src/CSBUI.cpp:1140-1158`), exactly the pair `UIM_LEFT_BUTTON_DOWN` and
 * `UIM_LEFT_BUTTON_UP` raise. So every such binding is a click on a panel, and the
 * panel's own handler decides what it means.
 *
 * `handleUIKey`'s bindings are the port's `config.txt`. They claim no key a table binds but
 * F1-F4, which select the caster, where `Byte18400` has them open the inventories
 * (buttons 7-10) — the author's choice, and a `DEBT.md` H divergence: 7-0 open the
 * inventories instead, and `tableKeyButton` leaves F1-F4 to `handleUIKey`. They call the handlers a click reaches rather than synthesising coordinates: the
 * coordinates in a `config.txt` are hardcoded, and ours would have to be read back out
 * of the runtime button lists to say the same thing. The guards below are therefore
 * lifted from `handleMouseButton` (`src/renderer/ui/Mouse.ts`) so the two routes stay
 * equivalent — in particular `d.PotentialCharacterOrdinal` makes every panel inert
 * (`doc/CSBwin-src/Mouse.cpp:1578-1650`).
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
import { prepareAttack, takeAttackOption } from './Attack';
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
 * Select the champion who is casting. The tables bind these to the inventories; the port
 * keeps them for the caster (`DEBT.md` H).
 */
const CASTER_KEYS = ['F1', 'F2', 'F3', 'F4'];
/** Magic button 107, the rune the incantation just took back. */
const RUNE_BACK_KEY = '`';
/** Magic button 108. */
const CAST_KEY = 'Tab';

/** Whether `k`, lower-cased, is one of the panel bindings. */
function isUIKey(k: string): boolean {
  return [...ATTACK_KEYS, INVENTORY_KEYS, RUNE_KEYS, CASTER_KEYS]
    .some((keys) => keys.includes(k)) || k === RUNE_BACK_KEY || k === CAST_KEY;
}

/**
 * The Atari keyscan of a `KeyboardEvent.key`, in the form `TAG0196da` compares: the ASCII
 * code in the low byte, or, for a key with none, the scancode in the high byte
 * (`if ((key&0xffff) == 0) key >>= 8`, `doc/CSBwin-src/CSBCode.cpp:8438`). These are the
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
 * `key`'s keyscan in CSBWin's key tables, or 0 for a key they cannot hold. With Ctrl, a
 * letter is its ASCII control code, the letter's code less 0x40 — Ctrl-S is 0x13 — and
 * any other key is nothing.
 */
export function keyScanOf(key: string, ctrl = false): number {
  if (ctrl) return /^[a-z]$/i.test(key) ? key.toUpperCase().charCodeAt(0) & 0x1f : 0;
  return KEYSCAN[key] ?? 0;
}

/**
 * The table half of `TAG0196da` (`doc/CSBwin-src/CSBCode.cpp:8428-8475`): the button
 * `d.pKeyXlate2`, then `d.pKeyXlate1`, binds `keyscan` to, or 0. With no `pKeyXlate2`,
 * no key is anything. CSBWin goes on past a match: every `pKeyXlate1` match is written
 * too, one queue slot further back each time, so a key bound twice would leave only the
 * last match queued, over the entry queued before it (`:8446-8475`). No keyscan is bound
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
 * caster keys, which the port takes from the tables (`CASTER_KEYS`, `DEBT.md` H).
 */
export function tableKeyButton(ui: UIState, key: string, ctrl = false): number {
  if (!ctrl && CASTER_KEYS.includes(key)) return 0;
  return translateKey(ui, keyScanOf(key, ctrl));
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
  // (`UIM_KEYDOWN`, `CSBUI.cpp:1120-1164`) that no pass takes before the credits. So the
  // key is claimed, and does nothing.
  if (ui.isRunningScript?.()) return isUIKey(k);

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

  if (k === RUNE_BACK_KEY) {
    magicButton(ui, 107);
    return true;
  }

  if (k === CAST_KEY) {
    magicButton(ui, 108);
    return true;
  }

  return false;
}

/** `d.PotentialCharacterOrdinal` — a champion only provisionally in the party. */
function championPending(ui: UIState): boolean {
  return (ui.partyState?.potentialChampionIndex ?? -1) >= 0;
}

/**
 * An attack key: with `chIdx`'s menu open, the attack of row `option`; otherwise that
 * champion's menu opens, replacing whatever was there. `prepareAttack` refuses a dead or
 * busy champion and a weapon with no attacks, and the menu already on screen is left
 * alone when it does.
 */
function attackKey(ui: UIState, chIdx: number, option: number): void {
  const party = ui.partyState;
  if (!party || championPending(ui)) return;
  if (chIdx >= party.champions.length) return;
  if (ui.attackingCharacterOrdinal === chIdx + 1) {
    performAttack(ui, option);
    return;
  }
  prepareAttack(ui, chIdx);
}

/**
 * The attack options, button ids 113-115. `word20248` is how many of the three rows are
 * real; the rest are dead, as they are for a click (`handleAttackAreaClick`).
 */
function performAttack(ui: UIState, option: number): void {
  if (option >= ui.word20248) return;
  takeAttackOption(ui, option);
}

/** Button ids 7-10 — the same toggle, and the same "replace" the click path gives. */
function toggleInventory(ui: UIState, chIdx: number): void {
  const party = ui.partyState;
  if (!party || championPending(ui)) return;
  if (chIdx >= party.champions.length) return;
  handleInventoryToggle(ui, chIdx);
}

/** Button id 100 — the rune keypad, live only once a caster is selected. */
function magicButton(ui: UIState, buttonId: number): void {
  if (championPending(ui)) return;
  if ((ui.partyState?.magicCasterIndex ?? -1) === -1) return;
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
  if (!party || championPending(ui)) return;
  const champion = party.champions[chIdx];
  if (!champion || !champion.alive) return;
  if (champion.attributes.maxMana === 0) return;
  selectMagicCaster(party, chIdx);
}
