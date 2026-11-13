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
 * `miniDat`, `hintOracle`, `dmRules`, `thumbnailAsTitle`, `hidden` and `official` may each be left out, for `false`, and the manifest
 * names one only where it is true. A set with `"hidden": true` is left out of the welcome
 * page's grid (`chooserSets`), but for a moderator, and plays all the same by its `?dungeon=`.
 * A set with `"official": true` is one of FTL's own games, which the welcome page lists in
 * a section of their own, before the fans' dungeons.
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
     * use none. `tools/fixtures/gamefiles/csbgraphics/CSBgraphics.dat`, Paul R. Stevens', is
     * one such library, for the tools (`npm run fetch-gamefiles`).
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
     * Whether it is one of FTL's own games, Dungeon Master in any of its versions, its Kid's
     * dungeon and Chaos Strikes Back, rather than a fan's: the welcome page lists those first,
     * in a section of their own, in the manifest's order (`src/ui/welcomePage.ts`). Only a
     * moderator says so (`server/publish.ts`, `server/edit.ts`).
     */
    official: boolean;
    /**
     * Whether it awaits a moderator's approval: the manifest's `"status": "pending"`. The
     * server offers such a set to its owner and the moderators only. A local set is not.
     */
    pending: boolean;
    /** The documents its folder holds for its players, by name (`DataSetDocument`): none, or several. A local set has none. */
    documents: readonly DataSetDocument[];
    /**
     * How many recordings of it the site lists to everyone (`server/recordings.ts`): those
     * approved, neither hidden nor broken; the manifest's `"recordings"`, 0 where it says
     * none. The welcome page's tile says it. A local set has none.
     */
    recordings: number;
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
 * Where the page asks for the MD5 of each game file of the sets `DATA_SETS_ROUTE` offers
 * it, naming its player the same way (`server/setFiles.ts`): what a recording played by
 * `?recording=` is matched against, to find a set whose files are those it was made over
 * (`findRecordingSet`, `src/data/RecordingSet.ts`).
 */
export const DATA_SET_FILES_ROUTE = 'api/data-set-files';

/**
 * The files a game reads of its set by name (`DataSetFiles.read`), which a recording's
 * digests may name (`FileDigests`, `src/data/DataSetFiles.ts`): the boot's
 * (`loadGameFiles`), `dungeon.dat` and `mini.dat` (`src/main.ts`), and RISE's portraits
 * (`UTILITY_PORTRAITS_FILE`). The server digests these alone of a set's folder, which also
 * holds its thumbnail and its documents.
 */
export const GAME_FILES = ['graphics.dat', 'CSBgraphics.dat', 'hcsb.hct', 'hcsb.dat', 'dungeon.dat', 'mini.dat', 'utility-portraits.dat'] as const;

/**
 * A set's own achievements, an optional file of its folder or its record
 * (`doc/ACHIEVEMENTS.md` → "The file"), read as text (`readAchievementsText`,
 * `DataSetFiles.ts`). It is no game file (`GAME_FILES`): a recording names none of it, so
 * an edit of it changes no recording's set (`findRecordingSet`).
 */
export const ACHIEVEMENTS_FILE = 'achievements.txt';

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
 * Where the page asks for a set's shared recordings, `?dataSet=<id>`, and uploads one,
 * relative to the page, naming its player as `DATA_SETS_ROUTE` does (`server/recordings.ts`,
 * `doc/RECORDING.md` → "Shared recordings"). `POST RECORDINGS_ROUTE/<id>` moderates or withdraws one
 * (`RECORDING_ACTIONS`).
 */
export const RECORDINGS_ROUTE = 'api/recordings';

/** The one field of the form `POST RECORDINGS_ROUTE` takes: the package's file. */
export const RECORDING_PACKAGE_FIELD = 'package';

/** Where a shared recording's package is served, relative to the page: `RECORDING_FILES/<id>.gz`. */
export const RECORDING_FILES = 'recordings';

/**
 * A shared recording's id, which the server draws: sixteen uppercase hexadecimal digits,
 * which the page tells from its own store's recordings' ids by their form, since those hold
 * a `-` (`src/main.ts`).
 */
export const SHARED_RECORDING_ID = /^[0-9A-F]{16}$/;

/**
 * What `POST RECORDINGS_ROUTE/<id>` does to a shared recording, its body's `{"action": …}`
 * (`server/recordings.ts`): a moderator's approve, hide, show and delete, the replay tool's
 * break, and its uploader's delete, a withdrawal.
 */
export const RECORDING_ACTIONS = ['approve', 'hide', 'show', 'break', 'delete'] as const;
export type RecordingAction = (typeof RECORDING_ACTIONS)[number];

/**
 * Where a recording's path ends, as the site lists a shared one (`server/recordings.ts`)
 * and the welcome page says it: at a save, or at the game's end, won or lost.
 */
export const RECORDING_ENDINGS = ['save', 'won', 'lost'] as const;
export type RecordingEnding = (typeof RECORDING_ENDINGS)[number];

/**
 * Where the page asks what the server knows of its player, `GET`, and chooses its public
 * name or links its browser to one, `POST` with `{"action": …}` (`PROFILE_ACTIONS`),
 * naming its player as `DATA_SETS_ROUTE` does (`server/identity.ts`, `doc/ACHIEVEMENTS.md`
 * → "Identity"): the welcome page's PROFILE (`src/ui/profile.ts`).
 */
export const PROFILE_ROUTE = 'api/profile';

/**
 * What `POST PROFILE_ROUTE` does: `name` chooses or changes the public name, `{"name": …}`;
 * `link` links the browser to the identity whose key it gives, `{"key": …}`; `key` draws
 * the identity a new key, the old one refused from then on.
 */
export const PROFILE_ACTIONS = ['name', 'link', 'key'] as const;
export type ProfileAction = (typeof PROFILE_ACTIONS)[number];

/**
 * Where the page sends the proof of its unlocks, `POST` with a form of `PROOF_FIELDS`, and
 * asks for their verdicts, `GET ?ids=<id>,<id>…`, naming its player as `DATA_SETS_ROUTE`
 * does (`server/proofs.ts`, `doc/ACHIEVEMENTS.md` → "Proofs").
 */
export const PROOFS_ROUTE = 'api/proofs';

/** The form `POST PROOFS_ROUTE` takes: the package's file, and the ids of the achievements it claims, a JSON list. */
export const PROOF_FIELDS = { package: 'package', claims: 'claims' } as const;

/** A proof's id, which the server draws and answers once: sixteen uppercase hexadecimal digits. */
export const PROOF_ID = /^[0-9A-F]{16}$/;

/**
 * An achievement's id as a claim names it: an id of the file's form (`AchievementFile.ts`),
 * at most 64 characters.
 */
export const CLAIM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The most achievements one proof claims, and the most proofs one `GET PROOFS_ROUTE` asks for. */
export const MAX_CLAIMS = 64;

/**
 * How far a proof has got on the server: `queued` until the verifier replays it, `checked`
 * once it played to its point, `drifted` where it did not, its claims then left unverified.
 */
export type ProofState = 'queued' | 'checked' | 'drifted';

/**
 * A claim's verdict: `unverified` until its proof is checked, and for good where it drifts;
 * `verified` where the replay unlocked it; `dropped` where the replay did not.
 */
export type ClaimState = 'unverified' | 'verified' | 'dropped';

/** What `GET PROOFS_ROUTE` answers of one proof: its state, why it drifted, and each claim's verdict. */
export interface ProofVerdict {
    id: string;
    state: ProofState;
    /** Why it drifted, where it did. */
    reason?: string;
    claims: Record<string, ClaimState>;
}

/**
 * Where a moderator resets a public name, `POST IDENTITIES_ROUTE/<public id>`,
 * `{"action": "reset"}`, and reads what the server holds of its proofs, `GET`
 * (`ModeratedIdentity`), naming themselves as `DATA_SETS_ROUTE` does.
 */
export const IDENTITIES_ROUTE = 'api/identities';

/** A proof as `GET IDENTITIES_ROUTE/<public id>` answers it to a moderator: never its sender's `playerId` nor its playthrough. */
export interface ModeratedProof {
    id: string;
    dataSet: string;
    /** Its set's name, or its id where the table no longer holds it. */
    name: string;
    state: ProofState;
    /** Why it drifted, where it did. */
    reason?: string;
    sentAt: number;
    checkedAt: number | null;
    /** Whether its package is still on the server, which `GET PROOFS_ROUTE/<id>` answers to a moderator. */
    kept: boolean;
    /** Each claim's verdict, and each unlock its replay granted unclaimed, `verified`. */
    claims: Record<string, ClaimState>;
}

/** `GET IDENTITIES_ROUTE/<public id>`: an identity as a moderator sees it, and its browsers' proofs, the latest sent first. */
export interface ModeratedIdentity {
    id: string;
    name: string | null;
    browsers: number;
    proofs: ModeratedProof[];
}

/**
 * `?recording=` of a proof, `PROOF_RECORDING_PREFIX<id>`: its package, which the server keeps
 * and answers a moderator alone (`GET PROOFS_ROUTE/<id>`), played as a site's recording is.
 */
export const PROOF_RECORDING_PREFIX = 'proof:';

/**
 * The Hall of Fame's answers (`server/fame.ts`), public and cached as `api/stats`'s are:
 * `GET FAME_ROUTE` every public set's figures, `FAME_ROUTE/FAME_SETS/<id>` a set's
 * achievements, and `FAME_ROUTE/FAME_PLAYERS/<public id>` a player's badges.
 */
export const FAME_ROUTE = 'api/fame';
export const FAME_SETS = 'sets';
export const FAME_PLAYERS = 'players';

/** The shortest and the longest public name, in characters. */
export const PUBLIC_NAME_LIMITS = { min: 3, max: 16 } as const;

/**
 * A public name's characters: ASCII letters, digits, `-`, `_` and `.`, in words a single
 * space apart, so that no two names differ by spaces a list does not show.
 */
const PUBLIC_NAME = /^[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)*$/;

/** Why `name` is not a public name, or `null` where it is one. Whether it is taken is the server's to say. */
export function publicNameProblem(name: string): string | null {
    if (name.length < PUBLIC_NAME_LIMITS.min || name.length > PUBLIC_NAME_LIMITS.max) {
        return `A name is ${PUBLIC_NAME_LIMITS.min} to ${PUBLIC_NAME_LIMITS.max} characters long.`;
    }
    if (!PUBLIC_NAME.test(name)) return 'A name is made of letters, digits, - _ and ., and single spaces between them.';
    return null;
}

/**
 * The alphabet of a public id and an identity key: Crockford's base 32, which has no I,
 * L, O or U, so that a key read aloud or copied by hand is read back.
 */
export const IDENTITY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A public id: ten characters of `IDENTITY_ALPHABET`, in lowercase, drawn by the server. */
export const PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{10}$/;

/** The characters of an identity key, `IDENTITY_ALPHABET`'s, shown in groups of `IDENTITY_KEY_GROUP` (`identityKeyText`). */
export const IDENTITY_KEY_LENGTH = 25;
export const IDENTITY_KEY_GROUP = 5;

/** `key`, `IDENTITY_KEY_LENGTH` characters of `IDENTITY_ALPHABET`, in groups a `-` apart. */
export function identityKeyText(key: string): string {
    return key.match(new RegExp(`.{1,${IDENTITY_KEY_GROUP}}`, 'g'))?.join('-') ?? key;
}

/**
 * The identity key `text` holds, as the server hashes it, or `null` where it holds none:
 * any case, the spaces and the `-` dropped, and an `O` read as `0` and an `I` or an `L` as
 * `1`, as Crockford's base 32 reads them.
 */
export function identityKeyOf(text: string): string | null {
    const key = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return key.length === IDENTITY_KEY_LENGTH && [...key].every((c) => IDENTITY_ALPHABET.includes(c)) ? key : null;
}

/** A set's state, as the profile says it: awaiting a moderator, listed, or hidden by one. */
export type ProfileState = 'pending' | 'approved' | 'hidden';

/**
 * `GET PROFILE_ROUTE`'s answer: what the server holds of the player who asks and of the
 * other browsers their identity links, and never a `playerId` (`server/identity.ts`).
 */
export interface PlayerProfile {
    /** Their public name and its public id, `null` before a name is chosen; the name `null` once a moderator reset it. */
    identity: { name: string | null; id: string; browsers: number } | null;
    /** The sets they published, in the list's order. */
    dataSets: { id: string; name: string; state: ProfileState }[];
    /** The recordings they shared, the latest first, each with its set's name. */
    recordings: { id: string; dataSet: string; name: string; title: string; state: ProfileState; broken: boolean; uploadedAt: number }[];
    /** How many of those the site lists as replays: approved, neither hidden nor broken. */
    replays: number;
    /** Their games the statistics hold, by set. */
    statistics: { dataSet: string; name: string; started: number; won: number; lost: number }[];
    /**
     * Their achievements by set, those a replay of their proofs verified, each once, the first
     * verified first; and their `names`, in the set's file's order, an id the file no longer
     * holds by itself, last.
     */
    achievements: { dataSet: string; name: string; unlocked: string[]; names: string[] }[];
}

/** `POST PROFILE_ROUTE`'s answer once done: the identity, and its key where one was drawn, shown this once. */
export interface ProfileIdentity {
    name: string | null;
    id: string;
    key?: string;
}

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

const FLAGS = ['csbGraphics', 'miniDat', 'hintOracle', 'dmRules', 'thumbnailAsTitle', 'hidden', 'official'] as const;

/**
 * `text`, a manifest whose folders are relative to `base` (`gamefiles` for the page,
 * `tools/fixtures/gamefiles` for the tools, `''` for the server), every one resolved under it. A
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
        const [csbGraphics, miniDat, hintOracle, dmRules, thumbnailAsTitle, hidden, official] = FLAGS.map((flag) => {
            const value = entry[flag] ?? false;
            if (typeof value !== 'boolean') throw manifestError(`data set '${id}' has a "${flag}" that is neither true nor false`);
            return value;
        }) as [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
        const status = entry.status ?? 'approved';
        if (status !== 'approved' && status !== 'pending') throw manifestError(`data set '${id}' has a "status" that is neither "approved" nor "pending"`);
        const { documents = [] } = entry;
        if (!Array.isArray(documents) || !documents.every((document) => isRecord(document) && typeof document.file === 'string' && isDocumentName(document.file)
            && Number.isSafeInteger(document.size) && (document.size as number) >= 0)) {
            throw manifestError(`data set '${id}' has "documents" that are not a list of {"file", "size"}, each file a document's name`);
        }
        const { recordings = 0 } = entry;
        if (!Number.isSafeInteger(recordings) || (recordings as number) < 0) throw manifestError(`data set '${id}' has "recordings" that is not a count`);
        const files = documents.map((document) => (document as Record<string, unknown>).file as string);
        if (new Set(files).size !== files.length) throw manifestError(`data set '${id}' names a document twice`);
        return {
            id, name, description, authors, dir: under(base, dir), csbGraphics, miniDat, hintOracle, dmRules, thumbnailAsTitle, hidden, official,
            pending: status === 'pending', documents: documents.map((document) => ({ file: document.file as string, size: document.size as number })),
            recordings: recordings as number,
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
