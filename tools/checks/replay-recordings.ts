/**
 * The replay tool (`utils/replay-recordings.ts`) against a scratch server
 * (`server/app.ts`) that serves `dm-atari`'s files and shares three of its recordings: one
 * that plays to its point, approved (`quietPackage`); one whose changes' `d.Time` and
 * `d.RandomNumber` are no game's, pending (`packageOf`); and one such, broken already. The
 * tool runs as a moderator runs it, its own process, its answers piped.
 *
 * 1. A dry run replays the two that are not broken, says which one drifts and where,
 *    asks about it alone, and breaks nothing.
 * 2. A run answered yes breaks the one that drifts, and only it.
 * 3. Run again, it replays the one left, which plays, and asks nothing.
 * 4. A player who does not moderate is refused the break, and the run stops there.
 *
 * Usage: npm test -- --only=replay-recordings.ts
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createAppServer, type ServerOptions } from '../../server/app.ts';
import { DataSetStore, parseModerators } from '../../server/dataSets.ts';
import { RateLimit } from '../../server/events.ts';
import { RecordingStore } from '../../server/recordings.ts';
import { StatsStore } from '../../server/stats.ts';
import { parseManifest, PLAYER_ID_HEADER, RECORDING_PACKAGE_FIELD, RECORDINGS_ROUTE } from '../../src/data/DataSets.ts';
import { checkLocalDataSet } from '../../src/engine/LocalDataSetCheck.ts';
import { readRecordingPackage } from '../../src/engine/RecordingPackage.ts';
import { check, finish } from '../lib/check.ts';
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
    const states = () => store.of('dm-atari').map((one) => `${one.title}${one.pending ? ' pending' : ''}${one.broken ? ' broken' : ''}`).sort().join(', ');
    const before = states();
    console.log(`Shared: ${before}`);
    const show = (out: string) => console.log(out.replace(/^/gm, '  | ').replace(/[0-9A-F]{16}/g, '<id>').replace(/against [^.]*\./, 'against <build>.'));

    console.log('\n1. A dry run:');
    const dry = await runTool(instance, ['--player', MODERATOR, '--dry-run'], 'y\n');
    show(dry.out);
    check(dry.code === 0 && dry.out.includes(`✓ ${plays} 'Quiet' (build test): plays to its point`)
        && dry.out.includes(`✗ ${drifts} 'Fake' (build test, pending): drifts at change 0 of root`) && !dry.out.includes(brokenAlready)
        && dry.out.includes('2 recordings replayed, 1 that drifts.') && dry.out.includes('and 1 broken already'),
        'a dry run replays the two not broken, the pending one included: the quiet game plays to its point, the fake drifts at its first change');
    check((dry.out.match(/Mark it broken\?/g) ?? []).length === 1 && dry.out.includes('A dry run: not marked.') && states() === before,
        'it asks about the one that drifts alone, and breaks nothing');

    console.log('\n2. A run, answered yes:');
    const run = await runTool(instance, ['--player', MODERATOR], 'y\n');
    show(run.out);
    check(run.code === 0 && run.out.includes('Marked broken.') && run.out.includes('1 marked broken.')
        && states() === 'Broken before pending broken, Fake pending broken, Quiet', `it breaks the one that drifts, and only it (${states()})`);

    console.log('\n3. Run again:');
    const again = await runTool(instance, ['--player', MODERATOR], '');
    show(again.out);
    check(again.code === 0 && again.out.includes('1 recording replayed, 0 that drift.') && again.out.includes('and 2 broken already')
        && !again.out.includes('Mark it broken?'), 'run again, it replays the one left, which plays, and asks nothing');

    console.log('\n4. A player who does not moderate:');
    store.remove(plays);
    const fake = await share(await packageOf('dm-atari', 'Another fake'));
    const refused = await runTool(instance, ['--player', PLAYER], 'y\n');
    show(refused.out);
    check(refused.code === 1 && refused.out.includes('--player is not one of its moderators') && !store.get(fake)!.broken,
        'a player who does not moderate is refused the break, and the run stops');
} finally {
    server.close();
    db.close();
    rmSync(scratch, { recursive: true, force: true });
}

finish();
