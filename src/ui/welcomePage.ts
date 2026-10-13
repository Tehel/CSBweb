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
 *   leaves none selected. With no save at all, the manifest's default set is selected, so
 *   that PLAY is a first visit's way in.
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
import { chooserSets, thumbnailPath, type DataSet, type DataSetManifest } from '../data/DataSets';
import { localDataSet, type LocalDataSetRecord } from '../data/LocalDataSets';
import { openAddDataSetForm } from './addDataSetForm';
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

/**
 * Show the welcome page in `body`, in place of whatever it held, for the sets of
 * `manifest` and of `localSets`, and the saves of `store`, the set `select` names selected,
 * where it names one.
 */
export async function showWelcomePage(
    body: HTMLElement,
    manifest: DataSetManifest,
    store: Pick<SaveStore, 'list'>,
    localSets: Pick<BrowserDataSetStore, 'list' | 'put' | 'remove'>,
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
        ?? (rows.length === 0 && sets.includes(manifest.defaultSet) ? manifest.defaultSet : null);
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
        grid.append(record ? penned(tile, record, saves) : tile);
        return { set, tile };
    });
    grid.append(addTile(() => openForm(null)));

    /** The form that adds a set, or edits `edited`'s, with its `saves`; the page shown again after it. */
    function openForm(edited: { record: LocalDataSetRecord; saves: number } | null): void {
        const again = (select: string | null): void => void showWelcomePage(body, manifest, store, localSets, select);
        openAddDataSetForm(
            manifest,
            new Set(records.map((record) => record.id).filter((id) => id !== edited?.record.id)),
            (record) => localSets.put(record),
            (record) => again(record.id),
            edited && { ...edited, remove: () => localSets.remove(edited.record.id), removed: () => again(null) },
        );
    }

    /** A local set's `tile` with the pen on its picture, which opens the form on `record`. */
    function penned(tile: HTMLElement, record: LocalDataSetRecord, saves: number): HTMLElement {
        const cell = document.createElement('div');
        cell.className = 'pick-cell';
        const pen = document.createElement('button');
        pen.type = 'button';
        pen.className = 'pick-edit';
        pen.title = `Edit ${record.name}`;
        pen.setAttribute('aria-label', pen.title);
        pen.innerHTML = PEN;
        pen.addEventListener('click', () => openForm({ record, saves }));
        cell.append(tile, pen);
        return cell;
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
const PEN_COLOURS: Record<string, string> = { e: 'p10', m: 'p13', B: 'p11', b: 'p9', d: 'p5', w: 'p13', t: 'p1' };

/** The pen, an SVG of `PEN_PIXELS`, a path for each colour. */
const PEN = `<svg viewBox="0 0 11 11" width="22" height="22" shape-rendering="crispEdges" aria-hidden="true">${
    Object.entries(PEN_COLOURS).map(([key, colour]) => `<path fill="var(--${colour})" d="${
        PEN_PIXELS.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === key ? [`M${x} ${y}h1v1h-1z`] : [])).join('')
    }"/>`).join('')
}</svg>`;

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
