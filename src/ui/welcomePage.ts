/**
 * The welcome page: the page without a known `?dungeon=` (`src/main.ts`), where the
 * player chooses a game. HTML, in the design kit's look (`welcomePage.css`), and nothing
 * of the game built: PLAY and CONTINUE are links that load the page again, with the
 * data set, and CONTINUE's save, in its query.
 *
 * - **The grid**: a tile for each set `chooserSets` lists, in the manifest's order. A set
 *   the store holds a save of is drawn bright, the others dimmed. A click selects a tile,
 *   and a click on the selected one leaves none selected.
 * - **PLAY** opens the selected set (`?dungeon=<id>`): its title, then its entrance. With
 *   no set selected it is disabled.
 * - **CONTINUE** opens the last save used (`lastUsedSave`) of the selected set, or of every
 *   set when none is selected (`?dungeon=<id>&save=<row id>`). With no such save it is
 *   disabled. The box beside it shows that save: its set, its party, its level, and when
 *   it was saved.
 *
 * A save of a set the manifest no longer names cannot be played, so it counts for
 * nothing here. A hidden set's saves count: the set plays by its `?dungeon=`. A store
 * that cannot be read (IndexedDB refused) is a store with no save.
 *
 * Every other parameter of the page's query is kept on the way to the game (`?dev`).
 */
import './welcomePage.css';
import { chooserSets, type DataSet, type DataSetManifest } from '../data/DataSets';
import { formatSaveDate, formatSaveTime, lastUsedSave, type SaveEntry, type SaveStore } from '../data/saves';

/** The page's static half: the logo, the places the grid and the buttons go, and the bottom. */
const PAGE = `
<main class="welcome-page">
  <h1 class="welcome-logo px px6">CSBweb</h1>
  <div class="welcome-grid" role="group" aria-label="Dungeons"></div>
  <div class="welcome-actions">
    <a class="btn px" id="welcome-play">Play</a>
    <a class="btn px" id="welcome-continue">Continue</a>
    <div class="welcome-preview px px2" aria-live="polite"></div>
  </div>
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
  <footer class="welcome-footer">
    <p>Dungeon Master and Chaos Strikes Back are FTL Games titles; their data files are read as they were released. The engine follows CSBWin by Paul R. Stevens. A non-commercial fan port. [RIGHTS NOTICE TO SETTLE BEFORE LAUNCH]</p>
    <nav class="px px2" aria-label="Footer">
      <a href="#about">About</a>
      <a aria-disabled="true">Source</a>
      <a aria-disabled="true">Credits</a>
    </nav>
  </footer>
</main>`;

/**
 * Show the welcome page in `body`, in place of whatever it held, for the sets of
 * `manifest` and the saves of `store`.
 */
export async function showWelcomePage(body: HTMLElement, manifest: DataSetManifest, store: Pick<SaveStore, 'list'>): Promise<void> {
    const known = new Set(manifest.dataSets.map((set) => set.id));
    const rows = (await store.list(null).catch(() => [] as SaveEntry[])).filter((row) => known.has(row.dataSet));

    body.classList.add('welcome');
    body.innerHTML = PAGE;
    const grid = body.querySelector<HTMLElement>('.welcome-grid')!;
    const play = body.querySelector<HTMLAnchorElement>('#welcome-play')!;
    const resume = body.querySelector<HTMLAnchorElement>('#welcome-continue')!;
    const preview = body.querySelector<HTMLElement>('.welcome-preview')!;

    let selected: DataSet | null = null;
    const tiles = chooserSets(manifest).map((set) => {
        const saves = rows.filter((row) => row.dataSet === set.id).length;
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = saves > 0 ? 'pick' : 'pick dim';
        tile.dataset.set = set.id;
        tile.append(
            line('pick-picture px px2', set.name),
            line('pick-name px px2', set.name),
            line('pick-saves px px2', saves === 0 ? 'No saved game' : saves === 1 ? '1 saved game' : `${saves} saved games`),
        );
        tile.addEventListener('click', () => {
            selected = selected === set ? null : set;
            update();
        });
        grid.append(tile);
        return { set, tile };
    });

    function update(): void {
        for (const { set, tile } of tiles) tile.setAttribute('aria-pressed', String(set === selected));
        const set = selected;
        link(play, set && pageQuery(set.id, null));
        const save = lastUsedSave(set ? rows.filter((row) => row.dataSet === set.id) : rows);
        link(resume, save && pageQuery(save.dataSet, save.id));
        preview.replaceChildren(...(save ? [
            line('preview-set', manifest.dataSets.find((set) => set.id === save.dataSet)!.name),
            line('preview-party', save.champions.map((name) => name.trim()).filter((name) => name !== '').join(' · ')),
            line('preview-when', `Level ${save.level} · ${formatSaveDate(save.savedAt)} ${formatSaveTime(save.savedAt)}`),
        ] : [
            line('preview-none', set ? 'No saved game of this dungeon' : 'No saved game yet'),
        ]));
    }
    update();
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

/** The page's own query, the game's set and, to continue, its save in it. */
function pageQuery(dataSet: string, save: string | null): string {
    const params = new URLSearchParams(window.location.search);
    params.set('dungeon', dataSet);
    if (save === null) params.delete('save');
    else params.set('save', save);
    return `?${params}`;
}
