/**
 * A CSBweb instance's sets and the recordings it shares, played here: what the deploy's
 * gate (`utils/replay-recordings.ts`) and the packages' migration
 * (`utils/migrate-recording-packages.ts`) both do. A package is played from itself alone,
 * in a page without the DOM (`playPath`, `tools/lib/playback.ts`), over the files the
 * instance serves of the set the page would play it over (`findRecordingSet`), with the
 * engine of this working tree.
 */
import { fileDigest, folderFiles } from '../../src/data/DataSetFiles';
import { DATA_SET_FILES_ROUTE, DATA_SETS_ROUTE, GAME_FILES, parseManifest, type DataSet, type DataSetManifest } from '../../src/data/DataSets';
import { findRecordingSet, parseSetDigests, type SetDigests } from '../../src/data/RecordingSet';
import type { RecordingPackage } from '../../src/engine/RecordingPackage';
import type { Drift } from '../../src/engine/RecordingPlayer';
import { keptFiles, playPath } from '../../tools/lib/playback';

/** The sets an instance lists, by id: each with its files as the instance serves them, read once. */
export type Served = ReadonlyMap<string, { set: DataSet; files: ReturnType<typeof keptFiles> }>;

/** What an instance serves, as `headers` (a moderator's `X-Player-Id`) are listed it. */
export interface Instance {
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly manifest: DataSetManifest;
    readonly served: Served;
    readonly digests: readonly SetDigests[];
}

export async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
    return response;
}

/** The instance at `url`: its manifest as `headers` are listed it, its sets' files, and their digests. */
export async function readInstance(url: string, headers: Record<string, string>): Promise<Instance> {
    const manifest = parseManifest(await (await fetchOk(`${url}/${DATA_SETS_ROUTE}`, { headers })).text(), `${url}/gamefiles`);
    const served: Served = new Map(manifest.dataSets.map((set) => [set.id, { set, files: keptFiles(folderFiles(set.dir)) }]));
    return { url, headers, manifest, served, digests: await setDigests(url, served, headers) };
}

/**
 * The digests of each game file of the sets `served` holds: the instance's
 * `api/data-set-files`, or, where it answers 404, a build from before that route, those
 * of the files it serves, which the route digests from the same folders.
 */
async function setDigests(url: string, served: Served, headers: Record<string, string>): Promise<SetDigests[]> {
    const response = await fetch(`${url}/${DATA_SET_FILES_ROUTE}`, { headers });
    if (response.status !== 404) {
        if (!response.ok) throw new Error(`${url}/${DATA_SET_FILES_ROUTE} answered HTTP ${response.status}`);
        return parseSetDigests(await response.text(), new Map([...served.values()].map(({ set }) => [set.id, set.name])));
    }
    console.log(`${url} has no ${DATA_SET_FILES_ROUTE}, so the files it serves are digested here.`);
    return Promise.all([...served.values()].map(async ({ set, files }) => {
        const digests: Record<string, string> = {};
        for (const name of GAME_FILES) {
            const bytes = await files.read(name);
            if (bytes) digests[name] = fileDigest(bytes);
        }
        return { id: set.id, name: set.name, files: digests };
    }));
}

/** `drift` as a line says it. */
export function driftText(drift: Drift): string {
    switch (drift.kind) {
        case 'change': return `drifts at change ${drift.change} of ${drift.recording}: d.Time ${drift.time}, random ${drift.random}`;
        case 'join': return `drifts at the join of ${drift.recording}: its file differs${drift.byte === null ? '' : ` at byte ${drift.byte}`}`;
        case 'save': return `drifts at the save shared: its file differs${drift.byte === null ? '' : ` at byte ${drift.byte}`}`;
        case 'end': return drift.word11694 === null
            ? `drifts at the end of ${drift.recording}: the game did not end`
            : `drifts at the end of ${drift.recording}: the game ended at VBL ${drift.vbls}, ${drift.word11694 ? 'won' : 'lost'}`;
    }
}

/**
 * `pkg`, a recording the instance lists on `dataSet`, played to its point over the set the
 * page would play it over: why it does not play there, `null` where it does, and the set
 * it played over where that is another.
 */
export async function playOver(instance: Instance, dataSet: string, pkg: RecordingPackage): Promise<{ why: string | null; over: string | null }> {
    const result = (why: string | null, over: string | null = null) => ({ why, over });
    if (pkg.dataSet !== dataSet) return result(`its package plays ${pkg.dataSet}, not ${dataSet}`);
    const found = findRecordingSet(pkg.path, instance.digests);
    if (found.kind === 'refused') return result(`is refused: ${found.why}`);
    const over = instance.served.get(found.id);
    if (!over) return result(`plays over ${found.id}, which the instance does not list`);
    const played = await playPath(over.set, over.files, pkg.path, pkg.shared.kind === 'save' ? pkg.shared : null);
    return result(played.drift ? driftText(played.drift) : null, over.set.id === dataSet ? null : over.set.id);
}
