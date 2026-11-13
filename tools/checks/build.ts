/**
 * What a build ships (`doc/DEPLOYMENT.md`): the page, the server's readers of a player's set
 * and of a shared recording, and none of `static/`.
 *
 * Builds with the project's own `vite.config.mts` (the CLI, as `npm run build` does: the
 * page, then `--ssr`) into a scratch folder, lists every file,
 * and asserts:
 *   - every file is `index.html`, `stats.html`, `fame.html`, the web app manifest, under `assets/`, or the server's
 *     module (`READERS_MODULE`), of a type the page itself is made of: no `.dat`, no `.pdf`
 *     but HOW TO PLAY's sheets to print (`src/assets/how-to-play/`), nothing of `static/`;
 *   - every local `href` and `src` in `index.html` names a file the build holds, the
 *     manifest among them, and the manifest's icons are in it too, at the sizes it says;
 *   - so does every one in `stats.html` and in `fame.html`, the Hall of Fame, which link no
 *     manifest, and load none of the game's code: not its entry, and a few KB of script
 *     each, followed through their imports;
 *   - the bundle hands the probes no `window.__probe`, which only a build made with
 *     `CSBWEB_PROBE=1` does (`vite.config.mts`): the image the golden frames check;
 *   - the server's module imports nothing, as the image has no `node_modules`, loads through
 *     the server's own loader (`loadPageReaders`), and says of a set what the page's
 *     `checkLocalDataSet` says, its problems, record, census and walls, and of a
 *     `dungeon.dat` what `readDungeonWalls` says: DM's `dungeon.dat` on its
 *     base set's `graphics.dat`, read from the set's folder, the same with Chaos Strikes Back's
 *     own `graphics.dat`, and a `dungeon.dat` that does not read, and DM's with its
 *     achievements, refused their family, which the built readers reserve to the site's
 *     sets (`achievementsCheck`) over the source's common file; of a package what the
 *     page's `readRecordingPackage` says: one read, one past the limit it unzips to, and
 *     bytes that are no package; and merges a set's own file with the source's common
 *     one, as the Hall of Fame lists them, each set's file read from its folder
 *     (`folderAchievements`): Dungeon Master's, the Kids dungeon's with none, and a file
 *     that does not read; and works those across games out of figures
 *     (`achievementsAcross`), Grand Slam out of a Dungeon Master set's and Chaos Strikes
 *     Back's;
 *   - the verifier's module (`VERIFIER_MODULE`, `--ssr --mode verifier`) imports nothing,
 *     loads through the verifier's loader (`loadVerifierReaders`), and replays a proof as
 *     the page's `replayProof` does, with the set's achievements: a genuine corpus
 *     recording (`replay-saves-written-over`, First Blood), and bytes that are no package.
 *
 * Usage: npm test -- --only=build.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { READERS_MODULE, VERIFIER_MODULE, loadPageReaders, loadVerifierReaders } from '../../server/app.ts';
import { DataSetStore } from '../../server/dataSets.ts';
import { verifierSets } from '../../server/proofs.ts';
import { FileDigestCache } from '../../server/setFiles.ts';
import { folderAchievements } from '../../server/setAchievements.ts';
import { openStore } from '../../server/store.ts';
import { parseManifest } from '../../src/data/DataSets.ts';
import { replayProof } from '../../src/engine/achievements/ProofReplay.ts';
import { setAchievementDefs } from '../../src/engine/achievements/PageAchievements.ts';
import type { DataSetDraft, DataSetFolder } from '../../server/publish.ts';
import { checkLocalDataSet, readDungeonWalls } from '../../src/engine/LocalDataSetCheck.ts';
import { readRecordingPackage } from '../../src/engine/RecordingPackage.ts';
import { check, finish } from '../lib/check.ts';
import { dataSetNamed, GAMEFILES_DIR, MANIFEST_FILE } from '../lib/dataSets.ts';
import { CORPUS_DIR } from '../lib/recordingCorpus.ts';
import { packageOf } from '../lib/recordingPackages.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const PAGE_TYPES = new Set(['.html', '.js', '.css', '.ico', '.jpg', '.png', '.ttf', '.woff2', '.img', '.wav', '.webmanifest']);
/** HOW TO PLAY's sheets to print (`tools/gen-help-sheet.ts`), the page's only PDFs, as Vite names them. */
const PRINTED_SHEET = /^assets\/(csbwin|keypad|arrows)-(qwerty|azerty)-[\w-]+\.pdf$/;
/** The statistics page and the Hall of Fame, Vite's second and third entries (`vite.config.mts`), and a bound on the script each loads. */
const STATS_PAGE = 'stats.html';
const FAME_PAGE = 'fame.html';
const STATS_PAGE_BYTES = 32 * 1024;

/** The web app manifest, beside `index.html` under a name that does not change (`vite.config.mts`). */
const WEB_MANIFEST = 'manifest.webmanifest';
/** The FTL logo, the page's own asset (`src/main.ts`, `loadSwooshFiles`). */
const SWOOSH_IMAGE = 'src/assets/swoosh.img';

/** `vite build` with `args`, into `outDir`, emptied first unless `keep`, as `npm run build` runs it. */
function viteBuild(outDir: string, args: string[], keep = false): void {
    const vite = spawnSync(resolve(ROOT, 'node_modules/.bin/vite'),
        ['build', ...args, '--outDir', outDir, ...(keep ? [] : ['--emptyOutDir']), '--logLevel', 'error'],
        { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CSBWEB_PROBE: undefined } });
    if (vite.status !== 0) throw new Error(`vite build ${args.join(' ')} failed:\n${vite.stdout}${vite.stderr}`);
}

/** The data set `id`'s folder on disk, as the server reads it. */
function folder(id: string): DataSetFolder {
    const dir = dataSetNamed(id).dir;
    return {
        async read(name) {
            try {
                return new Uint8Array(readFileSync(join(dir, name)));
            } catch {
                return null;
            }
        },
        where: (name) => join(dir, name),
    };
}

/** A draft of the files `names` of `set`'s folder, on base set `dm-atari` where it has no graphics.dat. */
function draftOf(set: string, names: string[], replaced: Record<string, Blob> = {}): DataSetDraft {
    const files: Record<string, Blob> = {};
    for (const name of names) files[name] = new Blob([readFileSync(join(dataSetNamed(set).dir, name))]);
    return { id: set, name: set, description: '', authors: [], dmRules: true, thumbnailAsTitle: false, official: false, baseSet: 'dm-atari', files: { ...files, ...replaced } };
}

function listFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const path = join(dir, e.name);
        return e.isDirectory() ? listFiles(path) : [path];
    });
}

async function main(): Promise<void> {
    const outDir = mkdtempSync(join(tmpdir(), 'csbweb-build-'));
    try {
        viteBuild(outDir, []);
        viteBuild(join(outDir, 'server'), ['--ssr']);
        viteBuild(join(outDir, 'server'), ['--ssr', '--mode', 'verifier'], true);

        const files = listFiles(outDir).map((f) => relative(outDir, f)).sort();
        let total = 0;
        console.log('The build:');
        for (const f of files) {
            const size = statSync(join(outDir, f)).size;
            total += size;
            console.log(`  ${String(size).padStart(8)}  ${f}`);
        }
        console.log(`  ${String(total).padStart(8)}  in all`);

        console.log('\nChecks:');
        const strays = files.filter((f) => f !== 'index.html' && f !== STATS_PAGE && f !== FAME_PAGE && f !== WEB_MANIFEST && !f.startsWith('assets/') && f !== READERS_MODULE && f !== VERIFIER_MODULE);
        check(strays.length === 0, `every file is index.html, ${STATS_PAGE}, ${FAME_PAGE}, ${WEB_MANIFEST}, under assets/, ${READERS_MODULE} or ${VERIFIER_MODULE}${strays.length ? `: not ${strays.join(', ')}` : ''}`);
        const foreign = files.filter((f) => !PAGE_TYPES.has(f.slice(f.lastIndexOf('.'))) && !PRINTED_SHEET.test(f));
        check(foreign.length === 0, `every file is of the page's own types${foreign.length ? `: not ${foreign.join(', ')}` : ''}`);
        check(!files.some((f) => f.includes('gamefiles')), 'no game files');

        const html = readFileSync(join(outDir, 'index.html'), 'utf8');
        const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1])
            .filter((u) => !/^(?:[a-z]+:|#)/i.test(u));
        check(refs.length >= 2, `index.html names its script and its icon (${refs.join(', ')})`);
        const missing = refs.filter((u) => !files.includes(u.replace(/^\.\//, '')));
        check(missing.length === 0, `every file index.html names is in the build${missing.length ? `: not ${missing.join(', ')}` : ''}`);
        check(/<link rel="manifest" href="\.\/manifest\.webmanifest">/.test(html), `index.html links ${WEB_MANIFEST}`);
        for (const [page, what] of [[STATS_PAGE, 'the statistics page'], [FAME_PAGE, 'the Hall of Fame']] as const) {
            const pageHtml = readFileSync(join(outDir, page), 'utf8');
            const pageRefs = [...pageHtml.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]!.replace(/^\.\//, ''));
            // The scripts the page loads: those it names, and every one they import.
            const loaded = new Set(pageRefs.filter((f) => f.endsWith('.js')));
            for (const f of loaded) for (const m of readFileSync(join(outDir, f), 'utf8').matchAll(/from\s*"\.\/([^"]+\.js)"/g)) loaded.add(`assets/${m[1]}`);
            const loadedBytes = [...loaded].reduce((sum, f) => sum + (files.includes(f) ? statSync(join(outDir, f)).size : 0), 0);
            console.log(`  ${page} loads ${[...loaded].join(', ')}: ${loadedBytes} bytes`);
            check(pageRefs.every((f) => files.includes(f)) && !pageHtml.includes(WEB_MANIFEST),
                `every file ${page} names is in the build, and not ${WEB_MANIFEST}: ${what} is no app`);
            check(loaded.size >= 1 && ![...loaded].some((f) => /\/main-[^/]+\.js$/.test(f)) && loadedBytes < STATS_PAGE_BYTES,
                `${page} loads none of the game's code: not its entry, and ${loadedBytes} bytes of script in all, under ${STATS_PAGE_BYTES}`);
        }
        const webManifest = JSON.parse(readFileSync(join(outDir, WEB_MANIFEST), 'utf8')) as
            { start_url: string; scope: string; display: string; orientation: string; icons: { src: string; sizes: string; purpose: string }[] };
        console.log(`  ${WEB_MANIFEST}: ${webManifest.display}, ${webManifest.orientation}, icons ${webManifest.icons.map((i) => `${i.src} ${i.sizes} ${i.purpose}`).join(', ')}`);
        check(webManifest.start_url === './' && webManifest.scope === './' && webManifest.display === 'fullscreen' && webManifest.orientation === 'landscape',
            'the manifest installs the page\'s folder, fullscreen and in landscape');
        const pngSize = (f: string) => { const png = readFileSync(join(outDir, f)); return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`; };
        const icons = webManifest.icons.filter((i) => /^assets\/[^/]+\.png$/.test(i.src) && files.includes(i.src) && pngSize(i.src) === i.sizes);
        check(icons.length === webManifest.icons.length && ['192x192', '512x512'].every((s) => icons.some((i) => i.sizes === s && i.purpose === 'any'))
            && icons.some((i) => i.purpose === 'maskable'),
            'its icons are hashed assets the build holds, at the sizes it names: 192 and 512, and a maskable one');

        const bundle = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf8')).join('');
        check(!bundle.includes('__probe'), 'the bundle hands the probes no handle');
        // Vite inlines a file under its 4 KiB limit as a data: URL: swoosh.img is 3016 bytes.
        const swoosh = readFileSync(SWOOSH_IMAGE).toString('base64');
        check((bundle.includes(swoosh) || files.some((f) => /^assets\/swoosh-[^/]+\.img$/.test(f))) && files.some((f) => /^assets\/swoosh-[^/]+\.wav$/.test(f)),
            'the FTL logo is in the build: swoosh.img, in the bundle or a file of its own, and swoosh.wav');

        console.log('\nThe server\'s check:');
        const module = readFileSync(join(outDir, READERS_MODULE), 'utf8');
        const imports = module.match(/^\s*(?:import|export\s.*\sfrom)\s.*$|\bimport\(|\brequire\(/gm) ?? [];
        check(imports.length === 0, `${READERS_MODULE} imports nothing${imports.length ? `: not ${imports.join(', ')}` : ''}`);
        const readers = await loadPageReaders(outDir);
        const { checkDataSet: built, readDungeonWalls: builtWalls, readRecordingPackage: builtPackage, achievementDefs: builtDefs } = readers;
        const commonText = readFileSync(resolve(ROOT, 'src/engine/achievements/defs/common.txt'), 'utf8');
        const dmText = readFileSync(resolve(ROOT, 'tools/achievements/dungeon-master.txt'), 'utf8');
        const hallStore = new DataSetStore(openStore(':memory:'));
        hallStore.fill(parseManifest(readFileSync(MANIFEST_FILE, 'utf8'), ''));
        const { achievementDefs: hallOf, achievementsAcross: acrossOf, achievementsCheck } = folderAchievements(resolve(ROOT, GAMEFILES_DIR), hallStore, readers);
        const reserved = achievementsCheck();
        console.log(`  the families a player's set may not declare: ${[...reserved.reservedFamilies].sort().join(', ')}`);
        check(reserved.common === commonText && ['dm-atari', 'dm-amiga', 'csb', 'dungeon-master'].every((family) => reserved.reservedFamilies.has(family)),
            'the built readers give the source\'s common file, and reserve each site\'s set\'s id and the family its file declares');
        const base = (set: string): DataSetFolder | null => set === 'dm-atari' || set === 'csb' ? folder(set) : null;
        const drafts: [string, DataSetDraft, boolean][] = [
            ['DM, on its base set\'s graphics.dat', draftOf('dm-atari', ['dungeon.dat']), true],
            ['CSB, with its own graphics.dat', draftOf('csb', ['dungeon.dat', 'graphics.dat']), true],
            ['a dungeon.dat that does not read', draftOf('dm-atari', [], { 'dungeon.dat': new Blob([new Uint8Array(3)]) }), false],
            ['DM with its achievements, their family the site\'s', draftOf('dm-atari', ['dungeon.dat'], { 'achievements.txt': new Blob([dmText]) }), false],
        ];
        for (const [what, draft, makesRecord] of drafts) {
            const said = async (check: typeof built) => {
                const { problems, record, census, walls } = await check(draft, new Set(), base, 0, reserved);
                return JSON.stringify({ problems, record: record && { ...record, files: undefined }, census, walls });
            };
            const fromBuild = await said(built), fromSource = await said(checkLocalDataSet);
            const { problems, record } = JSON.parse(fromBuild);
            console.log(`  ${what}: ${record ? `a record, signature ${record.dungeonSignature[0].slice(0, 12)}…` : problems.map((p: { about: string; text: string }) => `${p.about}: ${p.text}`).join('; ')}`);
            check((record !== null) === makesRecord, `${what}: ${makesRecord ? 'a record' : 'no record'}`);
            check(fromBuild === fromSource, `${what}: the built check says what the source's does`);
            const bytes = new Uint8Array(await draft.files['dungeon.dat']!.arrayBuffer());
            const wallsOf = (read: typeof builtWalls) => read(bytes).then((walls) => JSON.stringify(walls), (error: Error) => `throws: ${error.message}`);
            check(await wallsOf(builtWalls) === await wallsOf(readDungeonWalls), `${what}: the built reader of its walls says what the source's does`);
        }
        const won = await packageOf('dm-atari', 'A win', { extras: true });
        const packages: [string, Uint8Array, number][] = [['a package', won, 1 << 20], ['a package past the limit', won, 100], ['bytes that are no package', new Uint8Array([1, 2, 3]), 1 << 20]];
        for (const [what, bytes, limit] of packages) {
            const read = (reader: typeof builtPackage) => reader(bytes, limit).then((pkg) => JSON.stringify(pkg), (error: Error) => `throws: ${error.message}`);
            const fromBuild = await read(builtPackage);
            console.log(`  ${what}: ${fromBuild.startsWith('throws') ? fromBuild : `${fromBuild.length} characters of JSON`}`);
            check(fromBuild === await read(readRecordingPackage), `${what}: the built reader of a package says what the source's does`);
        }
        const sourceDefs = setAchievementDefs(commonText, dmText);
        const hallDefs = hallOf('dm-atari');
        console.log(`  the achievements of dm-atari, its folder's file merged with the common one: ${hallDefs?.length ?? 'none'}`);
        check(hallDefs !== null && JSON.stringify(hallDefs) === JSON.stringify(sourceDefs), 'the built achievements, which the Hall of Fame lists, are the source\'s, of the set\'s folder');
        const kids = hallOf('kids-dungeon'), unknown = hallOf('nowhere-at-all');
        console.log(`  of the Kids dungeon, whose folder has no file, and of a set the table does not hold: ${kids?.length ?? 'none'}, ${unknown?.length ?? 'none'}`);
        check(JSON.stringify(kids) === JSON.stringify(setAchievementDefs(commonText, null)) && JSON.stringify(unknown) === JSON.stringify(kids),
            'a set without a file of its own has the common achievements alone');
        check(builtDefs('# CSBweb achievements 1\n[a]\nname: A\n') === null, 'a set\'s file that does not read gives no achievements');
        const keyOf = (id: string) => sourceDefs.find((def) => def.id === id)!;
        const figures = { [keyOf('encore').games[0]!.key]: 1, [`total(${keyOf('dungeon-janitor').aggregates[0]!.key})`]: 300 };
        const games = (n: number) => Array.from({ length: n }, () => figures);
        const only = (id: string, n: number) => new Map([[id, games(n)]]);
        const across = [acrossOf('dm-atari', only('dm-atari', 2)), acrossOf('dm-atari', only('dm-atari', 3)), acrossOf('nowhere-at-all', only('nowhere-at-all', 3))]
            .map((ids) => ids.join('+'));
        console.log(`  across games, two games won, three, and of a set without a file of its own: ${JSON.stringify(across)}`);
        check(JSON.stringify(across) === JSON.stringify(['dungeon-janitor', 'dungeon-janitor+encore', 'dungeon-janitor+encore']),
            'the built achievements across games, which the Hall works out of the proofs\' figures');
        const wins = { [keyOf('encore').games[0]!.key]: 1 };
        const slams = [acrossOf('dm-atari', new Map([['dm-amiga', [wins]], ['csb', [wins]]])), acrossOf('csb', new Map([['dm-amiga', [wins]], ['csb', [wins]]])),
            acrossOf('csb', new Map([['csb', [wins, wins]]]))].map((ids) => ids.join('+'));
        console.log(`  Dungeon Master won on the Amiga and Chaos Strikes Back, as the Atari's set and CSB's, and CSB alone: ${JSON.stringify(slams)}`);
        check(JSON.stringify(slams) === JSON.stringify(['grand-slam', 'grand-slam', '']), 'the built Grand Slam reads every Dungeon Master set\'s games and CSB\'s');

        console.log('\nThe verifier\'s module:');
        const verifier = readFileSync(join(outDir, VERIFIER_MODULE), 'utf8');
        const verifierImports = verifier.match(/^\s*(?:import|export\s.*\sfrom)\s.*$|\bimport\(|\brequire\(/gm) ?? [];
        check(verifierImports.length === 0, `${VERIFIER_MODULE} imports nothing${verifierImports.length ? `: not ${verifierImports.join(', ')}` : ''}`);
        const { replay } = await loadVerifierReaders(outDir);
        const db = openStore(':memory:');
        const dataSets = new DataSetStore(db);
        dataSets.fill(parseManifest(readFileSync(MANIFEST_FILE, 'utf8'), ''));
        const sets = await verifierSets(dataSets, resolve(ROOT, GAMEFILES_DIR), new FileDigestCache());
        const common = sourceDefs;
        const proofs: [string, Uint8Array][] = [
            ['a genuine recording', new Uint8Array(readFileSync(join(CORPUS_DIR, 'replay-saves-written-over.L5.gz')))],
            ['bytes that are no package', new Uint8Array([1, 2, 3])],
        ];
        for (const [what, bytes] of proofs) {
            const fromBuild = JSON.stringify(await replay(bytes, 1 << 25, sets));
            console.log(`  ${what}: ${fromBuild}`);
            check(fromBuild === JSON.stringify(await replayProof(bytes, 1 << 25, sets, () => common)), `${what}: the built replay says what the source's does`);
        }
        check(JSON.parse(JSON.stringify(await replay(proofs[0]![1], 1 << 25, sets))).unlocked?.includes('first-blood') === true, 'the built replay of the genuine recording unlocks First Blood');
        db.close();
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }

    finish();
    process.exit();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
