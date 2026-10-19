/**
 * A published set's files as one zip, `<name>.zip`, which the welcome page's book offers
 * first, before the set's documents (`src/ui/welcomePage.ts`), so that a set published on
 * the site can be taken away and played in CSBWin, whose `directory=` is a folder of such
 * files (`DataSets.ts`). The page builds it from the files the server serves, one by one,
 * as it reads them to play: the server lists no folder.
 *
 * It holds what the set says its folder holds (`archiveFiles`): its `dungeon.dat` and
 * `graphics.dat`, the `CSBgraphics.dat`, `mini.dat` and Hint Oracle its flags name, its
 * thumbnail where it has one, and its documents, all in one folder of the zip's name. A
 * file of the folder the set does not name is not in it: none is a CSBWin file, but a
 * readme that is no document (`doc/DEPLOYMENT.md` → "A set's documents"). A local set has
 * none: its files are the player's already.
 */
import { zip } from '../core/zip';
import { thumbnailPath, type DataSet } from './DataSets';

/** A file of the archive: its name in the set's folder, and whether the set is not whole without it. */
export interface ArchiveFile {
    file: string;
    required: boolean;
}

/** A file read from the set's folder, and its date, or `null` where it cannot be read. */
export type ReadArchiveFile = (file: string) => Promise<{ bytes: Uint8Array; modified: Date } | null>;

/**
 * The name of `set`'s archive, without `.zip`, and of the folder in it: its name, each
 * character a file's name may not hold on Windows (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`,
 * a control) a `_`, its spaces and dots at either end dropped; its id where nothing is left.
 */
export function archiveName(set: DataSet): string {
    const name = set.name.replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
    return name === '' ? set.id : name;
}

/** The files of `set`'s folder its archive holds, in its order. */
export function archiveFiles(set: DataSet): ArchiveFile[] {
    const game = ['dungeon.dat', 'graphics.dat', ...(set.csbGraphics ? ['CSBgraphics.dat'] : []), ...(set.miniDat ? ['mini.dat'] : []),
        ...(set.hintOracle ? ['hcsb.hct', 'hcsb.dat'] : [])];
    const thumbnail = thumbnailPath(set).slice(set.dir.length + 1);
    return [...game.map((file) => ({ file, required: true })), { file: thumbnail, required: false },
        ...set.documents.map(({ file }) => ({ file, required: true }))];
}

/**
 * `set`'s archive, its files read by `read`, each in the folder `archiveName` says. Throws,
 * naming the file, where one the set is not whole without cannot be read.
 */
export async function dataSetArchive(set: DataSet, read: ReadArchiveFile): Promise<Uint8Array<ArrayBuffer>> {
    const folder = archiveName(set);
    const files = await Promise.all(archiveFiles(set).map(async ({ file, required }) => {
        const got = await read(file);
        if (!got && required) throw new Error(`${file} cannot be read.`);
        return got && { name: `${folder}/${file}`, ...got };
    }));
    return zip(files.filter((entry) => entry !== null));
}
