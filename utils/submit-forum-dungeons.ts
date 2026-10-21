/**
 * Offer a CSBweb instance the community's CSBWin custom dungeons, one at a time, each
 * submitted as a player's own set is (`POST api/data-sets`, `server/publish.ts`), pending
 * a moderator's approval. It stands in for the welcome page's "Add my own" form and its
 * PUBLISH, and reads each set with the form's own check (`checkLocalDataSet`).
 *
 * Run:
 *
 *   npx tsx utils/submit-forum-dungeons.ts --instance https://csbweb.example --player <playerId> [--dry-run]
 *
 * `--player` is the `playerId` the sets are submitted as, a UUID, which owns them while
 * they are pending (a page's is its `localStorage`'s). `--dry-run` does everything but the
 * `POST`.
 *
 * The candidates are the Dungeon Master forum's list of custom dungeons (`FORUM_LIST`),
 * the entries whose engines name CSBWin, less those the instance already lists (by name)
 * and those the forum's shared OneDrive (`ONEDRIVE_SHARE`) holds no files for: it keeps
 * every dungeon of the list in `Custom Dungeons/<name> [<engines>] [<authors>]`. For each,
 * the script shows its name, its authors (the list's) and a description (its forum
 * topic's Story, Notes or Aim, cut to whole sentences) and asks:
 *
 *   y  yes: download its files, check them, and submit
 *   n  no, next
 *   e  edit the description, then ask again
 *   a  edit the authors (comma-separated), then ask again
 *   q  quit
 *
 * Nothing of a dungeon's is downloaded before its yes. Then the script lists its folder's
 * archives and asks which, where there are several (versions, platforms); extracts it with
 * `unzip`, or `7z`, `unrar` or `bsdtar` for a RAR or a 7z; and tells each file by what it
 * holds (`identifyLocalDataSetFile`), a PC `dungeon.dat` turned into its Atari twin as the
 * form does. An archive may hold several dungeons (Theron's Quest's seven, an old and a new
 * version): the script asks which to submit, several each under a name of its own. A
 * dungeon takes the `graphics.dat`, `CSBgraphics.dat` and Hint Oracle beside it or above
 * it; without a `graphics.dat` it plays DM's, or CSB's where the dungeon names that one.
 * Its thumbnail is drawn from its graphics as "Generate from data" draws it.
 *
 * Before the `POST`, a dungeon whose `dungeon.dat` is byte for byte one of the instance's
 * sets' is skipped, and one with the same walls (`dungeonSignature`: a mod, another
 * version) is submitted only on a second yes. Nothing extracted is ever run: the archives
 * hold Windows executables, which are not read.
 *
 * The server takes five publishes an hour from one address. A refusal for that (429) ends
 * the run; run it again an hour later, and what it submitted, pending and the player's,
 * is listed by the instance and so is not offered again.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { DATA_SETS_ROUTE, LOCAL_DATA_SET_TEXT_LIMITS, LOCAL_ID_PATTERN, parseManifest, PLAYER_ID_HEADER, type DataSet } from '../src/data/DataSets';
import type { DataSetFiles } from '../src/data/DataSetFiles';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { dungeonSignature } from '../src/data/DungeonSignature';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { bigEndianDungeonDat } from '../src/data/LittleEndianDungeon';
import type { LocalDataSetFile } from '../src/data/LocalDataSets';
import { checkLocalDataSet, identifyLocalDataSetFile, type LocalDataSetDraft } from '../src/engine/LocalDataSetCheck';
import { lastTitleFrame, thumbnailPng } from '../src/renderer/intro/TitleThumbnail';

/** The forum's list of custom dungeons, kept up to date by its moderators. */
const FORUM_LIST = 'https://www.dungeon-master.com/forum/viewtopic.php?t=31516';
/** The forum's shared folder, which the list names as the archive of every dungeon in it. */
const ONEDRIVE_SHARE = 'https://1drv.ms/f/s!AsBu7boYHQokbYK3rjKY0b5_ra8';
/** OneDrive's web app, whose anonymous token reads a shared folder (`oneDriveToken`). */
const ONEDRIVE_APP_ID = '5cbed6ac-a083-4e14-b191-b4ba07653de2';
const ONEDRIVE_API = 'https://my.microsoftpersonalcontent.com/_api/v2.0';
/** The largest file the server takes (`MAX_PUBLISHED_FILE_BYTES`, `server/publish.ts`). */
const MAX_FILE_BYTES = 16 * 1024 * 1024;
/** The sets a `graphics.dat`-less dungeon may play the graphics of, as the form offers them. */
const BASE_SETS = ['dm-atari', 'csb'];
/** Files that are no game file, not read when an archive's files are told. */
const NOT_GAME_FILES = new Set(['.exe', '.dll', '.com', '.bat', '.cmd', '.sh', '.txt', '.doc', '.docx', '.rtf', '.pdf', '.ods', '.xls',
    '.htm', '.html', '.bmp', '.jpg', '.jpeg', '.gif', '.png', '.ico', '.wav', '.mp3', '.ogg', '.avi', '.mp4', '.ini', '.cfg',
    '.replay', '.rtc', '.zip', '.rar', '.7z', '.lzh', '.jbf', '.gil', '.tmp']);
/** The forum topic's sections a description is taken from, in order of preference. */
const DESCRIPTION_SECTIONS = ['story', 'notes', 'aim'];
const SECTION = /^(version|platform|author|email address|date published|date last updated|story|aim|notes|instructions|history|download|screenshots|help)\s*:\s*(.*)$/i;
const USER_AGENT = 'Mozilla/5.0 (CSBweb submit-forum-dungeons)';

/** A dungeon of the forum's list. */
interface Candidate {
    name: string;
    /** Its forum topic, where the list links one. */
    topic: string | null;
    engines: string;
    authors: string[];
    /** Its folder in the shared OneDrive, `null` where there is none. */
    folder: OneDriveItem | null;
}

interface OneDriveItem {
    id: string;
    name: string;
    size: number;
    folder?: unknown;
    parentReference: { driveId: string };
    '@content.downloadUrl'?: string;
}

/** A dungeon found in an archive, with the files that go with it. */
interface Found {
    path: string;
    /** Its Atari bytes, a PC file's twin. */
    dungeon: Uint8Array<ArrayBuffer>;
    pc: boolean;
    levels: number;
    files: Partial<Record<Exclude<LocalDataSetFile, 'thumbnail' | 'dungeon.dat'>, string>>;
}

/** One of the instance's sets, as far as this script compares a dungeon with it. */
interface Listed {
    set: DataSet;
    bytes: string | null;
    walls: string | null;
}

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function argument(name: string): string | null {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] ?? null : null;
}

const instance = (argument('--instance') ?? fail('--instance <url> is needed: the CSBweb instance to submit to')).replace(/\/+$/, '');
const player = argument('--player') ?? fail('--player <playerId> is needed: the player who submits the sets');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(player)) fail('--player is not a playerId, a lowercase UUID');
const dryRun = process.argv.includes('--dry-run');

const rl = createInterface({ input: stdin, output: stdout });
const scratch = mkdtempSync(join(tmpdir(), 'csbweb-forum-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

// The answers, queued as they come: piped ones arrive before their questions.
const answers: string[] = [];
let answered: ((line: string | null) => void) | null = null;
let ended = false;
rl.on('line', (line) => answered ? answered(line) : answers.push(line));
rl.on('close', () => {
    ended = true;
    answered?.(null);
});

/** The player's answer to `question`, `prefill` ready to edit on a terminal. The end of the input ends the run. */
async function ask(question: string, prefill = ''): Promise<string> {
    if (stdin.isTTY && !ended) {
        rl.setPrompt(question);
        rl.prompt();
        if (prefill !== '') rl.write(prefill);
    } else stdout.write(question);
    const line = answers.length > 0 ? answers.shift()! : ended ? null : await new Promise<string | null>((resolve) => answered = resolve);
    answered = null;
    if (line === null) {
        console.log('\nThe input ended.');
        process.exit(0);
    }
    if (!stdin.isTTY) stdout.write(`${line}\n`);
    return line.trim();
}

async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } });
    if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
    return response;
}

// ---------------------------------------------------------------- the forum

function decodeEntities(text: string): string {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', bull: '•' };
    return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity: string) => {
        if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
        return named[entity.toLowerCase()] ?? whole;
    });
}

/** A post's HTML as lines of text, each link `[text](href)`. */
function postLines(html: string): string[] {
    const linked = html.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis,
        (_, href: string, text: string) => `[${text.replace(/<[^>]+>/g, '')}](${decodeEntities(href)})`);
    return decodeEntities(linked.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).split('\n').map((line) => line.trim());
}

/** The post `post` of the forum page `html`, or its first where `post` is `null`. */
function postOf(html: string, post: string | null = null): string {
    const from = post === null ? 0 : Math.max(0, html.indexOf(`<div id="p${post}"`));
    return html.slice(from).match(/<div class="content">(.*?)<\/div>/s)?.[1] ?? '';
}

/** `text`'s authors: split at commas and '&' outside brackets, each "(a.k.a X)" made "(X)". */
function splitAuthors(text: string): string[] {
    const authors: string[] = [];
    let depth = 0, current = '';
    for (const char of text) {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (depth === 0 && (char === ',' || char === '&')) {
            authors.push(current);
            current = '';
        } else current += char;
    }
    authors.push(current);
    return authors.map((author) => author.replace(/\(\s*a\.\s*k?\.?\s*a\.?\s*/i, '(').replace(/\s+/g, ' ').trim()).filter((author) => author !== '');
}

/** The list's entries whose engines name CSBWin. */
async function forumCandidates(): Promise<Omit<Candidate, 'folder'>[]> {
    const lines = postLines(postOf(await (await fetchOk(FORUM_LIST)).text()));
    const entry = /^(?:\[([^\]]+)\]\(([^)]+)\)|([^[]+?))\s*\[([^\]]+)\]\s*\[([^\]]+)\]/;
    return lines.slice(lines.indexOf('Custom dungeons') + 1).flatMap((line) => {
        const match = line.match(entry);
        if (!match || !/csbwin/i.test(match[4])) return [];
        return [{ name: (match[1] ?? match[3]).trim(), topic: match[2] ?? null, engines: match[4], authors: splitAuthors(match[5]) }];
    });
}

/** `text` cut to its whole sentences that fit `limit`, or to its words with an ellipsis where the first does not. */
function fitSentences(text: string, limit: number): string {
    if (text.length <= limit) return text;
    const sentences = text.match(/[^.!?]+[.!?]+["')]*\s*/g) ?? [];
    let fitted = '';
    for (const sentence of sentences) {
        if ((fitted + sentence).trim().length > limit) break;
        fitted += sentence;
    }
    if (fitted.trim() !== '') return fitted.trim();
    return text.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
}

/** A description from the topic's first post, or the post its link names: its Story, Notes or Aim, else what it says before any section. */
async function topicDescription(topic: string | null): Promise<string> {
    if (!topic) return '';
    const lines = postLines(postOf(await (await fetchOk(topic)).text(), new URL(topic).searchParams.get('p')));
    const sections = new Map<string, string[]>([['', []]]);
    let current = '';
    for (const line of lines) {
        const header = line.match(SECTION);
        if (header) {
            current = header[1].toLowerCase();
            sections.set(current, []);
            if (header[2] !== '') sections.get(current)!.push(header[2]);
        } else sections.get(current)!.push(line);
    }
    const text = (name: string) => (sections.get(name) ?? [])
        // A link as its text, a bare address dropped, and the line that leads in to one, "The result is at:".
        .map((line) => line.replace(/\[([^\]]*)\]\([^)]*\)/g, (_, text: string) => /^https?:|\.\.\./.test(text) ? '' : text).replace(/https?:\/\/\S+/g, '').trim())
        .filter((line) => line !== '' && !line.endsWith(':'))
        .join(' ').replace(/\s+/g, ' ').trim();
    const chosen = [...DESCRIPTION_SECTIONS, ''].map(text).find((section) => section !== '') ?? '';
    return fitSentences(chosen, LOCAL_DATA_SET_TEXT_LIMITS.description);
}

// ---------------------------------------------------------------- the shared OneDrive

let oneDriveAuth: string | null = null;

/** OneDrive's anonymous token, which its web app reads a shared folder with. */
async function oneDrive(url: string): Promise<{ value?: OneDriveItem[]; '@odata.nextLink'?: string } & OneDriveItem> {
    if (oneDriveAuth === null) {
        const answer = await fetchOk('https://api-badgerp.svc.ms/v1.0/token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: ONEDRIVE_APP_ID }),
        });
        oneDriveAuth = `Badger ${(await answer.json() as { token: string }).token}`;
    }
    return (await fetchOk(url, { headers: { Authorization: oneDriveAuth, Prefer: 'autoredeem' } })).json();
}

async function oneDriveChildren(item: OneDriveItem): Promise<OneDriveItem[]> {
    const children: OneDriveItem[] = [];
    let url: string | undefined = `${ONEDRIVE_API}/drives/${item.parentReference.driveId}/items/${item.id}/children?$top=500`;
    while (url) {
        const page = await oneDrive(url);
        children.push(...page.value ?? []);
        url = page['@odata.nextLink'];
    }
    return children;
}

/** Every file under `item`, with its path below it. */
async function oneDriveFiles(item: OneDriveItem, path = ''): Promise<{ path: string; item: OneDriveItem }[]> {
    const files: { path: string; item: OneDriveItem }[] = [];
    for (const child of await oneDriveChildren(item)) {
        const below = `${path}/${child.name}`;
        if (child.folder) files.push(...await oneDriveFiles(child, below));
        else files.push({ path: below, item: child });
    }
    return files;
}

/** The shared folder's `Custom Dungeons`, its subfolders by the name before their first '['. */
async function oneDriveDungeons(): Promise<Map<string, OneDriveItem>> {
    const share = Buffer.from(ONEDRIVE_SHARE).toString('base64url');
    const root = await oneDrive(`${ONEDRIVE_API}/shares/u!${share}/driveitem`);
    const dungeons = (await oneDriveChildren(root)).find((child) => child.name === 'Custom Dungeons') ?? fail(`${ONEDRIVE_SHARE} has no 'Custom Dungeons' folder`);
    return new Map((await oneDriveChildren(dungeons)).map((child) => [comparable(child.name.split(' [')[0]), child]));
}

// ---------------------------------------------------------------- the instance

/** `name` as names are compared: lowercase letters and digits, a Roman numeral word a number. */
function comparable(name: string): string {
    const roman: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4' };
    return name.normalize('NFKD').toLowerCase().split(/[^a-z0-9]+/).map((word) => roman[word] ?? word).join('');
}

/** `name` as an id (`LOCAL_ID_PATTERN`). */
function idOf(name: string): string {
    return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

async function instanceSets(): Promise<DataSet[]> {
    const response = await fetchOk(`${instance}/${DATA_SETS_ROUTE}`, { headers: { [PLAYER_ID_HEADER]: player } });
    return [...parseManifest(await response.text(), `${instance}/gamefiles`).dataSets];
}

async function instanceFile(set: DataSet, name: string): Promise<Uint8Array | null> {
    const response = await fetch(`${set.dir}/${name}`).catch(() => null);
    return response?.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The instance's sets' dungeons, read once, at the first dungeon to compare. */
let listed: Promise<Listed[]> | null = null;

function listedDungeons(sets: DataSet[]): Promise<Listed[]> {
    listed ??= Promise.all(sets.map(async (set): Promise<Listed> => {
        const bytes = await instanceFile(set, 'dungeon.dat');
        if (!bytes) return { set, bytes: null, walls: null };
        const atari = bigEndianDungeonDat(bytes) ?? bytes;
        try {
            return { set, bytes: sha256(atari), walls: (await dungeonSignature(new DungeonLoader().loadDungeonDat(atari))).join() };
        } catch {
            return { set, bytes: sha256(atari), walls: null };
        }
    }));
    return listed;
}

// ---------------------------------------------------------------- an archive

function filesUnder(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
    });
}

/** The extractors of `archive`, by its name, with their arguments: the first on the PATH that takes it extracts it. */
function extractors(archive: string, into: string): [string, string[]][] {
    const name = archive.toLowerCase();
    const tools: Record<string, [string, string[]]> = {
        unzip: ['unzip', ['-qq', '-o', archive, '-d', into]],
        tar: ['tar', ['-xf', archive, '-C', into]],
        unrar: ['unrar', ['x', '-o+', '-inul', archive, `${into}/`]],
        '7z': ['7z', ['x', '-y', `-o${into}`, archive]],
        bsdtar: ['bsdtar', ['-xf', archive, '-C', into]],
    };
    const order = name.endsWith('.zip') ? ['unzip', '7z', 'bsdtar']
        : /\.(tar|tgz|tar\.gz|tar\.bz2|tar\.xz)$/.test(name) ? ['tar', 'bsdtar', '7z']
        : name.endsWith('.rar') ? ['unrar', '7z', 'bsdtar']
        : ['7z', 'bsdtar'];
    return order.map((tool) => tools[tool]);
}

/** Whether a tool on the PATH can extract `archive`, asked before it is downloaded. */
function canExtract(archive: string): boolean {
    return extractors(archive, '').some(([tool]) => !spawnSync(tool, ['--help'], { stdio: 'ignore' }).error);
}

/** `archive` extracted into a new folder, or `null` where no extractor takes it. */
function extract(archive: string): string | null {
    const into = mkdtempSync(join(scratch, 'x-'));
    for (const [tool, args] of extractors(archive, into)) {
        const run = spawnSync(tool, args, { stdio: 'ignore' });
        if (run.error) continue;
        if (run.status === 0 || filesUnder(into).length > 0) return into;
    }
    console.log(`  No extractor takes ${basename(archive)}.`);
    return null;
}

/** The dungeons `dir` holds, each with the game files that go with it. */
async function findDungeons(dir: string): Promise<Found[]> {
    const told: { path: string; kind: Exclude<LocalDataSetFile, 'thumbnail'>; bytes: Uint8Array<ArrayBuffer>; pc: boolean }[] = [];
    for (const path of filesUnder(dir)) {
        if (NOT_GAME_FILES.has(extname(path).toLowerCase()) || statSync(path).size > MAX_FILE_BYTES) continue;
        const read = new Uint8Array(readFileSync(path));
        const atari = bigEndianDungeonDat(read);
        const kind = await identifyLocalDataSetFile(new Blob([atari ?? read]));
        if (kind) told.push({ path: relative(dir, path), kind, bytes: atari ?? read, pc: atari !== null });
    }
    /** The file of `kind` beside `path`, else in the nearest folder above it, else the archive's one. */
    const beside = (path: string, kind: LocalDataSetFile): string | undefined => {
        const all = told.filter((file) => file.kind === kind);
        for (let folder = dirname(path); ; folder = dirname(folder)) {
            const here = all.find((file) => dirname(file.path) === folder);
            if (here) return here.path;
            if (folder === '.' || folder === '/') break;
        }
        return all.length === 1 ? all[0].path : undefined;
    };
    return told.filter((file) => file.kind === 'dungeon.dat').map((file) => {
        const files: Found['files'] = {};
        for (const kind of ['graphics.dat', 'CSBgraphics.dat'] as const) {
            const path = beside(file.path, kind);
            if (path) files[kind] = path;
        }
        const hct = told.find((other) => other.kind === 'hcsb.hct' && dirname(other.path) === dirname(file.path));
        const dat = told.find((other) => other.kind === 'hcsb.dat' && dirname(other.path) === dirname(file.path));
        if (hct && dat) Object.assign(files, { 'hcsb.hct': hct.path, 'hcsb.dat': dat.path });
        const levels = new DungeonLoader().loadDungeonDat(file.bytes).maps.length;
        return { path: file.path, dungeon: file.bytes, pc: file.pc, levels, files };
    });
}

const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * How likely `path` is the one to play in CSBWin: a CSBWin build or the latest one first, a
 * PC or another system's build after, and an archive of guides, sources, screenshots or old attempts last.
 */
function preference(path: string, pc = false): number {
    return (/csb/i.test(path) ? 1 : 0) + (/late?st/i.test(path) ? 3 : 0)
        + (/\bpc\b|dm ?pc|pc-/i.test(path) || pc ? -1 : 0) + (/linux|raspbian|windowsce|amiga/i.test(path) ? -1 : 0)
        + (/guide|information|sources?\b|screenshot|replay/i.test(path) ? -3 : 0) + (/\bold\b|attempt|backup/i.test(path) ? -2 : 0);
}

/** Which of `items` (shown by `label`) the player picks, one or several; `fallback` on Enter. */
async function pick<T>(what: string, items: T[], label: (item: T) => string, fallback: number, several: boolean): Promise<T[]> {
    if (items.length === 1) return items;
    console.log(`  ${items.length} ${what}:`);
    items.forEach((item, i) => console.log(`   ${String(i + 1).padStart(2)}. ${label(item)}`));
    const prompt = several ? `  Which (1-${items.length}, several as 1,3; 0 none) [${fallback + 1}]? ` : `  Which (1-${items.length}, 0 none) [${fallback + 1}]? `;
    for (;;) {
        const answer = await ask(prompt);
        if (answer === '') return [items[fallback]];
        const picked = answer.split(/[\s,]+/).map(Number);
        if (picked.length === 1 && picked[0] === 0) return [];
        if ((several || picked.length === 1) && picked.every((n) => Number.isInteger(n) && n >= 1 && n <= items.length)) return picked.map((n) => items[n - 1]);
    }
}

/** The index in `items` with the highest `score`, the last of them by natural order. */
function preferred<T>(items: T[], name: (item: T) => string, score: (item: T) => number): number {
    let best = 0;
    items.forEach((item, i) => {
        const [a, b] = [score(item), score(items[best])];
        if (a > b || (a === b && natural(name(item), name(items[best])) > 0)) best = i;
    });
    return best;
}

// ---------------------------------------------------------------- a submission

interface Submission {
    name: string;
    authors: string[];
    description: string;
}

/** The ids this run submitted (or a dry run would have), which the instance's list read at the start does not hold. */
const submitted = new Set<string>();

/** `found` checked as the form checks it, its thumbnail drawn, and sent; `false` where the run must stop. */
async function submit(found: Found, root: string, text: Submission, sets: DataSet[]): Promise<boolean> {
    const id = idOf(text.name);
    if (!LOCAL_ID_PATTERN.test(id)) {
        console.log(`  Cannot make an id of '${text.name}': skipped.`);
        return true;
    }
    if (sets.some((set) => set.id === id) || submitted.has(id)) {
        console.log(`  The instance already has a set '${id}': skipped.`);
        return true;
    }
    const others = await listedDungeons(sets);
    const twin = others.find((other) => other.bytes === sha256(found.dungeon));
    if (twin) {
        console.log(`  Its dungeon.dat is '${twin.set.name}'s: skipped.`);
        return true;
    }

    const files: LocalDataSetDraft['files'] = { 'dungeon.dat': new Blob([found.dungeon]) };
    for (const [kind, path] of Object.entries(found.files)) files[kind as LocalDataSetFile] = new Blob([new Uint8Array(readFileSync(join(root, path)))]);
    const base = (set: string): DataSetFiles | null => {
        const listedSet = sets.find((s) => s.id === set);
        return listedSet ? { read: (name) => instanceFile(listedSet, name), where: (name) => `${listedSet.dir}/${name}` } : null;
    };
    let baseSet = BASE_SETS[0];
    let checked = await checkLocalDataSet({ id, ...text, dmRules: true, thumbnailAsTitle: false, official: false, baseSet, files }, new Set(), base, Date.now());
    if (!files['graphics.dat'] && checked.problems.some((problem) => problem.about === 'baseSet')) {
        baseSet = BASE_SETS[1];
        checked = await checkLocalDataSet({ id, ...text, dmRules: true, thumbnailAsTitle: false, official: false, baseSet, files }, new Set(), base, Date.now());
    }
    if (!checked.record) {
        console.log('  It does not pass the check:');
        for (const problem of checked.problems) console.log(`    ${problem.about}: ${problem.text}`);
        return true;
    }
    const walls = others.find((other) => other.walls !== null && other.walls === checked.record!.dungeonSignature.join());
    if (walls && (await ask(`  It has the walls of '${walls.set.name}' (a mod, or another version). Submit all the same [y/N]? `)).toLowerCase() !== 'y') return true;

    const graphics = files['graphics.dat'] ? new Uint8Array(await files['graphics.dat'].arrayBuffer()) : await base(baseSet)?.read('graphics.dat');
    try {
        const loader = new GraphicsLoader();
        loader.loadFromArray(graphics!);
        files.thumbnail = new Blob([await thumbnailPng(await lastTitleFrame(loader))], { type: 'image/png' });
    } catch (error) {
        console.log(`  No thumbnail: ${error instanceof Error ? error.message : String(error)}`);
    }

    const body = new FormData();
    body.append('id', id);
    body.append('name', text.name);
    body.append('description', text.description);
    for (const author of text.authors) body.append('authors', author);
    body.append('dmRules', 'true');
    body.append('thumbnailAsTitle', 'false');
    body.append('official', 'false');
    body.append('baseSet', baseSet);
    for (const [kind, blob] of Object.entries(files)) body.append(kind, blob!, kind === 'thumbnail' ? 'thumbnail.png' : kind);
    const sent = Object.keys(files).filter((kind) => kind !== 'thumbnail').join(', ');
    const graphicsSaid = `${files['graphics.dat'] ? '' : `, ${baseSet}'s graphics`}${files.thumbnail ? ', a thumbnail' : ''}`;
    if (dryRun) {
        console.log(`  Dry run: would submit '${id}' (${sent}${graphicsSaid}).`);
        submitted.add(id);
        return true;
    }

    const response = await fetch(`${instance}/${DATA_SETS_ROUTE}`, { method: 'POST', headers: { [PLAYER_ID_HEADER]: player }, body });
    const answer = await response.json().catch(() => null) as { id?: string; error?: string; problems?: { about: string; text: string }[] } | null;
    if (response.status === 201) {
        console.log(`  Submitted as '${answer?.id ?? id}' (${sent}${graphicsSaid}), pending a moderator.`);
        submitted.add(id);
        return true;
    }
    console.log(`  Refused, HTTP ${response.status}: ${answer?.error ?? '(no answer)'}`);
    for (const problem of answer?.problems ?? []) console.log(`    ${problem.about}: ${problem.text}`);
    return response.status !== 429;
}

/** `candidate`'s files downloaded and submitted, once the player said yes; `false` where the run must stop. */
async function download(candidate: Candidate, text: Submission, sets: DataSet[]): Promise<boolean> {
    const archives = (await oneDriveFiles(candidate.folder!)).sort((a, b) => natural(a.path, b.path));
    if (archives.length === 0) {
        console.log('  Its folder is empty.');
        return true;
    }
    const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
    const [archive] = await pick('archives', archives, (a) => `${a.path}  (${megabytes(a.item.size)})`,
        preferred(archives, (a) => a.path, (a) => preference(a.path)), false);
    if (!archive) return true;
    if (!canExtract(archive.item.name)) {
        console.log(`  Nothing here extracts ${archive.item.name}: install 7z, unrar or bsdtar.`);
        return true;
    }
    console.log(`  Downloading ${archive.path} (${megabytes(archive.item.size)})…`);
    const local = join(mkdtempSync(join(scratch, 'a-')), archive.item.name);
    writeFileSync(local, new Uint8Array(await (await fetchOk(archive.item['@content.downloadUrl']!)).arrayBuffer()));
    const root = extract(local);
    if (!root) return true;
    // A CSBWin save reads as a dungeon of no level.
    const found = (await findDungeons(root)).filter((f) => f.levels > 0).sort((a, b) => natural(a.path, b.path));
    if (found.length === 0) {
        console.log('  It holds no dungeon.dat the port reads (a save, or another engine\'s files).');
        return true;
    }
    const describe = (f: Found) => `${f.path}  (${f.pc ? 'PC, ' : ''}${f.levels} level${f.levels === 1 ? '' : 's'}${
        Object.keys(f.files).length > 0 ? `, with ${Object.values(f.files).map((path) => basename(path)).join(', ')}` : ''})`;
    const chosen = await pick('dungeons', found, describe, preferred(found, (f) => f.path, (f) => preference(f.path, f.pc)), true);
    for (const dungeon of chosen) {
        let name = text.name;
        if (chosen.length > 1) {
            const suggested = `${text.name} - ${basename(dungeon.path, extname(dungeon.path))}`.slice(0, LOCAL_DATA_SET_TEXT_LIMITS.name);
            name = (await ask(`  Name of ${dungeon.path} [${suggested}]: `, suggested)) || suggested;
        }
        if (!await submit(dungeon, root, { ...text, name }, sets)) return false;
    }
    return true;
}

// ---------------------------------------------------------------- the run

async function main(): Promise<void> {
    console.log(`Reading the forum's list, the shared OneDrive and ${instance}'s sets…`);
    const [entries, folders, sets] = await Promise.all([forumCandidates(), oneDriveDungeons(), instanceSets()]);
    const listedNames = sets.map((set) => comparable(set.name));
    const candidates: Candidate[] = [];
    for (const entry of entries) {
        const name = comparable(entry.name);
        const folder = folders.get(name) ?? null;
        const already = sets.find((_, i) => listedNames[i].startsWith(name));
        if (already) console.log(`- ${entry.name}: the instance has '${already.name}'.`);
        else if (!folder) console.log(`- ${entry.name}: the shared OneDrive has no files for it.`);
        else candidates.push({ ...entry, folder });
    }
    console.log(`${candidates.length} of the forum's ${entries.length} CSBWin dungeons to offer.`);

    for (const [i, candidate] of candidates.entries()) {
        const text: Submission = {
            name: candidate.name.slice(0, LOCAL_DATA_SET_TEXT_LIMITS.name),
            authors: candidate.authors,
            description: await topicDescription(candidate.topic).catch(() => ''),
        };
        for (;;) {
            console.log(`\n[${i + 1}/${candidates.length}] ${text.name}  [${candidate.engines}]`);
            console.log(`  Authors:     ${text.authors.join(', ') || '(none)'}`);
            console.log(`  Description: ${text.description || '(none)'}`);
            if (candidate.topic) console.log(`  Topic:       ${candidate.topic}`);
            const answer = (await ask('  Submit it? [y]es, [n]o, [e]dit description, edit [a]uthors, [q]uit: ')).toLowerCase();
            if (answer === 'q') return;
            if (answer === 'n') break;
            if (answer === 'e') text.description = fitSentences(await ask('  Description: ', text.description), LOCAL_DATA_SET_TEXT_LIMITS.description);
            if (answer === 'a') text.authors = splitAuthors(await ask('  Authors: ', text.authors.join(', ')));
            if (text.authors.join(',').length > LOCAL_DATA_SET_TEXT_LIMITS.authors) {
                console.log(`  The authors are longer than ${LOCAL_DATA_SET_TEXT_LIMITS.authors} characters: edit them.`);
                continue;
            }
            if (answer !== 'y') continue;
            const goOn = await download(candidate, text, sets).catch((error: unknown) => {
                console.log(`  Failed: ${error instanceof Error ? error.message : String(error)}`);
                return true;
            });
            if (!goOn) {
                console.log('\nThe server takes five publishes an hour from one address: run this again in an hour.');
                return;
            }
            break;
        }
    }
}

await main();
rl.close();
