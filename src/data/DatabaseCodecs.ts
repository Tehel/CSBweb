/**
 * The dungeon image's records, read and written: one codec per database, the reader and
 * its inverse side by side, field for field and bit for bit against the `DBn` classes in
 * `doc/CSBwin-src/CSB.h:821-1348`.
 *
 * `DungeonLoader` reads a database through its codec, `CsbwinDungeonImageWriter` writes
 * it back through the same one, and `clearedRecords` gives the records
 * `DATABASES::Enlarge` adds. A record's size is `dbEntrySize`, CSBWin's `dbEntrySizes`
 * (`src/data/DungeonImageLayout.ts`): a codec reads and writes exactly that many bytes.
 *
 * Every bit is carried on the record, those the game never reads too — the door's
 * `word2` bits 9-15, the chest's whole `word4` and its two trailing bytes, the misc item's
 * `cursed` and `subType`, the new scroll's uninitialised `word4` debris — and named in
 * `src/data/dungeonTypes.ts`.
 *
 * Three of the sixteen databases have no codec: 11, `EXPOOL`, which the world keeps as
 * its blocks (`src/data/CsbwinExpool.ts`), and 12 and 13, which `CSB.h` marks
 * `//Not used`, empty in every file here.
 */
import { readU8, readU16BE, writeU16BE } from '../core/bytes';
import { DBType, OBJECT_ID_NULL } from '../core/types';
import type { ObjectID } from '../core/types';
import type { CsbwinObjectIndex } from './CsbwinObjectIndex';
import { dbEntrySize, type DatabaseShape } from './DungeonImageLayout';
import type {
    ActuatorRecord, ClothingRecord, CloudRecord, ContainerRecord, CreatureRecord, DatabaseRecord,
    DoorRecord, MiscRecord, MissileRecord, PotionRecord, ScrollRecord, TeleporterRecord,
    TextRecord, WeaponRecord,
} from './dungeonTypes';

/** Where a codec reads its record from: big-endian, from the read head on. */
export interface RecordReader {
    readU8(): number;
    readU16(): number;
}

/** How the image's records are read: their shape, and the object index of a save. */
export interface RecordShape extends DatabaseShape {
    /**
     * The image's object indirect index (`DungeonImageOptions.objectIndex`): present, a
     * free record's secondary RNs are read as `RNnul` (`readRNOfRecord`), and a new
     * scroll's text RN is numbered through it.
     */
    objectIndex?: CsbwinObjectIndex;
}

/** One database's records, read and written. */
export interface DatabaseCodec<T extends DatabaseRecord> {
    /** One record, from the reader's head. */
    read(r: RecordReader, shape: RecordShape): T;
    /** One record, at `at`. */
    write(buf: Uint8Array, at: number, record: T, shape: DatabaseShape): void;
}

/** The record each database with a codec holds. */
export interface RecordOf {
    [DBType.DOOR]: DoorRecord;
    [DBType.TELEPORTER]: TeleporterRecord;
    [DBType.TEXT]: TextRecord;
    [DBType.ACTUATOR]: ActuatorRecord;
    [DBType.CREATURE]: CreatureRecord;
    [DBType.WEAPON]: WeaponRecord;
    [DBType.CLOTHING]: ClothingRecord;
    [DBType.SCROLL]: ScrollRecord;
    [DBType.POTION]: PotionRecord;
    [DBType.CHEST]: ContainerRecord;
    [DBType.MISC]: MiscRecord;
    [DBType.MISSILE]: MissileRecord;
    [DBType.CLOUD]: CloudRecord;
}

const bit = (b: boolean | undefined): number => (b ? 1 : 0);

/**
 * Every record's first word, its link: a chain's next object. A `dungeon.dat`'s is
 * packed until `convertObjectReferences` numbers it; a save's is a slot already.
 */
function readRN(r: RecordReader): ObjectID {
    return r.readU16() as ObjectID;
}

function writeLink(buf: Uint8Array, at: number, record: { nextObject: number }): void {
    writeU16BE(buf, at, record.nextObject & 0xffff);
}

/**
 * A second RN inside a record that may be free — a monster's possessions, a chest's
 * contents, a missile's flying object, a scroll's text.
 *
 * CSBWin marks a record deleted by writing `RNnul` over its link and frees the
 * indirect slot that named it in the same breath (`DeleteDBEntry`,
 * `doc/CSBwin-src/data.cpp:995-1017`); everything else in the record is left as it
 * was. So in a save a free record routinely still holds a reference to a slot that
 * has since been freed or reused. CSBWin never looks: a free record is reached only
 * by the allocator, which clears it before handing it out. A free record's other RNs
 * are read as `RNnul`, which is what the record means.
 */
function readRNOfRecord(r: RecordReader, link: ObjectID, shape: RecordShape): ObjectID {
    const raw = r.readU16();
    if (shape.objectIndex && link === OBJECT_ID_NULL) return OBJECT_ID_NULL;
    return raw as ObjectID;
}

/**
 * A record's second RN, written. `RNnul` when the record is free: `readRNOfRecord` dropped
 * whatever the file held there, which cannot be reproduced, and deliberately so.
 * `tools/checks/dungeon-image-blocks.ts` exempts exactly those words, by name.
 */
function writtenSecondary(rn: number, link: number): number {
    if (link === OBJECT_ID_NULL) return OBJECT_ID_NULL;
    return rn & 0xffff;
}

/** The codec of each database the port carries records for. */
export const DATABASE_CODECS: { [D in keyof RecordOf]: DatabaseCodec<RecordOf[D]> } = {
    // `DB0::word2` (`doc/CSBwin-src/CSB.h:825-848`).
    [DBType.DOOR]: {
        read(r) {
            const nextObject = readRN(r);
            const attributes = r.readU16();
            return {
                nextObject,
                destructibleByChop: (attributes & 0x100) !== 0,
                destructibleByFireball: (attributes & 0x80) !== 0,
                hasButton: (attributes & 0x40) !== 0,
                vertical: (attributes & 0x20) !== 0,
                ornateNumber: (attributes >> 1) & 0xF,
                doorType: attributes & 0x1,
                word2Bits9_15: (attributes >> 9) & 0x7f
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2,
                ((r.word2Bits9_15 ?? 0) << 9) | (bit(r.destructibleByChop) << 8) |
                (bit(r.destructibleByFireball) << 7) | (bit(r.hasButton) << 6) |
                (bit(r.vertical) << 5) | ((r.ornateNumber & 0xf) << 1) | (r.doorType & 1));
        },
    },
    // `DB1::word2` and `word4` (`doc/CSBwin-src/CSB.h:852-898`).
    [DBType.TELEPORTER]: {
        read(r) {
            const nextObject = readRN(r);
            const attributes = r.readU16();
            const destination = r.readU16();
            return {
                nextObject,
                sound: (attributes & 0x8000) !== 0,
                scope: (attributes >> 13) & 0x3,
                absoluteRotation: (attributes & 0x1000) !== 0,
                rotation: (attributes >> 10) & 0x3,
                destY: (attributes >> 5) & 0x1F,
                destX: attributes & 0x1F,
                destMap: (destination >> 8) & 0xFF,
                word4Low: destination & 0xff
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2,
                (bit(r.sound) << 15) | ((r.scope & 3) << 13) | (bit(r.absoluteRotation) << 12) |
                ((r.rotation & 3) << 10) | ((r.destY & 0x1f) << 5) | (r.destX & 0x1f));
            writeU16BE(buf, at + 4, ((r.destMap & 0xff) << 8) | (r.word4Low ?? 0));
        },
    },
    // `DB2::word2` — `index()` is bits 3-15, `show()` bit 0 (`doc/CSBwin-src/CSB.h:991-1005`).
    [DBType.TEXT]: {
        read(r) {
            const nextObject = readRN(r);
            const textRef = r.readU16();
            return {
                nextObject,
                textOffset: (textRef >> 3) & 0x1FFF,
                visible: (textRef & 0x1) !== 0,
                word2Bits1_2: (textRef >> 1) & 0x3
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2,
                ((r.textOffset & 0x1fff) << 3) | ((r.word2Bits1_2 ?? 0) << 1) | bit(r.visible));
        },
    },
    // `DB3` keeps all four words raw here; every accessor is a bitfield of them. A big
    // actuator has a fifth (`MakeBigActuators`).
    [DBType.ACTUATOR]: {
        read(r, shape) {
            const nextObject = readRN(r);
            const word2 = r.readU16();
            const word4 = r.readU16();
            const word6 = r.readU16();
            const word8 = shape.bigActuators ? r.readU16() : undefined;
            return {
                nextObject,
                word2,
                word4,
                word6,
                word8
            };
        },
        write(buf, at, r, shape) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2, r.word2 & 0xffff);
            writeU16BE(buf, at + 4, r.word4 & 0xffff);
            writeU16BE(buf, at + 6, r.word6 & 0xffff);
            if (shape.bigActuators) writeU16BE(buf, at + 8, (r.word8 ?? 0) & 0xffff);
        },
    },
    // `DB4` (`doc/CSBwin-src/CSB.h:1078-1142`).
    [DBType.CREATURE]: {
        read(r, shape) {
            const nextObject = readRN(r);
            const possession = readRNOfRecord(r, nextObject, shape);
            const uByte4 = r.readU8();
            const groupIndex = r.readU8();
            const hp = [
                r.readU16(),
                r.readU16(),
                r.readU16(),
                r.readU16()
            ];
            const word14 = r.readU16();
            return {
                nextObject,
                possession,
                // DB4::monsterType() masks to 5 bits; the top three are the alternate
                // graphic selector (doc/CSBwin-src/CSB.h:1116-1119).
                creatureType: uByte4 & 0x1f,
                alternateGraphics: (uByte4 >> 5) & 0x7,
                groupIndex,
                hp,
                fear: word14 & 0xf,
                numMonM1: (word14 >> 5) & 0x3,
                facing: (word14 >> 8) & 0x3,
                important: (word14 & 0x400) !== 0,
                invisible: (word14 & 0x800) !== 0,
                drawAsSize4: (word14 & 0x1000) !== 0,
                unique: (word14 & 0x2000) !== 0,
                poisoned: (word14 & 0x4000) !== 0,
                word14Bit4: (word14 >> 4) & 1,
                word14Bit7: (word14 >> 7) & 1,
                word14Bit15: (word14 >> 15) & 1
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2, writtenSecondary(r.possession, r.nextObject));
            buf[at + 4] = ((r.alternateGraphics & 7) << 5) | (r.creatureType & 0x1f);
            buf[at + 5] = r.groupIndex & 0xff;
            for (let h = 0; h < 4; h++) writeU16BE(buf, at + 6 + h * 2, (r.hp[h] ?? 0) & 0xffff);
            writeU16BE(buf, at + 14,
                ((r.word14Bit15 ?? 0) << 15) | (bit(r.poisoned) << 14) | (bit(r.unique) << 13) |
                (bit(r.drawAsSize4) << 12) | (bit(r.invisible) << 11) | (bit(r.important) << 10) |
                ((r.facing & 3) << 8) | ((r.word14Bit7 ?? 0) << 7) | ((r.numMonM1 & 3) << 5) |
                ((r.word14Bit4 ?? 0) << 4) | (r.fear & 0xf));
        },
    },
    // `DB5::word2` (`doc/CSBwin-src/CSB.h:1144-1177`).
    [DBType.WEAPON]: {
        read(r) {
            const nextObject = readRN(r);
            const attributes = r.readU16();
            return {
                nextObject,
                broken: (attributes & 0x4000) !== 0,
                charges: (attributes >> 10) & 0xF,
                litTorch: (attributes & 0x8000) !== 0,
                poisoned: (attributes & 0x200) !== 0,
                cursed: (attributes & 0x100) !== 0,
                important: (attributes & 0x80) !== 0,
                weaponType: attributes & 0x7F
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2,
                (bit(r.litTorch) << 15) | (bit(r.broken) << 14) | ((r.charges & 0xf) << 10) |
                (bit(r.poisoned) << 9) | (bit(r.cursed) << 8) | (bit(r.important) << 7) |
                (r.weaponType & 0x7f));
        },
    },
    // `DB6::word2` (`doc/CSBwin-src/CSB.h:1179-1195`).
    [DBType.CLOTHING]: {
        read(r) {
            const nextObject = readRN(r);
            const attributes = r.readU16();
            return {
                nextObject,
                broken: (attributes & 0x2000) !== 0,
                charges: (attributes >> 9) & 0xF,
                cursed: (attributes & 0x100) !== 0,
                important: (attributes & 0x80) !== 0,
                clothingType: attributes & 0x7F,
                word2Bits14_15: (attributes >> 14) & 0x3
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2,
                ((r.word2Bits14_15 ?? 0) << 14) | (bit(r.broken) << 13) | ((r.charges & 0xf) << 9) |
                (bit(r.cursed) << 8) | (bit(r.important) << 7) | (r.clothingType & 0x7f));
        },
    },
    // `DB7`, in two forms: four bytes, bits 0-9 of its word a text index and 10-15 the
    // `b10_15()` the new form's `open` was derived from; or six, from extended-features
    // version 'B' (`newScrolls`), whose `open` is bit 0 of a word after an RN to the text
    // record (`doc/CSBwin-src/CSB.h:1198-1219`).
    [DBType.SCROLL]: {
        read(r, shape) {
            const nextObject = readRN(r);
            if (shape.newScrolls) {
                // The RN's record index is exactly what the old 10-bit field held, so
                // storing that keeps every reader of `textReference` unchanged.
                const textRn = readRNOfRecord(r, nextObject, shape);
                const flags = r.readU16();
                const index = shape.objectIndex;
                return {
                    nextObject,
                    open: (flags & 0x1) !== 0,
                    textReference: index && textRn < index.length ? index.indexMap[textRn]! : textRn & 0x3FF,
                    textObject: textRn,
                    word4Bits1_15: (flags >> 1) & 0x7fff
                };
            }
            const attributes = r.readU16();
            return {
                nextObject,
                open: ((attributes >> 10) & 0x3F) === 0,
                textReference: attributes & 0x3FF,
                word2Bits10_15: (attributes >> 10) & 0x3F
            };
        },
        write(buf, at, r, shape) {
            writeLink(buf, at, r);
            if (shape.newScrolls) {
                // The text RN is a secondary reference, and follows `writtenSecondary`.
                const text = r.textObject;
                if (text === undefined) throw new Error('a four-byte scroll cannot be written as a six-byte one');
                writeU16BE(buf, at + 2, writtenSecondary(text, r.nextObject));
                writeU16BE(buf, at + 4, ((r.word4Bits1_15 ?? 0) << 1) | bit(r.open));
                return;
            }
            writeU16BE(buf, at + 2,
                ((r.word2Bits10_15 ?? (r.open ? 0 : 1)) << 10) | (r.textReference & 0x3ff));
        },
    },
    // `DB8::word2` (`doc/CSBwin-src/CSB.h:1221-1237`).
    [DBType.POTION]: {
        read(r) {
            const nextObject = readRN(r);
            const attributes = r.readU16();
            return {
                nextObject,
                important: (attributes & 0x8000) !== 0,
                potionType: (attributes >> 8) & 0x7F,
                power: attributes & 0xFF
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2,
                (bit(r.important) << 15) | ((r.potionType & 0x7f) << 8) | (r.power & 0xff));
        },
    },
    // `DB9` (`doc/CSBwin-src/CSB.h:1239-1253`): link, contents, `m_word4`, `m_uByte6[2]`.
    // `containerType` is bits 1-2 of `m_word4`; the rest of that word is carried, because
    // it is not zero and CSBWin names none of it.
    [DBType.CHEST]: {
        read(r, shape) {
            const nextObject = readRN(r);
            const containedObject = readRNOfRecord(r, nextObject, shape);
            const word4 = r.readU16();
            // `DB9::m_uByte6[2]` — the two bytes that close the record. Zero in every file
            // here, but no more derivable than `FILL2`.
            const uByte6 = [r.readU8(), r.readU8()];
            return {
                nextObject,
                containedObject,
                containerType: (word4 >> 1) & 0x3,
                word4,
                uByte6
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2, writtenSecondary(r.containedObject, r.nextObject));
            writeU16BE(buf, at + 4, (r.word4 ?? ((r.containerType & 3) << 1)) & 0xffff);
            buf[at + 6] = (r.uByte6?.[0] ?? 0) & 0xff;
            buf[at + 7] = (r.uByte6?.[1] ?? 0) & 0xff;
        },
    },
    // `DB10::word2` (`doc/CSBwin-src/CSB.h:1268-1308`).
    [DBType.MISC]: {
        read(r) {
            const nextObject = readRN(r);
            const attributes = r.readU16();
            return {
                nextObject,
                specialState: (attributes >> 14) & 0x3,
                important: (attributes & 0x80) !== 0,
                miscType: attributes & 0x7F,
                cursed: (attributes & 0x100) !== 0,
                subType: (attributes >> 9) & 0x1F
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2,
                ((r.specialState & 3) << 14) | ((r.subType ?? 0) << 9) | (bit(r.cursed) << 8) |
                (bit(r.important) << 7) | (r.miscType & 0x7f));
        },
    },
    // `DB14` (`doc/CSBwin-src/CSB.h:1320-1331`).
    [DBType.MISSILE]: {
        read(r, shape) {
            const nextObject = readRN(r);
            const projectileObject = readRNOfRecord(r, nextObject, shape);
            const rangeRemaining = r.readU8();
            const damageRemaining = r.readU8();
            const timerIndex = r.readU16();
            return {
                nextObject,
                projectileObject,
                rangeRemaining,
                damageRemaining,
                timerIndex
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2, writtenSecondary(r.projectileObject, r.nextObject));
            buf[at + 4] = r.rangeRemaining & 0xff;
            buf[at + 5] = r.damageRemaining & 0xff;
            writeU16BE(buf, at + 6, r.timerIndex & 0xffff);
        },
    },
    // `DB15::word2` (`doc/CSBwin-src/CSB.h:1333-1348`).
    [DBType.CLOUD]: {
        read(r) {
            const nextObject = readRN(r);
            const attributes = r.readU16();
            return {
                nextObject,
                value: (attributes >> 8) & 0xFF,
                cloudType: attributes & 0x7F,
                bit7: (attributes & 0x80) !== 0
            };
        },
        write(buf, at, r) {
            writeLink(buf, at, r);
            writeU16BE(buf, at + 2,
                ((r.value & 0xff) << 8) | (bit(r.bit7) << 7) | (r.cloudType & 0x7f));
        },
    },
};

/** Database `db`'s codec, or `undefined` for one the port carries no records for. */
export function databaseCodec(db: DBType): DatabaseCodec<DatabaseRecord> | undefined {
    return (DATABASE_CODECS as Partial<Record<DBType, DatabaseCodec<DatabaseRecord>>>)[db];
}

/**
 * `count` records of database `db` as `DATABASES::Enlarge` clears them
 * (`doc/CSBwin-src/data.cpp:865-876`): every byte 0 and the link `RNnul`, read
 * through the database's codec as a save's are, in the record shape `bigActuators` and
 * `newScrolls` give. So a cleared record is what a save of it gives back: its other RNs
 * are `RNnul` (`readRNOfRecord`).
 */
export function clearedRecords(db: DBType, count: number, shape: DatabaseShape): DatabaseRecord[] {
    const codec = databaseCodec(db);
    if (!codec || count <= 0) return [];
    const objectIndex = { length: 0, typeMap: new Uint8Array(0), indexMap: new Uint16Array(0) };
    const recordShape: RecordShape = { bigActuators: shape.bigActuators, newScrolls: shape.newScrolls, objectIndex };
    const bytes = new Uint8Array(dbEntrySize(db, recordShape));
    bytes[0] = 0xff;
    bytes[1] = 0xff;
    const records: DatabaseRecord[] = [];
    for (let i = 0; i < count; i++) records.push(codec.read(bytesReader(bytes), recordShape));
    return records;
}

/** A reader over `bytes`, from its first. */
function bytesReader(bytes: Uint8Array): RecordReader {
    let at = 0;
    return {
        readU8: () => readU8(bytes, at++),
        readU16: () => { const value = readU16BE(bytes, at); at += 2; return value; },
    };
}
