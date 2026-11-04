/**
 * Migrate a CSBweb instance's shared recordings from the package of version 1 or 2 to version 3
 * (`DEBT.md` R19, `doc/RECORDING.md` → "Shared recordings"), which the page reads alone: each
 * package rewritten with the same content, its branches' save files and its save shared
 * named by their MD5, its changes' clock and stream kept every 64th change and at each
 * recording's last. It keeps a private copy of version 2's reader (`readOld`), which read
 * version 1's too, written before levels, each recording of level 0 naming no files, and
 * the page no longer has.
 *
 * Run it from a commit whose build reads version 3, before that build is deployed: the
 * deploy's gate (`utils/replay-recordings.ts`) reads the instance's packages with it, and
 * refuses one of an earlier version.
 *
 *   npx tsx utils/migrate-recording-packages.ts [--dry-run]
 *   npx tsx utils/migrate-recording-packages.ts --file <package.gz>…
 *
 * The target is the local `.env`'s, as for `utils/deploy.sh`: `DEPLOY_HOST` and
 * `DEPLOY_DIR`, the SSH destination and the stack's folder, whose container must be
 * running; `DEPLOY_INSTANCE`, its URL, and `DEPLOY_PLAYER`, a moderator's `playerId`, to
 * whom the manifest lists every set. The packages are read and written by the container's
 * Node, in `RECORDINGS_DIR` as the server and `server/backup.ts` find it, and the rows in
 * its store through `node:sqlite`, as `utils/install-official-sets.ts` writes them.
 *
 * For each recording of the store's `recordings` table, it shows its id, title, set, state
 * and size, and asks:
 *
 *   y  yes: its package downloaded, converted, the version 3 read back by the page's
 *      reader and played to its point over the instance's files (`playOver`), then put
 *      in place of the old one, and its row's `size` set to the new file's
 *   n  no, next
 *   q  quit
 *
 * A package that is of version 3 already is left alone. One whose version 3 does not play
 * to its point is not replaced, and the run says whether its old version played; but a
 * recording broken already (`broken`), which the gate plays no more, is replaced once its
 * version 3 reads. The old file is kept in `<BACKUP_DIR>/recordings-old/<id>.gz`, moved
 * there from `<BACKUP_DIR>/recordings/` where the nightly backup had copied it, so that
 * the next backup copies the new one (`doc/DEPLOYMENT.md` → "Backups"). `--dry-run` does
 * everything but the replacement.
 *
 * `--file` converts the packages named on the command line in place, without playing
 * them: the corpus's (`tools/fixtures/recordings/`), which `recording-corpus.ts` plays.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { fileDigest } from '../src/data/DataSetFiles';
import { PLAYER_ID_HEADER } from '../src/data/DataSets';
import type { Recording, RecordingStart } from '../src/engine/Recorder';
import {
    packaged, readRecordingPackage, RECORDING_PACKAGE_VERSION, writeRecordingPackage, type RecordingPackage, type RecordingPackageInfo,
} from '../src/engine/RecordingPackage';
import { playPath } from '../tools/lib/playback';
import { driftText, playOver, readInstance, type Instance } from './lib/instanceRecordings';

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

/* ------------------------------------------------- versions 1 and 2 ---- */

/**
 * A package of version 1 or 2 as version 2's reader read it: the path whole, each
 * recording as the store holds it (a branch's start its save's file, each change with its
 * clock and stream), and the save shared as its file.
 */
interface OldPackage {
    readonly build: string;
    readonly level: number;
    readonly dataSet: string;
    readonly info: RecordingPackageInfo;
    readonly path: readonly Recording[];
    readonly shared: { readonly kind: 'save'; readonly file: Uint8Array; readonly inVbl: boolean } | { readonly kind: 'end' };
}

/**
 * The package of version 1 or 2 `bytes` hold, or the version they hold where it is
 * another. Its fields are taken as version 2's writer wrote them, their files from base64,
 * and one of version 1's as version 2's reader took it: written before levels, the package
 * and each recording of level 0, each naming no files. The form is checked by version 3's
 * writer and reader, which the converted package goes through.
 */
async function readOld(bytes: Uint8Array): Promise<{ old: OldPackage } | { version: unknown }> {
    const text = await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const json: any = JSON.parse(text);
    if (json?.version !== 1 && json?.version !== 2) return { version: json?.version };
    const leveled = json.version === 2;
    const startOf = (start: any): RecordingStart => (start.kind === 'save' ? { ...start, bytes: fromBase64(start.bytes) } : start);
    return { old: {
        build: json.build,
        level: leveled ? json.level : 0,
        dataSet: json.dataSet,
        info: json.info,
        // A recording written before profiles has none.
        path: (json.path as any[]).map((recording): Recording => ({
            ...recording, level: leveled ? recording.level : 0, profile: recording.profile ?? null, files: leveled ? recording.files : null, start: startOf(recording.start),
        })),
        shared: json.shared.kind === 'save' ? { kind: 'save', file: fromBase64(json.shared.file), inVbl: json.shared.inVbl } : { kind: 'end' },
    } };
}

function fromBase64(encoded: string): Uint8Array {
    return new Uint8Array(Buffer.from(encoded, 'base64'));
}

/** `old` as a package of version 3: its path as a package holds it (`packaged`), its save shared by its file's MD5. */
function toVersion3(old: OldPackage): RecordingPackage {
    const { build, level, dataSet, info, path, shared } = old;
    return {
        version: RECORDING_PACKAGE_VERSION, build, level, dataSet, info, path: packaged(path),
        shared: shared.kind === 'save' ? { kind: 'save', md5: fileDigest(shared.file), inVbl: shared.inVbl } : { kind: 'end' },
    };
}

/** Two packages the same, field for field, whatever the order of their keys. */
function samePackage(a: RecordingPackage, b: RecordingPackage): boolean {
    const json = (pkg: RecordingPackage) => JSON.stringify(pkg, (_, value: unknown) => (value instanceof Uint8Array ? [...value]
        : typeof value === 'object' && value !== null && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : value));
    return json(a) === json(b);
}

/**
 * `bytes`, a package of version 1 or 2, as the file of version 3, which the page's reader
 * reads back as the package converted; or why not: a package of another version, which it
 * names.
 */
async function convert(bytes: Uint8Array): Promise<{ old: OldPackage; v3: RecordingPackage; file: Uint8Array } | string> {
    const read = await readOld(bytes);
    if (!('old' in read)) {
        if (read.version !== RECORDING_PACKAGE_VERSION) return `of version ${JSON.stringify(read.version)}, which this script does not read`;
        const why = await readRecordingPackage(bytes).then(() => null, (error: unknown) => (error instanceof Error ? error.message : String(error)));
        return why === null ? `of version ${RECORDING_PACKAGE_VERSION} already` : `of version ${RECORDING_PACKAGE_VERSION}, but refused: ${why}`;
    }
    const v3 = toVersion3(read.old);
    const file = await writeRecordingPackage(v3);
    const back = await readRecordingPackage(file);
    if (!samePackage(back, v3)) throw new Error('version 3 does not read back as written');
    return { old: read.old, v3: back, file };
}

const kb = (bytes: number): string => `${Math.round(bytes / 1024).toLocaleString('en')} KB`;

/* ---------------------------------------------------------- --file ---- */

async function convertFiles(files: readonly string[]): Promise<void> {
    for (const name of files) {
        if (!existsSync(name)) fail(`No such file: ${name}`);
        const bytes = new Uint8Array(readFileSync(name));
        const converted = await convert(bytes);
        if (typeof converted === 'string') {
            console.log(`${name}: ${converted}, left alone`);
            continue;
        }
        writeFileSync(name, converted.file);
        console.log(`${name}: ${kb(bytes.length)} → ${kb(converted.file.length)}`);
    }
}

/* -------------------------------------------------------- instance ---- */

/** The local `.env`'s variables, `KEY=VALUE` lines as `deploy.sh`'s bash reads them, quotes around a value dropped. */
function readEnv(): Record<string, string> {
    if (!existsSync('.env')) fail('No .env here: copy .env.template to .env and fill it in (doc/SETUP.md).');
    const env: Record<string, string> = {};
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (match) env[match[1]!] = match[2]!.trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return env;
}

/** `text` quoted for the remote shell. */
const quoted = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;
/** Compose v1's `docker-compose` where the server has it, else v2's `docker compose`, as `deploy.sh` picks. */
const COMPOSE = 'compose() { if command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"; else docker compose "$@"; fi; }';

/**
 * The container's folders as `server/backup.ts` finds them: the store, the packages beside
 * it and the backups.
 */
const PATHS = `const fs = require('node:fs');
const path = require('node:path');
const stats = process.env.STATS_DB;
const dir = process.env.RECORDINGS_DIR ?? path.join(path.dirname(stats), 'recordings');
const backups = process.env.BACKUP_DIR ?? path.join(path.dirname(stats), 'backups');
`;

interface Row {
    id: string;
    dataSet: string;
    title: string;
    size: number;
    status: string;
    hidden: boolean;
    broken: boolean;
}

class Remote {
    constructor(private readonly host: string, private readonly deployDir: string) {}

    /** `program`, CommonJS, run by the container's Node, `input` its stdin; what it prints, or the run ends where it fails. */
    node(program: string, input: string | Uint8Array = ''): string {
        const command = `compose exec -T csbweb node --disable-warning=ExperimentalWarning --input-type=commonjs -e ${quoted(PATHS + program)}`;
        const run = spawnSync('ssh', [this.host, `cd ${quoted(this.deployDir)} && ${COMPOSE} && ${command}`], { input, maxBuffer: 1 << 28 });
        if (run.error) fail(`ssh: ${run.error.message}`);
        if (run.status !== 0) fail(`On ${this.host}, the container's node failed:\n${run.stderr.toString().trim()}`);
        return run.stdout.toString();
    }

    rows(): Row[] {
        return JSON.parse(this.node(`
const db = new (require('node:sqlite').DatabaseSync)(stats);
const rows = db.prepare('SELECT id, data_set, title, size, status, hidden, broken FROM recordings ORDER BY uploaded_at').all();
db.close();
console.log(JSON.stringify(rows.map((row) => ({ id: row.id, dataSet: row.data_set, title: row.title, size: row.size, status: row.status, hidden: row.hidden === 1, broken: row.broken === 1 }))));`)) as Row[];
    }

    read(id: string): Uint8Array {
        return fromBase64(this.node(`process.stdout.write(fs.readFileSync(path.join(dir, ${JSON.stringify(`${id}.gz`)})).toString('base64'));`));
    }

    /**
     * `file` in place of `id`'s package, which must still be the one whose MD5 is `was`;
     * the old one kept in the backups' `recordings-old/`, and its row's size set.
     */
    replace(id: string, was: string, file: Uint8Array): void {
        this.node(`
const name = ${JSON.stringify(`${id}.gz`)};
const live = path.join(dir, name);
const md5 = (bytes) => require('node:crypto').createHash('md5').update(bytes).digest('hex');
if (md5(fs.readFileSync(live)) !== ${JSON.stringify(was)}) throw new Error(name + ' changed since it was read');
const bytes = fs.readFileSync(0);
const kept = path.join(backups, 'recordings-old');
fs.mkdirSync(kept, { recursive: true });
const copied = path.join(backups, 'recordings', name);
if (!fs.existsSync(path.join(kept, name))) {
    if (fs.existsSync(copied)) fs.renameSync(copied, path.join(kept, name));
    else fs.copyFileSync(live, path.join(kept, name));
} else fs.rmSync(copied, { force: true });
const partial = path.join(dir, '.' + name + '.partial');
fs.writeFileSync(partial, bytes);
fs.renameSync(partial, live);
const db = new (require('node:sqlite').DatabaseSync)(stats);
db.exec('PRAGMA busy_timeout = 5000');
db.prepare('UPDATE recordings SET size = ? WHERE id = ?').run(bytes.length, ${JSON.stringify(id)});
db.close();`, file);
    }
}

const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

/** The answer to `question`. The end of the input ends the run. */
async function ask(question: string): Promise<string> {
    stdout.write(question);
    const line = await lines.next();
    if (line.done) {
        console.log('\nThe input ended.');
        process.exit(0);
    }
    if (!stdin.isTTY) stdout.write(`${line.value}\n`);
    return line.value.trim().toLowerCase();
}

/** Why `old`'s path, played whole as its old version held it, does not play to its point over its own set; `null` where it does. */
async function playOld(instance: Instance, old: OldPackage): Promise<string | null> {
    const over = instance.served.get(old.dataSet);
    if (!over) return `its set, ${old.dataSet}, is not listed`;
    const played = await playPath(over.set, over.files, old.path, old.shared.kind === 'save' ? old.shared : null);
    return played.drift ? driftText(played.drift) : null;
}

async function migrate(dryRun: boolean): Promise<void> {
    const env = readEnv();
    const host = env['DEPLOY_HOST'] || fail('DEPLOY_HOST is not set in .env');
    const deployDir = env['DEPLOY_DIR'] || fail('DEPLOY_DIR is not set in .env');
    if (!deployDir.startsWith('/')) fail('DEPLOY_DIR must be absolute');
    const url = (env['DEPLOY_INSTANCE'] || fail('DEPLOY_INSTANCE is not set in .env')).replace(/\/+$/, '');
    const player = env['DEPLOY_PLAYER'] || fail('DEPLOY_PLAYER is not set in .env');
    const remote = new Remote(host, deployDir);
    const instance = await readInstance(url, { [PLAYER_ID_HEADER]: player });
    if (!instance.manifest.moderator) fail(`${url} refuses: DEPLOY_PLAYER is not one of its moderators, so its manifest would leave sets out.`);
    const rows = remote.rows();
    console.log(`${url}: ${rows.length} recording${rows.length === 1 ? '' : 's'} shared, converted to version ${RECORDING_PACKAGE_VERSION}${dryRun ? ' (a dry run: nothing replaced)' : ''}.`);
    let replaced = 0;
    for (const [i, row] of rows.entries()) {
        const state = [row.status, row.hidden ? 'hidden' : '', row.broken ? 'broken' : ''].filter((word) => word !== '').join(', ');
        console.log(`\n[${i + 1}/${rows.length}] ${row.id} '${row.title}' on ${row.dataSet} (${state}), ${kb(row.size)}`);
        const answer = await ask('  Convert it? [y]es, [n]o, [q]uit: ');
        if (answer === 'q') break;
        if (answer !== 'y') continue;
        const bytes = remote.read(row.id);
        let converted: Awaited<ReturnType<typeof convert>>;
        try {
            converted = await convert(bytes);
        } catch (error) {
            console.log(`  Not converted: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        if (typeof converted === 'string') {
            console.log(`  Left alone: ${converted}.`);
            continue;
        }
        const { old, v3, file } = converted;
        const changes = v3.path.reduce((sum, recording) => sum + recording.changes.length, 0);
        console.log(`  Version 3: ${kb(bytes.length)} → ${kb(file.length)}, ${v3.path.length} recording${v3.path.length === 1 ? '' : 's'}, ${changes} changes.`);
        const startedAt = Date.now();
        const { why, over } = await playOver(instance, row.dataSet, v3).catch((error: unknown) => ({ why: `does not play: ${error instanceof Error ? error.message : String(error)}`, over: null }));
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        if (why) {
            const before = await playOld(instance, old).catch((error: unknown) => `does not play: ${error instanceof Error ? error.message : String(error)}`);
            console.log(`  Version 3 ${why} (${seconds} s); the old version ${before ?? 'plays to its point'}.`);
            if (!row.broken) {
                console.log('  Not replaced.');
                continue;
            }
            console.log('  Broken already, so replaced all the same.');
        } else {
            console.log(`  Version 3 plays to its point${over ? `, over ${over}'s files` : ''} (${seconds} s).`);
        }
        if (dryRun) {
            console.log('  A dry run: not replaced.');
            continue;
        }
        remote.replace(row.id, fileDigest(bytes), file);
        replaced++;
        console.log(`  Replaced; its row's size is ${file.length} bytes, and the old file is in the backups' recordings-old/.`);
    }
    console.log(`\n${replaced} replaced.`);
}

const args = process.argv.slice(2);
if (args[0] === '--file') {
    if (args.length < 2) fail('usage: npx tsx utils/migrate-recording-packages.ts --file <package.gz>…');
    await convertFiles(args.slice(1));
} else {
    if (args.some((arg) => arg !== '--dry-run')) fail('usage: npx tsx utils/migrate-recording-packages.ts [--dry-run] | --file <package.gz>…');
    await migrate(args.includes('--dry-run'));
}
rl.close();
