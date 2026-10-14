/**
 * A dungeon's signature: what tells whose a save is, since the file does not say.
 *
 * A CSBWin save holds no name of its dungeon, but it holds the dungeon (blocks 7-14),
 * and a file on its way into the store is checked against the running one by it
 * (`doc/SAVES.md` → "An import is checked against the dungeon"). CSBWin has no such
 * check: it keeps a game's saves in that game's directory
 * (`doc/CSBwin-src/CSBCode.cpp:9871-9880`).
 *
 * The signature is one digest per level, of the level's walls: its width, its height,
 * and a bit per cell, stone or anything else. Nothing finer goes in. What a release
 * moved, a teleporter or an object, and what play changes, a door, a pit, a wall's
 * objects, all leave it alone, so the four Dungeon Master sets here are one dungeon and
 * a save of any of them is a save of it.
 *
 * The digest is SHA-256 through `crypto.subtle`, which a page has in a secure context
 * alone. The page is served from localhost and will be hosted over https, both secure,
 * so it is always there: the author's decision is that nothing stands in for it.
 */
import { getRoomType, RoomType } from '../core/types';
import type { DungeonData, MapData } from './dungeonTypes';

/** A digest per level, in the levels' order: 64 hexadecimal digits each. */
export type DungeonSignature = readonly string[];

/**
 * What a level's digest is taken of: its width, its height, then a bit per cell in the
 * file's order, column by column, the first cell in a byte's high bit. The bit is set
 * for any cell but stone.
 */
export function levelWalls(map: MapData): Uint8Array<ArrayBuffer> {
    const { width, height } = map.descriptor;
    const walls = new Uint8Array(2 + Math.ceil((width * height) / 8));
    walls[0] = width;
    walls[1] = height;
    let cell = 0;
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++, cell++) {
            if (getRoomType(map.cellFlags[x][y]) !== RoomType.STONE) walls[2 + (cell >> 3)] |= 0x80 >> (cell & 7);
        }
    }
    return walls;
}

/** The signature of `dungeon`, a `dungeon.dat`'s or a save's. */
export async function dungeonSignature(dungeon: DungeonData): Promise<string[]> {
    const signature: string[] = [];
    for (const map of dungeon.maps) {
        const digest = await crypto.subtle.digest('SHA-256', levelWalls(map));
        signature.push(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    }
    return signature;
}

/** A dungeon the port can name. */
export interface KnownDungeon {
    name: string;
    /** The data sets that play it, their `DataSet.id`: none for a dungeon the port cannot play. */
    dataSets: readonly string[];
    signature: DungeonSignature;
}

/**
 * The catalogue. It is not read from the game's files as a table of CSBWin's is: it may
 * list a dungeon whose files the page does not have, and the page loads one data set's.
 * `tools/dump-dungeon-signature.ts` holds every entry to the files here, and prints the
 * digests of a dungeon that is to be added.
 *
 * The four Dungeon Master sets are one dungeon. Chaos Strikes Back is two: its
 * `dungeon.dat` is the prison, and the game is `mini.dat`'s (`doc/PROVEN_FACTS.md` → "A
 * compressed `dungeon.dat`: CSB's prison").
 */
export const KNOWN_DUNGEONS: readonly KnownDungeon[] = [
    {
        name: 'Dungeon Master',
        dataSets: ['dm-atari', 'dm-windows', 'dm-atari-1.2', 'dm-atari-1.3-fr'],
        signature: [
            '167ec1080a5ce33a678ad38ba810d9723c25a12d6380443ad24aab877a2c6507',
            '2601fa2a50a662417b081aa47633a2c99379316f745c3454b7c51e855ac07559',
            'f6b6de7b6098eb7ec8028f84f531b736f14d8ccf6a240c2217eacdef723cbe14',
            '09ce9e15a93fb4182606112c9efb9eea2ca4935db3c1f3d47ed0198197e20cdb',
            '508fe5bfe1075872f3152dd0d14e4096314fea983e04b339774d8ff3e51181c9',
            '2c55ec179a626e417a075af9399077a759e30aa1626c32d20f29141aab0ee50f',
            '4c4ca2d3f738ed73588cd02bd2cfeeaedd7ce4a2be34f26e20120a0c23dede68',
            '2732e4a22ea4a8ff93d9332e0414efccffe9fe4e07999cde1cf8d878d3d91101',
            '533e71826a528db1451fad87569c4e34a60cbb99c785dac07c1cb9a9f5b9728c',
            'e275c1f1ca53ffd5d52a8608bd70555d47a484981bdbc484d45c29a92a6192b9',
            '76bdf577ac0b1497c32b307af5afadb90e890ebca7163d3035e713b8d62ac950',
            'ebf848e9aea42b3ac007efcbf58c031f1f0e8fd0fcddc00e309bdc4db6b9a5e4',
            'fe041c65423dc507813a391a348c6311ecde3fed63a2e85b903f25286ee03b96',
            'abc4d17013d93fa0d2d31e32e7e9851bece8e89a3f3cbcda44f9139022420361',
        ],
    },
    {
        name: 'Chaos Strikes Back',
        dataSets: ['csb'],
        signature: [
            '9d42bdc4a2f2a9513b57fedde53c7472feaea0cce74a897c2b773ffb56493006',
            '4b756274bd04c300536e090410be7a8ae16387508205895e7110421b56e4aed2',
            '5fb68fd2dc9777d1b0dd66dc49c566e1c9a41ba4a3e2d0be5ae4361272f9add0',
            'd3784c64a8717a0262f35b10256769f699ed5173df770f3f01a0023062ae6413',
            '18a42c458f69d044bceb348f414999eb772710e2b5953059790f2c1bb1db4db7',
            'b239842ee185701c7afa4efbbf2d5b6e4a08f5424d9017ebb0a88826e65a3e3a',
            'e8120cfdd06e2c2f621e44f180aa60ae3714fc9f4eaca780c9ab92e31df6113b',
            'dc72dcf4a1ea3e928cbf6f35e526faf1ffa006813a279e765c60af69e389ed27',
            '4c03822d4e55c24624562511030f53ffb6dcba7d3c6a6289194e10116e64fa58',
            '9962a953f63414d9977e0595aadb73d14bf28ba2d2f5072cf25b18f609b90eec',
            '9f44ac6acb8a37b00b615dc89259d306035be82dee7db2b472e4c48326195440',
        ],
    },
    {
        name: 'Chaos Strikes Back, the prison',
        dataSets: ['csb'],
        signature: [
            'e6ceb1dfd22dff936c9572feed5fe878b7649771daabb245c19162ada94e32c7',
            'daa2538fad1ccb10717afd7bf3c90cfc0ef88948ec38f1ff729fbdf3336d96df',
        ],
    },
    {
        name: 'Kids dungeon 24',
        dataSets: ['kids-dungeon'],
        signature: [
            'cfccd1cff2c660a714b747329d684c5f2b3c35da0ea5cbb79106dc944da29777',
            '367ff76418cbeef6cdbf8b0668aa91a8a9ad6290d3cb4a92008c7f691042f611',
            '85590ce50b3812d720d3260356b9ce7ab8733b839b326c550a6b46bf2073944d',
        ],
    },
    {
        name: '3D2D1D',
        dataSets: ['3d2d1d'],
        signature: [
            'e54b23180f537c92831ebe0de5816a6583a577951a5d17e1f73ebd66e1c926ab',
            'b7778d04e69c1c2f6677e5bdd1af7d0524ce0a6dcd84bebc96307a7134adfe6a',
            '5ee318d5a4c3445cac9ec096a3d6fe7107a24d6aaca10ec3ec1f0e4df27df7a1',
            'fdf307e3343b147dca6d1b00ef9f525334385d978b549a895e348b36940526c6',
            'c73e01d7ae59314c5b68da2822df429d5550488e3ff6ef24970b82e03c7ea89d',
            '7d95988566c9fcfcf3bd6e74427c7089ef23d5a93ec9c1512562c6a6489e44d4',
            '6ef7319b7858df41be162763661dde8008710b674082dfd470749fb960f1cb1a',
            'd8ab2a4ddf64d2da80cc68ab9d1a1e01c8c217abd4c982e8507db3a7c124189a',
            '368b5dc255e36bb32741c72ca6af621aad02ad5ad91c77049e4cc5c1c62b4313',
            '895467d5bce99a75f493fd9bea8562eb0b52a7c44618b7299eb690a8244ab798',
        ],
    },
    {
        name: 'Conflux 3.5',
        dataSets: ['conflux-3.5'],
        signature: [
            '38979e507c116f3ecd487bc787b54293ab5fabe005aaee9f0ff784ec0e23cc4d',
            '95a1e5aac338605d7cecc9fa338da1a6bd711bf2bb5a05c2d6fe4aec018641a9',
            '3924e3afd4d961023fc8b513af4b79ea7c1a4bc13da1e580096e44334bb26330',
            '1a97b5f5c53214376b8d35bbd6e5965d6b017b0871db63d10ad82f7f8c343174',
            '4d1714a7477866fb184aa8590c5d9394248d17facf7db87ae5bd0e029ef6cfb5',
            '6ec80e9e715522daa2c0a27cc0dbb872f97c132a7697d657a34437dbc4a4c785',
            'df652d01585fe9b7a7cfb9e7bcb2c3ded41505f3f8404a0b2a363925a151a83c',
            '7e805d6ad98e3743bc91ed7d171b3e39729437e17eb4f039abe093c071c6bb83',
            'eea88505f5c7067c08940e1f3eff118bf27cc14abe59849dc61bd8ddcf3531a8',
            '7d73da9dcd72f262c8f0faed2ff352191265cee12286fa8cace0ecb190f4d601',
            '9c334f3c2629732b6b2a96fe65e9de68d4a8a300a39695f8321a2663b5f7231d',
            '80abdf22b7adbd9e3d9b5aefee5a66d38ee0f70ebc60c6f17492b3b0383011b0',
            'e3b2a73982e45fcd10b8387519baca3dfdddde43b346b9c2639c980c7d139fdf',
            '4aaaa1782225e02d5786bf54c39f1b9fb52021ac2cfde581d2ad2a5a04d637de',
            'cd983650c70a9cde485165b61f5382d83c3b96ed12c10c6c2e5f1fc2ca42b717',
            'eaca9b7a21649645b3aa97c33123af209f91df55a8e5884bd600968a1e9b8c15',
            'e6e38b198c888738604841e81cc391b807bb3a90a5cb2f23f8f125f967bdddd6',
            'c431648f5012f4c7ca0745c9ec5828fc30a2d2a88783d12bdfd87bf04333e35a',
            'c46a5975542f27e9d4c9890876a0fcd7309560d1ab39ef1ab089c0459f9231e5',
            '92ffec6e7c26f4e1881bc63f1bcbe22aca4957e8b1e3e9f94967f5c71ce38d2b',
            'f46bdb1a4bde12c9ce84b2d4cd41a2931055e2b0ad45a05896b4cd93c00c0ba4',
            'e73f78ad6ae0e6719976eca7c634a4f7817741ad8c5aab225556ed28b1204902',
            'd3b46351ec058e07dd01cad51846fa4eb76ded2c2a72bd7fd3a5133db135ee3f',
            '099bd522bf37750d244db1525c36941a63b85bb105369e49d8780895ccc792b8',
            '100bdba6f7fda799fa1cd7c9d5acf10e17ef165ee739b6a011dd3ecd2d05790f',
            '7b06958585f098f036cc9b4c6c6a31a90af36e565797d1d2453c5f34f2d83c6f',
            'c88953b31254c77759c1543c9848d4cd0eb41868ca580be040fd3db58602358f',
            'f4bfeb18099fa0b8e262f095d2d61ca0175b9e602c5b725386ab0061169732dc',
            'a1f46c387aaea851d9848718780835874727951251d455be3a81b4d17cda17fa',
            '4bac79089104de468598159bd74609b520c0035af17a40f935ef66a8fa8d5717',
            '1621790a42c9902a44a5ff883c83b4e0f0df6e7879c150f5fd4c10d5e43c1ecf',
            'd74298aa5f0e58338eb8f650b88634a7f1daeb534688faf1fef4bf4d2d7a517b',
            '88a59dee1c9a4b301ebed0faf12c18930487ae1fef97d7aa2d45bb9b78263829',
            '7a96b06549fc921b74d0b1ec963e767ab3e24c872e827333c1d1c40f7f34e0fb',
            'c47b1021e736362f1ccb039dd64c409e54bcf18c5c936cb7633a60ebf8f088e0',
            '64cb070be1070b46f551a648e9185d7cb9064a61055bffdd1399813cf78556e8',
            '81b91c360fc86f0d196a80bde892cae0e2e5e634d99fd15ce46a844170f358e7',
            '0c797e2de757c95e8f2c57dfd2336b28d7f722ce56bbc4b58c58d4133db8ded1',
            'acb5ba19d5f366644a67099137da93c0c6f9e20bce0fc0dfc855cd63a3329fcc',
            '51e7fefd4fcf2a53a4065ee14cf1c75355b70c0b5bd277f7395237627bb447ce',
            'd735a21a9fa5f8d6a59ca30da0e86ee5e3567ea75753d0039e6a8a4cd5f02afa',
            'af02dc86158bcd419b3b030aaf04aca1d66afa2e430c0d54d8a4e298729318f7',
            '6e22ea046391cc8c77d0a5f82c8804f9dab467097e3327c081df7cfd3d3a9a8e',
            'c41fb87eed66922d7cbae3c05156a014f236429ad2551d9f111df5adf5ebf557',
            '02cadc56921dbecd8b65f5e9720a700eb55382ea0553b5debd71febd376ec077',
            '916cfd97680775442c6de045f3b98e215939d5d6e3096f3991272485a1d322bb',
            '709389da1d7a4fd7967438be4a8d5b7016757eb601f15287831919568db687d2',
            'dabfb09a3d78688fd0d6f51ecb22e71b4d807f18a8554b5ce286dfdfe9b0c786',
            '552723d981da08ab6fe0d18148f1cdf86e30fb64695d9f6c27b843da3789bf95',
            'f0e095c07836e55666aa6f9356b0a27807902ce74825fdf945bdf60eb0dc9037',
            'ae71873336d98de061985a9309ad2f777878d4806ea8b9ea9cc945b62635576a',
            '083f435d990e739d6ec5ce386e21dbe29a99140993dac8b66a4d0211e6164479',
            'e1e3f409f3a874c708f29820271a756d21f72c8a8775c093dddd46f85425094c',
            'b97e430219d99d3955b2272af5c8935eccf222dba8c303ddeb0a39507017d499',
            '3f0377ef6a40a1bfa2e158bbc471ad72fcf1136ccf658af43e157e242783ca70',
            '226fdf69cf3e1e88f7ffee79357916d1a1bf00b5d85fa7ca76f129d117461fae',
            '48a6d35ea850a8d1a38d5584d10f99fb055242d29da0bdc88b78166bb812f6f1',
            'f386ebe4b3843914cf4cdd0c5e4a584c38e4817364f19ae51f2ff0bac2074bdf',
            'ae0a293676f2be0ab00d8e23e1399a2d54cfd26a69ecb5b4e56b17e5411fae77',
            'e75f6d4e0254d1914e1c25fd5f678f385b4fb77256c867621d019e7a9961af05',
            '188772d9d4cd9a6bf73094d5acb2750f478e4a7125296e23e93fe3f49e0f0974',
            '85016f2e9463ffe23172ba6fcc78504c1fba5e611b2040f615191a6d8cadb5e2',
            '723f99577ff31f8df91c613e733a6572de0c46390bfe5d76c6e5cfcb56042fef',
            '8bbe61029d8a597ebfa40e52648843d84601e2625137e9cd50f9d89378b57adc',
        ],
    },
    {
        // Levels 17 to 63 have the same walls, stone but for one cell: one digest, 47 times.
        name: 'The Towers of Chaos 3.3',
        dataSets: ['towers-of-chaos'],
        signature: [
            'dbec5c5dc9867f1dd49108c7be90e68ce56a954a5b4e113572c2c33bb4a5ea6f',
            'fae651dd5e7ec66aa1008cfc12d8c43abbdff594d35d3c6b43cc3281d73cca14',
            '0924ec30f0f8b90e5a89c846332afab0c6ee85054911ca79812706f8359c3774',
            '6e6eb3131392d52f52119c22089cea4bed1f1372174e7724853cb82e42f56d38',
            'dcf2611cc745e80fc8448c4b5ea8766dc074e19bf9bb0854fc984c66e088fdde',
            'e5d481dd1a0a6ed53cef3d3a004384161a39f9d4256ed8094313f73fe06ddfc9',
            'a60ee887197a424a3b1db909c0d6cedd7f70536ad82c7ea99225a53c9ef6c69f',
            '64fc2ef1a4b38298317e5a5276931d486d9d41d6076ab7359439c3af48a186c8',
            '181643980f6a42170afb5ca3a6b15dd7ac1f8864bbeeb592696e807923c00916',
            '31e04276b5301381612eb92b9dc3265b62fd6b34a97884c86da70b33cdd8f618',
            '1cee9279d40615788696bfa300a4be35979966eb188ed60daf57f33f83364462',
            'efd813bcb1c8870333eb8b962ae96a7f6a103c718386654ccde11b31ccf55e88',
            '9ff6e917d8a4543b06b47ae484451cbb068b09d80ac28638dd2fce61a683c725',
            'a15c9ef97d192880d9b29e6de328bf7c9e4ba3537ec24e45d59808d1f452e210',
            '481f829ac56273a035a6b84c6ed9e921addbadc794e49e12390b01551a1123ba',
            '253eec03257ba7ae8f62d453b576360ce0636995180883134b95630177d9e083',
            '605ad2b4a148c02f18906c209f2a7248de458e1800f06aafcb45dc2173c08338',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
            '8ebe397195a42cedeb1642a816a4b838546d9f71d2ae4b3f347a5a30bfc2852f',
        ],
    },
];

/** The known dungeon a signature looks like. */
export interface DungeonMatch {
    dungeon: KnownDungeon;
    /** How many of the signature's levels are the dungeon's, each against the level of its own number. */
    levels: number;
    /** Whether the signature is the dungeon's: as many levels, and every one the same. */
    whole: boolean;
}

/**
 * The known dungeon most levels of `signature` match, and `null` when none of them
 * matches any. A dungeon the signature is the whole of comes before one it is the first
 * levels of.
 */
export function identifyDungeon(
    signature: DungeonSignature,
    known: readonly KnownDungeon[] = KNOWN_DUNGEONS,
): DungeonMatch | null {
    let best: DungeonMatch | null = null;
    for (const dungeon of known) {
        const levels = dungeon.signature.filter((digest, level) => digest === signature[level]).length;
        const whole = levels === signature.length && levels === dungeon.signature.length;
        if (levels === 0) continue;
        if (!best || levels > best.levels || (levels === best.levels && whole && !best.whole)) {
            best = { dungeon, levels, whole };
        }
    }
    return best;
}

/**
 * A dungeon's walls, what an import is told by: each level's width and height, and its
 * signature. A level's digest takes its width and height in (`levelWalls`) but hides
 * them, and the rules for the running set's own dungeon need them apart.
 */
export interface DungeonWalls {
    /** Each level's `[width, height]`, in the levels' order. */
    shapes: readonly (readonly [number, number])[];
    signature: DungeonSignature;
}

/** `dungeon`'s walls, a `dungeon.dat`'s or a save's. */
export async function dungeonWalls(dungeon: DungeonData): Promise<DungeonWalls> {
    return {
        shapes: dungeon.maps.map((map) => [map.descriptor.width, map.descriptor.height] as const),
        signature: await dungeonSignature(dungeon),
    };
}

/** Whether two dungeons have as many levels, each as wide and as high as the other's. */
function sameShapes(a: DungeonWalls, b: DungeonWalls): boolean {
    return a.shapes.length === b.shapes.length
        && a.shapes.every(([width, height], level) => width === b.shapes[level][0] && height === b.shapes[level][1]);
}

/**
 * What a save's dungeon is to the running data set (`doc/SAVES.md` → "An import is
 * checked against the dungeon"): the set's `own`, whole; a slightly `different` version
 * of the set's own; an `other` known dungeon's, the whole or most of one, which another
 * set may play; or of an `unknown` dungeon.
 */
export type DungeonCheck =
    | { kind: 'own' }
    | { kind: 'different' }
    | { kind: 'other'; dungeon: KnownDungeon }
    | { kind: 'unknown' };

/**
 * `save`'s walls against the data set `dataSet`, its `DataSet.id`, whose own dungeons,
 * as its files read, are `own`: its `dungeon.dat`, and CSB's `mini.dat`. The author's
 * rules:
 *
 * - A save whose levels are as many as an own dungeon's, each as wide and as high, is
 *   held against that dungeon alone: the set's `own` when every level's digest is the
 *   same, a slightly `different` dungeon when some are, and `unknown` when none is.
 * - Any other is not the set's, and goes on to the other sets: the known dungeon it
 *   looks like (`identifyDungeon`) among those that do not list the set, `other`, or
 *   `unknown` where there is none. So does a `different` one the player sends on, with
 *   `elsewhere`.
 *
 * The catalogue alone never names the running set's dungeon, which its files say better.
 */
export function checkDungeon(
    save: DungeonWalls,
    dataSet: string,
    own: readonly DungeonWalls[],
    elsewhere = false,
    known: readonly KnownDungeon[] = KNOWN_DUNGEONS,
): DungeonCheck {
    const set = elsewhere ? undefined : own.find((dungeon) => sameShapes(dungeon, save));
    if (set) {
        const same = set.signature.filter((digest, level) => digest === save.signature[level]).length;
        return { kind: same === save.signature.length ? 'own' : same > 0 ? 'different' : 'unknown' };
    }
    const match = identifyDungeon(save.signature, known.filter((dungeon) => !dungeon.dataSets.includes(dataSet)));
    return match ? { kind: 'other', dungeon: match.dungeon } : { kind: 'unknown' };
}
