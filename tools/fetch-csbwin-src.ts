/**
 * Fetch CSBWin's C++ source, the port's specification, into `doc/CSBwin-src/`
 * (`doc/CSBWIN_REFERENCE_INDEX.md`). It is Paul R. Stevens' `CSBwin_SRC_20230608.7z`, not
 * ours to commit, so the tree is git-ignored and this tool rebuilds it.
 *
 * `--version=<v>` fetches an older source instead, into `doc/CSBwin-src-<v>/`: the sources
 * the profiles of the older CSBWin versions are read from (`DEBT.md` R18, step 5), never
 * cited as the specification. `11.014` is `CSBwin11_014Source.7z`, the last source before
 * the 11.017 and 11.018 runs, `11.056` is `CSBwin11_056src.zip`, the first after them.
 *
 * The archive comes from his site, or from the Wayback Machine's copy when the site does not
 * answer, and must have its `sha256`: every `File.cpp:line` the docs and the code cite is a
 * line of one build. `7z` (or `7zz`, `7za`), which must be on the PATH, unpacks its source
 * folder (`src`). The source and text files (`TEXT`) lose every CR, and the project, build
 * and binary files are kept as published: that gives, byte for byte, the tree the docs were
 * written against.
 *
 * Run:
 *
 *   npm run fetch-csbwin-src              # write the tree, unless it is there and equal
 *   npm run fetch-csbwin-src -- --check   # only compare the tree with the archive's
 *   npm run fetch-csbwin-src -- --version=11.014   # an older source, beside it
 *
 * A tree that is there and differs (a file changed, missing or extra) is left as it is: the
 * tool names the files and exits with 1. Move it aside to fetch a clean one.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** A source archive: its name, its digest, where it is, and the folder of it the tree is. */
interface Source {
  readonly archive: string;
  readonly sha256: string;
  readonly urls: readonly string[];
  /** The folder of the archive the tree holds, '' for its root. */
  readonly src: string;
}

const SITE = 'https://www.dianneandpaul.net/CSBwin/';
const VERSIONS: Readonly<Record<string, Source>> = {
  '2023': {
    archive: 'CSBwin_SRC_20230608.7z',
    sha256: '4a3c57265c2cdd1d8555f17493eda0945e3d5a48fc8e4b51e247194699144157',
    urls: [`${SITE}CSBwin_SRC_20230608.7z`, `https://web.archive.org/web/20260409155801id_/${SITE}CSBwin_SRC_20230608.7z`],
    src: 'src',
  },
  '11.014': {
    archive: 'CSBwin11_014Source.7z',
    sha256: '532bd80ccfcbc42ee386126283533837cf8c51a28e350448e626bdaad2ea1295',
    urls: [`${SITE}CSBwin11_014Source.7z`, 'https://web.archive.org/web/20161109141551id_/http://www.dianneandpaul.net/CSBwin/CSBwin11_014Source.7z'],
    src: 'CSBwin/src',
  },
  '11.056': {
    archive: 'CSBwin11_056src.zip',
    sha256: '1262382f0285c35c2841127d5e6fe4fa2d44795bd14daba93ab71b4f045b19c8',
    urls: [`${SITE}CSBwin11_056src.zip`, 'https://web.archive.org/web/20251029074446id_/http://www.dianneandpaul.net/CSBwin/CSBwin11_056src.zip'],
    src: '',
  },
};
/** The files whose CRs are removed: the code and the text, not the project or build files. */
const TEXT = /(\.(cpp|h|inl|c|rc|txt)|^README)$/;

const version = process.argv.find((a) => a.startsWith('--version='))?.slice('--version='.length) ?? '2023';
const SOURCE = VERSIONS[version];
if (SOURCE === undefined) {
  console.error(`no CSBWin source ${version}: ${Object.keys(VERSIONS).join(', ')}`);
  process.exit(1);
}
const { archive: ARCHIVE, sha256: SHA256 } = SOURCE;
const NAME = version === '2023' ? 'doc/CSBwin-src' : `doc/CSBwin-src-${version}`;
const TREE = resolve(NAME);

const checkOnly = process.argv.includes('--check');

async function download(): Promise<Uint8Array> {
  for (const url of SOURCE.urls) {
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

/** The archive's source folder, as the tree holds it: file name to bytes. */
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
    const folder = join(out, SOURCE.src);
    for (const name of readdirSync(folder).sort()) {
      const bytes = new Uint8Array(readFileSync(join(folder, name)));
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
    console.error(`${NAME}/ differs from ${ARCHIVE}:\n  ${lines.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`${NAME}/ is ${ARCHIVE}'s ${files.size} files.`);
} else if (checkOnly) {
  console.error(`${NAME}/ is missing: run npm run fetch-csbwin-src${version === '2023' ? '' : ` -- --version=${version}`}.`);
  process.exit(1);
} else {
  mkdirSync(TREE, { recursive: true });
  for (const [name, bytes] of files) writeFileSync(join(TREE, name), bytes);
  console.log(`${NAME}/: ${files.size} files written from ${ARCHIVE}.`);
}
