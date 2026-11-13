/**
 * Install FTL's own games on a CSBweb instance as the site's sets, over SSH: the sets of
 * the repository's manifest (`tools/data-sets.json`) marked `official`, their files taken
 * from `tools/fixtures/gamefiles/` (`npm run fetch-gamefiles`). It does by script what
 * `doc/DEPLOYMENT.md` → "Writing the site's sets" does by hand, and `doc/SETUP.md` runs it.
 *
 * Run:
 *
 *   npx tsx utils/install-official-sets.ts [--dry-run]
 *
 * The target is the local `.env`'s, as for `utils/deploy.sh`: `DEPLOY_HOST`, the SSH
 * destination, and `DEPLOY_DIR`, the stack's folder there, whose container must be running
 * (`npm run deploy`). `--dry-run` reads the instance's table and asks, but copies and writes
 * nothing.
 *
 * Not through `POST api/data-sets`, as `utils/submit-forum-dungeons.ts` offers the fans'
 * dungeons: a published set has an owner, and only an owner-less set is a base set, whose
 * `graphics.dat` a player's set without one plays (`siteSet`, `server/publish.ts`); and a
 * publish carries no `mini.dat`, which CSB's entrance needs for RISE, nor
 * `utility-portraits.dat`. Here each set is a row with no owner, approved, its flags the
 * manifest's, `official` and `hidden` included, last in the list; and the manifest's
 * default set is made the instance's where it has none.
 *
 * A set is installed where a row of the instance holds its game files, byte for byte,
 * whatever its id (`holding`, `tools/lib/officialSets.ts`): the instance's own sets may
 * have been written by hand under ids of their own. A set whose id the instance gives other
 * files, or whose folder another set has, is named and not offered. For each other set,
 * the script shows its name, authors and description, and asks:
 *
 *   y  yes: copy its folder to `<DEPLOY_DIR>/gamefiles/<dir>/`, then write its row
 *   n  no, next
 *   r  rename it, then ask again
 *   e  edit the description, then ask again
 *   a  edit the authors (comma-separated), then ask again
 *   q  quit
 *
 * The folder holds the files the set's archive names (`archiveFiles`), its thumbnail and,
 * where the fetched folder has them, `utility-portraits.dat` and `achievements.txt`, the
 * set's achievements (`doc/ACHIEVEMENTS.md` → "The file"); nothing else of the fetched
 * folder, since everything under `gamefiles/` can be downloaded. A set the instance holds
 * already whose `achievements.txt` is not the fetched folder's is offered that file alone:
 * the repository's are edited after a set is installed. The rows are written by
 * the container's Node through `node:sqlite`, the server's own store, which takes them at
 * once: no restart. At its end it names the instance's duplicates, the sets that hold the
 * same files under several ids, which it never removes: that is the author's, on the
 * server, once nothing names the duplicate (its recordings, statistics, documents and
 * defaults, and the saves in players' browsers).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { archiveFiles } from '../src/data/DataSetArchive';
import { LOCAL_DATA_SET_TEXT_LIMITS, parseManifest, type DataSet } from '../src/data/DataSets';
import { UTILITY_PORTRAITS_FILE } from '../src/data/UtilityPortraits';
import { GAMEFILES_DIR, MANIFEST_FILE } from '../tools/lib/dataSets';

/** A set's own achievements, in its folder (`doc/ACHIEVEMENTS.md` → "The file"), which `fetch-gamefiles` copies into each official set's. */
const ACHIEVEMENTS_FILE = 'achievements.txt';
import { duplicates, GAME_FILES, gameFilesOf, holding, type GameDigests, type InstanceSet } from '../tools/lib/officialSets';

/** The authors an official set is offered with: FTL's own games, by the manifest's `official`. */
const OFFICIAL_AUTHORS = ['FTL Games'];

interface Text {
    name: string;
    description: string;
    authors: string[];
}

/** What the instance's table holds, as far as this script asks: its sets in their order, their files' digests read in its `gamefiles/`. */
interface Instance {
    rows: InstanceSet[];
    defaultSet: string | null;
    /** The SHA-256 of each row's `achievements.txt`, by its id, `null` where its folder has none. */
    achievements: Record<string, string | null>;
}

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
if (process.argv.slice(2).some((arg) => arg !== '--dry-run')) fail('usage: npx tsx utils/install-official-sets.ts [--dry-run]');

/** The local `.env`'s variables, `KEY=VALUE` lines as `deploy.sh`'s bash reads them, quotes around a value dropped. */
function readEnv(): Record<string, string> {
    if (!existsSync('.env')) fail('No .env here: copy .env.template to .env and fill in DEPLOY_HOST and DEPLOY_DIR (doc/SETUP.md).');
    const env: Record<string, string> = {};
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (match) env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return env;
}

const env = readEnv();
const host = env.DEPLOY_HOST || fail('DEPLOY_HOST is not set in .env');
const deployDir = env.DEPLOY_DIR || fail('DEPLOY_DIR is not set in .env');
if (!deployDir.startsWith('/')) fail('DEPLOY_DIR must be absolute');

/** `text` quoted for the remote shell. */
const quoted = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;
/** Compose v1's `docker-compose` where the server has it, else v2's `docker compose`, as `deploy.sh` picks. */
const COMPOSE = 'compose() { if command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"; else docker compose "$@"; fi; }';

/** `command` run in `DEPLOY_DIR` over SSH, `input` its stdin; its stdout, or the run ends where it fails. */
function remote(command: string, input: string | Buffer = ''): string {
    const run = spawnSync('ssh', [host, `cd ${quoted(deployDir)} && ${COMPOSE} && ${command}`], { input, maxBuffer: 1 << 28 });
    if (run.error) fail(`ssh: ${run.error.message}`);
    if (run.status !== 0) fail(`On ${host}, '${command}' failed:\n${run.stderr.toString().trim()}`);
    return run.stdout.toString();
}

/** `program`, CommonJS, run by the container's Node on its store; what it prints. */
function inStore(program: string): string {
    const script = `const db = new (require('node:sqlite').DatabaseSync)(process.env.STATS_DB);\ndb.exec('PRAGMA busy_timeout = 5000');\n${program}\ndb.close();\n`;
    return remote('compose exec -T csbweb node --disable-warning=ExperimentalWarning --input-type=commonjs -', script);
}

function readInstance(): Instance {
    return JSON.parse(inStore(`
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const digest = (dir, name) => { try { return createHash('sha256').update(readFileSync(process.env.GAMEFILES_DIR + '/' + dir + '/' + name)).digest('hex'); } catch { return null; } };
const names = ${JSON.stringify(GAME_FILES)};
const rows = db.prepare('SELECT id, dir, csb_graphics, mini_dat FROM data_sets ORDER BY position').all().map((row) => ({ id: row.id, dir: row.dir,
    files: Object.fromEntries(names.map((name) => [name, (name === 'CSBgraphics.dat' && !row.csb_graphics) || (name === 'mini.dat' && !row.mini_dat) ? null : digest(row.dir, name)])) }));
const defaults = db.prepare('SELECT default_set FROM data_set_defaults').get();
const achievements = Object.fromEntries(rows.map((row) => [row.id, digest(row.dir, ${JSON.stringify(ACHIEVEMENTS_FILE)})]));
console.log(JSON.stringify({ rows, defaultSet: defaults ? defaults.default_set : null, achievements }));`)) as Instance;
}

/** `set`'s game files in its fetched folder, by name. */
function localDigests(set: DataSet): GameDigests {
    const named = gameFilesOf(set);
    return Object.fromEntries(GAME_FILES.map((name) => [name, named.includes(name)
        ? createHash('sha256').update(readFileSync(join(GAMEFILES_DIR, set.dir, name))).digest('hex') : null])) as GameDigests;
}

/** The files of `set`'s fetched folder that go to the instance; the run ends on one it needs that is not there. */
function setFiles(set: DataSet): string[] {
    const local = join(GAMEFILES_DIR, set.dir);
    const files = archiveFiles(set).map(({ file }) => file);
    for (const extra of [UTILITY_PORTRAITS_FILE, ACHIEVEMENTS_FILE]) if (existsSync(join(local, extra))) files.push(extra);
    const missing = files.filter((file) => !existsSync(join(local, file)));
    if (missing.length > 0) fail(`${local} lacks ${missing.join(', ')}: run npm run fetch-gamefiles first.`);
    return files;
}

/** `files` of `set`'s fetched folder copied to the instance's `gamefiles/<dir>/`, over any of the same name. */
function copyFolder(set: DataSet, files: string[], dir = set.dir): void {
    const tar = spawnSync('tar', ['-C', join(GAMEFILES_DIR, set.dir), '-cf', '-', ...files], { maxBuffer: 1 << 28 });
    if (tar.status !== 0) fail(`tar: ${tar.stderr.toString().trim()}`);
    const target = quoted(`gamefiles/${dir}`);
    remote(`mkdir -p ${target} && tar -C ${target} -xf -`, tar.stdout);
}

/** `set`'s row, the site's: no owner, approved, last in the list. */
function writeRow(set: DataSet, text: Text): void {
    const values = [set.id, text.name, text.description, JSON.stringify(text.authors), set.dir,
        ...[set.csbGraphics, set.miniDat, set.hintOracle, set.dmRules, set.thumbnailAsTitle, set.hidden, set.official].map(Number)];
    inStore(`
db.prepare("INSERT INTO data_sets (id, name, description, authors, dir, position, status, owner, csb_graphics, mini_dat, hint_oracle, dm_rules, thumbnail_as_title, hidden, official) "
    + "VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM data_sets), 'approved', NULL, ?, ?, ?, ?, ?, ?, ?)").run(...${JSON.stringify(values)});`);
}

function writeDefault(id: string): void {
    inStore(`db.prepare('INSERT INTO data_set_defaults (only, default_set) VALUES (1, ?)').run(${JSON.stringify(id)});`);
}

// ---------------------------------------------------------------- the questions

const rl = createInterface({ input: stdin, output: stdout });
// The answers, queued as they come: piped ones arrive before their questions.
const answers: string[] = [];
let answered: ((line: string | null) => void) | null = null;
let ended = false;
/** `line` to the question waiting, once: a chunk's lines arrive together, and the next ones wait for their questions. */
function answer(line: string | null): void {
    const waiting = answered;
    answered = null;
    if (waiting) waiting(line);
    else if (line !== null) answers.push(line);
}
rl.on('line', answer);
rl.on('close', () => {
    ended = true;
    answer(null);
});

/** The answer to `question`, `prefill` ready to edit on a terminal. The end of the input ends the run. */
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

/** Whether `text` fits the form's limits, so that a moderator's pen can edit it later; says what does not. */
function fits(text: Text): boolean {
    const over = (['name', 'description', 'authors'] as const).filter((field) =>
        (field === 'authors' ? text.authors.join(',') : text[field]).length > LOCAL_DATA_SET_TEXT_LIMITS[field]);
    for (const field of over) console.log(`  The ${field} is longer than ${LOCAL_DATA_SET_TEXT_LIMITS[field]} characters: edit it.`);
    return over.length === 0 && text.name !== '';
}

/**
 * The fetched folder's `achievements.txt` offered to `as`, the instance's row that holds
 * `set`'s files, where its own is not the same; whether the run goes on.
 */
async function offerAchievements(set: DataSet, as: string, instance: Instance): Promise<'next' | 'quit'> {
    const local = join(GAMEFILES_DIR, set.dir, ACHIEVEMENTS_FILE);
    if (!existsSync(local)) return 'next';
    const digest = createHash('sha256').update(readFileSync(local)).digest('hex');
    const theirs = instance.achievements[as] ?? null;
    if (theirs === digest) return 'next';
    const dir = instance.rows.find((row) => row.id === as)!.dir;
    for (;;) {
        const answer = (await ask(`  Its ${ACHIEVEMENTS_FILE} ${theirs === null ? 'is missing' : 'differs'} on the instance: copy it to gamefiles/${dir}/? [y]es, [n]o, [q]uit: `)).toLowerCase();
        if (answer === 'q') return 'quit';
        if (answer === 'n') return 'next';
        if (answer !== 'y') continue;
        if (dryRun) console.log(`  Dry run: would copy ${ACHIEVEMENTS_FILE} to gamefiles/${dir}/.`);
        else {
            copyFolder(set, [ACHIEVEMENTS_FILE], dir);
            console.log(`  Copied ${ACHIEVEMENTS_FILE} to gamefiles/${dir}/.`);
        }
        instance.achievements[as] = digest;
        return 'next';
    }
}

// ---------------------------------------------------------------- the run

async function main(): Promise<void> {
    const manifest = parseManifest(readFileSync(MANIFEST_FILE, 'utf8'), '');
    const sets = manifest.dataSets.filter((set) => set.official);
    const files = new Map(sets.map((set) => [set.id, setFiles(set)]));

    console.log(`Reading ${host}:${deployDir}'s sets…`);
    const instance = readInstance();
    for (const [i, set] of sets.entries()) {
        const digests = localDigests(set);
        const held = holding({ id: set.id, dir: set.dir, files: digests }, instance.rows);
        if (held.kind === 'installed') {
            console.log(`- ${set.name}: the instance has its files${held.as === set.id ? '' : ' as'} '${held.as}'.`);
            if (await offerAchievements(set, held.as, instance) === 'quit') return;
            continue;
        }
        if (held.kind === 'id-taken') {
            console.log(`- ${set.name}: the instance's '${set.id}' holds other files: not offered.`);
            continue;
        }
        if (held.kind === 'dir-taken') {
            console.log(`- ${set.name}: the instance's '${held.by}' is in gamefiles/${set.dir}/: not offered.`);
            continue;
        }
        const text: Text = { name: set.name, description: set.description, authors: set.authors.length > 0 ? [...set.authors] : OFFICIAL_AUTHORS };
        for (;;) {
            console.log(`\n[${i + 1}/${sets.length}] ${text.name}  (${set.id}, gamefiles/${set.dir}/${set.hidden ? ', hidden' : ''})`);
            console.log(`  Authors:     ${text.authors.join(', ') || '(none)'}`);
            console.log(`  Description: ${text.description || '(none)'}`);
            console.log(`  Files:       ${files.get(set.id)!.join(', ')}`);
            const answer = (await ask('  Install it? [y]es, [n]o, [r]ename, [e]dit description, edit [a]uthors, [q]uit: ')).toLowerCase();
            if (answer === 'q') return;
            if (answer === 'n') break;
            if (answer === 'r') text.name = await ask('  Name: ', text.name);
            if (answer === 'e') text.description = await ask('  Description: ', text.description);
            if (answer === 'a') text.authors = (await ask('  Authors: ', text.authors.join(', '))).split(',').map((author) => author.trim()).filter((author) => author !== '');
            if (answer !== 'y' || !fits(text)) continue;
            if (dryRun) console.log(`  Dry run: would copy gamefiles/${set.dir}/ and write '${set.id}'.`);
            else {
                copyFolder(set, files.get(set.id)!);
                writeRow(set, text);
                console.log(`  Installed '${set.id}', approved${set.hidden ? ' and hidden' : ''}.`);
            }
            instance.rows.push({ id: set.id, dir: set.dir, files: digests });
            instance.achievements[set.id] = existsSync(join(GAMEFILES_DIR, set.dir, ACHIEVEMENTS_FILE))
                ? createHash('sha256').update(readFileSync(join(GAMEFILES_DIR, set.dir, ACHIEVEMENTS_FILE))).digest('hex') : null;
            break;
        }
    }

    const wanted = manifest.defaultSet?.id ?? null;
    if (instance.defaultSet !== null) console.log(`\nThe default set is '${instance.defaultSet}'.`);
    else if (wanted !== null && instance.rows.some((row) => row.id === wanted)) {
        if (dryRun) console.log(`\nDry run: would make '${wanted}' the default set.`);
        else {
            writeDefault(wanted);
            console.log(`\n'${wanted}' is the default set, the one the welcome page selects on a first visit.`);
        }
    } else console.log('\nThe instance has no default set: the welcome page selects none on a first visit (doc/DEPLOYMENT.md).');

    const twice = duplicates(instance.rows);
    if (twice.length > 0) {
        console.log('\nThe instance holds the same files under several ids, which this script does not remove:');
        for (const ids of twice) console.log(`  ${ids.join(', ')}`);
    }
}

await main();
rl.close();
