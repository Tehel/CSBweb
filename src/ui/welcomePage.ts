/**
 * The welcome page: the page without a known `?dungeon=` (`src/main.ts`), where the
 * player chooses a game. HTML, in the design kit's look (`welcomePage.css`), and nothing
 * of the game built: PLAY and CONTINUE are links that load the page again, with the
 * data set, and CONTINUE's save, in its query.
 *
 * - **The grid**: a tile for each set `chooserSets` lists and each of the player's own
 *   (`src/data/LocalDataSets.ts`), its picture the set's thumbnail, or a blank box where
 *   it has none. A manifest set's is in its folder (`thumbnailPath`), its title's last
 *   frame at half size; a local set's is its record's image. The sets the store holds a
 *   save of come first, drawn bright, the one saved last first; the others follow,
 *   dimmed, by name (`tileOrder`). A click selects a tile, and a click on the selected one
 *   leaves none selected. With no save at all, the manifest's default set is selected,
 *   where it names one, so that PLAY is a first visit's way in. A manifest with no set
 *   leaves the grid nothing but "+ Add my own", and PLAY disabled.
 * - **"+ Add my own"**, the grid's last tile, which is never selected. A click opens the
 *   form that adds a set (`src/ui/addDataSetForm.ts`); the set it adds is stored, and the
 *   page shows it, selected.
 * - **A tile's name says its set's state**: cyan for a local set, red for a pending one,
 *   which awaits a moderator (to its owner and the moderators, the only ones it is
 *   offered), purple for a hidden one (to a moderator, the only one it is listed for), and
 *   white otherwise. Red wins over purple.
 * - **A local set's tile** has **the pen** on its picture, at its top right corner, which
 *   opens the same form on its record, to edit or delete it. The page then shows the set
 *   edited, selected, or none, for a set deleted.
 * - **A published set's tile** has the moderation's controls there instead, each where the
 *   viewer may use it (`server/moderate.ts`): to a moderator, **the tick** and **the
 *   cross** on a pending set, which approve and reject it, and **the eye** on any other,
 *   open on a set shown and shut on a hidden one, which hides or shows it; to the owner of
 *   a pending set, the only player but the moderators it is offered to, the cross, which
 *   withdraws it. The cross asks first, since the site then deletes the set's files. The
 *   page is not told who owns a set, so a moderator is offered the cross on a site's own
 *   pending set too, which the server refuses; never on the default set. The page then
 *   asks for the sets anew and shows them, the selection kept but for a set gone. A
 *   refusal is said in the box beside CONTINUE.
 * - **PLAY** opens the selected set (`?dungeon=<id>`): its title, then its entrance. With
 *   no set selected it is disabled.
 * - **CONTINUE** opens the last save used (`lastUsedSave`) of the selected set, or of every
 *   set when none is selected (`?dungeon=<id>&save=<row id>`). With no such save it is
 *   disabled. The box beside it shows that save: its set, its party, its level, and when
 *   it was saved.
 *
 * The buttons and the box sit above the grid, which grows with the sets, so that they
 * stay on the first screen.
 *
 * A save of a set neither the manifest nor the player's own sets name cannot be played,
 * so it counts for nothing here. A hidden set's saves count: the set plays by its
 * `?dungeon=`. A store that cannot be read (IndexedDB refused) is a store with no save
 * and no set of the player's.
 *
 * Every other parameter of the page's query is kept on the way to the game (`?dev`), and
 * on the way back, by the settings dialog's EXIT (`welcomePageQuery`).
 *
 * The labels are HTML text in the game's font, and the prose in Spectral, both served
 * with the page (`welcomePage.css`).
 */
import './welcomePage.css';
import logoUrl from '../assets/csbweb-logo.jpg';
import {
    chooserSets, DATA_SETS_ROUTE, PLAYER_ID_HEADER, thumbnailPath,
    type DataSet, type DataSetManifest, type ModerationAction,
} from '../data/DataSets';
import { localDataSet, type LocalDataSetRecord } from '../data/LocalDataSets';
import { openAddDataSetForm } from './addDataSetForm';
import { playerId } from './gameEvents';
import {
    formatSaveDate, formatSaveTime, lastUsedSave,
    type BrowserDataSetStore, type SaveEntry, type SaveStore,
} from '../data/saves';

/** The page's static half: the logo, the places the grid and the buttons go, and the bottom. */
const PAGE = `
<main class="welcome-page">
  <h1 class="welcome-logo"><img src="${logoUrl}" alt="CSBweb" width="550" height="307"></h1>
  <div class="welcome-actions">
    <a class="btn px" id="welcome-play">Play</a>
    <a class="btn px" id="welcome-continue">Continue</a>
    <div class="welcome-preview px px2" aria-live="polite"></div>
  </div>
  <div class="welcome-grid" role="group" aria-label="Dungeons"></div>
  <section class="welcome-about" id="about">
    <p class="welcome-lead">The 1987 dungeon, rebuilt one function at a time from CSBWin. There is nothing to install: open the page and go down the stairs.</p>
    <div class="welcome-columns">
      <div>
        <h2 class="px">Faithful to the tick</h2>
        <p>A mechanical port of Paul R. Stevens' CSBWin, function by function. The timers, the monsters, the spells and the odd corners all match the Atari ST original.</p>
      </div>
      <div>
        <h2 class="px">Your saves, both ways</h2>
        <p>Genuine CSBWin save files load here, and the saves written here are CSBWin files. Drop your old CSBGAME.DAT on the page and carry on.</p>
      </div>
      <div>
        <h2 class="px">Any screen</h2>
        <p>A desktop, a laptop, a tablet or a phone. Keyboard and mouse, or just your fingers: every action in the game is already on screen.</p>
      </div>
      <div>
        <h2 class="px">Nothing redrawn</h2>
        <p>Every picture, sound and table is read from the original game files when you play. What you see is FTL's art, pixel for pixel.</p>
      </div>
    </div>
  </section>
  <section class="welcome-credits" id="credits">
    <h2 class="px px6">Credits</h2>
    <div class="welcome-columns">
      <div>
        <h2 class="px">FTL Games</h2>
        <p>Dungeon Master and Chaos Strikes Back, by FTL Games, Software Heaven, Inc.: Doug Bell (director), Dennis Walker (assistant director), Mike Newton (second unit director), Andy Jaros (graphics) and Wayne Holder (producer).</p>
      </div>
      <div>
        <h2 class="px">CSBWin</h2>
        <p><a href="http://www.dianneandpaul.net/CSBwin/">Paul R. Stevens</a>, for the crazy work of making CSBWin, the Atari ST game disassembled and rewritten in C++. Everything here is a port of it.</p>
      </div>
      <div>
        <h2 class="px">Swoosh Construction Kit</h2>
        <p>The people of the <a href="http://greatstone.free.fr/dm">Swoosh Construction Kit</a>, for the detailed reverse-engineering of every one of the data files' structures.</p>
      </div>
      <div>
        <h2 class="px">The community</h2>
        <p>The <a href="http://dmweb.free.fr">DMweb</a> community, for its love of the original game all these years, and the <a href="https://www.dungeon-master.com/">Dungeon Master forum</a>, where the fans still meet.</p>
      </div>
    </div>
  </section>
  <footer class="welcome-footer">
    <p>Dungeon Master © 1987 and Chaos Strikes Back © 1989 FTL Games, Software Heaven, Inc. Their names, pictures, sounds and data files belong to their rights holders, and are served here only to be played. The other dungeons belong to their authors. The engine is a port of CSBWin by Paul R. Stevens. CSBweb is a free, non-commercial fan project, not affiliated with or endorsed by any of them. Rights holders: write to csbweb[at]looten.net, and whatever you ask is taken down.</p>
    <nav class="px px2" aria-label="Footer">
      <a aria-disabled="true" href="#about">About</a>
      <a aria-disabled="true">Stats</a>
      <a aria-disabled="true">Source</a>
      <a href="#credits">Credits</a>
    </nav>
  </footer>
</main>`;

/** The confirmation the cross opens. */
const CONFIRM_REJECT = `
<form class="add-set-form">
  <h2 class="px" id="reject-set-title"></h2>
  <p class="delete-set-text"></p>
  <div class="add-set-buttons">
    <button type="button" class="btn px" id="reject-set-cancel">Cancel</button>
    <button type="button" class="btn px" id="reject-set-confirm"></button>
  </div>
</form>`;

/** Each action, done, as a refusal names it. */
const DONE: Record<ModerationAction, string> = { approve: 'approved', reject: 'rejected', hide: 'hidden', show: 'shown' };

/**
 * Show the welcome page in `body`, in place of whatever it held, for the sets of
 * `manifest` and of `localSets`, and the saves of `store`, the set `select` names selected,
 * where it names one. `loadManifest` asks the server for the manifest again, once a set is
 * published or moderated.
 */
export async function showWelcomePage(
    body: HTMLElement,
    manifest: DataSetManifest,
    store: Pick<SaveStore, 'list'>,
    localSets: Pick<BrowserDataSetStore, 'list' | 'put' | 'remove'>,
    loadManifest: () => Promise<DataSetManifest>,
    select: string | null = null,
): Promise<void> {
    const records = await localSets.list().catch(() => [] as LocalDataSetRecord[]);
    const local = records.map((record) => ({ set: localDataSet(record), record, thumbnail: record.files.thumbnail ?? null }));
    const allSets = [...manifest.dataSets, ...local.map(({ set }) => set)];
    const known = new Set(allSets.map((set) => set.id));
    const rows = (await store.list(null).catch(() => [] as SaveEntry[])).filter((row) => known.has(row.dataSet));

    body.classList.add('welcome');
    body.innerHTML = PAGE;
    const grid = body.querySelector<HTMLElement>('.welcome-grid')!;
    const play = body.querySelector<HTMLAnchorElement>('#welcome-play')!;
    const resume = body.querySelector<HTMLAnchorElement>('#welcome-continue')!;
    const preview = body.querySelector<HTMLElement>('.welcome-preview')!;

    const thumbnails = new Map<DataSet, string | Blob | null>([
        ...chooserSets(manifest).map((set) => [set, thumbnailPath(set)] as const),
        ...local.map(({ set, thumbnail }) => [set, thumbnail] as const),
    ]);
    const sets = tileOrder([...thumbnails.keys()], rows);
    let selected: DataSet | null = sets.find((set) => set.id === select)
        ?? (rows.length === 0 && manifest.defaultSet && sets.includes(manifest.defaultSet) ? manifest.defaultSet : null);
    const tiles = sets.map((set) => {
        const saves = rows.filter((row) => row.dataSet === set.id).length;
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = saves > 0 ? 'pick' : 'pick dim';
        tile.dataset.set = set.id;
        tile.append(
            picture(thumbnails.get(set) ?? null),
            line('pick-name px px2', set.name),
            line('pick-saves px px2', saves === 0 ? 'No saves' : saves === 1 ? '1 save' : `${saves} saves`),
        );
        tile.addEventListener('click', () => {
            selected = selected === set ? null : set;
            update();
        });
        const record = local.find((l) => l.set === set)?.record;
        if (record) tile.classList.add('local');
        if (set.pending) tile.classList.add('pending');
        if (set.hidden) tile.classList.add('hidden');
        const controls = record ? [control('pick-edit', `Edit ${record.name}`, PEN, () => openForm({ record, saves }))] : moderation(set);
        grid.append(controls.length > 0 ? withControls(tile, controls) : tile);
        return { set, tile };
    });
    grid.append(addTile(() => openForm(null)));

    /** The page shown again, `select` selected, for the manifest `shown`. */
    function again(select: string | null, shown = manifest): void {
        void showWelcomePage(body, shown, store, localSets, loadManifest, select);
    }

    /** The form that adds a set, or edits `edited`'s, with its `saves`; the page shown again after it. */
    function openForm(edited: { record: LocalDataSetRecord; saves: number } | null): void {
        openAddDataSetForm(
            manifest,
            new Set(records.map((record) => record.id).filter((id) => id !== edited?.record.id)),
            (record) => localSets.put(record),
            (record) => again(record.id),
            edited && {
                ...edited,
                remove: () => localSets.remove(edited.record.id),
                removed: () => again(null),
                // The page as it was, should the server not answer again.
                published: (id) => void loadManifest().then((asked) => again(id, asked), () => again(id)),
            },
        );
    }

    /** The controls of a published `set` the viewer may use: the tick and the cross, or the eye. */
    function moderation(set: DataSet): HTMLElement[] {
        const { moderator } = manifest;
        if (!set.pending) {
            return !moderator ? [] : set.hidden
                ? [control('pick-show', `Show ${set.name}`, EYE_SHUT, () => void moderate(set, 'show'))]
                : [control('pick-hide', `Hide ${set.name}`, EYE_OPEN, () => void moderate(set, 'hide'))];
        }
        const withdraw = !moderator;
        return [
            ...(moderator ? [control('pick-approve', `Approve ${set.name}`, TICK, () => void moderate(set, 'approve'))] : []),
            ...(set === manifest.defaultSet ? [] : [control('pick-reject', `${withdraw ? 'Withdraw' : 'Reject'} ${set.name}`, CROSS,
                () => confirmReject(set, withdraw, () => moderate(set, 'reject')))]),
        ];
    }

    /**
     * `action` asked of the server on `set` (`server/moderate.ts`), then the page shown
     * again as the server lists the sets, the selection kept but for a set rejected; or
     * the refusal said in the box beside CONTINUE.
     */
    async function moderate(set: DataSet, action: ModerationAction): Promise<void> {
        const error = await moderateDataSet(set.id, action);
        if (error !== null) {
            preview.replaceChildren(line('preview-failure', `${set.name} could not be ${DONE[action]}: ${error}`));
            return;
        }
        const keep = action === 'reject' && selected === set ? null : selected?.id ?? null;
        // The page as it was, should the server not answer again.
        loadManifest().then((asked) => again(keep, asked), () => again(keep));
    }

    function update(): void {
        for (const { set, tile } of tiles) tile.setAttribute('aria-pressed', String(set === selected));
        const set = selected;
        link(play, set && pageQuery(set.id, null));
        const save = lastUsedSave(set ? rows.filter((row) => row.dataSet === set.id) : rows);
        link(resume, save && pageQuery(save.dataSet, save.id));
        preview.replaceChildren(...(save ? [
            line('preview-set', allSets.find((set) => set.id === save.dataSet)!.name),
            line('preview-party', save.champions.map((name) => name.trim()).filter((name) => name !== '').join(' · ')),
            line('preview-when', `Level ${save.level} · ${formatSaveDate(save.savedAt)} ${formatSaveTime(save.savedAt)}`),
        ] : [
            line('preview-none', set ? 'No saved game of this dungeon' : 'No saved game yet'),
        ]));
    }
    update();
}

/**
 * `action` sent to `api/data-sets/<id>` about the set `id`, by the player whose `playerId`
 * this is: `null` once done, else why not, as the server says it.
 */
async function moderateDataSet(id: string, action: ModerationAction): Promise<string | null> {
    const response = await fetch(`${DATA_SETS_ROUTE}/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { [PLAYER_ID_HEADER]: playerId(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    }).catch(() => null);
    if (!response) return 'the server cannot be reached.';
    if (response.ok) return null;
    const answer = await response.json().catch(() => null) as { error?: unknown } | null;
    return typeof answer?.error === 'string' ? answer.error : `the server answered HTTP ${response.status}.`;
}

/**
 * The confirmation the cross opens: the set's name, that the site deletes its files, and
 * CANCEL and REJECT, or WITHDRAW for its owner, which closes it and calls `go`.
 */
function confirmReject(set: DataSet, withdraw: boolean, go: () => void): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'add-set delete-set reject-set';
    dialog.setAttribute('aria-labelledby', 'reject-set-title');
    dialog.innerHTML = CONFIRM_REJECT;
    const verb = withdraw ? 'Withdraw' : 'Reject';
    dialog.querySelector('#reject-set-title')!.textContent = `${verb} ${set.name}?`;
    dialog.querySelector('.delete-set-text')!.textContent = withdraw
        ? 'The site deletes the files you published. A set of yours kept in this browser stays.'
        : 'The site deletes its files. Its owner may publish it again.';
    const confirm = dialog.querySelector<HTMLButtonElement>('#reject-set-confirm')!;
    confirm.textContent = verb;
    dialog.querySelector('#reject-set-cancel')!.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
        dialog.close();
        go();
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
}

/** `tile` with `controls` along its picture's top edge, from its top right corner. */
function withControls(tile: HTMLElement, controls: HTMLElement[]): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'pick-cell';
    const row = document.createElement('div');
    row.className = 'pick-controls';
    row.append(...controls);
    cell.append(tile, row);
    return cell;
}

/** A tile's control, `className` naming what it does, `label` saying it, its picture `svg`. */
function control(className: string, label: string, svg: string, click: () => void): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pick-control ${className}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = svg;
    button.addEventListener('click', click);
    return button;
}

/** The pen's pixels, 11 by 11, in the page's palette (`welcomePage.css`). */
const PEN_PIXELS = [
    '.........ee',
    '........mee',
    '.......Bme.',
    '......Bbm..',
    '.....Bbd...',
    '....Bbd....',
    '...Bbd.....',
    '..Bbd......',
    '.wbd.......',
    'wwd........',
    'tw.........',
];
const PEN = pixelArt(PEN_PIXELS, { e: 'p10', m: 'p13', B: 'p11', b: 'p9', d: 'p5', w: 'p13', t: 'p1' });

/** The tick, which approves a pending set. */
const TICK = pixelArt([
    '...........',
    '.........gg',
    '........gg.',
    '.......gg..',
    '......gg...',
    'gg...gg....',
    '.gg.gg.....',
    '..ggg......',
    '...g.......',
    '...........',
    '...........',
], { g: 'p7' });

/** The cross, which rejects or withdraws a pending set. */
const CROSS = pixelArt([
    '...........',
    '.rr.....rr.',
    '..rr...rr..',
    '...rr.rr...',
    '....rrr....',
    '...rr.rr...',
    '..rr...rr..',
    '.rr.....rr.',
    '...........',
    '...........',
    '...........',
], { r: 'p8' });

/** The eye open, on a set shown, which hides it. */
const EYE_OPEN = pixelArt([
    '...........',
    '...........',
    '...wwwww...',
    '..w.....w..',
    '.w..ccc..w.',
    'w...cbc...w',
    '.w..ccc..w.',
    '..w.....w..',
    '...wwwww...',
    '...........',
    '...........',
], { w: 'p15', c: 'p4', b: 'p0' });

/** The eye shut, on a hidden set, which shows it. */
const EYE_SHUT = pixelArt([
    '...........',
    '...........',
    '...........',
    '...........',
    'w.........w',
    '.w.......w.',
    '..wwwwwww..',
    '.w..w.w..w.',
    '...w...w...',
    '...........',
    '...........',
], { w: 'purple' });

/** An SVG of `pixels`, 11 by 11, a path for each colour, `colours` naming the page's (`welcomePage.css`). */
function pixelArt(pixels: string[], colours: Record<string, string>): string {
    return `<svg viewBox="0 0 11 11" width="22" height="22" shape-rendering="crispEdges" aria-hidden="true">${
        Object.entries(colours).map(([key, colour]) => `<path fill="var(--${colour})" d="${
            pixels.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === key ? [`M${x} ${y}h1v1h-1z`] : [])).join('')
        }"/>`).join('')
    }</svg>`;
}

/**
 * `sets` in the grid's order: those `rows` holds a save of, the one with the latest save
 * first, then the others by name.
 */
function tileOrder(sets: DataSet[], rows: SaveEntry[]): DataSet[] {
    const lastSaved = new Map<string, number>();
    for (const row of rows) lastSaved.set(row.dataSet, Math.max(lastSaved.get(row.dataSet) ?? 0, row.savedAt));
    return [...sets].sort((a, b) => (lastSaved.get(b.id) ?? -1) - (lastSaved.get(a.id) ?? -1) || a.name.localeCompare(b.name));
}

/**
 * A set's picture: its thumbnail, a file's path or a local set's image, in a box that
 * stays blank for `null` or if it does not load.
 */
function picture(thumbnail: string | Blob | null): HTMLElement {
    const box = line('pick-picture', '');
    if (thumbnail === null) return box;
    const image = document.createElement('img');
    const src = typeof thumbnail === 'string' ? thumbnail : URL.createObjectURL(thumbnail);
    image.src = src;
    image.alt = '';
    image.width = 160;
    image.height = 100;
    image.addEventListener('error', () => image.remove());
    if (src !== thumbnail) {
        for (const done of ['load', 'error']) image.addEventListener(done, () => URL.revokeObjectURL(src), { once: true });
    }
    box.append(image);
    return box;
}

/** The grid's last tile, "+ Add my own", which calls `open`. */
function addTile(open: () => void): HTMLElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'pick add';
    tile.addEventListener('click', open);
    const box = line('pick-picture', '');
    box.append(line('pick-plus px px6', '+'));
    tile.append(box, line('pick-name px px2', 'Add my own'));
    return tile;
}

/** An element of one line of text. */
function line(className: string, text: string): HTMLElement {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
}

/** `anchor` leading to `query`, or disabled for `null`. */
function link(anchor: HTMLAnchorElement, query: string | null | undefined): void {
    if (query) {
        anchor.href = query;
        anchor.removeAttribute('aria-disabled');
    } else {
        anchor.removeAttribute('href');
        anchor.setAttribute('aria-disabled', 'true');
    }
}

/**
 * The page's own query without the game's set and save: the welcome page's, where the
 * settings dialog's EXIT leads (`UIState.onExit`). Every other parameter is kept.
 */
export function welcomePageQuery(): string {
    const params = new URLSearchParams(window.location.search);
    params.delete('dungeon');
    params.delete('save');
    const query = `${params}`;
    return query ? `?${query}` : window.location.pathname;
}

/** The page's own query, the game's set and, to continue, its save in it. */
function pageQuery(dataSet: string, save: string | null): string {
    const params = new URLSearchParams(window.location.search);
    params.set('dungeon', dataSet);
    if (save === null) params.delete('save');
    else params.set('save', save);
    return `?${params}`;
}
