/**
 * Keyboard bindings for the DM interface.
 *
 * CSBWin has no keyboard controls of its own: `ReadConfigFile`
 * (`doc/CSBwin-src/CSBUI.cpp:741`) reads `config.txt` into a `KEYXLATE` table
 * (`doc/CSBwin-src/CSBUI.cpp:514`), and an `MSCAN` line binds one scancode to a screen
 * point and a mouse button (`doc/CSBwin-src/CSBUI.cpp:783-796`). `UIM_KEYDOWN` then
 * turns the key into a click there — `OnMouseSwitchAction(2, x, y)` followed by
 * `OnMouseSwitchAction(0)` (`doc/CSBwin-src/CSBUI.cpp:1140-1158`), exactly the pair
 * `UIM_LEFT_BUTTON_DOWN` and `UIM_LEFT_BUTTON_UP` raise. So every CSBWin key binding is
 * a click on a panel, and the panel's own handler decides what it means.
 *
 * This table binds the same panel actions, but calls the handlers a click reaches rather
 * than synthesising coordinates: the coordinates in a `config.txt` are hardcoded, and
 * ours would have to be read back out of the runtime button lists to say the same thing.
 * The guards below are therefore lifted from `handleMouseButton`
 * (`src/renderer/ui/Mouse.ts`) so the two routes stay equivalent — in particular
 * `d.PotentialCharacterOrdinal` makes every panel inert
 * (`doc/CSBwin-src/Mouse.cpp:1578-1650`).
 *
 * ⚠️ One deliberate divergence, and it is the reason for the direct calls: an attack key
 * pressed while *another* champion's attack menu is open replaces that menu. A click
 * cannot do that — with a menu open the panel area is the option list, not the four
 * champion buttons (`handleAttackAreaClick`) — so there is no click to synthesise.
 */
import { selectMagicCaster } from '../../engine/Party';
import { closeAttackMenu, executeAttack, prepareAttack } from './Attack';
import { applyMagicSelection } from './MagicPanel';
import { handleInventoryToggle } from './Mouse';
import { UIState } from './UIState';

/** Open/close the attack menu of champion 0-3. */
const ATTACK_PANEL_KEYS = ['q', 'w', 'e', 'r'];
/** Perform the first, second or third of the offered attacks. */
const ATTACK_OPTION_KEYS = ['a', 's', 'd'];
/** Open/close the inventory of champion 0-3. */
const INVENTORY_KEYS = ['z', 'x', 'c', 'v'];
/** The six runes of the current incantation step — magic buttons 101-106. */
const RUNE_KEYS = ['1', '2', '3', '4', '5', '6'];
/** Select the champion who is casting. */
const CASTER_KEYS = ['F1', 'F2', 'F3', 'F4'];
/** Magic button 107, the rune the incantation just took back. */
const RUNE_BACK_KEY = '`';
/** Magic button 108. */
const CAST_KEY = 'Tab';

/** Whether `k`, lower-cased, is one of the panel bindings. */
function isUIKey(k: string): boolean {
  return [ATTACK_PANEL_KEYS, ATTACK_OPTION_KEYS, INVENTORY_KEYS, RUNE_KEYS, CASTER_KEYS]
    .some((keys) => keys.includes(k)) || k === RUNE_BACK_KEY || k === CAST_KEY;
}

/**
 * The keyscan CSBWin's key tables hold for a `KeyboardEvent.key`: Return and Esc, the two
 * keys `Byte18440` and `Byte18448` bind. The rest of `Byte18400` and `Byte18428`,
 * scancodes in the high byte, is `DEBT.md` C62.
 */
const KEYSCAN: Readonly<Record<string, number>> = { Enter: 0x0d, Escape: 0x1b };

/** `key`'s keyscan in CSBWin's key tables, or 0 for a key they cannot hold. */
export function keyScanOf(key: string): number {
  return KEYSCAN[key] ?? 0;
}

/**
 * The table half of `TAG0196da` (`doc/CSBwin-src/CSBCode.cpp:8428-8475`): the button
 * `d.pKeyXlate2`, then `d.pKeyXlate1`, binds `keyscan` to, or 0. With no `pKeyXlate2`,
 * no key is anything. CSBWin also queues every `pKeyXlate1` match after a `pKeyXlate2`
 * one, which none of the keys `keyScanOf` knows can reach.
 */
export function translateKey(ui: UIState, keyscan: number): number {
  if (!ui.keyXlate2 || keyscan === 0) return 0;
  for (const entry of ui.keyXlate2) if (entry.keyscan === keyscan) return entry.mouse;
  for (const entry of ui.keyXlate1 ?? []) if (entry.keyscan === keyscan) return entry.mouse;
  return 0;
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

  let index = ATTACK_PANEL_KEYS.indexOf(k);
  if (index >= 0) {
    toggleAttackMenu(ui, index);
    return true;
  }

  index = ATTACK_OPTION_KEYS.indexOf(k);
  if (index >= 0) {
    performAttack(ui, index);
    return true;
  }

  index = INVENTORY_KEYS.indexOf(k);
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
 * The attack keys. Pressing the key of the champion whose menu is open closes it
 * (`TAG01b1c0`); any other opens that champion's, replacing whatever was there.
 * `prepareAttack` refuses a dead champion and a weapon with no attacks, and the menu
 * already on screen is left alone when it does.
 */
function toggleAttackMenu(ui: UIState, chIdx: number): void {
  const party = ui.partyState;
  if (!party || championPending(ui)) return;
  if (chIdx >= party.champions.length) return;
  if (ui.attackingCharacterOrdinal === chIdx + 1) {
    closeAttackMenu(ui);
    return;
  }
  prepareAttack(ui, chIdx);
}

/**
 * The attack options, button ids 113-115. `word20248` is how many of the three rows are
 * real; the rest are dead, as they are for a click (`handleAttackAreaClick`).
 */
function performAttack(ui: UIState, option: number): void {
  if (championPending(ui)) return;
  if (ui.attackingCharacterOrdinal === 0) return;
  if (option >= ui.word20248) return;
  executeAttack(ui, option);
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
  applyMagicSelection(ui, buttonId);
}

/**
 * The caster tabs. A tab is only drawn for a living champion with mana to spend
 * (`drawSpellControls`), so only those can be picked — the keys reach exactly the tabs
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
