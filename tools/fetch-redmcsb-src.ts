/**
 * Fetch ReDMCSB's source, the reference for what only the Amiga release does, into
 * `doc/ReDMCSB-src/` (`doc/AMIGA_DISK_REFERENCE.md` → "The reference"). It is Christophe
 * Fontanel's `ReDMCSB_WIP20210206.7z`, the reverse-engineered source of every DM and CSB
 * release, not ours to commit, so the tree is git-ignored and this tool rebuilds it.
 *
 * The archive comes from dmweb.free.fr, or from the Wayback Machine's copy when the site
 * does not answer, and must have `SHA256`: every `FILE.C:line` the docs cite is a line of
 * this one build. `7z` (or `7zz`, `7za`), which must be on the PATH, unpacks two of its
 * folders: `Toolchains/Common/Source/`, the code, whose files the tree holds at its top, and
 * `Documentation/`, which it holds as `Documentation/`. The rest (the toolchains, the
 * emulators, the reference binaries) is left out. The code and the pages (`TEXT`) lose
 * every CR, and the pictures and the spreadsheet are kept as published.
 *
 * Run:
 *
 *   npm run fetch-redmcsb-src              # write the tree, unless it is there and equal
 *   npm run fetch-redmcsb-src -- --check   # only compare the tree with the archive's
 *
 * A tree that is there and differs (a file changed, missing or extra) is left as it is: the
 * tool names the files and exits with 1. Move it aside to fetch a clean one.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ARCHIVE = 'ReDMCSB_WIP20210206.7z';
const SHA256 = '58de16a34476a1ac2349ca01a4768cdecbadc9929fed0b69e8b9698f996159d1';
const SOURCES = [
  `http://dmweb.free.fr/Stuff/${ARCHIVE}`,
  `https://web.archive.org/web/20260106192653id_/http://dmweb.free.fr/Stuff/${ARCHIVE}`,
];
/** The archive's folders the tree holds, each with where it holds it. */
const FOLDERS: [from: string, to: string][] = [['Toolchains/Common/Source', ''], ['Documentation', 'Documentation']];
/** The files whose CRs are removed: the code and the pages, not the pictures or the spreadsheet. */
const TEXT = /\.(C|H|htm|css)$/;
const TREE = resolve('doc/ReDMCSB-src');

const checkOnly = process.argv.includes('--check');

async function download(): Promise<Uint8Array> {
  for (const url of SOURCES) {
    try {
      const answer = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
      const bytes = new Uint8Array(await answer.arrayBuffer());
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== SHA256) throw new Error(`SHA-256 ${sha}, not ${SHA256}`);
      console.log(`${ARCHIVE}: ${bytes.length} bytes from ${url}`);
      return bytes;
    } catch (error) {
      console.error(`${url}: ${(error as Error).message}`);
    }
  }
  throw new Error(`no source gave ${ARCHIVE}`);
}

/** Every file under `dir`, by its path below it. */
function filesUnder(dir: string, below = ''): string[] {
  return readdirSync(join(dir, below), { withFileTypes: true }).flatMap((entry) => {
    const path = below ? `${below}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(dir, path) : [path];
  });
}

/** The archive's `FOLDERS`, as the tree holds them: path to bytes. */
function unpack(archive: Uint8Array): Map<string, Uint8Array> {
  const scratch = mkdtempSync(join(tmpdir(), 'redmcsb-src-'));
  try {
    writeFileSync(join(scratch, ARCHIVE), archive);
    const out = join(scratch, 'x');
    const sevenZip = ['7z', '7zz', '7za'].find((name) => !spawnSync(name, ['i'], { stdio: 'ignore' }).error);
    if (sevenZip === undefined) throw new Error('no 7z on the PATH (7-Zip, or p7zip-full)');
    const run = spawnSync(sevenZip, ['x', '-y', `-o${out}`, join(scratch, ARCHIVE), ...FOLDERS.map(([from]) => `${from}/*`)],
      { stdio: ['ignore', 'ignore', 'inherit'] });
    if (run.status !== 0) throw new Error(`${sevenZip} exited with ${run.status}`);
    const files = new Map<string, Uint8Array>();
    for (const [from, to] of FOLDERS) {
      for (const path of filesUnder(join(out, from)).sort()) {
        const bytes = new Uint8Array(readFileSync(join(out, from, path)));
        files.set(to ? `${to}/${path}` : path, TEXT.test(path) ? bytes.filter((b) => b !== 0x0d) : bytes);
      }
    }
    return files;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The tree's differences from the archive's files: changed, missing and extra paths. */
function differences(files: Map<string, Uint8Array>): string[] {
  const found = new Set(filesUnder(TREE));
  const lines: string[] = [];
  for (const [path, bytes] of files) {
    if (!found.has(path)) lines.push(`missing ${path}`);
    else if (!Buffer.from(bytes).equals(readFileSync(join(TREE, path)))) lines.push(`changed ${path}`);
  }
  for (const path of found) if (!files.has(path)) lines.push(`extra ${path}`);
  return lines;
}

const files = unpack(await download());
if (existsSync(TREE)) {
  const lines = differences(files);
  if (lines.length > 0) {
    console.error(`doc/ReDMCSB-src/ differs from ${ARCHIVE}:\n  ${lines.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`doc/ReDMCSB-src/ is ${ARCHIVE}'s ${files.size} files.`);
} else if (checkOnly) {
  console.error('doc/ReDMCSB-src/ is missing: run npm run fetch-redmcsb-src.');
  process.exit(1);
} else {
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(TREE, path)), { recursive: true });
    writeFileSync(join(TREE, path), bytes);
  }
  console.log(`doc/ReDMCSB-src/: ${files.size} files written from ${ARCHIVE}.`);
}
