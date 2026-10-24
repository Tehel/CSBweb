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
 * For each set the table does not hold (by id, or by folder), the script shows its name,
 * authors and description, and asks:
 *
 *   y  yes: copy its folder to `<DEPLOY_DIR>/gamefiles/<dir>/`, then write its row
 *   n  no, next
 *   r  rename it, then ask again
 *   e  edit the description, then ask again
 *   a  edit the authors (comma-separated), then ask again
 *   q  quit
 *
 * The folder holds the files the set's archive names (`archiveFiles`), its thumbnail and,
 * where the fetched folder has one, `utility-portraits.dat`; nothing else of the fetched
 * folder, since everything under `gamefiles/` can be downloaded. The rows are written by
 * the container's Node through `node:sqlite`, the server's own store, which takes them at
 * once: no restart.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { archiveFiles } from '../src/data/DataSetArchive';
import { LOCAL_DATA_SET_TEXT_LIMITS, parseManifest, type DataSet } from '../src/data/DataSets';
import { UTILITY_PORTRAITS_FILE } from '../src/data/UtilityPortraits';
import { GAMEFILES_DIR, MANIFEST_FILE } from '../tools/lib/dataSets';

/** The authors an official set is offered with: FTL's own games, by the manifest's `official`. */
const OFFICIAL_AUTHORS = ['FTL Games'];

interface Text {
    name: string;
    description: string;
    authors: string[];
}

/** What the instance's table holds, as far as this script asks. */
interface Instance {
    ids: string[];
    dirs: string[];
    defaultSet: string | null;
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
const rows = db.prepare('SELECT id, dir FROM data_sets').all();
const defaults = db.prepare('SELECT default_set FROM data_set_defaults').get();
console.log(JSON.stringify({ ids: rows.map((row) => row.id), dirs: rows.map((row) => row.dir), defaultSet: defaults ? defaults.default_set : null }));`)) as Instance;
}

/** The files of `set`'s fetched folder that go to the instance; the run ends on one it needs that is not there. */
function setFiles(set: DataSet): string[] {
    const local = join(GAMEFILES_DIR, set.dir);
    const files = archiveFiles(set).map(({ file }) => file);
    if (existsSync(join(local, UTILITY_PORTRAITS_FILE))) files.push(UTILITY_PORTRAITS_FILE);
    const missing = files.filter((file) => !existsSync(join(local, file)));
    if (missing.length > 0) fail(`${local} lacks ${missing.join(', ')}: run npm run fetch-gamefiles first.`);
    return files;
}

/** `set`'s folder copied to the instance's `gamefiles/`, its files over any of the same name. */
function copyFolder(set: DataSet, files: string[]): void {
    const tar = spawnSync('tar', ['-C', join(GAMEFILES_DIR, set.dir), '-cf', '-', ...files], { maxBuffer: 1 << 28 });
    if (tar.status !== 0) fail(`tar: ${tar.stderr.toString().trim()}`);
    const target = quoted(`gamefiles/${set.dir}`);
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

// ---------------------------------------------------------------- the run

async function main(): Promise<void> {
    const manifest = parseManifest(readFileSync(MANIFEST_FILE, 'utf8'), '');
    const sets = manifest.dataSets.filter((set) => set.official);
    const files = new Map(sets.map((set) => [set.id, setFiles(set)]));

    console.log(`Reading ${host}:${deployDir}'s sets…`);
    const instance = readInstance();
    for (const [i, set] of sets.entries()) {
        if (instance.ids.includes(set.id)) {
            console.log(`- ${set.name}: the instance has '${set.id}'.`);
            continue;
        }
        if (instance.dirs.includes(set.dir)) {
            console.log(`- ${set.name}: a set of the instance's is in gamefiles/${set.dir}/: skipped.`);
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
            instance.ids.push(set.id);
            break;
        }
    }

    const wanted = manifest.defaultSet?.id ?? null;
    if (instance.defaultSet !== null) console.log(`\nThe default set is '${instance.defaultSet}'.`);
    else if (wanted !== null && instance.ids.includes(wanted)) {
        if (dryRun) console.log(`\nDry run: would make '${wanted}' the default set.`);
        else {
            writeDefault(wanted);
            console.log(`\n'${wanted}' is the default set, the one the welcome page selects on a first visit.`);
        }
    } else console.log('\nThe instance has no default set: the welcome page selects none on a first visit (doc/DEPLOYMENT.md).');
}

await main();
rl.close();
