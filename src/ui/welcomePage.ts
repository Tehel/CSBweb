/**
 * The welcome page: the page without a known `?dungeon=` (`src/main.ts`), where the
 * player chooses a game. HTML, in the design kit's look (`welcomePage.css`), and nothing
 * of the game built: PLAY and CONTINUE are links that load the page again, with the
 * data set, and CONTINUE's save, in its query.
 *
 * - **The grids**: a tile for each set `chooserSets` lists and each of the player's own
 *   (`src/data/LocalDataSets.ts`), its picture the set's thumbnail, or a blank box where
 *   it has none. A manifest set's is in its folder (`thumbnailPath`), its title's last
 *   frame at half size; a local set's is its record's image. Two sections hold them, each
 *   under its title: first **the official games**, FTL's own (`DataSet.official`), in the
 *   manifest's order, then the player's own; then **the fan-made dungeons**, every other
 *   set, those the store holds a save of first, the one saved last first, the others
 *   following in the manifest's order, the server's `position` (`tileOrder`). A set the store holds a save of is drawn bright, any
 *   other dimmed. A section of no official game is not shown. A click selects a tile, and a click on the selected one
 *   leaves none selected. With no save at all, the manifest's default set is selected,
 *   where it names one, so that PLAY is a first visit's way in. A manifest with no set
 *   leaves the page nothing but "+ Add my own", and PLAY disabled.
 * - **"+ Add my own"**, the fan-made dungeons' last tile, which is never selected. A click opens the
 *   form that adds a set (`src/ui/addDataSetForm.ts`); the set it adds is stored, and the
 *   page shows it, selected.
 * - **A tile's name says its set's state**: cyan for a local set, red for a pending one,
 *   which awaits a moderator (to its owner and the moderators, the only ones it is
 *   offered), purple for a hidden one (to a moderator, the only one it is listed for), and
 *   white otherwise. Red wins over purple.
 * - **The triangle** is on every tile, first among the controls along its picture's top
 *   edge. It is a link that opens the set as PLAY does, without selecting it: its title,
 *   then its entrance, and never a save, which only CONTINUE opens.
 * - **A local set's tile** has **the pen** on its picture, at its top right corner, which
 *   opens the same form on its record, to edit or delete it. The page then shows the set
 *   edited, selected, or none, for a set deleted.
 * - **A published set's tile** has the moderation's controls there instead, each where the
 *   viewer may use it (`server/moderate.ts`): to a moderator, **the tick** and **the
 *   cross** on a pending set, which approve and reject it, and **the eye** on any other,
 *   open on a set shown and shut on a hidden one, which hides or shows it; to the owner of
 *   a pending set, the only player but the moderators it is offered to, the cross, which
 *   withdraws it. And to a moderator, **the pen** on every published set, first, which
 *   opens the form on the set as the site holds it, its files read from its folder, to
 *   edit its text and files (`openPublishedSetForm`); the preview box says the set is
 *   read meanwhile. The cross asks first, since the site then deletes the set's files. The
 *   page is not told who owns a set, so a moderator is offered the cross on a site's own
 *   pending set too, which the server refuses; never on the default set. The page then
 *   asks for the sets anew and shows them, the selection kept but for a set gone. A
 *   refusal is said in the box beside CONTINUE.
 * - **The book** is on every tile, after the triangle. It opens a dialog titled with the
 *   set's name, in two tabs, DOCUMENTS and RECORDINGS; a local set's has RECORDINGS alone.
 *   While recordings are paused (`recordingsOn`), the book has DOCUMENTS alone, with no
 *   tab, and a local set has no book.
 *   DOCUMENTS says the set's description, if it has one, then its authors, "By: " and
 *   their names separated by commas, if it has any, and offers the set's files as one zip, `<name>.zip`, made in the page from the files the server serves
 *   (`src/data/DataSetArchive.ts`), so that the set can be played in CSBWin; then its
 *   documents, the files its folder holds for its players (`DataSetDocument`), each a link
 *   that the browser opens in a new tab, a PDF, a text or a picture, or downloads, a word
 *   processor's file or an archive. To a
 *   moderator, each has a cross that removes it, once confirmed, and ADD offers to choose
 *   a file on the drive to add (`server/documents.ts`); the list then shows the set as the
 *   server lists it anew, and so does the page once the dialog is closed. A refusal is said
 *   in the dialog. RECORDINGS lists the site's recordings of a published set first, by
 *   title, the latest shared first, each marked where an extra was on and with its state to
 *   whom the server tells it: pending, hidden or broken, and "yours" to its uploader
 *   (`server/recordings.ts`); a moderator whose switch is off is listed them as a player
 *   is. Then this browser's points of the set, the latest made first: its saves whose
 *   recording the store holds up to them, by name, and its games' ends, won or lost, but
 *   for those another passes on its way, as a Sleepsave the game went on from
 *   (`src/engine/RecordingPoints.ts`). A click selects one, and the panel under the lists
 *   says where its path starts, when it began and ended, the time played, its build and
 *   whether an extra was on, a site's its author, its description and when it was shared
 *   too, with PLAY, a link that plays it (`?recording=`). On a site's, to a moderator,
 *   APPROVE on a pending one, HIDE or SHOW on any other, and DELETE, and to its uploader
 *   WITHDRAW, after which the list is the server's anew, a refusal said in the dialog. On
 *   a browser's, UPLOAD, which opens its form in the panel, a title, which it needs, an
 *   author and a description, and sends its package (`POST api/recordings`), after which
 *   the site's list is asked anew, the recording selected in it, pending; it is not offered
 *   for a local set, a pending one, nor a path that holds a move of `?dev`, and the panel
 *   says why. On a game's end DELETE, the only way one leaves the store but its set's own
 *   deletion. Each delete and withdrawal asks first. CLOSE closes the dialog, and so does
 *   a click beside it (`closeOnBackdrop`), as it closes HOW TO PLAY's and ABOUT's.
 * - **The moderator's switch**, at the page's top right corner, is offered to a moderator
 *   alone. Off, the page is the one a player sees (`playerView`): neither a hidden set nor
 *   a pending one, the moderator's own pending sets included since the page is not told
 *   who owns a set, and no control a player is not offered. The page is shown again, the
 *   selection kept but for a set no longer listed, and the switch kept in `localStorage`
 *   (`MODERATION_KEY`), on until it is turned off. The form a set's pen opens is the
 *   same either way.
 * - **PLAY** opens the selected set (`?dungeon=<id>`): its title, then its entrance. With
 *   no set selected it is disabled.
 * - **CONTINUE** opens the last save used (`lastUsedSave`) of the selected set, or of every
 *   set when none is selected (`?dungeon=<id>&save=<row id>`). With no such save it is
 *   disabled. The box beside it shows that save: its set, its party, its level, and when
 *   it was saved.
 *
 * The buttons and the box sit above the grids, which grow with the sets, so that they
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
import { archiveName, dataSetArchive, type ReadArchiveFile } from '../data/DataSetArchive';
import { folderFiles } from '../data/DataSetFiles';
import {
    chooserSets, DATA_SETS_ROUTE, DOCUMENT_EXTENSIONS, DOCUMENTS_SEGMENT, documentPath, isDocumentName, PLAYER_ID_HEADER, PNG_HEAD_BYTES, pngSize,
    RECORDING_PACKAGE_FIELD, RECORDINGS_ROUTE, SHARED_RECORDING_ID, thumbnailPath,
    type DataSet, type DataSetManifest, type ModerationAction, type RecordingAction,
} from '../data/DataSets';
import { localDataSet, type LocalDataSetFile, type LocalDataSetRecord } from '../data/LocalDataSets';
import { openAddDataSetForm, openPublishedSetForm, type EditedPublishedSet } from './addDataSetForm';
import { ABOUT_HASH, openAbout } from './about';
import { closeOnBackdrop } from './backdropClose';
import { HOW_TO_PLAY_HASH, openHowToPlay, type HowToPlayHost } from './howToPlay';
import { playerId } from './gameEvents';
import {
    formatPlayTime, formatSaveDate, formatSaveTime, lastUsedSave,
    type BrowserDataSetStore, type RecordingEntry, type RecordingStore, type SaveEntry, type SaveStore,
} from '../data/saves';
import { pointInfo, pointMadeAt, pointPath, pointRecordingId, shownPoints, storedPoints, type PointInfo, type StoredPoint } from '../engine/RecordingPoints';
import {
    packageOfEnd, packageOfSave, playedWithDevMoves, RECORDING_TEXT_LIMITS, writeRecordingPackage,
    type RecordingPackageStart, type RecordingPackageText,
} from '../engine/RecordingPackage';
import { recordingsOn } from './recordingsSwitch';
import type { Recording } from '../engine/Recorder';
import { pruneRecordings } from '../engine/RecordingWriter';

/** The page's static half: the logo, the places the grid and the buttons go, and the bottom. */
const PAGE = `
<main class="welcome-page">
  <h1 class="welcome-logo"><img src="${logoUrl}" alt="CSBweb" width="550" height="307"></h1>
  <div class="welcome-actions">
    <div class="welcome-actions-row">
      <a class="btn px" id="welcome-play">Play</a>
      <button type="button" class="btn px" id="welcome-help">How to play</button>
    </div>
    <div class="welcome-actions-row">
      <a class="btn px" id="welcome-continue">Continue</a>
      <div class="welcome-preview px px2" aria-live="polite"></div>
    </div>
  </div>
  <section class="welcome-sets welcome-official" aria-labelledby="welcome-official-title">
    <h2 class="px" id="welcome-official-title">Official games</h2>
    <p class="welcome-sets-lead">Dungeon Master and Chaos Strikes Back, as FTL Games released them.</p>
    <div class="welcome-grid" role="group" aria-labelledby="welcome-official-title"></div>
  </section>
  <section class="welcome-sets welcome-custom" aria-labelledby="welcome-custom-title">
    <h2 class="px" id="welcome-custom-title">Fan-made dungeons</h2>
    <p class="welcome-sets-lead">Custom dungeons built by the community, played on the same engine.</p>
    <div class="welcome-grid" role="group" aria-labelledby="welcome-custom-title"></div>
  </section>
  <section class="welcome-about">
    <p class="welcome-lead">The 1987 dungeon, rebuilt from CSBWin's source. There is nothing to install: open the page and go down the stairs.</p>
    <div class="welcome-columns">
      <div>
        <h2 class="px">Faithful to the tick</h2>
        <p>The rules are Paul R. Stevens' CSBWin, ported from its source and checked against it: the timers, the monsters, the spells and the odd corners all match the Atari ST original.</p>
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
    <p>Dungeon Master © 1987 and Chaos Strikes Back © 1989 FTL Games, Software Heaven, Inc. Their names, pictures, sounds and data files belong to their rights holders, and are served here only to be played. The other dungeons belong to their authors. The game's engine is ported from CSBWin by Paul R. Stevens. CSBweb is a free, non-commercial fan project, not affiliated with or endorsed by any of them. Rights holders: write to csbweb[at]looten.net, and whatever you ask is taken down.</p>
    <nav class="px px2" aria-label="Footer">
      <a href="#about">About</a>
      <a href="stats">Stats</a>
      <a href="https://github.com/Tehel/CSBweb" target="_blank">Source</a>
    </nav>
  </footer>
</main>`;

/** A confirmation, the cross's on a tile or on a document, its ids each `<prefix>-title`, `-cancel` and `-confirm`. */
const CONFIRMATION = (prefix: string) => `
<form class="add-set-form">
  <h2 class="px" id="${prefix}-title"></h2>
  <p class="delete-set-text"></p>
  <div class="add-set-buttons">
    <button type="button" class="btn px" id="${prefix}-cancel">Cancel</button>
    <button type="button" class="btn px" id="${prefix}-confirm"></button>
  </div>
</form>`;

/**
 * The dialog the book opens: the set's name, then its two tabs, DOCUMENTS, the set's
 * description, its authors and the documents, and RECORDINGS, the site's recordings of the
 * set, then the browser's points of it, and the panel of the one selected; then a
 * moderator's ADD, on DOCUMENTS alone, and CLOSE.
 */
const DOCUMENTS = `
<form class="add-set-form">
  <h2 class="px" id="documents-title"></h2>
  <div class="documents-tabs px px2" role="tablist">
    <button type="button" role="tab" class="documents-tab" id="documents-tab-documents" aria-controls="documents-pane">Documents</button>
    <button type="button" role="tab" class="documents-tab" id="documents-tab-recordings" aria-controls="recordings-pane">Recordings</button>
  </div>
  <div class="documents-pane" id="documents-pane" role="tabpanel" aria-labelledby="documents-tab-documents">
    <p class="documents-description"></p>
    <p class="documents-authors"></p>
    <ul class="documents-list"></ul>
  </div>
  <div class="documents-pane" id="recordings-pane" role="tabpanel" aria-labelledby="documents-tab-recordings">
    <h3 class="px px2 recordings-heading recordings-site-heading">On the site</h3>
    <ul class="recordings-list recordings-site" role="listbox" aria-label="Recordings on the site"></ul>
    <h3 class="px px2 recordings-heading">On this browser</h3>
    <ul class="recordings-list recordings-browser" role="listbox" aria-label="Recordings on this browser"></ul>
    <div class="recordings-panel" aria-live="polite"></div>
  </div>
  <p class="documents-status" aria-live="polite"></p>
  <div class="add-set-buttons">
    <button type="button" class="btn px" id="documents-close">Close</button>
    <button type="button" class="btn px" id="documents-add">Add</button>
  </div>
  <input type="file" id="documents-file" hidden>
</form>`;

/**
 * The UPLOAD form in the RECORDINGS tab's panel: a recording's title, author and
 * description (`RecordingPackageText`), as long as a set's may be, and who reads them first.
 */
const UPLOAD = `
<label class="add-set-field"><span class="px px2">Title</span>
  <input name="title" maxlength="${RECORDING_TEXT_LIMITS.title}" autocomplete="off"></label>
<label class="add-set-field"><span class="px px2">Author</span>
  <input name="author" maxlength="${RECORDING_TEXT_LIMITS.author}" placeholder="Your name, or none" autocomplete="off"></label>
<label class="add-set-field"><span class="px px2">Description</span>
  <textarea name="description" rows="3" maxlength="${RECORDING_TEXT_LIMITS.description}"></textarea></label>
<p class="recordings-why">A moderator reads them before the site lists it to anyone but you.</p>`;

/**
 * The extensions of the documents a browser shows, which a link opens in a new tab; any
 * other is downloaded (`DOCUMENT_EXTENSIONS`).
 */
const SHOWN_DOCUMENTS = ['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png', '.gif', '.webp'];

/** Where the moderator's switch is kept: `'off'` once turned off, else on. */
const MODERATION_KEY = 'csbweb_moderation_v1';

/** Each action, done, as a refusal names it. */
const DONE: Record<ModerationAction, string> = { approve: 'approved', reject: 'rejected', hide: 'hidden', show: 'shown' };

/**
 * Show the welcome page in `body`, in place of whatever it held, for the sets of
 * `manifest` and of `localSets`, and the saves of `store`, the set `select` names selected,
 * where it names one. `loadManifest` asks the server for the manifest again, once a set is
 * published or moderated. HOW TO PLAY opens its dialog on `help` (`src/ui/howToPlay.ts`),
 * as the page does where its address ends in `#how-to-play`, and the footer's ABOUT its own
 * (`src/ui/about.ts`) where it ends in `#about`.
 */
export async function showWelcomePage(
    body: HTMLElement,
    manifest: DataSetManifest,
    store: Pick<SaveStore, 'list' | 'read'>,
    localSets: Pick<BrowserDataSetStore, 'list' | 'put' | 'remove'>,
    recordings: RecordingStore,
    loadManifest: () => Promise<DataSetManifest>,
    help: HowToPlayHost,
    select: string | null = null,
): Promise<void> {
    const records = await localSets.list().catch(() => [] as LocalDataSetRecord[]);
    const local = records.map((record) => ({ set: localDataSet(record), record, thumbnail: record.files.thumbnail ?? null }));
    const moderating = manifest.moderator && moderationOn();
    // The manifest the page shows: a player's, but where a moderator moderates.
    const viewed = manifest.moderator && !moderating ? playerView(manifest) : manifest;
    const allSets = [...viewed.dataSets, ...local.map(({ set }) => set)];
    const known = new Set(allSets.map((set) => set.id));
    const rows = (await store.list(null).catch(() => [] as SaveEntry[])).filter((row) => known.has(row.dataSet));

    body.classList.add('welcome');
    body.innerHTML = PAGE;
    const officialSection = body.querySelector<HTMLElement>('.welcome-official')!;
    const officialGrid = officialSection.querySelector<HTMLElement>('.welcome-grid')!;
    const customGrid = body.querySelector<HTMLElement>('.welcome-custom .welcome-grid')!;
    const play = body.querySelector<HTMLAnchorElement>('#welcome-play')!;
    const resume = body.querySelector<HTMLAnchorElement>('#welcome-continue')!;
    const preview = body.querySelector<HTMLElement>('.welcome-preview')!;
    body.querySelector('#welcome-help')!.addEventListener('click', () => openHowToPlay(help));

    const thumbnails = new Map<DataSet, string | Blob | null>([
        ...chooserSets(viewed).map((set) => [set, thumbnailPath(set)] as const),
        ...local.map(({ set, thumbnail }) => [set, thumbnail] as const),
    ]);
    const listed = [...thumbnails.keys()];
    const official = listed.filter((set) => set.official);
    const sets = [...official, ...tileOrder(listed.filter((set) => !set.official), rows)];
    officialSection.hidden = official.length === 0;
    let selected: DataSet | null = sets.find((set) => set.id === select)
        ?? (rows.length === 0 && viewed.defaultSet && sets.includes(viewed.defaultSet) ? viewed.defaultSet : null);
    const tiles = sets.map((set) => {
        const saves = rows.filter((row) => row.dataSet === set.id).length;
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = saves > 0 ? 'pick' : 'pick dim';
        tile.dataset.set = set.id;
        tile.append(picture(thumbnails.get(set) ?? null), line('pick-name px px2', set.name));
        if (saves > 0) tile.append(line('pick-saves px px2', saves === 1 ? '1 save' : `${saves} saves`));
        tile.addEventListener('click', () => {
            selected = selected === set ? null : set;
            update();
        });
        const record = local.find((l) => l.set === set)?.record;
        if (record) tile.classList.add('local');
        if (set.pending) tile.classList.add('pending');
        if (set.hidden) tile.classList.add('hidden');
        const controls = record ? [...recordingsOn() ? [control('pick-documents', `Recordings of ${set.name}`, BOOK, () => openDocuments(set))] : [],
            control('pick-edit', `Edit ${record.name}`, PEN, () => openForm({ record, saves }))]
            : [control('pick-documents', `Documents of ${set.name}`, BOOK, () => openDocuments(set)), ...moderation(set)];
        (set.official ? officialGrid : customGrid).append(withControls(tile, [playControl(set), ...controls]));
        return { set, tile };
    });
    customGrid.append(addTile(() => openForm(null)));
    if (manifest.moderator) {
        body.querySelector('.welcome-page')!.prepend(moderationSwitch(moderating, () => {
            keepModeration(!moderating);
            again(selected?.id ?? null);
        }));
    }

    /** The page shown again, `select` selected, for the manifest `shown`. */
    function again(select: string | null, shown = manifest): void {
        void showWelcomePage(body, shown, store, localSets, recordings, loadManifest, help, select);
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

    /**
     * The dialog the book opens on `set`'s documents and recordings, a local set's
     * recordings alone; the page shown again as the server lists the sets once it is
     * closed, where a document was added or removed, the selection kept.
     */
    function openDocuments(set: DataSet): void {
        const keep = selected?.id ?? null;
        const isLocal = local.some((l) => l.set === set);
        showDocuments(set, isLocal, viewed.moderator, loadManifest, { saves: store, recordings }, (asked) => {
            if (asked) again(keep, asked);
        });
    }

    /** The controls of a published `set` the viewer may use: the pen, and the tick and the cross, or the eye. */
    function moderation(set: DataSet): HTMLElement[] {
        const { moderator } = viewed;
        const pen = moderator ? [control('pick-edit', `Edit ${set.name}`, PEN, () => void editPublished(set))] : [];
        if (!set.pending) {
            return !moderator ? [] : set.hidden
                ? [...pen, control('pick-show', `Show ${set.name}`, EYE_SHUT, () => void moderate(set, 'show'))]
                : [...pen, control('pick-hide', `Hide ${set.name}`, EYE_OPEN, () => void moderate(set, 'hide'))];
        }
        const withdraw = !moderator;
        return [
            ...pen,
            ...(moderator ? [control('pick-approve', `Approve ${set.name}`, TICK, () => void moderate(set, 'approve'))] : []),
            ...(set === manifest.defaultSet ? [] : [control('pick-reject', `${withdraw ? 'Withdraw' : 'Reject'} ${set.name}`, CROSS,
                () => confirmReject(set, withdraw, () => moderate(set, 'reject')))]),
        ];
    }

    /**
     * The form opened on the published `set` as the site holds it, once its files are read,
     * the box beside CONTINUE saying so meanwhile, or why they were not; the page shown
     * again as the server lists the sets once it is edited, the selection kept.
     */
    async function editPublished(set: DataSet): Promise<void> {
        preview.replaceChildren(line('preview-none', `Reading ${set.name}…`));
        let record: EditedPublishedSet['record'];
        try {
            record = await publishedRecord(set);
        } catch (error) {
            preview.replaceChildren(line('preview-failure', `${set.name} could not be read: ${error instanceof Error ? error.message : String(error)}`));
            return;
        }
        update();
        const keep = selected?.id ?? null;
        openPublishedSetForm(manifest, {
            record,
            // The page as it was, should the server not answer again.
            edited: () => void loadManifest().then((asked) => again(keep, asked), () => again(keep)),
        });
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
            line('preview-none', set ? 'No saved game here yet' : 'No saved game yet'),
        ]));
    }
    update();
    // The address at `#how-to-play` opens HOW TO PLAY, and at `#about` ABOUT, as the page is
    // shown and as the fragment changes on it. One handler, the last page's: the page is
    // shown anew often.
    const dialogAsked = () => {
        const { hash } = window.location;
        if (hash === HOW_TO_PLAY_HASH && !document.querySelector('dialog.how-to-play')) openHowToPlay(help);
        if (hash === ABOUT_HASH && !document.querySelector('dialog.about')) openAbout();
    };
    window.onhashchange = dialogAsked;
    dialogAsked();
}

/** Whether the moderator's switch is on: on but where it was turned off, or `localStorage` cannot be read. */
function moderationOn(): boolean {
    try {
        return localStorage.getItem(MODERATION_KEY) !== 'off';
    } catch {
        return true;
    }
}

/** The moderator's switch kept `on` or off, where `localStorage` keeps it. */
function keepModeration(on: boolean): void {
    try {
        if (on) localStorage.removeItem(MODERATION_KEY);
        else localStorage.setItem(MODERATION_KEY, 'off');
    } catch {
        // The switch then holds for this page alone.
    }
}

/**
 * The moderator's `manifest` as a player is answered it (`server/dataSets.ts`): without the
 * pending sets, which the page cannot tell the moderator's own from, and not a moderator's,
 * so without the hidden sets either (`chooserSets`).
 */
function playerView(manifest: DataSetManifest): DataSetManifest {
    return { ...manifest, dataSets: manifest.dataSets.filter((set) => !set.pending), moderator: false };
}

/** The moderator's switch, `on` or off, which calls `toggle` once clicked. */
function moderationSwitch(on: boolean, toggle: () => void): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'welcome-moderation px px2';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(on));
    button.textContent = on ? 'Moderator on' : 'Moderator off';
    button.addEventListener('click', toggle);
    return button;
}

/**
 * `action` sent to `api/data-sets/<id>` about the set `id`, by the player whose `playerId`
 * this is: `null` once done, else why not, as the server says it.
 */
function moderateDataSet(id: string, action: ModerationAction): Promise<string | null> {
    return postAsPlayer(`${DATA_SETS_ROUTE}/${encodeURIComponent(id)}`, { 'Content-Type': 'application/json' }, JSON.stringify({ action }));
}

/**
 * `body` posted to `route`, a set's (`server/moderate.ts`, `server/documents.ts`) or a
 * shared recording's (`server/recordings.ts`), by the player whose `playerId` this is, with
 * `headers`: `null` once done, else why not, as the server says it.
 */
async function postAsPlayer(route: string, headers: Record<string, string>, body: string | FormData): Promise<string | null> {
    const answer = await answerAsPlayer(route, headers, body);
    return typeof answer === 'string' ? answer : null;
}

/**
 * `body` posted to `route` as `postAsPlayer` posts it: the server's JSON answer once done,
 * `null` where it is none, else why not, as the server says it.
 */
async function answerAsPlayer(route: string, headers: Record<string, string>, body: string | FormData): Promise<{ readonly json: unknown } | string> {
    const response = await fetch(route, { method: 'POST', headers: { [PLAYER_ID_HEADER]: playerId(), ...headers }, body }).catch(() => null);
    if (!response) return 'the server cannot be reached.';
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) return { json };
    const error = (json as { error?: unknown } | null)?.error;
    return typeof error === 'string' ? error : `the server answered HTTP ${response.status}.`;
}

/**
 * The published `set` as the form edits it: its text, and the files of its folder the form
 * knows, `dungeon.dat` and `graphics.dat`, the `CSBgraphics.dat` and the Hint Oracle its
 * flags say it has, and its thumbnail where it is served as a PNG. Throws where one of its
 * files cannot be read, but the thumbnail.
 */
async function publishedRecord(set: DataSet): Promise<EditedPublishedSet['record']> {
    const folder = folderFiles(set.dir);
    const names: Exclude<LocalDataSetFile, 'thumbnail'>[] = ['dungeon.dat', 'graphics.dat',
        ...(set.csbGraphics ? ['CSBgraphics.dat' as const] : []), ...(set.hintOracle ? ['hcsb.hct' as const, 'hcsb.dat' as const] : [])];
    const files: Partial<Record<LocalDataSetFile, File>> = {};
    await Promise.all(names.map(async (name) => {
        const bytes = await folder.read(name);
        if (!bytes) throw new Error(`${folder.where(name)} cannot be read.`);
        files[name] = new File([bytes as Uint8Array<ArrayBuffer>], name);
    }));
    const thumbnail = await fetch(thumbnailPath(set)).then((response) => (response.ok ? response.blob() : null), () => null);
    if (thumbnail && pngSize(new Uint8Array(await thumbnail.slice(0, PNG_HEAD_BYTES).arrayBuffer()))) {
        files.thumbnail = new File([thumbnail], 'thumbnail.png', { type: 'image/png' });
    }
    return {
        id: set.id, name: set.name, description: set.description, authors: [...set.authors], dmRules: set.dmRules,
        thumbnailAsTitle: set.thumbnailAsTitle, official: set.official, baseSet: null, files,
    };
}

/**
 * The confirmation the cross opens: the set's name, that the site deletes its files, and
 * CANCEL and REJECT, or WITHDRAW for its owner, which closes it and calls `go`.
 */
function confirmReject(set: DataSet, withdraw: boolean, go: () => void): void {
    const verb = withdraw ? 'Withdraw' : 'Reject';
    confirmation('reject-set', `${verb} ${set.name}?`, withdraw
        ? 'The site deletes the files you published. A set of yours kept in this browser stays.'
        : 'The site deletes its files. Its owner may publish it again.', verb, go);
}

/**
 * A confirmation, its ids prefixed with `prefix` and its dialog of that class: `title`,
 * `text`, and CANCEL and `verb`, which closes it and calls `go`.
 */
function confirmation(prefix: string, title: string, text: string, verb: string, go: () => void): void {
    const dialog = document.createElement('dialog');
    dialog.className = `add-set delete-set ${prefix}`;
    dialog.setAttribute('aria-labelledby', `${prefix}-title`);
    dialog.innerHTML = CONFIRMATION(prefix);
    dialog.querySelector(`#${prefix}-title`)!.textContent = title;
    dialog.querySelector('.delete-set-text')!.textContent = text;
    const confirm = dialog.querySelector<HTMLButtonElement>(`#${prefix}-confirm`)!;
    confirm.textContent = verb;
    dialog.querySelector(`#${prefix}-cancel`)!.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
        dialog.close();
        go();
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
}

/** The stores the RECORDINGS tab reads: the saves and the recordings. */
interface RecordingsSource {
    readonly saves: Pick<SaveStore, 'list' | 'read'>;
    readonly recordings: RecordingStore;
}

/**
 * The dialog the book opens on `set`, titled with its name, in two tabs. DOCUMENTS, the
 * first shown: its archive, `<name>.zip`, which is made and downloaded once clicked, then
 * its documents, each a link, with its size; to a `moderator`, a cross on each, which
 * removes it once confirmed, and ADD, which sends the file chosen on the drive. After a
 * change, the list is the set as `loadManifest` gives it anew, its folder a new one.
 * RECORDINGS: the site's recordings of the set (`siteRecordings`), the latest shared
 * first, then the browser's points of it (`storedPoints`) but those another passes
 * (`shownPoints`), the latest made first; a click
 * selects one, and the panel under the lists shows its metadata (`pointInfo`) and PLAY,
 * which plays it (`?recording=`, `pointRecordingId`). On a site's, to a `moderator`,
 * APPROVE, HIDE or SHOW, and DELETE, and to its uploader WITHDRAW (`POST
 * RECORDINGS_ROUTE/<id>`), after which the site's list is asked anew. On a browser's,
 * UPLOAD, its form in the panel, which sends its package (`uploadPoint`), but where the
 * site does not publish the set or the path holds a move of `?dev`. On a game's end
 * DELETE, which deletes it, then what no other point reaches of the recordings before it
 * (`pruneRecordings`). Each delete asks first. A local set, `isLocal`, has RECORDINGS
 * alone, and no site's list. `closed`
 * is called once it is closed, with the last manifest asked for, or `null` where nothing
 * changed.
 */
function showDocuments(
    shown: DataSet, isLocal: boolean, moderator: boolean, loadManifest: () => Promise<DataSetManifest>,
    source: RecordingsSource, closed: (asked: DataSetManifest | null) => void,
): void {
    let set = shown;
    let asked: DataSetManifest | null = null;
    const dialog = document.createElement('dialog');
    dialog.className = 'add-set delete-set documents';
    dialog.setAttribute('aria-labelledby', 'documents-title');
    dialog.innerHTML = DOCUMENTS;
    dialog.querySelector('#documents-title')!.textContent = set.name;
    const list = dialog.querySelector<HTMLElement>('.documents-list')!;
    const status = dialog.querySelector<HTMLElement>('.documents-status')!;
    const add = dialog.querySelector<HTMLButtonElement>('#documents-add')!;
    const input = dialog.querySelector<HTMLInputElement>('#documents-file')!;
    const route = `${DATA_SETS_ROUTE}/${encodeURIComponent(set.id)}/${DOCUMENTS_SEGMENT}`;

    const description = dialog.querySelector<HTMLElement>('.documents-description')!;
    const authors = dialog.querySelector<HTMLElement>('.documents-authors')!;
    const render = () => {
        description.textContent = set.description;
        authors.textContent = set.authors.length > 0 ? `By: ${set.authors.join(', ')}` : '';
        const archive = document.createElement('li');
        archive.className = 'documents-archive';
        const name = `${archiveName(set)}.zip`;
        const pack = document.createElement('button');
        pack.type = 'button';
        pack.className = 'documents-pack';
        pack.textContent = name;
        pack.addEventListener('click', () => void (async () => {
            status.textContent = `Packing ${name}…`;
            pack.disabled = true;
            try {
                downloadFile(name, await dataSetArchive(set, servedFile(set)));
                status.textContent = '';
            } catch (error) {
                status.textContent = `${name} could not be made: ${error instanceof Error ? error.message : String(error)}`;
            }
            pack.disabled = false;
        })());
        archive.append(pack, line('documents-size', 'every file'));
        list.replaceChildren(archive, ...set.documents.map(({ file, size }) => {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = documentPath(set, file);
            link.textContent = file;
            if (SHOWN_DOCUMENTS.includes(file.slice(file.lastIndexOf('.')).toLowerCase())) {
                link.target = '_blank';
                link.rel = 'noopener';
            } else {
                link.download = file;
            }
            item.append(link, line('documents-size', formatSize(size)));
            if (moderator) item.append(control('documents-remove', `Remove ${file}`, CROSS, () => confirmation('remove-document', `Remove ${file}?`,
                'The site deletes the file. The night\'s backup keeps a copy.', 'Remove', () => void change(`Removing ${file}…`,
                    () => postAsPlayer(route, { 'Content-Type': 'application/json' }, JSON.stringify({ remove: file }))))));
            return item;
        }));
        if (set.documents.length === 0 && moderator) {
            const none = document.createElement('li');
            none.className = 'documents-none';
            none.textContent = 'No document yet.';
            list.append(none);
        }
    };

    /** `send` done, `doing` said meanwhile, then the list as the server gives it anew; or the refusal said. */
    const change = async (doing: string, send: () => Promise<string | null>) => {
        status.textContent = doing;
        for (const button of dialog.querySelectorAll<HTMLButtonElement>('.documents-remove, #documents-add')) button.disabled = true;
        const error = await send();
        if (error === null) {
            try {
                asked = await loadManifest();
                set = asked.dataSets.find((one) => one.id === set.id) ?? set;
                status.textContent = '';
            } catch {
                status.textContent = 'Done, but the site does not list the sets anew.';
            }
        } else {
            status.textContent = `${doing.slice(0, -1)} failed: ${error}`;
        }
        render();
        add.disabled = false;
    };

    if (!moderator) add.remove();
    add.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (!isDocumentName(file.name)) {
            status.textContent = `${file.name} cannot be a document: a document's name ends in ${DOCUMENT_EXTENSIONS.join(', ')}, and starts with no '.'.`;
            return;
        }
        const form = new FormData();
        form.append('file', file);
        void change(`Sending ${file.name}…`, () => postAsPlayer(route, {}, form));
    });
    dialog.querySelector('#documents-close')!.addEventListener('click', () => dialog.close());
    closeOnBackdrop(dialog);
    dialog.addEventListener('close', () => {
        dialog.remove();
        closed(asked);
    });

    const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('.documents-tab')];
    const panes = [...dialog.querySelectorAll<HTMLElement>('.documents-pane')];
    const showTab = (shownTab: number) => {
        tabs.forEach((tab, n) => tab.setAttribute('aria-selected', String(n === shownTab)));
        panes.forEach((pane, n) => { pane.hidden = n !== shownTab; });
        add.hidden = shownTab !== 0;
        status.textContent = '';
    };
    tabs.forEach((tab, n) => tab.addEventListener('click', () => showTab(n)));
    if (!recordingsOn()) {
        dialog.querySelector('.documents-tabs')!.remove();
        panes[1]!.remove();
        render();
    } else if (isLocal) {
        showRecordings(dialog, set, false, moderator, source, status);
        dialog.querySelector('.documents-tabs')!.remove();
        panes[0]!.remove();
        add.remove();
        panes[1]!.hidden = false;
    } else {
        showRecordings(dialog, set, true, moderator, source, status);
        render();
        showTab(0);
    }
    document.body.append(dialog);
    dialog.showModal();
}

/**
 * The RECORDINGS tab of `dialog`, on `set`: where it is `published`, the site's recordings
 * of the set, as the server lists them to this player, or as it lists them to a player
 * where the viewer is no `moderator`; then the browser's points of the set, from `source`;
 * and the panel of the one selected, a single selection over the two lists, whose ids
 * differ in form (`SHARED_RECORDING_ID`). What goes wrong is said in `status`.
 */
function showRecordings(dialog: HTMLElement, set: DataSet, published: boolean, moderator: boolean, source: RecordingsSource, status: HTMLElement): void {
    const siteList = dialog.querySelector<HTMLElement>('.recordings-site')!;
    const list = dialog.querySelector<HTMLElement>('.recordings-browser')!;
    const panel = dialog.querySelector<HTMLElement>('.recordings-panel')!;
    let rows: RecordingEntry[] = [];
    let points: StoredPoint[] = [];
    // The site's, `null` until it answers first.
    let shared: SiteRecording[] | null = null;
    let selected: string | null = null;
    // The browser's point whose UPLOAD form the panel holds, which a list asked anew keeps.
    let uploadFor: string | null = null;
    // Why the browser's points cannot be uploaded, where the site does not publish the set.
    const unpublished = !published ? 'Not to upload: the site shares the recordings of the dungeons it publishes, and this one is this browser\'s own.'
        : set.pending ? 'Not to upload yet: the site shares this dungeon\'s recordings once a moderator approves it.' : null;

    const refresh = async () => {
        try {
            rows = await source.recordings.list();
            points = shownPoints(storedPoints(await source.saves.list(null), rows, set.id), rows);
        } catch (error) {
            rows = [];
            points = [];
            status.textContent = `This browser's recordings could not be read: ${error instanceof Error ? error.message : String(error)}`;
        }
        render();
    };

    const refreshSite = async () => {
        try {
            const listed = await siteRecordings(set.id);
            shared = moderator ? listed : listed.filter((recording) => recording.mine || !(recording.pending || recording.hidden || recording.broken));
        } catch (error) {
            shared = [];
            status.textContent = `The site's recordings could not be read: ${error instanceof Error ? error.message : String(error)}`;
        }
        render();
    };

    /** A line of a list, `id` its selection's, `name` and `marks` on its left, `when` on its right. */
    const item = (id: string, name: string, marks: readonly string[], when: number) => {
        const entry = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recordings-item';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(id === selected));
        button.dataset.recording = id;
        button.append(line('recordings-name', name), ...marks.map((mark) => line('recordings-mark', mark)),
            line('recordings-when', `${formatSaveDate(when)} ${formatSaveTime(when)}`));
        button.addEventListener('click', () => {
            selected = id;
            uploadFor = null;
            render();
        });
        entry.append(button);
        return entry;
    };

    /** `into` holding `items`, or the line `none` where there is none. */
    const fill = (into: HTMLElement, items: HTMLElement[], none: string) => {
        if (items.length > 0) return into.replaceChildren(...items);
        const empty = document.createElement('li');
        empty.className = 'documents-none';
        empty.textContent = none;
        into.replaceChildren(empty);
    };

    const render = () => {
        if (selected !== null && !points.some((point) => pointRecordingId(point) === selected) && !shared?.some((recording) => recording.id === selected)) {
            selected = null;
        }
        if (published) {
            fill(siteList, (shared ?? []).map((recording) => item(recording.id, recording.title, siteMarks(recording), recording.uploadedAt)),
                shared === null ? 'Asking the site…' : 'No recording of this dungeon on the site yet.');
        }
        fill(list, points.map((point) => item(pointRecordingId(point), pointName(point), [], pointMadeAt(point))),
            'No recording of this dungeon on this browser yet: a save, or the end of a game, is one.');
        const recording = shared?.find((one) => one.id === selected);
        const point = points.find((one) => pointRecordingId(one) === selected);
        if (recording) showShared(recording);
        else if (point) {
            if (uploadFor !== selected) void showPoint(point);
        } else {
            panel.replaceChildren();
        }
    };

    /**
     * The panel of the site's `recording`: its author, its description and its metadata,
     * when it was shared and its state, then PLAY; to a moderator, APPROVE on a pending one,
     * HIDE or SHOW on any other, and DELETE, and to its uploader, WITHDRAW, either asking
     * first.
     */
    const showShared = (recording: SiteRecording) => {
        const buttons = document.createElement('div');
        buttons.className = 'add-set-buttons';
        buttons.append(playLink(recordingQuery(set.id, recording.id)));
        const act = async (action: RecordingAction, doing: string) => {
            status.textContent = doing;
            for (const button of panel.querySelectorAll('button')) button.disabled = true;
            const error = await postAsPlayer(`${RECORDINGS_ROUTE}/${encodeURIComponent(recording.id)}`, { 'Content-Type': 'application/json' },
                JSON.stringify({ action }));
            status.textContent = error === null ? '' : `${doing.slice(0, -1)} failed: ${error}`;
            await refreshSite();
        };
        const ask = (verb: string, text: string) => confirmation('delete-recording', `${verb} ${recording.title}?`, text, verb,
            () => void act('delete', `${verb === 'Delete' ? 'Deleting' : 'Withdrawing'} ${recording.title}…`));
        if (moderator) {
            buttons.append(recording.pending ? panelButton('recordings-approve', 'Approve', () => void act('approve', `Approving ${recording.title}…`))
                : recording.hidden ? panelButton('recordings-show', 'Show', () => void act('show', `Showing ${recording.title}…`))
                    : panelButton('recordings-hide', 'Hide', () => void act('hide', `Hiding ${recording.title}…`)),
            panelButton('recordings-delete', 'Delete', () => ask('Delete', 'The site deletes the recording. Its uploader may share it again.')));
        } else if (recording.mine) {
            buttons.append(panelButton('recordings-withdraw', 'Withdraw', () => ask('Withdraw', 'The site deletes the recording you shared. This browser\'s stays.')));
        }
        const state = recording.pending ? ', awaiting a moderator' : recording.hidden ? ', hidden by a moderator' : '';
        panel.replaceChildren(
            ...(recording.author ? [line('recordings-info', `By: ${recording.author}`)] : []),
            ...(recording.description ? [line('recordings-description', recording.description)] : []),
            ...pointLines(recording).map((text) => line('recordings-info', text)),
            line('recordings-info', `Shared ${formatSaveDate(recording.uploadedAt)} ${formatSaveTime(recording.uploadedAt)}${state}`),
            ...(recording.broken ? [line('recordings-failure', 'It drifts on the site\'s version: it plays, and stops where it drifts.')] : []),
            buttons);
    };

    /**
     * The panel of `point`: its metadata, once its path is read, then PLAY, UPLOAD, and DELETE
     * on a game's end. Where the site does not publish the set, or the path holds a move of
     * `?dev`, a line says why in UPLOAD's place.
     */
    const showPoint = async (point: StoredPoint) => {
        const id = pointRecordingId(point);
        panel.replaceChildren(line('recordings-reading', 'Reading the recording…'));
        let path: Recording[];
        let info: PointInfo;
        try {
            path = await pointPath(source.recordings, point);
            info = pointInfo(point, path, rows);
        } catch (error) {
            if (selected === id) panel.replaceChildren(line('recordings-failure', `It could not be read: ${error instanceof Error ? error.message : String(error)}`));
            return;
        }
        if (selected !== id) return;
        const buttons = document.createElement('div');
        buttons.className = 'add-set-buttons';
        buttons.append(playLink(recordingQuery(set.id, id)));
        const why = unpublished ?? (playedWithDevMoves(path) ? 'Not to upload: it holds a move of ?dev, which no game holds.' : null);
        if (why === null) {
            buttons.append(panelButton('recordings-upload', 'Upload', () => {
                uploadFor = id;
                showUpload(point, path, info);
            }));
        }
        if (point.kind === 'end') {
            buttons.append(panelButton('recordings-delete', 'Delete', () => confirmation('delete-recording', `Delete ${pointName(point).toLowerCase()}?`,
                'This browser deletes the recording of the game to its end, and what nothing else reaches of the recordings before it.',
                'Delete', () => void (async () => {
                    try {
                        await source.recordings.remove(point.recording.id);
                        await pruneRecordings(source.recordings, source.saves, null);
                    } catch (error) {
                        status.textContent = `It could not be deleted: ${error instanceof Error ? error.message : String(error)}`;
                    }
                    await refresh();
                })())));
        }
        panel.replaceChildren(...pointLines(info).map((text) => line('recordings-info', text)), ...(why === null ? [] : [line('recordings-why', why)]), buttons);
    };

    /**
     * The panel's UPLOAD form on `point`, whose path is `path` and metadata `info`: its
     * title, which UPLOAD waits for, and its author and description, then CANCEL, back to
     * its panel, and UPLOAD, which sends its package (`uploadPoint`). Once the site has it,
     * the site's list is asked anew, the recording selected in it, pending; a refusal is
     * said, and the form kept.
     */
    const showUpload = (point: StoredPoint, path: readonly Recording[], info: PointInfo) => {
        const fields = document.createElement('div');
        fields.className = 'recordings-upload-form';
        fields.innerHTML = UPLOAD;
        const title = fields.querySelector<HTMLInputElement>('[name="title"]')!;
        const author = fields.querySelector<HTMLInputElement>('[name="author"]')!;
        const description = fields.querySelector<HTMLTextAreaElement>('[name="description"]')!;
        const buttons = document.createElement('div');
        buttons.className = 'add-set-buttons';
        const send = panelButton('recordings-send', 'Upload', () => void upload()) as HTMLButtonElement;
        const ready = () => { send.disabled = title.value.trim() === ''; };
        const editable = (on: boolean) => {
            for (const field of [title, author, description]) field.disabled = !on;
            for (const button of buttons.querySelectorAll('button')) button.disabled = !on;
            if (on) ready();
        };
        const upload = async () => {
            const text = { title: title.value.trim(), author: author.value.trim(), description: description.value.trim() };
            status.textContent = `Uploading ${text.title}…`;
            editable(false);
            const answer = await uploadPoint(point, path, info, text, source.saves);
            if (typeof answer === 'string') {
                status.textContent = `Uploading ${text.title} failed: ${answer}`;
                editable(true);
                return;
            }
            uploadFor = null;
            selected = answer.id;
            status.textContent = `${text.title} is uploaded: the site lists it to you alone until a moderator approves it.`;
            await refreshSite();
        };
        buttons.append(panelButton('recordings-cancel', 'Cancel', () => {
            uploadFor = null;
            render();
        }), send);
        title.addEventListener('input', ready);
        ready();
        panel.replaceChildren(fields, buttons);
        title.focus();
    };

    if (published) void refreshSite();
    else for (const shown of dialog.querySelectorAll('.recordings-site-heading, .recordings-site')) shown.remove();
    void refresh();
}

/**
 * The package of `point`, whose path is `path` (`pointPath`) and metadata `info`, said by
 * `text`, written and uploaded (`POST RECORDINGS_ROUTE`) by the player whose `playerId`
 * this is, a save's file read from `saves`: the id the site gives it, or why not.
 */
async function uploadPoint(
    point: StoredPoint, path: readonly Recording[], info: PointInfo, text: RecordingPackageText, saves: Pick<SaveStore, 'read'>,
): Promise<{ readonly id: string } | string> {
    let bytes: Uint8Array;
    try {
        const times = { recordedAt: info.recordedAt, endedAt: info.endedAt, playTime: info.playTime };
        bytes = await writeRecordingPackage(point.kind === 'save'
            ? packageOfSave(path, point.save.recording, await saves.read(point.save.id), text, times)
            : packageOfEnd(path, text, times));
    } catch (error) {
        return `it could not be packed: ${error instanceof Error ? error.message : String(error)}.`;
    }
    const form = new FormData();
    form.append(RECORDING_PACKAGE_FIELD, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/gzip' }), 'recording.gz');
    const answer = await answerAsPlayer(RECORDINGS_ROUTE, {}, form);
    if (typeof answer === 'string') return answer;
    const id = (answer.json as { id?: unknown } | null)?.id;
    return typeof id === 'string' && SHARED_RECORDING_ID.test(id) ? { id } : 'the server answered no id.';
}

/** The panel's PLAY: a link to `href`. */
function playLink(href: string): HTMLElement {
    const play = document.createElement('a');
    play.className = 'btn px recordings-play';
    play.textContent = 'Play';
    play.href = href;
    return play;
}

/** A button of the panel, `className` naming what it does, `text` saying it. */
function panelButton(className: string, text: string, click: () => void): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn px ${className}`;
    button.textContent = text;
    button.addEventListener('click', click);
    return button;
}

/**
 * A recording of the site's, as `GET RECORDINGS_ROUTE?dataSet=<id>` lists it
 * (`recordingsText`, `server/recordings.ts`): what a point's panel shows of it, and its
 * text, when it was shared, and its state to whom the server tells it.
 */
interface SiteRecording extends PointInfo {
    readonly id: string;
    readonly title: string;
    readonly author: string;
    readonly description: string;
    readonly uploadedAt: number;
    readonly pending: boolean;
    readonly hidden: boolean;
    readonly broken: boolean;
    /** This player shared it, and may withdraw it. */
    readonly mine: boolean;
}

/** The marks a list's line puts after a site's recording's title: an extra on, and its state. */
function siteMarks(recording: SiteRecording): string[] {
    return [
        ...(recording.extras ? ['extra on'] : []), ...(recording.pending ? ['pending'] : []), ...(recording.hidden ? ['hidden'] : []),
        ...(recording.broken ? ['broken'] : []), ...(recording.mine ? ['yours'] : []),
    ];
}

/**
 * The site's recordings of the set `dataSet` the player whose `playerId` this is may see,
 * the latest shared first, each of them as the server lists it; a row not of that form is
 * left out. Throws where the server cannot be reached or does not answer the list.
 */
async function siteRecordings(dataSet: string): Promise<SiteRecording[]> {
    const response = await fetch(`${RECORDINGS_ROUTE}?dataSet=${encodeURIComponent(dataSet)}`, { headers: { [PLAYER_ID_HEADER]: playerId() } })
        .catch(() => null);
    if (!response) throw new Error('the server cannot be reached.');
    if (!response.ok) throw new Error(`the server answered HTTP ${response.status}.`);
    const listed = (await response.json().catch(() => null) as { recordings?: unknown } | null)?.recordings;
    if (!Array.isArray(listed)) throw new Error('the server answered no list.');
    return listed.flatMap((row: unknown) => {
        const recording = siteRecording(row);
        return recording ? [recording] : [];
    });
}

/** `row` as a site's recording, or `null` where it is not one. */
function siteRecording(row: unknown): SiteRecording | null {
    if (typeof row !== 'object' || row === null) return null;
    const r = row as Record<string, unknown>;
    const { id, build, title, author, description, recordedAt, endedAt, playTime, uploadedAt } = r;
    const start = startOf(r.start);
    if (typeof id !== 'string' || !SHARED_RECORDING_ID.test(id) || typeof build !== 'string' || typeof title !== 'string'
        || typeof author !== 'string' || typeof description !== 'string' || typeof recordedAt !== 'number' || typeof endedAt !== 'number'
        || typeof playTime !== 'number' || typeof uploadedAt !== 'number' || start === null) return null;
    return {
        id, build, title, author, description, recordedAt, endedAt, playTime, uploadedAt, start,
        extras: r.extras === true, pending: r.status === 'pending', hidden: r.hidden === true, broken: r.broken === true, mine: r.mine === true,
    };
}

/** `start` as where a package's path starts, or `null` where it is not that. */
function startOf(start: unknown): RecordingPackageStart | null {
    if (typeof start !== 'object' || start === null) return null;
    const { kind, level, champions } = start as Record<string, unknown>;
    if (kind === 'new') return { kind };
    return kind === 'save' && typeof level === 'number' && Array.isArray(champions) && champions.every((name) => typeof name === 'string')
        ? { kind, level, champions } : null;
}

/** What the list names `point` by: a save's name, or the game won or lost. */
function pointName(point: StoredPoint): string {
    return point.kind === 'save' ? point.save.name : point.recording.end.word11694 ? 'The game won' : 'The game lost';
}

/** The panel's lines of a point's metadata `info`. */
function pointLines(info: PointInfo): string[] {
    const { start } = info;
    const party = start.kind === 'save' ? start.champions.map((name) => name.trim()).filter((name) => name !== '').join(' · ') : '';
    return [
        start.kind === 'new' ? 'From a new game' : `From a saved game, level ${start.level}${party ? `: ${party}` : ''}`,
        `Began ${formatSaveDate(info.recordedAt)} ${formatSaveTime(info.recordedAt)}, ended ${formatSaveDate(info.endedAt)} ${formatSaveTime(info.endedAt)}`,
        `Time played ${formatPlayTime(info.playTime)}`,
        `Build ${info.build}${info.extras ? ', played with an extra on' : ''}`,
    ];
}

/** The files of the published `set`'s folder as the server serves them, each with its date, its `Last-Modified`, or now. */
function servedFile(set: DataSet): ReadArchiveFile {
    return async (file) => {
        const response = await fetch(documentPath(set, file)).catch(() => null);
        if (!response?.ok) return null;
        const modified = new Date(response.headers.get('Last-Modified') ?? Date.now());
        return { bytes: new Uint8Array(await response.arrayBuffer()), modified: Number.isNaN(modified.getTime()) ? new Date() : modified };
    };
}

/** `bytes` downloaded as the browser does its downloads, under `name`: a link to them, clicked (`downloadSaveFile`). */
function downloadFile(name: string, bytes: Uint8Array<ArrayBuffer>): void {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `bytes` as a document's size: `512 B`, `40 KB`, `3.2 MB`. */
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

/** The triangle on `set`'s tile: a link to the set, as PLAY's (`pageQuery`), its save none. */
function playControl(set: DataSet): HTMLElement {
    const anchor = document.createElement('a');
    anchor.className = 'pick-control pick-play';
    anchor.href = pageQuery(set.id, null);
    anchor.title = `Play ${set.name}`;
    anchor.setAttribute('aria-label', anchor.title);
    anchor.innerHTML = PLAY;
    return anchor;
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

/** The triangle, which plays a set. */
const PLAY = pixelArt([
    '...y.......',
    '...yy......',
    '...yyy.....',
    '...yyyy....',
    '...yyyyy...',
    '...yyyyyy..',
    '...yyyyy...',
    '...yyyy....',
    '...yyy.....',
    '...yy......',
    '...y.......',
], { y: 'p9' });

/** The book, which opens a set's documents. */
const BOOK = pixelArt([
    '...........',
    '..cccccccc.',
    '.dcccccccc.',
    '.dcyyyyycc.',
    '.dcccccccc.',
    '.dcccccccc.',
    '.dcccccccc.',
    '.dcccccccc.',
    '.dcccccccc.',
    '.dwwwwwwww.',
    '..dddddddd.',
], { d: 'p3', c: 'p5', y: 'p9', w: 'p13' });

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
 * first, then the others in `sets`' own order, the manifest's (a sort is stable).
 */
function tileOrder(sets: DataSet[], rows: SaveEntry[]): DataSet[] {
    const lastSaved = new Map<string, number>();
    for (const row of rows) lastSaved.set(row.dataSet, Math.max(lastSaved.get(row.dataSet) ?? 0, row.savedAt));
    return [...sets].sort((a, b) => (lastSaved.get(b.id) ?? -1) - (lastSaved.get(a.id) ?? -1));
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
 * The page's own query without the game's set, save and recording: the welcome page's,
 * where the settings dialog's EXIT leads (`UIState.onExit`), and a recording's viewer's
 * stop (`playRecording`, `src/main.ts`). Every other parameter is kept.
 */
export function welcomePageQuery(): string {
    const params = new URLSearchParams(window.location.search);
    params.delete('dungeon');
    params.delete('save');
    params.delete('recording');
    const query = `${params}`;
    return query ? `?${query}` : window.location.pathname;
}

/** The page's own query, the game's set and the recording `recording` to play (`?recording=`), with no save. */
function recordingQuery(dataSet: string, recording: string): string {
    const params = new URLSearchParams(window.location.search);
    params.set('dungeon', dataSet);
    params.delete('save');
    params.set('recording', recording);
    return `?${params}`;
}

/** The page's own query, the game's set and, to continue, its save in it. */
function pageQuery(dataSet: string, save: string | null): string {
    const params = new URLSearchParams(window.location.search);
    params.set('dungeon', dataSet);
    if (save === null) params.delete('save');
    else params.set('save', save);
    return `?${params}`;
}
