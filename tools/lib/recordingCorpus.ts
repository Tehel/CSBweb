/**
 * The corpus of the port's own recordings (`doc/RECORDING.md` → "The corpus"): packages kept in `tools/fixtures/recordings/`, each named for what it plays
 * and the engine's level it was made at, `<name>.L<level>.gz`, which
 * `tools/checks/recording-corpus.ts` plays at their levels. A package written here is
 * never rewritten but by a migration of the package's format that keeps its content
 * (`utils/migrate-recording-packages.ts --file`): at a level of its own, it is the proof
 * that the flags of the levels after it keep its behaviour.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';

import { writeRecordingPackage, type RecordingPackage } from '../../src/engine/RecordingPackage';

export const CORPUS_DIR = 'tools/fixtures/recordings';

/** A corpus file's name: what it plays, and its level. */
export const CORPUS_FILE = /^([a-z0-9][a-z0-9-]*)\.L(0|[1-9][0-9]*)\.gz$/i;

/** The file `name`'s package of `level` is kept in. */
export function corpusFile(name: string, level: number): string {
  const file = `${name}.L${level}.gz`;
  if (!CORPUS_FILE.test(file)) throw new Error(`${file} is not a corpus file's name`);
  return `${CORPUS_DIR}/${file}`;
}

/** The corpus's files, by name. */
export function corpusFiles(): string[] {
  return existsSync(CORPUS_DIR) ? readdirSync(CORPUS_DIR).filter((file) => file.endsWith('.gz')).sort() : [];
}

/**
 * `pkg` written to the corpus as `name` at its level, where the corpus has none of that
 * name and level: its path, or `null` where it had one, which is kept.
 */
export async function keepInCorpus(name: string, pkg: RecordingPackage): Promise<string | null> {
  const path = corpusFile(name, pkg.level);
  if (existsSync(path)) return null;
  mkdirSync(CORPUS_DIR, { recursive: true });
  writeFileSync(path, await writeRecordingPackage(pkg));
  return path;
}
