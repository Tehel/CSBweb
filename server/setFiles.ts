/**
 * `api/data-set-files` (`DATA_SET_FILES_ROUTE`): the MD5 of each game file (`GAME_FILES`)
 * of the sets `api/data-sets` offers the same player, read from their folders. The page
 * matches a recording's files against them, to play it over a set whose files are those it
 * was made over (`findRecordingSet`, `src/data/RecordingSet.ts`).
 *
 * A file is digested once and kept while its size and its modification time stay, so a
 * moderator's edit, which writes a new file, is digested again at the next request.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { GAME_FILES } from '../src/data/DataSets.ts';
import { visibleSets, type DataSetViewer, type StoredDataSets } from './dataSets.ts';

/** The digests of the files read so far, by path, with the size and time they were read at. */
export class FileDigestCache {
    private readonly kept = new Map<string, { size: number; mtimeMs: number; digest: string }>();

    /** `path`'s MD5 in lower-case hex, or `null` where it is not a file. */
    async digest(path: string): Promise<string | null> {
        const stats = await stat(path).catch(() => null);
        if (!stats?.isFile()) {
            this.kept.delete(path);
            return null;
        }
        const kept = this.kept.get(path);
        if (kept && kept.size === stats.size && kept.mtimeMs === stats.mtimeMs) return kept.digest;
        const digest = createHash('md5').update(await readFile(path)).digest('hex');
        this.kept.set(path, { size: stats.size, mtimeMs: stats.mtimeMs, digest });
        return digest;
    }
}

/**
 * `{"dataSets": [{"id", "files": {<name>: <md5>}}]}`: each set of `stored` that `viewer`
 * may see, in the table's order, with the digest of each of its game files its folder under
 * `gamefilesDir` holds.
 */
export async function filesText(stored: StoredDataSets, viewer: DataSetViewer, gamefilesDir: string, cache: FileDigestCache): Promise<string> {
    const dataSets = [];
    for (const set of visibleSets(stored, viewer)) {
        const files: Record<string, string> = {};
        for (const name of [...GAME_FILES].sort()) {
            const digest = await cache.digest(join(gamefilesDir, set.dir, name));
            if (digest !== null) files[name] = digest;
        }
        dataSets.push({ id: set.id, files });
    }
    return JSON.stringify({ dataSets });
}
