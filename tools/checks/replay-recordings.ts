/**
 * The deploy's gate (`utils/replay-recordings.ts`) against a scratch server
 * (`server/app.ts`) that serves `dm-atari`'s files and shares four of its recordings: one
 * that plays to its point, approved (`quietPackage`); one whose changes' `d.Time` and
 * `d.RandomNumber` are no game's, pending (`packageOf`); one such, broken already; and one
 * such titled as a CSBWin run checked by nothing (`CSBWIN_RUNS_UNCHECKED`). The tool runs
 * as `utils/deploy.sh` runs it, its own process, its answers piped.
 *
 * 1. The gate replays the two that are not broken nor titled as a run checked by nothing,
 *    passes over that one, says which one drifts and where, asks nothing, breaks nothing,
 *    and refuses the deploy: it exits 1.
 * 2. `--break`, answered yes, breaks the one that drifts, and only it.
 * 3. The gate again replays the one left, which plays, asks nothing, and lets the deploy
 *    go on: it exits 0.
 * 4. Once `dm-atari`'s `dungeon.dat` is another, the one left plays over a set whose files
 *    are those it was made over, `dm-copy`; and without it, it is refused, the gate saying
 *    which file of its set no longer matches (`findRecordingSet`). The same from an
 *    instance without `api/data-set-files`, a build from before it: the gate digests the
 *    files it serves, and finds the same set.
 * 5. A player who does not moderate is refused before anything plays, by the gate and by
 *    `--break`: the lists would leave recordings out.
 *
 * Usage: npm test -- --only=replay-recordings.ts
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createAppServer, type ServerOptions } from '../../server/app.ts';
import { DataSetStore, parseModerators } from '../../server/dataSets.ts';
import { RateLimit } from '../../server/events.ts';
import { IdentityStore } from '../../server/identity.ts';
import { RecordingStore } from '../../server/recordings.ts';
import { StatsStore } from '../../server/stats.ts';
import { DATA_SET_FILES_ROUTE, parseManifest, PLAYER_ID_HEADER, RECORDING_PACKAGE_FIELD, RECORDINGS_ROUTE } from '../../src/data/DataSets.ts';
import { checkLocalDataSet } from '../../src/engine/LocalDataSetCheck.ts';
import { readRecordingPackage } from '../../src/engine/RecordingPackage.ts';
import { check, finish } from '../lib/check.ts';
import { CSBWIN_RUNS_UNCHECKED } from '../lib/csbwinRun.ts';
import { dataSetNamed, diskFiles } from '../lib/dataSets.ts';
import { packageOf, quietPackage } from '../lib/recordingPackages.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const MODERATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAYER = '00000000-0000-4000-8000-000000000000';
/** The VBLs the quiet game is left alone for: a few ticks of its monsters and timers. */
const QUIET_VBLS = 600;

/** The tool run against `instance` with `args`, `answers` piped: its exit code and its output. */
function runTool(instance: string, args: string[], answers: string): Promise<{ code: number | null; out: string }> {
    return new Promise((done, fail) => {
        const child = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'utils', 'replay-recordings.ts'), '--instance', instance, ...args],
            { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
        child.on('error', fail);
        child.on('close', (code) => done({ code, out }));
        child.stdin.end(answers);
    });
}

const dm = dataSetNamed('dm-atari');
const scratch = mkdtempSync(join(tmpdir(), 'csbweb-replay-recordings-'));
const distDir = join(scratch, 'dist');
const gamefilesDir = join(scratch, 'gamefiles');
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>page</title>');
mkdirSync(join(gamefilesDir, 'dm-atari'), { recursive: true });
for (const name of ['dungeon.dat', 'graphics.dat']) symlinkSync(resolve(dm.dir, name), join(gamefilesDir, 'dm-atari', name));
const options: ServerOptions = { distDir, gamefilesDir };
const db = new DatabaseSync(':memory:');
const dataSets = new DataSetStore(db);
dataSets.fill(parseManifest(JSON.stringify({ default: 'dm-atari', dataSets: [{ id: 'dm-atari', name: 'DM' }] }), ''));
const store = new RecordingStore(db, 1 << 30);
const recordingsDir = join(scratch, 'recordings');
mkdirSync(recordingsDir);
const server = createAppServer(options, {
    checkDataSet: checkLocalDataSet, dataSets, moderators: parseModerators(`${MODERATOR}=Tool`), store: new StatsStore(db),
    notify: () => {}, rules: { hasSet: (id) => dataSets.hasSet(id) }, rateLimit: new RateLimit(100, 60_000), eventBudget: new RateLimit(100, 60_000),
    publishRateLimit: new RateLimit(100, 60_000), now: Date.now,
    recordings: { store, dir: recordingsDir, readPackage: readRecordingPackage, shareRateLimit: new RateLimit(100, 60_000) },
    identities: { store: new IdentityStore(db), rateLimit: new RateLimit(100, 60_000) },
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const instance = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

try {
    const share = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
        const form = new FormData();
        form.append(RECORDING_PACKAGE_FIELD, new File([bytes], 'recording.gz', { type: 'application/gzip' }));
        const response = await fetch(`${instance}/${RECORDINGS_ROUTE}`, { method: 'POST', headers: { [PLAYER_ID_HEADER]: PLAYER }, body: form });
        const body = await response.json() as { id?: string; error?: string };
        if (!body.id) throw new Error(`the share was refused: ${response.status} ${body.error}`);
        return body.id;
    };
    const plays = await share(await quietPackage(dm, diskFiles(dm), 'Quiet', QUIET_VBLS));
    store.approve(plays);
    const drifts = await share(await packageOf('dm-atari', 'Fake'));
    const brokenAlready = await share(await packageOf('dm-atari', 'Broken before'));
    store.setBroken(brokenAlready);
    const uncheckedTitle = CSBWIN_RUNS_UNCHECKED[0]!.title;
    const unchecked = await share(await packageOf('dm-atari', uncheckedTitle));
    const states = () => store.of('dm-atari').map((one) => `${one.title}${one.pending ? ' pending' : ''}${one.broken ? ' broken' : ''}`).sort().join(', ');
    const before = states();
    console.log(`Shared: ${before}`);
    const show = (out: string) => console.log(out.replace(/^/gm, '  | ').replace(/[0-9A-F]{16}/g, '<id>').replace(/against [^.]*\./, 'against <build>.'));

    console.log('\n1. The gate:');
    const gate = await runTool(instance, ['--player', MODERATOR], 'y\n');
    show(gate.out);
    check(gate.out.includes(`✓ ${plays} 'Quiet' (build test): plays to its point`)
        && gate.out.includes(`✗ ${drifts} 'Fake' (build test, pending): drifts at change 0 of root`) && !gate.out.includes(brokenAlready)
        && gate.out.includes('2 recordings replayed, 1 that drifts.') && gate.out.includes('and 1 broken already'),
        'the gate replays the two not broken, the pending one included: the quiet game plays to its point, the fake drifts at its first change');
    check(gate.out.includes(`- ${unchecked} '${uncheckedTitle}': not played, a CSBWin run checked by nothing`) && !gate.out.includes(`✗ ${unchecked}`),
        `it passes over the one titled as a CSBWin run checked by nothing, which would drift`);
    check(gate.code === 1 && gate.out.includes('The deploy is refused') && !gate.out.includes('Mark it broken?') && states() === before,
        `it refuses the deploy, exit ${gate.code}, asks nothing and breaks nothing`);

    console.log('\n2. --break, answered yes:');
    const run = await runTool(instance, ['--player', MODERATOR, '--break'], 'y\n');
    show(run.out);
    check(run.code === 0 && (run.out.match(/Mark it broken\?/g) ?? []).length === 1 && run.out.includes('Marked broken.') && run.out.includes('1 marked broken.')
        && states() === `Broken before pending broken, ${uncheckedTitle} pending, Fake pending broken, Quiet`, `it asks about the one that drifts alone, and breaks it (${states()})`);

    console.log('\n3. The gate again:');
    const again = await runTool(instance, ['--player', MODERATOR], '');
    show(again.out);
    check(again.code === 0 && again.out.includes('1 recording replayed, 0 that drift.') && again.out.includes('and 2 broken already')
        && !again.out.includes('refused') && !again.out.includes('Mark it broken?'), 'it replays the one left, which plays, asks nothing, and lets the deploy go on');

    console.log('\n4. Its set\'s dungeon.dat another:');
    mkdirSync(join(gamefilesDir, 'dm-copy'));
    for (const name of ['dungeon.dat', 'graphics.dat']) symlinkSync(resolve(dm.dir, name), join(gamefilesDir, 'dm-copy', name));
    db.prepare("INSERT INTO data_sets (id, name, dir, position, status, owner) VALUES ('dm-copy', 'DM copy', 'dm-copy', 99, 'approved', NULL)").run();
    const dungeon = join(gamefilesDir, 'dm-atari', 'dungeon.dat');
    unlinkSync(dungeon);
    symlinkSync(resolve(dataSetNamed('csb').dir, 'dungeon.dat'), dungeon);
    const moved = await runTool(instance, ['--player', MODERATOR], '');
    show(moved.out);
    check(moved.code === 0 && moved.out.includes(`✓ ${plays} 'Quiet' (build test): plays to its point, over dm-copy's files`),
        'the recording plays over the set whose files are those it was made over');
    // An instance whose build predates api/data-set-files: the scratch server behind a
    // proxy that answers that route 404, and forwards the rest.
    const older = createServer((request, response) => {
        if ((request.url ?? '').split('?')[0] === `/${DATA_SET_FILES_ROUTE}`) {
            response.writeHead(404).end();
            return;
        }
        const player = request.headers[PLAYER_ID_HEADER.toLowerCase()];
        void fetch(`${instance}${request.url}`, { headers: typeof player === 'string' ? { [PLAYER_ID_HEADER]: player } : {} }).then(async (answer) => {
            response.writeHead(answer.status, { 'Content-Type': answer.headers.get('Content-Type') ?? 'application/octet-stream' });
            response.end(Buffer.from(await answer.arrayBuffer()));
        });
    });
    await new Promise<void>((done) => older.listen(0, '127.0.0.1', done));
    try {
        const before = await runTool(`http://127.0.0.1:${(older.address() as AddressInfo).port}`, ['--player', MODERATOR], '');
        show(before.out);
        check(before.code === 0 && before.out.includes(`has no ${DATA_SET_FILES_ROUTE}, so the files it serves are digested here.`)
            && before.out.includes(`✓ ${plays} 'Quiet' (build test): plays to its point, over dm-copy's files`),
            'and from an instance without api/data-set-files, the gate digests the files it serves, and finds the same set');
    } finally {
        older.close();
    }
    db.prepare("DELETE FROM data_sets WHERE id = 'dm-copy'").run();
    const gone = await runTool(instance, ['--player', MODERATOR], '');
    show(gone.out);
    check(gone.code === 1 && gone.out.includes(`✗ ${plays} 'Quiet' (build test): is refused: DM's dungeon.dat no longer matches the recording, and no other set on this site holds its files.`)
        && gone.out.includes('The deploy is refused'), 'and where no set has them, it is refused, and the deploy with it');
    unlinkSync(dungeon);
    symlinkSync(resolve(dm.dir, 'dungeon.dat'), dungeon);

    console.log('\n5. A player who does not moderate:');
    store.remove(plays);
    const fake = await share(await packageOf('dm-atari', 'Another fake'));
    for (const args of [[], ['--break']]) {
        const refused = await runTool(instance, ['--player', PLAYER, ...args], 'y\n');
        show(refused.out);
        check(refused.code === 1 && refused.out.includes('--player is not one of its moderators') && !refused.out.includes('replayed')
            && !store.get(fake)!.broken, `a player who does not moderate is refused before anything plays${args.length ? ', with --break' : ''}`);
    }
} finally {
    server.close();
    db.close();
    rmSync(scratch, { recursive: true, force: true });
}

finish();
