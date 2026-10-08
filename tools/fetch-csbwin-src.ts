/**
 * Fetch CSBWin's C++ source, the port's specification, into `doc/CSBwin-src/`
 * (`doc/CSBWIN_REFERENCE_INDEX.md`). It is Paul R. Stevens' `CSBwin_SRC_20230608.7z`, not
 * ours to commit, so the tree is git-ignored and this tool rebuilds it.
 *
 * The archive comes from his site, or from the Wayback Machine's copy when the site does not
 * answer, and must have `SHA256`: every `File.cpp:line` the docs and the code cite is a line
 * of this one build. `7z` (or `7zz`, `7za`), which must be on the PATH, unpacks its `src/`.
 * The source and text files (`TEXT`) lose every CR, and the project, build and binary files
 * are kept as published: that gives, byte for byte, the tree the docs were written against.
 *
 * Run:
 *
 *   npm run fetch-csbwin-src              # write the tree, unless it is there and equal
 *   npm run fetch-csbwin-src -- --check   # only compare the tree with the archive's
 *
 * A tree that is there and differs (a file changed, missing or extra) is left as it is: the
 * tool names the files and exits with 1. Move it aside to fetch a clean one.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ARCHIVE = 'CSBwin_SRC_20230608.7z';
const SHA256 = '4a3c57265c2cdd1d8555f17493eda0945e3d5a48fc8e4b51e247194699144157';
const SOURCES = [
  `https://www.dianneandpaul.net/CSBwin/${ARCHIVE}`,
  `https://web.archive.org/web/20260409155801id_/https://www.dianneandpaul.net/CSBwin/${ARCHIVE}`,
];
/** The files whose CRs are removed: the code and the text, not the project or build files. */
const TEXT = /(\.(cpp|h|inl|c|rc|txt)|^README)$/;
const TREE = resolve('doc/CSBwin-src');

const checkOnly = process.argv.includes('--check');

async function download(): Promise<Uint8Array> {
  for (const url of SOURCES) {
    try {
      const answer = await fetch(url, { signal: AbortSignal.timeout(120_000) });
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

/** The archive's `src/`, as the tree holds it: file name to bytes. */
function unpack(archive: Uint8Array): Map<string, Uint8Array> {
  const scratch = mkdtempSync(join(tmpdir(), 'csbwin-src-'));
  try {
    writeFileSync(join(scratch, ARCHIVE), archive);
    const out = join(scratch, 'x');
    const sevenZip = ['7z', '7zz', '7za'].find((name) => !spawnSync(name, ['i'], { stdio: 'ignore' }).error);
    if (sevenZip === undefined) throw new Error('no 7z on the PATH (7-Zip, or p7zip-full)');
    const run = spawnSync(sevenZip, ['x', '-y', `-o${out}`, join(scratch, ARCHIVE)], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (run.status !== 0) throw new Error(`${sevenZip} exited with ${run.status}`);
    const files = new Map<string, Uint8Array>();
    for (const name of readdirSync(join(out, 'src')).sort()) {
      const bytes = new Uint8Array(readFileSync(join(out, 'src', name)));
      files.set(name, TEXT.test(name) ? bytes.filter((b) => b !== 0x0d) : bytes);
    }
    return files;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The tree's differences from the archive's files: changed, missing and extra names. */
function differences(files: Map<string, Uint8Array>): string[] {
  const found = new Set(readdirSync(TREE));
  const lines: string[] = [];
  for (const [name, bytes] of files) {
    if (!found.has(name)) lines.push(`missing ${name}`);
    else if (!Buffer.from(bytes).equals(readFileSync(join(TREE, name)))) lines.push(`changed ${name}`);
  }
  for (const name of found) if (!files.has(name)) lines.push(`extra ${name}`);
  return lines;
}

const files = unpack(await download());
if (existsSync(TREE)) {
  const lines = differences(files);
  if (lines.length > 0) {
    console.error(`doc/CSBwin-src/ differs from ${ARCHIVE}:\n  ${lines.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`doc/CSBwin-src/ is ${ARCHIVE}'s ${files.size} files.`);
} else if (checkOnly) {
  console.error('doc/CSBwin-src/ is missing: run npm run fetch-csbwin-src.');
  process.exit(1);
} else {
  mkdirSync(TREE, { recursive: true });
  for (const [name, bytes] of files) writeFileSync(join(TREE, name), bytes);
  console.log(`doc/CSBwin-src/: ${files.size} files written from ${ARCHIVE}.`);
}
