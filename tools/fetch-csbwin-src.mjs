// Fetch CSBWin's C++ source, the port's specification, into doc/CSBwin-src/. It is Paul R.
// Stevens' CSBwin_SRC_20160923.zip ("Version 15.9"), not ours to commit, so the tree is
// git-ignored and this script rebuilds it.
//
// The archive comes from his site, or from the Wayback Machine's copy when the site does
// not answer, and must have SHA256: every File.cpp:line the docs cite is a line of this one
// build. 7z (or 7zz, 7za), which must be on the PATH, unpacks its CSBwin/. Every text file
// (no NUL byte, no lone CR) has its CRLFs turned to LF; UpgradeLog.htm, Visual Studio's
// report, is left out.
//
//   npm run fetch-csbwin-src              # write the tree, unless it is there and equal
//   npm run fetch-csbwin-src -- --check   # only compare the tree with the archive's
//
// A tree that is there and differs (a file changed, missing or extra) is left as it is: the
// script names the files and exits with 1. Move it aside to fetch a clean one.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ARCHIVE = 'CSBwin_SRC_20160923.zip';
const SHA256 = 'f1f379f09137a65ebfeb977e6cb8244a5d6927370fbd6055b7ead2fd4b1766e7';
const SOURCES = [
  `https://www.dianneandpaul.net/CSBwin/${ARCHIVE}`,
  `https://web.archive.org/web/20170307055210id_/http://dianneandpaul.net/CSBwin/${ARCHIVE}`,
];
const LEFT_OUT = new Set(['UpgradeLog.htm']);
const TREE = resolve('doc/CSBwin-src');

const checkOnly = process.argv.includes('--check');

async function download() {
  for (const url of SOURCES) {
    try {
      const answer = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
      const bytes = Buffer.from(await answer.arrayBuffer());
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== SHA256) throw new Error(`SHA-256 ${sha}, not ${SHA256}`);
      console.log(`${ARCHIVE}: ${bytes.length} bytes from ${url}`);
      return bytes;
    } catch (error) {
      console.error(`${url}: ${error.message}`);
    }
  }
  throw new Error(`no source gave ${ARCHIVE}`);
}

/** A text file's CRLFs as LF; a file with a NUL byte or a lone CR as it is. */
function normalize(bytes) {
  if (bytes.includes(0)) return bytes;
  const text = bytes.toString('latin1');
  if (/\r(?!\n)/.test(text)) return bytes;
  return Buffer.from(text.replace(/\r\n/g, '\n'), 'latin1');
}

/** The archive's CSBwin/, as the tree holds it: file name to bytes. */
function unpack(archive) {
  const scratch = mkdtempSync(join(tmpdir(), 'csbwin-src-'));
  try {
    writeFileSync(join(scratch, ARCHIVE), archive);
    const out = join(scratch, 'x');
    const sevenZip = ['7z', '7zz', '7za'].find((name) => !spawnSync(name, ['i'], { stdio: 'ignore' }).error);
    if (sevenZip === undefined) throw new Error('no 7z on the PATH (7-Zip, or p7zip-full)');
    const run = spawnSync(sevenZip, ['x', '-y', `-o${out}`, join(scratch, ARCHIVE)], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (run.status !== 0) throw new Error(`${sevenZip} exited with ${run.status}`);
    const files = new Map();
    for (const name of readdirSync(join(out, 'CSBwin')).sort()) {
      if (!LEFT_OUT.has(name)) files.set(name, normalize(readFileSync(join(out, 'CSBwin', name))));
    }
    return files;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The tree's differences from the archive's files: changed, missing and extra names. */
function differences(files) {
  const found = new Set(readdirSync(TREE));
  const lines = [];
  for (const [name, bytes] of files) {
    if (!found.has(name)) lines.push(`missing ${name}`);
    else if (!bytes.equals(readFileSync(join(TREE, name)))) lines.push(`changed ${name}`);
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
