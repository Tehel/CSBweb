import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { extractPresetHeroes } from '../src/data/HeroExtractor';

interface ToolOptions {
  file: string;
  out?: string;
  trace: boolean;
}

function parseArgs(argv: string[]): ToolOptions {
  const options: ToolOptions = {
    file: 'static/gamefiles/dm-atari/dungeon.dat',
    trace: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      options.file = argv[i + 1] ?? options.file;
      i++;
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      options.out = argv[i + 1];
      i++;
      continue;
    }
    if (arg === '--trace') {
      options.trace = true;
    }
  }

  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const filePath = resolve(process.cwd(), options.file);
  const bytes = new Uint8Array(readFileSync(filePath));
  const loader = new DungeonLoader();
  const data = loader.loadFromArray(bytes);

  const heroes = extractPresetHeroes(data);
  const payload = { count: heroes.length, heroes };

  if (options.out) {
    writeFileSync(resolve(process.cwd(), options.out), JSON.stringify(payload, null, 2));
    console.log(`Wrote ${heroes.length} heroes to ${options.out}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

main();
