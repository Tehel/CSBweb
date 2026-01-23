import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type {
  ClothingRecord,
  ContainerRecord,
  DungeonData,
  MiscRecord,
  PotionRecord,
  ScrollRecord,
  WeaponRecord,
} from '../src/data/dungeonTypes';

interface ToolOptions {
  file: string;
  out: string;
}

interface RecordEntry<T> {
  index: number;
  record: T;
}

interface DefinedItemsDump {
  file: string;
  counts: {
    weapons: number;
    clothing: number;
    scrolls: number;
    potions: number;
    containers: number;
    misc: number;
  };
  items: {
    weapons: Array<RecordEntry<WeaponRecord>>;
    clothing: Array<RecordEntry<ClothingRecord>>;
    scrolls: Array<RecordEntry<ScrollRecord>>;
    potions: Array<RecordEntry<PotionRecord>>;
    containers: Array<RecordEntry<ContainerRecord>>;
    misc: Array<RecordEntry<MiscRecord>>;
  };
}

function parseArgs(argv: string[]): ToolOptions {
  const options: ToolOptions = {
    file: 'static/gamefiles/dm-atari/dungeon.dat',
    out: 'tools/output/defined-items.json',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      options.file = argv[i + 1] ?? options.file;
      i++;
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      options.out = argv[i + 1] ?? options.out;
      i++;
      continue;
    }
  }

  return options;
}

function mapRecords<T>(records: T[]): Array<RecordEntry<T>> {
  return records.map((record, index) => ({ index, record }));
}

function buildDump(data: DungeonData, file: string): DefinedItemsDump {
  const weapons = mapRecords(data.databases.weapons.records);
  const clothing = mapRecords(data.databases.clothing.records);
  const scrolls = mapRecords(data.databases.scrolls.records);
  const potions = mapRecords(data.databases.potions.records);
  const containers = mapRecords(data.databases.containers.records);
  const misc = mapRecords(data.databases.misc.records);

  return {
    file,
    counts: {
      weapons: weapons.length,
      clothing: clothing.length,
      scrolls: scrolls.length,
      potions: potions.length,
      containers: containers.length,
      misc: misc.length,
    },
    items: {
      weapons,
      clothing,
      scrolls,
      potions,
      containers,
      misc,
    },
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const filePath = resolve(process.cwd(), options.file);
  const bytes = new Uint8Array(readFileSync(filePath));
  const loader = new DungeonLoader();
  const data = loader.loadFromArray(bytes);
  const dump = buildDump(data, options.file);

  const outPath = resolve(process.cwd(), options.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log(`Wrote ${dump.counts.weapons + dump.counts.clothing + dump.counts.scrolls + dump.counts.potions + dump.counts.containers + dump.counts.misc} items to ${options.out}`);
}

main();
