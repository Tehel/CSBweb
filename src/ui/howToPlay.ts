/**
 * The welcome page's HOW TO PLAY (`src/ui/welcomePage.ts`): a dialog over the page that
 * holds what a player new to the game cannot guess. The keys come first, read from the
 * player's settings (`src/settings/Settings.ts`) and labelled as the settings' KEYS tab
 * labels them (`keyLabel`), with a chooser between the three presets' moves, since
 * CSBWin's K J L M are no one's first guess and its letters attack. Then the runes, which
 * the scrolls name in words and the magic panel shows only as glyphs, then the first
 * steps and the mouse.
 *
 * The runes are drawn in the page's font, `dm-screen.ttf`, where `tools/gen-font.ts`
 * puts graphics.dat's 24 rune glyphs at U+E060 to U+E077. Their names, and the names of
 * their four rows, are neither in CSBWin nor in the data: they are the Dungeon Master
 * manual's, page text as the page's credits are, not a game table read from a file.
 *
 * `#how-to-play` in the page's address opens it, so a link can lead straight to it.
 */
import type { Settings } from '../settings/Settings';
import { type KeyAction, type KeyBindings, type KeyPreset } from '../renderer/ui/Keyboard';
import { keyLabel, type KeyboardLayoutMap } from '../renderer/ui/KeyLabels';

/** What the dialog reads: the player's settings, and the keyboard's layout where the browser says. */
export interface HowToPlayHost {
    readonly settings: Settings;
    readonly keyboardLayout: () => KeyboardLayoutMap | null;
}

/** The address's fragment that opens the dialog. */
export const HOW_TO_PLAY_HASH = '#how-to-play';

/** The presets the chooser offers, each with what it moves the party with. */
const MOVE_PRESETS: ReadonlyArray<{ preset: Exclude<KeyPreset, 'custom'>; label: string }> = [
    { preset: 'csbwin', label: 'CSBWin keys' },
    { preset: 'keypad', label: 'Keypad' },
    { preset: 'arrows', label: 'Arrows' },
];

/** The six moves as the screen's arrows lay them out: turn, forward, turn; strafe, back, strafe. */
const MOVES: ReadonlyArray<{ action: KeyAction; label: string }> = [
    { action: 'move.turnLeft', label: 'Turn left' },
    { action: 'move.forward', label: 'Forward' },
    { action: 'move.turnRight', label: 'Turn right' },
    { action: 'move.strafeLeft', label: 'Step left' },
    { action: 'move.backward', label: 'Back' },
    { action: 'move.strafeRight', label: 'Step right' },
];

/** The keys outside the moves, the attacks and the runes, in the sheet's two short lists. */
const MAGIC_KEYS: ReadonlyArray<{ actions: KeyAction[]; label: string }> = [
    { actions: ['caster.0', 'caster.1', 'caster.2', 'caster.3'], label: 'Who casts' },
    { actions: ['runeBack'], label: 'Take a rune back' },
    { actions: ['cast'], label: 'Cast' },
];
const PARTY_KEYS: ReadonlyArray<{ actions: KeyAction[]; label: string }> = [
    { actions: ['inventory.0', 'inventory.1', 'inventory.2', 'inventory.3'], label: 'Inventories' },
    { actions: ['pass'], label: 'Pass, in an attack menu' },
    { actions: ['quickSave'], label: 'Quick save' },
    { actions: ['quickLoad'], label: 'Quick load' },
    { actions: ['freeze'], label: 'Freeze the game' },
];

/** The manual's runes: its four rows, each with the six names, in the order the panel shows them. */
const RUNE_ROWS: ReadonlyArray<{ row: string; names: readonly string[] }> = [
    { row: 'Power', names: ['LO', 'UM', 'ON', 'EE', 'PAL', 'MON'] },
    { row: 'Element', names: ['YA', 'VI', 'OH', 'FUL', 'DES', 'ZO'] },
    { row: 'Form', names: ['VEN', 'EW', 'KATH', 'IR', 'BRO', 'GOR'] },
    { row: 'Alignment', names: ['KU', 'ROS', 'DAIN', 'NETA', 'RA', 'SAR'] },
];

/** The font's code point of row `row`'s rune `n`: U+E000 plus the game's code, `96 + 6 * row + n`. */
function runeGlyph(row: number, n: number): string {
    return String.fromCodePoint(0xe000 + 96 + 6 * row + n);
}

const DIALOG = `
<form class="add-set-form how-form">
  <div class="add-set-head">
    <h2 class="px" id="how-title">How to play</h2>
    <button type="button" class="btn px" id="how-close">Close</button>
  </div>
  <fieldset class="how-chooser">
    <legend class="px px2">Move with</legend>
  </fieldset>
  <div class="how-sheet"></div>
</form>`;

/** The dialog opened over the page, the address's fragment `#how-to-play` while it is. */
export function openHowToPlay(host: HowToPlayHost): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'add-set how-to-play';
    dialog.setAttribute('aria-labelledby', 'how-title');
    dialog.innerHTML = DIALOG;
    const chooser = dialog.querySelector<HTMLElement>('.how-chooser')!;
    const sheet = dialog.querySelector<HTMLElement>('.how-sheet')!;

    const choices = MOVE_PRESETS.map(({ preset, label }) => {
        const choice = document.createElement('label');
        choice.className = 'how-choice px px2';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'how-preset';
        input.value = preset;
        input.addEventListener('change', () => {
            host.settings.update({ keyPreset: preset });
            render();
        });
        choice.append(input, label);
        chooser.append(choice);
        return input;
    });
    const custom = document.createElement('p');
    custom.className = 'how-custom';
    custom.textContent = 'Your own keys, as the settings\' KEYS tab has them: pick one of these to start again from it.';
    chooser.append(custom);

    function render(): void {
        const { keyPreset, keyBindings, keyLabels } = host.settings.values;
        const layout = host.keyboardLayout();
        for (const input of choices) input.checked = input.value === keyPreset;
        custom.hidden = keyPreset !== 'custom';
        sheet.replaceChildren(...helpSheet(keyBindings, (code) => keyLabel(code, keyLabels, layout)));
    }
    render();

    dialog.querySelector('#how-close')!.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        dialog.remove();
        if (window.location.hash === HOW_TO_PLAY_HASH) history.replaceState(null, '', window.location.pathname + window.location.search);
    });
    if (window.location.hash !== HOW_TO_PLAY_HASH) history.replaceState(null, '', HOW_TO_PLAY_HASH);
    document.body.append(dialog);
    dialog.showModal();
}

/** The sheet's sections for `bindings`, each key named by `label`. */
export function helpSheet(bindings: KeyBindings, label: (code: string) => string): HTMLElement[] {
    const keys = (action: KeyAction) => keyCaps(bindings[action].map(label).filter((name) => name !== ''));

    const move = section('how-move', 'Move');
    const pad = document.createElement('div');
    pad.className = 'how-pad';
    for (const { action, label: name } of MOVES) pad.append(cell('how-pad-cell', keys(action), text('how-what', name)));
    move.append(pad, para('Or click the six arrows at the bottom right of the screen.'));

    const fight = section('how-fight', 'Fight');
    const grid = document.createElement('div');
    grid.className = 'how-attacks';
    grid.append(text('how-corner', ''));
    for (let champion = 0; champion < 4; champion++) grid.append(text('how-head px px2', `${champion + 1}`));
    for (let row = 0; row < 3; row++) {
        grid.append(text('how-row', `Attack ${row + 1}`));
        for (let champion = 0; champion < 4; champion++) grid.append(keys(`attack.${champion}.${row}` as KeyAction));
    }
    fight.append(
        para('A column per champion, left to right as their names are at the top. A key opens that champion\'s attack menu; with it open, each key of their column performs its row\'s attack.'),
        grid,
        para('So these letters fight, and never walk.', 'how-warn'),
    );

    const magic = section('how-magic', 'Cast');
    magic.append(keyList(MAGIC_KEYS, keys));

    const party = section('how-party', 'Party and game');
    party.append(keyList(PARTY_KEYS, keys), para('Esc, or a double click on the messages under the view, opens the settings, where every key can be changed.'));

    const runes = section('how-runes', 'Runes');
    const table = document.createElement('div');
    table.className = 'how-rune-table';
    table.append(text('how-corner', ''));
    for (let n = 0; n < 6; n++) table.append(keys(`rune.${n}` as KeyAction));
    RUNE_ROWS.forEach(({ row, names }, r) => {
        table.append(text('how-row', `${r + 1}. ${row}`));
        names.forEach((name, n) => table.append(cell('how-rune', text('how-glyph px', runeGlyph(r, n)), text('how-rune-name px px2', name))));
    });
    runes.append(
        para('A spell is a rune from each row, in order: the panel at the top right shows the next row\'s six after each one. The keys above each column pick that rune of the row shown.'),
        table,
        list([
            'Scrolls leave out the power: start with one, LO the weakest, MON the strongest and the costliest in mana.',
            'Then the scroll\'s runes, then cast: "Invoke FUL for a magic torch" is LO FUL, then cast.',
        ]),
    );

    const start = section('how-start', 'First steps');
    start.append(list([
        'The game begins in the Hall of Champions. Walk up to a mirror and click it to meet the champion inside.',
        'RESURRECT takes them as they are. REINCARNATE gives them a new name, wipes every skill they had and adds twelve points to their attributes.',
        'Take up to four. Click a champion\'s name at the top of the screen to open their inventory.',
        'Drop food or water on the mouth in the inventory to eat or drink, as the food and water bars there run low.',
        'Keep a lit torch in a hand: the dungeon is dark.',
        'At the top of an inventory, the disk icon saves and ZZZ rests the party; a click wakes it. Save often.',
    ]));

    const mouse = section('how-mouse', 'Mouse and touch');
    mouse.append(list([
        'Every action is on the screen; a tap is a click. The arrows move, the hands above them fight, the runes above those cast.',
        'Click an object on the floor to take it: it becomes the pointer. Click the floor to drop it, the middle of the view to throw it.',
        'Click a wall\'s button or lever to use it, a keyhole with the key in hand.',
    ]));

    return [move, fight, magic, party, runes, start, mouse];
}

/** A section of the sheet: its class and title. */
function section(className: string, title: string): HTMLElement {
    const element = document.createElement('section');
    element.className = `how-section ${className}`;
    const heading = document.createElement('h3');
    heading.className = 'px';
    heading.textContent = title;
    element.append(heading);
    return element;
}

/** `names` as key caps, one each, or a dash for an action no key does. */
function keyCaps(names: string[]): HTMLElement {
    const caps = document.createElement('span');
    caps.className = 'how-keys';
    for (const name of names.length === 0 ? ['-'] : names) caps.append(text('how-key px px2', name));
    return caps;
}

/** Each entry of `entries`, its actions' keys then what they do. */
function keyList(entries: ReadonlyArray<{ actions: KeyAction[]; label: string }>, keys: (action: KeyAction) => HTMLElement): HTMLElement {
    const element = document.createElement('dl');
    element.className = 'how-list';
    for (const { actions, label } of entries) {
        const term = document.createElement('dt');
        term.append(...actions.map(keys));
        const what = document.createElement('dd');
        what.textContent = label;
        element.append(term, what);
    }
    return element;
}

function cell(className: string, ...children: HTMLElement[]): HTMLElement {
    const element = document.createElement('div');
    element.className = className;
    element.append(...children);
    return element;
}

function text(className: string, content: string): HTMLElement {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = content;
    return element;
}

function para(content: string, className = ''): HTMLElement {
    const element = document.createElement('p');
    if (className) element.className = className;
    element.textContent = content;
    return element;
}

function list(items: string[]): HTMLElement {
    const element = document.createElement('ul');
    for (const item of items) {
        const entry = document.createElement('li');
        entry.textContent = item;
        element.append(entry);
    }
    return element;
}
