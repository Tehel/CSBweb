/**
 * Replay every recording a CSBweb instance shares against this checkout's build, before
 * it is deployed there, and mark those that drift as broken (`DEBT.md` G31,
 * `doc/DEPLOYMENT.md` → "Shared recordings"): a behaviour change makes an older recording
 * drift (`doc/RECORDING.md` → "Shared recordings"), and the list leaves a broken one out
 * but for its uploader and the moderators.
 *
 * Run:
 *
 *   npx tsx utils/replay-recordings.ts --instance https://csbweb.example --player <playerId> [--dry-run]
 *
 * `--player` is a moderator's `playerId` (`MODERATOR_PLAYER_IDS`), a UUID: the lists then
 * hold every recording of every set, pending and hidden ones included, and only a
 * moderator may break one. `--dry-run` replays them all and breaks none.
 *
 * Each set the instance lists (`api/data-sets`) has its recordings listed
 * (`api/recordings?dataSet=<id>`), and each that is not broken yet has its package
 * fetched (`recordings/<id>.gz`), read by the page's reader (`readRecordingPackage`) and
 * played, from the package alone, in a page without the DOM over the set's files as the
 * instance serves them (`playPath`, `tools/lib/playback.ts`), with the engine of this
 * working tree: what the build deployed from it will play. A recording that plays to its
 * point, a save's file checked there or the game's end reached, is kept; one that drifts,
 * or whose package does not read or play, is shown with why, and once every one is played
 * the script asks, for each such:
 *
 *   y  yes: mark it broken (`POST api/recordings/<id>`, `{"action": "break"}`)
 *   n  no, next
 *   q  quit
 *
 * A broken recording stays broken: no action takes it back.
 */
import { spawnSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { folderFiles } from '../src/data/DataSetFiles';
import { DATA_SETS_ROUTE, parseManifest, PLAYER_ID_HEADER, RECORDING_FILES, RECORDINGS_ROUTE, SHARED_RECORDING_ID, type DataSet } from '../src/data/DataSets';
import { readRecordingPackage } from '../src/engine/RecordingPackage';
import type { Drift } from '../src/engine/RecordingPlayer';
import { keptFiles, playPath } from '../tools/lib/playback';

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function argument(name: string): string | null {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] ?? null : null;
}

const instance = (argument('--instance') ?? fail('--instance <url> is needed: the CSBweb instance whose recordings to replay')).replace(/\/+$/, '');
const player = argument('--player') ?? fail('--player <playerId> is needed: a moderator of the instance');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(player)) fail('--player is not a playerId, a lowercase UUID');
const dryRun = process.argv.includes('--dry-run');
const asPlayer = { [PLAYER_ID_HEADER]: player };

const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

/** The moderator's answer to `question`. The end of the input ends the run. */
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

async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
    return response;
}

/** What the script reads of a recording the instance lists (`recordingsText`, `server/recordings.ts`). */
interface Listed {
    id: string;
    build: string;
    title: string;
    status?: string;
    hidden?: boolean;
    broken?: boolean;
}

/** A recording that did not play to its point, and why. */
interface Drifted {
    set: DataSet;
    recording: Listed;
    why: string;
}

/** `drift` as a line says it. */
function driftText(drift: Drift): string {
    switch (drift.kind) {
        case 'change': return `drifts at change ${drift.change} of ${drift.recording}: d.Time ${drift.time}, random ${drift.random}`;
        case 'join': return `drifts at the join of ${drift.recording}: its file differs at byte ${drift.byte}`;
        case 'save': return `drifts at the save shared: its file differs at byte ${drift.byte}`;
        case 'end': return drift.word11694 === null
            ? `drifts at the end of ${drift.recording}: the game did not end`
            : `drifts at the end of ${drift.recording}: the game ended at VBL ${drift.vbls}, ${drift.word11694 ? 'won' : 'lost'}`;
    }
}

/** The commit this working tree is, as the deploy names its build. */
function checkoutBuild(): string {
    const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
    const changed = spawnSync('git', ['status', '--porcelain', '--', 'src'], { encoding: 'utf8' });
    return `${head.stdout.trim() || 'an unknown commit'}${changed.stdout.trim() ? ', its src/ changed' : ''}`;
}

/** `recording` of `set` played from its package: `null` where it plays to its point, or why it does not. */
async function replay(set: DataSet, files: ReturnType<typeof keptFiles>, recording: Listed): Promise<string | null> {
    try {
        const bytes = new Uint8Array(await (await fetchOk(`${instance}/${RECORDING_FILES}/${recording.id}.gz`)).arrayBuffer());
        const pkg = await readRecordingPackage(bytes);
        if (pkg.dataSet !== set.id) return `its package plays ${pkg.dataSet}, not ${set.id}`;
        const played = await playPath(set, files, pkg.path, pkg.shared.kind === 'save' ? pkg.shared : null);
        return played.drift ? driftText(played.drift) : null;
    } catch (error) {
        return `does not play: ${error instanceof Error ? error.message : String(error)}`;
    }
}

async function main(): Promise<void> {
    console.log(`Replaying ${instance}'s recordings against ${checkoutBuild()}${dryRun ? ', a dry run' : ''}.`);
    const manifest = parseManifest(await (await fetchOk(`${instance}/${DATA_SETS_ROUTE}`, { headers: asPlayer })).text(), `${instance}/gamefiles`);
    const drifted: Drifted[] = [];
    let played = 0;
    for (const set of manifest.dataSets) {
        const url = `${instance}/${RECORDINGS_ROUTE}?dataSet=${encodeURIComponent(set.id)}`;
        const listed = (JSON.parse(await (await fetchOk(url, { headers: asPlayer })).text()) as { recordings: Listed[] }).recordings;
        const toPlay = listed.filter((recording) => !recording.broken && SHARED_RECORDING_ID.test(recording.id));
        if (toPlay.length === 0) continue;
        console.log(`\n${set.name} (${set.id}): ${toPlay.length} recording${toPlay.length === 1 ? '' : 's'}`
            + `${listed.length > toPlay.length ? `, and ${listed.length - toPlay.length} broken already` : ''}`);
        const files = keptFiles(folderFiles(set.dir));
        for (const recording of toPlay) {
            const state = recording.status === 'pending' ? ', pending' : recording.hidden ? ', hidden' : '';
            const why = await replay(set, files, recording);
            played++;
            console.log(`  ${why ? '✗' : '✓'} ${recording.id} '${recording.title}' (build ${recording.build}${state}): ${why ?? 'plays to its point'}`);
            if (why) drifted.push({ set, recording, why });
        }
    }
    console.log(`\n${played} recording${played === 1 ? '' : 's'} replayed, ${drifted.length} that drift${drifted.length === 1 ? 's' : ''}.`);

    let broken = 0;
    for (const [i, { set, recording, why }] of drifted.entries()) {
        console.log(`\n[${i + 1}/${drifted.length}] ${recording.id} '${recording.title}' of ${set.name}, build ${recording.build}: ${why}`);
        const answer = await ask(`  Mark it broken? [y]es, [n]o, [q]uit: `);
        if (answer === 'q') break;
        if (answer !== 'y') continue;
        if (dryRun) {
            console.log('  A dry run: not marked.');
            continue;
        }
        const response = await fetch(`${instance}/${RECORDINGS_ROUTE}/${recording.id}`, {
            method: 'POST', headers: { ...asPlayer, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'break' }),
        });
        if (response.status === 403) fail(`  ${instance} refuses: --player is not one of its moderators.`);
        if (!response.ok) {
            console.log(`  Not marked: HTTP ${response.status} ${await response.text()}`);
            continue;
        }
        broken++;
        console.log('  Marked broken.');
    }
    console.log(`\n${broken} marked broken.`);
}

await main();
rl.close();
