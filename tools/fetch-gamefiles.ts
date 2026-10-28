/**
 * Fetch the data sets the tests, the golden frames and the dev server read into
 * `tools/fixtures/gamefiles/`, one folder a set, as `tools/data-sets.json` names them, and a
 * library the tools read. They are FTL's and the fans' files, not ours to commit, so the
 * folder is git-ignored and this tool rebuilds it, byte for byte: every file must have its
 * `FILES` SHA-256, which is what the tools' assertions and the frames were written against.
 *
 * Each file comes from one of `ARCHIVES`, pinned by its SHA-256, tried at each of its
 * sources in turn (the publisher's site, then the Wayback Machine's copy, or the Dungeon
 * Master forum's shared OneDrive, `tools/lib/oneDrive.ts`):
 *
 * - the Atari ST disks of DM and CSB, as dmweb.free.fr keeps them: 1.1's dungeon (CSBWin's,
 *   `dm-atari`), 1.2 English's and 1.3 French's files, read from their Pasti images
 *   (`tools/lib/stx.ts`), and the CSB 2.1 utility disk's portraits;
 * - the Amiga 2.2 English disk of DM, as dmweb.free.fr keeps it: its program, `graphics.dat`
 *   and `Dungeon.dat`, read from its ADF (`tools/lib/adf.ts`) into `amiga-2.2/`, a folder
 *   that is not a set, which only the tools read (`doc/AMIGA_DISK_REFERENCE.md`), and
 *   `dm-amiga`'s dungeon;
 * - CSBWin's DM and CSB packages and 3D2D1D, from Paul R. Stevens' site: `dm-windows`, the
 *   `graphics.dat` the Kids dungeon plays, `csb`'s files, and `3D2D1D`;
 * - his `CSBgraphics.dat`, the designers' library no set plays, a file of its own on his site:
 *   `csbgraphics/`, another folder that is not a set, which only the tools read;
 * - Conflux 3.5 beta 8 (his site, or the OneDrive), The Towers of Chaos 3.3 and the Kids
 *   dungeon 24 (the OneDrive).
 *
 * Four steps make the rest, each by its own tool, in this order: `dm-atari`'s
 * `graphics.dat`, CSBWin's with three items of 1.2's (`tools/checks/dm-atari-graphics.ts
 * --write`); `dm-amiga`'s, `dm-atari`'s with the Amiga's credits, font, names and sounds
 * (`tools/checks/amiga-graphics.ts --write`); `csb`'s `utility-portraits.dat`, from the
 * utility disk (`tools/gen-utility-portraits.ts`); and every set's thumbnail
 * (`tools/gen-thumbnails.ts`).
 *
 * `7z` (or `7zz`, `7za`), which must be on the PATH, unpacks the archives. Nothing
 * extracted is run: the packages hold Windows programs, which are not read.
 *
 *   npm run fetch-gamefiles              # write the missing files, then check every one
 *   npm run fetch-gamefiles -- --check   # only check the files against FILES
 *
 * A file that is there is never written over: one that differs is named (changed, missing
 * or extra), and the tool exits with 1. Move it aside to fetch a clean one. Only the
 * archives a missing file needs are downloaded.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { thumbnailPath } from '../src/data/DataSets';
import { DATA_SETS, GAMEFILES_DIR } from './lib/dataSets';
import { adfFiles } from './lib/adf';
import { fetchOk, oneDriveCustomDungeons, oneDriveFiles } from './lib/oneDrive';
import { stxFiles } from './lib/stx';

/** A file of the shared OneDrive's `Custom Dungeons`: its folder, by the start of its name, and its path in it. */
interface OneDriveSource {
  folder: string;
  path: string;
}

interface Archive {
  file: string;
  sha256: string;
  sources: (string | OneDriveSource)[];
  /** A file served as it is, not an archive: it is copied, not unpacked. */
  plain?: true;
}

const DMWEB = 'http://dmweb.free.fr/files';
const PAUL = 'https://www.dianneandpaul.net/CSBwin';

const ARCHIVES = {
  dmAtari: {
    file: 'Game,Dungeon_Master,Atari_ST,Software.7z',
    sha256: 'be61def17c104cde187e802eaac40cc75ccb72799022bec8992cf4ba04fa4782',
    sources: [`${DMWEB}/Game,Dungeon_Master,Atari_ST,Software.7z`,
      `https://web.archive.org/web/20260106190803id_/${DMWEB}/Game,Dungeon_Master,Atari_ST,Software.7z`],
  },
  dmAmiga: {
    file: 'Game,Dungeon_Master,Amiga,Software.7z',
    sha256: '79fe5438ffa9dceb2f61346cf390bc41b052cf36c6f558389e76ce78ec72e0ea',
    sources: [`${DMWEB}/Game,Dungeon_Master,Amiga,Software.7z`,
      `https://web.archive.org/web/20260106192334id_/${DMWEB}/Game,Dungeon_Master,Amiga,Software.7z`],
  },
  csbAtari: {
    file: 'Game,Chaos_Strikes_Back,Atari_ST,Software.7z',
    sha256: 'ce6e638622a099bbf15e6dacd7750ce811a52373a20b2d0f92ef6332cc47d7f5',
    sources: [`${DMWEB}/Game,Chaos_Strikes_Back,Atari_ST,Software.7z`,
      `https://web.archive.org/web/20260106190754id_/${DMWEB}/Game,Chaos_Strikes_Back,Atari_ST,Software.7z`],
  },
  dmWindows: {
    file: 'DM_Windows_x86-32_20171117.zip',
    sha256: 'f18df08b1f404cec81388967fa0d3471a27f5f91d073f90a8693601996bd9244',
    sources: [`${PAUL}/Games/DM_Windows_x86-32_20171117.zip`,
      'https://web.archive.org/web/20260106181841id_/http://dianneandpaul.net/CSBwin/Games/DM_Windows_x86-32_20171117.zip'],
  },
  csbWindows: {
    file: 'CSB_Windows_x86-32_20151213.zip',
    sha256: '416157c0b5ea7e72a2ff42c7d2253f9155c2b8d2c7d994495aca0f4a8fbb2215',
    sources: [`${PAUL}/Games/CSB_Windows_x86-32_20151213.zip`,
      'https://web.archive.org/web/20260106181848id_/http://www.dianneandpaul.net/CSBwin/Games/CSB_Windows_x86-32_20151213.zip'],
  },
  threeD2D1D: {
    file: '3D2D1D_CSBwin.zip',
    sha256: '0a32ed74079496e3e32ced793e6cc7fca62693f2cc4127cbf2aaa8dda733c4ab',
    sources: [`${PAUL}/Games/3D2D1D_CSBwin.zip`],
  },
  csbGraphics: {
    file: 'CSBgraphics.dat',
    sha256: 'd9d181c622732ef7e82fc788c6fe03f8c1c1de0e8d93e28f00fe1d6741367adb',
    sources: [`${PAUL}/CSBgraphics.dat`,
      'https://web.archive.org/web/20250108232147id_/http://www.dianneandpaul.net/CSBwin/CSBgraphics.dat'],
    plain: true,
  },
  conflux: {
    file: 'Conflux_3.5_B8.7z',
    sha256: '3a36463af7e217c4aecb3618253647b1505a0187f59760d429a60c3b66f50e35',
    sources: [`${PAUL}/Conflux_3.5_B8.7z`,
      'https://web.archive.org/web/20251024185712id_/http://dianneandpaul.net/CSBwin/Conflux_3.5_B8.7z',
      { folder: 'Conflux III -', path: '/Conflux_III_3.5_B8_Windows.7z' }],
  },
  towersOfChaos: {
    file: 'The Towers of Chaos 3.3.zip',
    sha256: '918f9c0dff05028424daac0d0d3aedbef3f750991a358c43072b99e6752da1f4',
    sources: [{ folder: 'The Towers of Chaos [', path: '/The Towers of Chaos 3.3.zip' }],
  },
  kidsDungeon: {
    file: "Kid's-Dungeon-24.zip",
    sha256: '1e8c1c988168c916f10034688168beb10912fba1a5dce5d859b2bb4daf830e0f',
    sources: [{ folder: 'Kid Dungeon (Original) [', path: "/Kid's-Dungeon-24.zip" }],
  },
} satisfies Record<string, Archive>;

type ArchiveName = keyof typeof ARCHIVES;

/** Where a file comes from: a file of an archive, a file of a disk image in it (a Pasti image or an ADF, by its extension), or a step (`STEPS`). */
type Origin =
  | { archive: ArchiveName; path: string; disk?: string }
  | { step: StepName };

const DM_STX = 'Floppy Disks STX/Dungeon Master for Atati ST';
const DM_AMIGA_ADF = 'Floppy Disks ADF/Dungeon Master for Amiga v2.2 (English) Original (Not working).adf';
const CSB_UTILITY_STX = 'Floppy Disks STX/Chaos Strikes Back for Atari ST Utility Disk v2.1 (English).stx';

/** Every file of the folder, by its path under it: its SHA-256 and where it comes from. */
const FILES: Record<string, [sha256: string, origin: Origin]> = {
  'amiga-2.2/dm': ['a21ae6b9b0c85d9c524a1b2d4b2a744b6427840e478e413c9ff38b4f04a3a44e', { archive: 'dmAmiga', path: DM_AMIGA_ADF, disk: 'dm' }],
  'amiga-2.2/Dungeon.dat': ['f89f51bdecf95a5f9b9b4f70afb6381bdd2b7f6b571379ab33118d4a8b3d5c8b', { archive: 'dmAmiga', path: DM_AMIGA_ADF, disk: 'Dungeon.dat' }],
  'amiga-2.2/graphics.dat': ['e371fc45d1b279bb2fc4254587c5cb2d0194226e4a9f901c6dee2f5a86449b79', { archive: 'dmAmiga', path: DM_AMIGA_ADF, disk: 'graphics.dat' }],
  '3D2D1D/dungeon.dat': ['80e2610f3061f79ed4f9a50e32f29c2b4461b7e0ab570bcc92afc43a7e0fc6e7', { archive: 'threeD2D1D', path: 'dungeon.dat' }],
  '3D2D1D/graphics.dat': ['7cceef26a20acec6c5f9de659a6a0c57cdb24908687a2ca3a58e3c62cc6b0593', { archive: 'threeD2D1D', path: 'GRAPHICS.DAT' }],
  '3D2D1D/3d2d1d-thumbnail.png': ['bd45d907acabbd887626d67a70c0e094af1d5dd7e4d5f4fb9fcd7cb45b495b68', { step: 'thumbnails' }],
  'conflux-3.5-b8/CSBgraphics.dat': ['9c9ca81cb051ba7e3ab242e507ad482c0e7c24a89ddee0063fc5c68ffcb9f536', { archive: 'conflux', path: 'Conflux_3.5_B8/Files/CSBgraphics.dat' }],
  'conflux-3.5-b8/dungeon.dat': ['3097270c3e73dc96f3aa5d5c94b42f9f81a39a590036813ae5378aee6a677e23', { archive: 'conflux', path: 'Conflux_3.5_B8/Files/dungeon.dat' }],
  'conflux-3.5-b8/graphics.dat': ['94064802c1bd7e2b867e59b2a6dd605b204f6c5567e7097546548eed27677817', { archive: 'conflux', path: 'Conflux_3.5_B8/Files/graphics.dat' }],
  'conflux-3.5-b8/conflux-3.5-thumbnail.png': ['e2670aa65fa2b7c37272c55533001335534e7088155c263a74627367ebf6c56b', { step: 'thumbnails' }],
  'csbgraphics/CSBgraphics.dat': ['d9d181c622732ef7e82fc788c6fe03f8c1c1de0e8d93e28f00fe1d6741367adb', { archive: 'csbGraphics', path: 'CSBgraphics.dat' }],
  'csb/csbgame2.dat': ['105104b30dde164e7000d388f251f3d6d3f83a56959f28f56220711d1e9f3a9e', { archive: 'csbWindows', path: 'csbgame2.dat' }],
  'csb/dungeon.dat': ['3cafd2fb9f255df93e99ae27d4bf60ff22cc8e43cfa90de7d29c04172b2542ba', { archive: 'csbWindows', path: 'dungeon.dat' }],
  'csb/graphics.dat': ['7cceef26a20acec6c5f9de659a6a0c57cdb24908687a2ca3a58e3c62cc6b0593', { archive: 'csbWindows', path: 'graphics.dat' }],
  'csb/hcsb.dat': ['5268b36a108f582e043a0e698052ce6fe67d33132737a3dc2271caa3031e6fcc', { archive: 'csbWindows', path: 'hcsb.dat' }],
  'csb/hcsb.hct': ['1b2fbff81a11928afd153f46c117355cce1f9a93f482d14d58e35a115d9cde38', { archive: 'csbWindows', path: 'hcsb.hct' }],
  'csb/mini.dat': ['61d981061bbb7a81b9b7f4795e99c24a592ee329169eb0c195459ba4eb62e3a9', { archive: 'csbWindows', path: 'mini.dat' }],
  'csb/utility-portraits.dat': ['50ec780dccedd255bd6f323852db1a992a5cc0bc52e50432ebe01f3e2c1b5482', { step: 'utilityPortraits' }],
  'csb/csb-thumbnail.png': ['bd45d907acabbd887626d67a70c0e094af1d5dd7e4d5f4fb9fcd7cb45b495b68', { step: 'thumbnails' }],
  'dm-atari/dungeon.dat': ['a26f0edc4fb13e3d38551d91ad7c24f517257cfc689affe72d657f4e423853b2', { archive: 'dmAtari', path: `${DM_STX} v1.1 (English).stx`, disk: 'DUNGEON.DAT' }],
  'dm-atari/graphics.dat': ['b5f238d299207b11107881ffa113c362685362c00c9c109116fe872ce6531ac5', { step: 'dmAtariGraphics' }],
  'dm-atari/dm-atari-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'dm-amiga/dungeon.dat': ['f89f51bdecf95a5f9b9b4f70afb6381bdd2b7f6b571379ab33118d4a8b3d5c8b', { archive: 'dmAmiga', path: DM_AMIGA_ADF, disk: 'Dungeon.dat' }],
  'dm-amiga/graphics.dat': ['6909479a6d71a97aeecc732e9118ef54cff4311e4ab31fbe72d5398c02dc4332', { step: 'dmAmigaGraphics' }],
  'dm-amiga/dm-amiga-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'dm-atari-1.0a/dungeon.dat': ['f388d156d2533abb90efb1235194d9d4f90e041193d8190e6a1efab809acf681', { archive: 'dmAtari', path: `${DM_STX} v1.0 (English) 1987-12-08.stx`, disk: 'DUNGEON.DAT' }],
  'dm-atari-1.0a/graphics.dat': ['e0daae7b956c10ae94c097e5294c6eb5fce5b3280bd1e29d96f2c2a51d5a863f', { archive: 'dmAtari', path: `${DM_STX} v1.0 (English) 1987-12-08.stx`, disk: 'GRAPHICS.DAT' }],
  'dm-atari-1.0a/dm-atari-1.0a-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'dm-atari-1.0b/dungeon.dat': ['a43a07834444d868a6b67bbc414b1f2618973635caf505696ba86c1d30894ee8', { archive: 'dmAtari', path: `${DM_STX} v1.0 (English) 1987-12-11.stx`, disk: 'DUNGEON.DAT' }],
  'dm-atari-1.0b/graphics.dat': ['16180d645f9d9292cafd95a1a763ce0a7f893afba3c34619b618dfc368a1a20a', { archive: 'dmAtari', path: `${DM_STX} v1.0 (English) 1987-12-11.stx`, disk: 'GRAPHICS.DAT' }],
  'dm-atari-1.0b/dm-atari-1.0b-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'dm-atari-1.1/dungeon.dat': ['a26f0edc4fb13e3d38551d91ad7c24f517257cfc689affe72d657f4e423853b2', { archive: 'dmAtari', path: `${DM_STX} v1.1 (English).stx`, disk: 'DUNGEON.DAT' }],
  'dm-atari-1.1/graphics.dat': ['310eb7737e1756e67c7f16c048485c5c8b5bb8307fdcee695d199a065fda2003', { archive: 'dmAtari', path: `${DM_STX} v1.1 (English).stx`, disk: 'GRAPHICS.DAT' }],
  'dm-atari-1.1/dm-atari-1.1-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'dm-atari-1.2/dungeon.dat': ['0db918d30a2cca24da067f72f8a050366a739cbbaf4bca50300e2556314f667e', { archive: 'dmAtari', path: `${DM_STX} v1.2 (English).stx`, disk: 'DUNGEON.DAT' }],
  'dm-atari-1.2/graphics.dat': ['b4ab5f43d06193d76976eaead3be4aa941a74367bc84a0f2a3b00ad44756aa30', { archive: 'dmAtari', path: `${DM_STX} v1.2 (English).stx`, disk: 'GRAPHICS.DAT' }],
  'dm-atari-1.2/dm-atari-1.2-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'dm-atari-1.2-de/dungeon.dat': ['85e2017ec6bec3d27389cca6d2b3fcd201025f6f9775363fa483ba2ef6355141', { archive: 'dmAtari', path: `${DM_STX} v1.2 (German).stx`, disk: 'DUNGEON.DAT' }],
  'dm-atari-1.2-de/graphics.dat': ['650ff7f430ac1113cce08a14b0f56bd010400232e97adcd2659b4be9671c18a2', { archive: 'dmAtari', path: `${DM_STX} v1.2 (German).stx`, disk: 'GRAPHICS.DAT' }],
  'dm-atari-1.2-de/dm-atari-1.2-de-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'dm-atari-1.3-fr/dungeon.dat': ['e0f5696a5eb792b7ece238f5d5b49c3967ce64c268e0978b658d2bf67b54be3c', { archive: 'dmAtari', path: `${DM_STX} v1.3 (French).stx`, disk: 'DUNGEON.DAT' }],
  'dm-atari-1.3-fr/graphics.dat': ['b14e87bb2fb4a6ecc051e8e160b20d5244d6293e71e01bd754d6aaa6d8bdee1a', { archive: 'dmAtari', path: `${DM_STX} v1.3 (French).stx`, disk: 'GRAPHICS.DAT' }],
  'dm-atari-1.3-fr/dm-atari-1.3-fr-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'dm-windows/dungeon.dat': ['ac3f9a233a988c9ff7d8074a6736909ce13fc482555cd329b3a130f661f90da5', { archive: 'dmWindows', path: 'dungeon.dat' }],
  'dm-windows/graphics.dat': ['196cb349827e8926e2763fa61ecbe8e10810003045ef72a435b7da4dded56d8e', { archive: 'dmWindows', path: 'graphics.dat' }],
  'dm-windows/dm-windows-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'kids-dungeon-24/dungeon.dat': ['d38ecd06ffe387cf7c76cb346aedcdadb86c992f56776416a89064f413a048dc', { archive: 'kidsDungeon', path: "Kid's-Dungeon ST&Amiga.dat" }],
  'kids-dungeon-24/graphics.dat': ['196cb349827e8926e2763fa61ecbe8e10810003045ef72a435b7da4dded56d8e', { archive: 'dmWindows', path: 'graphics.dat' }],
  'kids-dungeon-24/kids-dungeon-thumbnail.png': ['0449c5fd626d79618ac0f21a0a30ee992a56b6e890aee184c86579aa095b8ae1', { step: 'thumbnails' }],
  'towers-of-chaos-3.3/CSBgraphics.dat': ['8717c6dc618739e78559e6d4426e9962a634dc3e546d3b08a0145be5d80790a9', { archive: 'towersOfChaos', path: 'TOC 3.3/TOC 3.3/CSBgraphics.dat' }],
  'towers-of-chaos-3.3/dungeon.dat': ['1fd266667e0f74ce7767fc8ac6d7bb5d4463f83d9cb67b585453670a74ac3673', { archive: 'towersOfChaos', path: 'TOC 3.3/TOC 3.3/dungeon.dat' }],
  'towers-of-chaos-3.3/graphics.dat': ['a7fb7bb8513e7be4797651d30c84c623173b3ef2cb3eb3effd50a13cf80e218b', { archive: 'towersOfChaos', path: 'TOC 3.3/TOC 3.3/graphics.dat' }],
  'towers-of-chaos-3.3/Readme.txt': ['73390389ac24738ab89797c228d7a0df57f31bed13ed1889154a01547d427375', { archive: 'towersOfChaos', path: 'TOC 3.3/TOC 3.3/Readme.txt' }],
  'towers-of-chaos-3.3/towers-of-chaos-thumbnail.png': ['bd45d907acabbd887626d67a70c0e094af1d5dd7e4d5f4fb9fcd7cb45b495b68', { step: 'thumbnails' }],
};

/**
 * The steps, in the order they run, each a tool and its arguments, given the missing paths:
 * each reads what the archives and the steps before it wrote, and writes only those.
 */
const STEPS = {
  dmAtariGraphics: (): string[] => ['tools/checks/dm-atari-graphics.ts', '--write'],
  dmAmigaGraphics: (): string[] => ['tools/checks/amiga-graphics.ts', '--write'],
  utilityPortraits: (): string[] => ['tools/gen-utility-portraits.ts', unpacked('csbAtari', CSB_UTILITY_STX)],
  thumbnails: (paths: string[]): string[] => ['tools/gen-thumbnails.ts',
    ...DATA_SETS.filter((set) => paths.some((path) => resolve(TREE, path) === resolve(thumbnailPath(set)))).map((set) => set.id)],
};

type StepName = keyof typeof STEPS;

const TREE = resolve(GAMEFILES_DIR);
const checkOnly = process.argv.includes('--check');
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const scratch = mkdtempSync(join(tmpdir(), 'csbweb-gamefiles-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

/** The bytes of `source`, a URL or a file of the shared OneDrive. */
async function fetchSource(source: string | OneDriveSource): Promise<Uint8Array> {
  if (typeof source === 'string') {
    return new Uint8Array(await (await fetchOk(source, { signal: AbortSignal.timeout(300_000) })).arrayBuffer());
  }
  const folder = (await oneDriveCustomDungeons()).find((f) => f.name.startsWith(source.folder));
  if (!folder) throw new Error(`the OneDrive has no folder '${source.folder}…'`);
  const file = (await oneDriveFiles(folder)).find((f) => f.path === source.path);
  if (!file?.item['@content.downloadUrl']) throw new Error(`the OneDrive's '${folder.name}' has no ${source.path}`);
  return new Uint8Array(await (await fetchOk(file.item['@content.downloadUrl'], { signal: AbortSignal.timeout(300_000) })).arrayBuffer());
}

const describe = (source: string | OneDriveSource): string =>
  typeof source === 'string' ? source : `the forum's OneDrive, ${source.folder}…${source.path}`;

/** `name`'s archive, downloaded from the first source that gives its bytes, and unpacked into the scratch folder. */
async function unpack(name: ArchiveName): Promise<void> {
  const archive: Archive = ARCHIVES[name];
  for (const source of archive.sources) {
    try {
      const bytes = await fetchSource(source);
      const sha = sha256(bytes);
      if (sha !== archive.sha256) throw new Error(`SHA-256 ${sha}, not ${archive.sha256}`);
      console.log(`${archive.file}: ${bytes.length} bytes from ${describe(source)}`);
      if (archive.plain) {
        mkdirSync(join(scratch, name));
        writeFileSync(join(scratch, name, archive.file), bytes);
        return;
      }
      const file = join(scratch, archive.file);
      writeFileSync(file, bytes);
      const sevenZip = ['7z', '7zz', '7za'].find((tool) => !spawnSync(tool, ['i'], { stdio: 'ignore' }).error);
      if (sevenZip === undefined) throw new Error('no 7z on the PATH (7-Zip, or p7zip-full)');
      const run = spawnSync(sevenZip, ['x', '-y', `-o${join(scratch, name)}`, file], { stdio: ['ignore', 'ignore', 'inherit'] });
      if (run.status !== 0) throw new Error(`${sevenZip} exited with ${run.status}`);
      return;
    } catch (error) {
      console.error(`${describe(source)}: ${(error as Error).message}`);
    }
  }
  throw new Error(`no source gave ${archive.file}`);
}

/** A file of an unpacked archive, by its path in it. */
function unpacked(name: ArchiveName, path: string): string {
  return join(scratch, name, path);
}

/** Every file under `dir`, by its path below it. */
function filesUnder(dir: string, below = ''): string[] {
  return readdirSync(join(dir, below), { withFileTypes: true }).flatMap((entry) => {
    const path = below ? `${below}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(dir, path) : [path];
  });
}

/** The folder's differences from `FILES`: changed, missing and extra paths. */
function differences(): string[] {
  const found = new Set(existsSync(TREE) ? filesUnder(TREE) : []);
  const lines: string[] = [];
  for (const [path, [sha]] of Object.entries(FILES)) {
    if (!found.has(path)) lines.push(`missing ${path}`);
    else if (sha256(readFileSync(join(TREE, path))) !== sha) lines.push(`changed ${path}`);
  }
  for (const path of found) if (!(path in FILES)) lines.push(`extra ${path}`);
  return lines;
}

const missing = Object.entries(FILES).filter(([path]) => !existsSync(join(TREE, path)));
if (!checkOnly && missing.length > 0) {
  const archives = new Set<ArchiveName>();
  const steps = new Set<StepName>();
  for (const [, [, origin]] of missing) {
    if ('step' in origin) steps.add(origin.step);
    else archives.add(origin.archive);
  }
  if (steps.has('utilityPortraits')) archives.add('csbAtari');
  for (const name of archives) await unpack(name);

  for (const [path, [, origin]] of missing) {
    if ('step' in origin) continue;
    const source = unpacked(origin.archive, origin.path);
    let bytes: Uint8Array | undefined = readFileSync(source);
    if (origin.disk !== undefined) bytes = (origin.path.endsWith('.adf') ? adfFiles : stxFiles)(bytes).get(origin.disk);
    if (bytes === undefined) throw new Error(`${origin.path} has no readable ${origin.disk}`);
    mkdirSync(dirname(join(TREE, path)), { recursive: true });
    writeFileSync(join(TREE, path), bytes);
  }
  for (const step of Object.keys(STEPS) as StepName[]) {
    if (!steps.has(step)) continue;
    const args = STEPS[step](missing.map(([path]) => path));
    console.log(`npx tsx ${args.join(' ')}`);
    const run = spawnSync('npx', ['tsx', ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    if (run.status !== 0) {
      process.stdout.write(run.stdout);
      throw new Error(`${args[0]} exited with ${run.status}`);
    }
  }
}

const lines = differences();
if (lines.length > 0) {
  console.error(`${GAMEFILES_DIR}/ differs from what this tool fetches:\n  ${lines.join('\n  ')}`);
  process.exit(1);
}
console.log(`${GAMEFILES_DIR}/: the ${Object.keys(FILES).length} files of ${new Set(Object.keys(FILES).map((p) => p.split('/')[0])).size} folders, each as pinned.`);
