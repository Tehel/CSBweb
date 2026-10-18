/**
 * The games the page can play: a folder of CSBWin data files each, one of them chosen
 * before the boot: by `?dungeon=`, which the welcome page's PLAY and CONTINUE set
 * (`src/ui/welcomePage.ts`).
 *
 * CSBWin plays whatever its directory holds: the command line's `directory=` or
 * `config.txt`'s `DIRECTORY` (doc/CSBwin-src/CSBUI.cpp:2057, :819), read before
 * `_AskWhatToDo`, which offers no dungeon (doc/CSBwin-src/CSBCode.cpp:11573-11679). Its
 * code does not branch on the game: the tables, the title and the credits all come from
 * the directory's `graphics.dat`, so everything the page builds comes from the set.
 *
 * The sets are listed by a manifest, which the page asks the server for (`DATA_SETS_ROUTE`):
 * the deployed server answers it from its store's table (`server/dataSets.ts`), and the dev server from the
 * repository's, `tools/data-sets.json` (`vite.config.mts`), which the tools read too. This module parses it, for the page and the
 * tools:
 *
 *     { "default": "dm-atari",
 *       "dataSets": [{ "id": "dm-atari", "name": "Dungeon Master", "csbGraphics": true },
 *                    { "id": "conflux", "name": "Conflux 3.5", "dir": "conflux-3.5-b8" }, …] }
 *
 * A folder is named relative to the manifest. The list may be empty: a new server's is,
 * until a player's set is published and approved, and the welcome page then offers only to
 * add one. `default` may be `null` or left out, for none. A set's `dir` may be left out, for its `id`.
 * The flags `csbGraphics`,
 * `miniDat`, `hintOracle`, `dmRules`, `thumbnailAsTitle` and `hidden` may each be left out, for `false`, and the manifest
 * names one only where it is true. A set with `"hidden": true` is left out of the welcome
 * page's grid (`chooserSets`), but for a moderator, and plays all the same by its `?dungeon=`.
 *
 * A set's `description`, a text, and its `authors`, a list of texts, may each be left out,
 * for `''` and `[]`: what the form that adds a set says of it (`src/ui/addDataSetForm.ts`).
 *
 * A set's `status` may be `"pending"`, for a set uploaded and not yet approved, which the
 * server offers its owner and the moderators only (`server/dataSets.ts`), or `"approved"`, or
 * be left out, for `"approved"`.
 *
 * A set's `documents` may be left out, for none: the files its folder holds beside the game's
 * for its players to read, a manual or a solution (`DataSetDocument`), which the welcome
 * page's book lists (`src/ui/welcomePage.ts`). The game reads none of them.
 *
 * `"moderator": true` says that the player asking is one of the site's moderators, which
 * only the server's answer to a moderator says; it may be left out, for `false`.
 *
 * A set's folder may also hold its thumbnail, `<id>-thumbnail.png` (`thumbnailPath`): the
 * last frame of its title, which the welcome page's tile shows. `tools/gen-thumbnails.ts`
 * writes it from the folder's `graphics.dat`, so the page fetches no game file to draw the
 * grid. A folder without one leaves its tile's picture blank.
 */
export interface DataSet {
    /** The page's `?dungeon=` value. */
    id: string;
    name: string;
    /** What its author says of it, `''` for nothing. */
    description: string;
    /** Who made it, in the order they are named: none, or several. */
    authors: readonly string[];
    /**
     * The folder that holds the files: the manifest's `dir`, under the manifest's folder.
     * A local set has none, and `''` here (`src/data/LocalDataSets.ts`).
     */
    dir: string;
    /**
     * Whether the folder holds a `CSBgraphics.dat`, CSBWin's extensions' overlay, which it
     * opens only on demand (doc/CSBwin-src/Graphics.cpp:1864-1882, :3228-3300). It is a
     * library of resources for dungeon designers, which varies from release to release, so
     * a dungeon that uses it ships its own: Conflux and The Towers of Chaos do. DM and CSB
     * use none. `tools/fixtures/csbgraphics/CSBgraphics.dat` is one such library, for the tools.
     */
    csbGraphics: boolean;
    /**
     * Whether the folder holds a `mini.dat`, the dungeon CSBWin's UTILITY makes a new
     * adventure in from a saved game's party (`src/engine/Chaos.ts`). CSB's package ships
     * one, and its entrance offers RISE (`src/renderer/intro/PrisonDoor.ts`).
     */
    miniDat: boolean;
    /**
     * Whether the folder holds `hcsb.hct` and `hcsb.dat`, Chaos Strikes Back's Hint
     * Oracle, a program of its own in CSBWin (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md`). Where
     * it does, the inventory's close box is the Oracle's button
     * (`src/renderer/ui/HintOracleButton.ts`).
     */
    hintOracle: boolean;
    /**
     * Whether the game starts with `DMRulesDesignOption` on, which the boot turns into
     * `DM_rules` (`Game.forceDMRulesAtBoot`): a reincarnated champion then keeps their
     * attributes and their HP, stamina and mana (doc/CSBwin-src/CSBCode.cpp:6799, :6820).
     * It is the flags' value at the start, as a launch option's would be (`--dmrules`,
     * doc/CSBwin-src/LinCSBUI.cpp:677): a file with an Extended Features block sets both
     * its own way, and one without leaves them (`readRulesOptions`). DM's Atari files have
     * no block; CSBWin's DM package, converted from them, has `DMRules`
     * (`doc/PROVEN_FACTS.md`, "`DM_rules` and `DMRulesDesignOption`…"), and so does a
     * game of DM saved by the port, which writes the flag back.
     */
    dmRules: boolean;
    /**
     * Whether its thumbnail (`thumbnailPath`) is to be shown in place of the title's
     * animation, a choice of its author's on the form that adds a set
     * (`src/ui/addDataSetForm.ts`). CSBWin has no such picture: it always plays the
     * animation from `graphics.dat` (`_DisplayChaosStrikesBack`,
     * doc/CSBwin-src/CSBCode.cpp:9308). The page reads it to give the boot the thumbnail,
     * reduced to sixteen registers (`loadTitlePicture`, `src/main.ts`;
     * `src/renderer/intro/TitlePicture.ts`), in the animation's place.
     */
    thumbnailAsTitle: boolean;
    /**
     * Whether the chooser leaves it out (`chooserSets`). It is played by its `?dungeon=` all
     * the same, and the server takes its events and serves its files as any other's.
     */
    hidden: boolean;
    /**
     * Whether it awaits a moderator's approval: the manifest's `"status": "pending"`. The
     * server offers such a set to its owner and the moderators only. A local set is not.
     */
    pending: boolean;
    /** The documents its folder holds for its players, by name (`DataSetDocument`): none, or several. A local set has none. */
    documents: readonly DataSetDocument[];
}

/**
 * A document of a set's: a file of its folder for its players to read or download from the
 * welcome page, a manual, a solution, an author's notes, which the game never reads. A
 * moderator adds and removes them (`server/documents.ts`).
 */
export interface DataSetDocument {
    /** Its file's name in the set's folder, which `isDocumentName` takes. */
    file: string;
    /** Its size in bytes. */
    size: number;
}

/** What a manifest says, its folders resolved. */
export interface DataSetManifest {
    /** In the manifest's order. */
    dataSets: readonly DataSet[];
    /**
     * The set the tools play where they name none (`tools/lib/dataSets.ts`), or `null` where
     * the manifest names none. The page plays none until one is chosen: without a known
     * `?dungeon=` it is the welcome page, which selects this one while the store holds no save.
     */
    defaultSet: DataSet | null;
    /**
     * Whether the player asking is a moderator: the manifest's `"moderator": true`. The
     * welcome page then lists the hidden sets too (`chooserSets`).
     */
    moderator: boolean;
}

/**
 * The prefix of a player's own set's id (`src/data/LocalDataSets.ts`), which no manifest
 * set's may have. Here and not there: the server parses manifests, and reads nothing else
 * of the page's.
 */
export const LOCAL_DATA_SET_PREFIX = 'local:';

/**
 * The `<id>` of a player's own set's `local:<id>`: lowercase letters, digits, `.`, `-` and
 * `_`, a letter or a digit first, at most 40. A published set's id is its folder on the
 * server (`server/publish.ts`), so it is a folder's name everywhere.
 */
export const LOCAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/**
 * The files a player's own set may hold, by the name the game reads them under, and
 * `thumbnail`, an image (`LocalDataSetRecord`, `src/data/LocalDataSets.ts`).
 */
export const LOCAL_DATA_SET_FILES = ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat', 'hcsb.hct', 'hcsb.dat', 'thumbnail'] as const;

/**
 * The field of a moderator's edit of a published set that names a file of
 * `LOCAL_DATA_SET_FILES` the set no longer has, once per file (`server/edit.ts`).
 */
export const EDIT_REMOVE_FIELD = 'remove';

/**
 * The longest text the form that adds a set takes in each field, in characters
 * (`src/ui/addDataSetForm.ts`), and the server publishes: the authors as the form's one
 * line, joined by commas.
 */
export const LOCAL_DATA_SET_TEXT_LIMITS = { name: 60, description: 300, authors: 200 } as const;

/**
 * Where the page asks for the manifest, relative to the page: the server's API, not a file
 * under `gamefiles/`, since a server chooses what each player is offered.
 */
export const DATA_SETS_ROUTE = 'api/data-sets';

/**
 * Where the page asks for the published sets' walls (`parsePublishedDungeons`,
 * `src/data/DungeonSignature.ts`), relative to the page, naming its player as
 * `DATA_SETS_ROUTE` does: only an import that is not the running set's needs them.
 */
export const DATA_SET_WALLS_ROUTE = 'api/data-set-walls';

/**
 * The header in which the page names its player to `DATA_SETS_ROUTE`: their `playerId`
 * (`src/ui/gameEvents.ts`), a secret, which a URL's query would leak into logs.
 */
export const PLAYER_ID_HEADER = 'X-Player-Id';

/**
 * What `POST DATA_SETS_ROUTE/<id>` does to a set, its body's `{"action": …}`
 * (`server/moderate.ts`): the welcome page's tick, cross and eye (`src/ui/welcomePage.ts`).
 */
export const MODERATION_ACTIONS = ['approve', 'reject', 'hide', 'show'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/**
 * The segment below `DATA_SETS_ROUTE/<id>` where a moderator adds a document to the set,
 * by a form, and removes one, by `{"remove": "<file>"}` (`server/documents.ts`).
 */
export const DOCUMENTS_SEGMENT = 'documents';

/**
 * The extensions a document may have, in any case: what a browser shows (a PDF, a text, a
 * picture) or downloads (a word processor's file, an archive). Never one that it would run
 * as the page's own, HTML or SVG, since a document is served beside the page.
 */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.txt', '.md', '.doc', '.docx', '.rtf', '.odt', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.zip'] as const;

/** The longest name a document may have, in characters. */
export const DOCUMENT_NAME_LIMIT = 100;

/**
 * Whether `name` may name a document in a set's folder: a file's name of at most
 * `DOCUMENT_NAME_LIMIT` characters, no `.` first, no `/`, `\` or control character, and one
 * of `DOCUMENT_EXTENSIONS`. So no game file is one (`dungeon.dat`, `mini.dat`), since those
 * end in `.dat` or `.hct`; the set's thumbnail, a `.png`, the server refuses as a document's
 * name (`server/documents.ts`).
 */
export function isDocumentName(name: string): boolean {
    const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
    return name.length <= DOCUMENT_NAME_LIMIT && !name.startsWith('.') && !/[/\\\x00-\x1f\x7f]/.test(name)
        && name.lastIndexOf('.') > 0 && (DOCUMENT_EXTENSIONS as readonly string[]).includes(extension);
}

/** The file of `set`'s document `file`, in its folder, as a URL relative to the page: `3D2D1D/WALKTHROUGH.md`. */
export function documentPath(set: DataSet, file: string): string {
    return `${set.dir}/${encodeURIComponent(file)}`;
}

const FLAGS = ['csbGraphics', 'miniDat', 'hintOracle', 'dmRules', 'thumbnailAsTitle', 'hidden'] as const;

/**
 * `text`, a manifest whose folders are relative to `base` (`gamefiles` for the page,
 * `static/gamefiles` for the tools, `''` for the server), every one resolved under it. A
 * manifest that is not JSON, or does not say what the page needs, throws an error whose
 * message says why: the page cannot choose a game without it.
 */
export function parseManifest(text: string, base: string): DataSetManifest {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        throw manifestError(`it is not JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!isRecord(json)) throw manifestError('it is not an object');
    const { dataSets: list, default: defaultId, moderator = false } = json;
    if (!Array.isArray(list)) throw manifestError('"dataSets" is not a list of data sets');

    const dataSets = list.map((entry: unknown, i): DataSet => {
        const where = `data set ${i}`;
        if (!isRecord(entry)) throw manifestError(`${where} is not an object`);
        const { id, name } = entry;
        if (!isText(id)) throw manifestError(`${where} has no "id"`);
        if (id.startsWith(LOCAL_DATA_SET_PREFIX)) throw manifestError(`data set '${id}' has an id of a player's own set`);
        if (!isText(name)) throw manifestError(`data set '${id}' has no "name"`);
        const dir = entry.dir === undefined ? id : entry.dir;
        if (!isFolder(dir)) throw manifestError(`data set '${id}' has no "dir", a folder relative to the manifest`);
        const { description = '', authors = [] } = entry;
        if (typeof description !== 'string') throw manifestError(`data set '${id}' has a "description" that is not a text`);
        if (!Array.isArray(authors) || !authors.every((author) => typeof author === 'string')) {
            throw manifestError(`data set '${id}' has "authors" that are not a list of texts`);
        }
        const [csbGraphics, miniDat, hintOracle, dmRules, thumbnailAsTitle, hidden] = FLAGS.map((flag) => {
            const value = entry[flag] ?? false;
            if (typeof value !== 'boolean') throw manifestError(`data set '${id}' has a "${flag}" that is neither true nor false`);
            return value;
        }) as [boolean, boolean, boolean, boolean, boolean, boolean];
        const status = entry.status ?? 'approved';
        if (status !== 'approved' && status !== 'pending') throw manifestError(`data set '${id}' has a "status" that is neither "approved" nor "pending"`);
        const { documents = [] } = entry;
        if (!Array.isArray(documents) || !documents.every((document) => isRecord(document) && typeof document.file === 'string' && isDocumentName(document.file)
            && Number.isSafeInteger(document.size) && (document.size as number) >= 0)) {
            throw manifestError(`data set '${id}' has "documents" that are not a list of {"file", "size"}, each file a document's name`);
        }
        const files = documents.map((document) => (document as Record<string, unknown>).file as string);
        if (new Set(files).size !== files.length) throw manifestError(`data set '${id}' names a document twice`);
        return {
            id, name, description, authors: authors as string[], dir: under(base, dir), csbGraphics, miniDat, hintOracle, dmRules, thumbnailAsTitle, hidden,
            pending: status === 'pending', documents: documents.map((document) => ({ file: document.file as string, size: document.size as number })),
        };
    });
    const twice = dataSets.find((set, i) => dataSets.findIndex((other) => other.id === set.id) !== i);
    if (twice) throw manifestError(`two data sets are '${twice.id}'`);

    const defaultSet = defaultId === undefined || defaultId === null ? null : dataSets.find((set) => set.id === defaultId);
    if (defaultSet === undefined) throw manifestError(`"default" names none of its data sets`);
    if (typeof moderator !== 'boolean') throw manifestError('"moderator" is neither true nor false');
    return { dataSets, defaultSet, moderator };
}

/**
 * The sets the welcome page lists, in the manifest's order: every set but the hidden ones,
 * or every set for a moderator. The page orders them itself (`src/ui/welcomePage.ts`).
 */
export function chooserSets(manifest: DataSetManifest): DataSet[] {
    return manifest.dataSets.filter((set) => !set.hidden || manifest.moderator);
}

/** The file of `set`'s thumbnail, in its folder: `dm-atari/dm-atari-thumbnail.png`. */
export function thumbnailPath(set: DataSet): string {
    return `${set.dir}/${set.id}-thumbnail.png`;
}

/**
 * A thumbnail's size, the screen's: the form takes no image of another
 * (`src/ui/addDataSetForm.ts`), and the server publishes none (`server/publish.ts`).
 */
export const THUMBNAIL_WIDTH = 320;
export const THUMBNAIL_HEIGHT = 200;

/** A PNG's first eight bytes. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The bytes `pngSize` reads: the signature, and the `IHDR` chunk's length, type, width and height. */
export const PNG_HEAD_BYTES = 24;

/**
 * The width and height of the PNG whose first bytes, `PNG_HEAD_BYTES` of them, are `head`,
 * read from its `IHDR`, the first chunk, 13 bytes long; `null` where they are not a PNG's.
 */
export function pngSize(head: Uint8Array): { width: number; height: number } | null {
    if (head.length < PNG_HEAD_BYTES || !PNG_SIGNATURE.every((byte, i) => head[i] === byte)) return null;
    const view = new DataView(head.buffer, head.byteOffset, PNG_HEAD_BYTES);
    if (view.getUint32(8) !== 13 || String.fromCharCode(...head.subarray(12, 16)) !== 'IHDR') return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * The set `?dungeon=<id>` names, hidden or not, or `null` when it names none or an
 * unknown one: the welcome page then, where the player chooses one.
 */
export function dataSetNamed(manifest: DataSetManifest, id: string | null): DataSet | null {
    return manifest.dataSets.find((s) => s.id === id) ?? null;
}

function manifestError(why: string): Error {
    return new Error(`The data sets' manifest is not usable: ${why}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value !== '';
}

/** A folder below the manifest's: relative, with no `.` or `..` and no empty segment. */
function isFolder(value: unknown): value is string {
    return isText(value) && !value.includes('\\')
        && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function under(base: string, dir: string): string {
    return base === '' ? dir : `${base}/${dir}`;
}
