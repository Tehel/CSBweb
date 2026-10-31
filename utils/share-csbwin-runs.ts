/**
 * Share CSBWin's own runs on a CSBweb instance as its recordings (`DEBT.md` F24,
 * `doc/RECORDING.md` → "Recordings made in CSBWin"): each run that plays to its end in the
 * port (`CSBWIN_RUNS`, `tools/fixtures/csbwin-runs/`) played into a page through its input
 * boundary and recorded (`recordRun`), its package written as the welcome page's UPLOAD
 * writes one, and submitted to `POST api/recordings`, pending a moderator's approval.
 *
 * Run:
 *
 *   npx tsx utils/share-csbwin-runs.ts --instance https://csbweb.example --player <playerId> [--dry-run] [<run id>…]
 *
 * `--player` is the `playerId` the recordings are shared as, a UUID, which may withdraw
 * them (a page's is its `localStorage`'s). `--dry-run` does everything but the `POST`.
 * Run ids name the runs to offer, all of them otherwise.
 *
 * The instance must run a build whose package reader takes the `playfile` change, the
 * recorder's own draws a CSBWin run carries (`PLAYFILE_LINES`), or it refuses each. A run
 * whose title the instance already lists on its set (to `--player`: pending, hidden and
 * its own included) is not offered again. For each other, the script plays it to its end
 * (Lord Chaos fused, or its log's last entry, where a save is made to share it at), plays
 * its package back with the port's player (`playPath`), shows its title, its player, its
 * description and its size, and asks:
 *
 *   y  yes: submit it
 *   n  no, next
 *   q  quit
 *
 * A run that drifts, or whose package does not play back, is shown with why and not
 * offered: the engine of this working tree has parted from CSBWin, which
 * `tools/checks/csbwin-runs.ts` says first.
 */
import { spawnSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { PLAYER_ID_HEADER, RECORDING_PACKAGE_FIELD, RECORDINGS_ROUTE } from '../src/data/DataSets';
import { packageOfEnd, packageOfSave, readRecordingPackage, writeRecordingPackage } from '../src/engine/RecordingPackage';
import { CSBWIN_RUNS, recordRun, type CsbwinRun } from '../tools/lib/csbwinRun';
import { dataSetNamed, diskFiles } from '../tools/lib/dataSets';
import { playPath } from '../tools/lib/playback';

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function argument(name: string): string | null {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] ?? null : null;
}

const instance = (argument('--instance') ?? fail('--instance <url> is needed: the CSBweb instance to share the runs on')).replace(/\/+$/, '');
const player = argument('--player') ?? fail('--player <playerId> is needed: the player the runs are shared as');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(player)) fail('--player is not a playerId, a lowercase UUID');
const dryRun = process.argv.includes('--dry-run');
const named = process.argv.slice(2).filter((arg, n, args) => !arg.startsWith('--') && args[n - 1] !== '--instance' && args[n - 1] !== '--player');
const unknown = named.filter((id) => !CSBWIN_RUNS.some((run) => run.id === id));
if (unknown.length > 0) fail(`No such run: ${unknown.join(', ')}. The runs: ${CSBWIN_RUNS.map((run) => run.id).join(', ')}`);
const runs = CSBWIN_RUNS.filter((run) => named.length === 0 || named.includes(run.id));
const asPlayer = { [PLAYER_ID_HEADER]: player };

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

/** The commit this working tree is, as the deploy names its build: the recordings' build. */
function checkoutBuild(): string {
    const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
    return head.stdout.trim() || 'unknown';
}

/** The titles the instance lists to `--player` on `dataSet`. */
async function listedTitles(dataSet: string): Promise<Set<string>> {
    const url = `${instance}/${RECORDINGS_ROUTE}?dataSet=${encodeURIComponent(dataSet)}`;
    const response = await fetch(url, { headers: asPlayer });
    if (!response.ok) fail(`${url} answered HTTP ${response.status}`);
    const { recordings } = (await response.json()) as { recordings: { title: string }[] };
    return new Set(recordings.map((recording) => recording.title));
}

/** `run` played, packaged and played back: its package, or why it cannot be shared. */
async function packageOf(run: CsbwinRun, build: string): Promise<Uint8Array | string> {
    const recorded = await recordRun(run, build);
    if (recorded.drift) return `it drifts at ${recorded.drift}`;
    if (run.end === 'won' ? recorded.won !== true : recorded.saved === null) return 'it does not reach its end';
    const text = { title: run.title, author: run.player, description: run.description };
    const date = Date.parse(run.recordedAt);
    const times = { recordedAt: date, endedAt: date, playTime: recorded.page.game.playTime() };
    const pkg = recorded.saved
        ? packageOfSave([recorded.recording], recorded.saved.point, recorded.saved.file, text, times)
        : packageOfEnd([recorded.recording], text, times);
    const bytes = await writeRecordingPackage(pkg);
    const read = await readRecordingPackage(bytes);
    const set = dataSetNamed(run.dataSet);
    const played = await playPath(set, diskFiles(set), read.path, read.shared.kind === 'save' ? read.shared : null);
    return played.drift ? `its package drifts as it plays back: ${JSON.stringify(played.drift)}` : bytes;
}

async function main(): Promise<void> {
    const build = checkoutBuild();
    console.log(`Sharing CSBWin's runs on ${instance} as ${player}, build ${build}${dryRun ? ', a dry run' : ''}.`);
    const listed = new Map<string, Set<string>>();
    let shared = 0;
    for (const [i, run] of runs.entries()) {
        let titles = listed.get(run.dataSet);
        if (!titles) listed.set(run.dataSet, titles = await listedTitles(run.dataSet));
        console.log(`\n[${i + 1}/${runs.length}] ${run.id}, on ${run.dataSet}`);
        if (titles.has(run.title)) {
            console.log(`  '${run.title}' is listed already: not offered.`);
            continue;
        }
        const bytes = await packageOf(run, build);
        if (typeof bytes === 'string') {
            console.log(`  Not offered: ${bytes}.`);
            continue;
        }
        console.log(`  Title:       ${run.title}`);
        console.log(`  Author:      ${run.player}`);
        console.log(`  Description: ${run.description}`);
        console.log(`  Recorded:    ${run.recordedAt}; its package ${Math.round(bytes.length / 1024)} KB, played back to its end`);
        const answer = await ask('  Submit it? [y]es, [n]o, [q]uit: ');
        if (answer === 'q') break;
        if (answer !== 'y') continue;
        if (dryRun) {
            console.log('  A dry run: not submitted.');
            continue;
        }
        const form = new FormData();
        form.append(RECORDING_PACKAGE_FIELD, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/gzip' }), 'recording.gz');
        const response = await fetch(`${instance}/${RECORDINGS_ROUTE}`, { method: 'POST', headers: asPlayer, body: form });
        const json = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
        if (!response.ok) {
            console.log(`  Refused: HTTP ${response.status}${json?.error ? `, ${json.error}` : ''}`);
            if (response.status === 429) break;
            continue;
        }
        shared++;
        titles.add(run.title);
        console.log(`  Submitted as ${json?.id ?? 'an unnamed recording'}, pending a moderator's approval.`);
    }
    console.log(`\n${shared} submitted.`);
}

await main();
rl.close();
