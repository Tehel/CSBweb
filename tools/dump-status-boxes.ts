/**
 * The boxes around the mouth and the eye in an open inventory.
 *
 * `doc/CSBwin-src/Character.cpp:1368-1397` blits one of two graphics into each of two
 * fixed rectangles: **33** is the plain box, **34** the one that marks something wrong.
 * The mouth is marked when the champion is starving, parched or poisoned; the eye when
 * any of attributes **1..6** has Current below Maximum.
 *
 * The second is the "red square after a level gain" this port had an open question
 * about for a long time, and the answer is that it has nothing to do with levels. A
 * level raises the *maxima* (`doc/CSBwin-src/Magic.cpp:101-151`) and leaves Current
 * where it stood, so the gap opens and the box changes — and a champion drained by a
 * monster shows exactly the same box.
 *
 * **Why this is a tool and not a golden frame.** The frames cannot see this. Graphic
 * 33 is pixel-identical to the inventory background beneath it, so in the only state
 * the frames capture — a freshly injected party, fed and undamaged — drawing the boxes
 * changes nothing at all, and `tools/check-frames.sh` reported all five frames
 * unchanged after they were added. What has to be proved is that the *other* graphic
 * exists, differs, and is chosen on the right condition.
 *
 * So: the two rectangles come out of `graphics.dat` (they are `d.Word1398` and
 * `d.Word1406`, already extracted for the mouth-chew animation and the eye's hit box),
 * both graphics are measured, and every arm of both predicates is driven.
 *
 * Run: `npx tsx tools/dump-status-boxes.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { AttributeIndex, setAttributeCurrent } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { BOX_GRAPHIC_MARKED, BOX_GRAPHIC_PLAIN } from '../src/renderer/ui/Draw';
import { eyeBoxGraphic, mouthBoxGraphic } from '../src/renderer/ui/Inventory';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { graphicsTablesOf } from './lib/game';

/** A champion with nothing wrong: fed, watered, unpoisoned, no attribute drained. */
function healthyChampion(): Champion {
  return {
    ...addCharacterDefaults(),
    name: 'HERO',
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: 0,
  };
}

const ATTRIBUTE_NAMES = ['Luck', 'Strength', 'Dexterity', 'Wisdom', 'Vitality', 'AntiMagic', 'AntiFire'];

function main(): void {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const g232 = graphicsTablesOf(graphics).ui.graphic232;

  /* ---------------------------------------- the geometry ------------------------- */

  console.log('=== where the boxes go, from graphics.dat item 0x232 ===');
  console.log(['rect', 'x1', 'y1', 'x2', 'y2', 'w', 'h'].join('\t'));
  const rects = [
    ['Word1398 (mouth)', g232.word1398],
    ['Word1406 (eye)', g232.word1406],
  ] as const;
  for (const [name, r] of rects) {
    console.log([name, r.x1, r.y1, r.x2, r.y2, r.x2 - r.x1 + 1, r.y2 - r.y1 + 1].join('\t'));
  }
  console.log('');

  // Each box is 18x18 on screen while its source line is 16 *bytes* — 32 pixels. The
  // two numbers are not in conflict: 16 bytes is the Atari row **stride**, an 18-pixel
  // row rounded up to a whole number of 8-byte bitplane groups, and `TAG0088b2` walks
  // the source by that stride while copying only as much as the destination rectangle
  // asks for. Passing the image's visible width as the stride instead would skew every
  // row by 14 pixels.
  for (const [name, r] of rects) {
    check(r.x2 - r.x1 + 1 === 18, `${name} is 18 pixels wide on screen`);
    check(r.y2 - r.y1 + 1 === 18, `${name} is 18 pixels tall`);
  }
  // The two boxes are side by side in the same strip: same height, same rows.
  check(g232.word1398.y1 === g232.word1406.y1, 'mouth and eye boxes share a top edge');
  check(g232.word1398.y2 === g232.word1406.y2, 'and a bottom edge');
  check(g232.word1398.x1 !== g232.word1406.x1, 'but sit at different columns');

  /* ---------------------------------------- the two graphics --------------------- */

  console.log('=== the two box graphics ===');
  console.log(['graphic', 'width', 'height'].join('\t'));
  const plain = graphics.getImage(BOX_GRAPHIC_PLAIN);
  const marked = graphics.getImage(BOX_GRAPHIC_MARKED);
  if (!plain || !marked) {
    check(false, 'both box graphics should decode out of graphics.dat');
    finish();
    return;
  }
  console.log([`${BOX_GRAPHIC_PLAIN} (plain)`, plain.width, plain.height].join('\t'));
  console.log([`${BOX_GRAPHIC_MARKED} (marked)`, marked.width, marked.height].join('\t'));
  console.log('');

  // The decoded width is the padded stride the blit is told about, and it must be at
  // least as wide as the rectangle being filled or the box would be clipped.
  check(plain.width === 32, "graphic 33 decodes at the 16-byte stride's 32 pixels");
  check(plain.height === 18, 'and 18 rows, the height of the destination rectangle');
  check(marked.width === plain.width && marked.height === plain.height, 'graphic 34 is the same size');
  check(
    plain.width >= g232.word1398.x2 - g232.word1398.x1 + 1,
    'the source is at least as wide as the rectangle it fills',
  );
  // The whole point of two graphics: if they were identical the box could never say
  // anything, and the frames' silence would be the truth rather than an artefact.
  const differs = Array.from(plain.pixels).some((px, i) => px !== marked.pixels[i]);
  check(differs, 'the marked box must actually differ from the plain one');

  /* ---------------------------------------- the mouth predicate ------------------ */

  console.log('=== the mouth: food < 0, water < 0 or poisoned ===');
  console.log(['champion', 'food', 'water', 'poison', 'graphic'].join('\t'));
  const mouthCases: Array<[string, Partial<Champion>, number]> = [
    ['fed and well', {}, BOX_GRAPHIC_PLAIN],
    ['food exactly 0', { food: 0 }, BOX_GRAPHIC_PLAIN],
    ['starving', { food: -1 }, BOX_GRAPHIC_MARKED],
    ['water exactly 0', { water: 0 }, BOX_GRAPHIC_PLAIN],
    ['parched', { water: -1 }, BOX_GRAPHIC_MARKED],
    ['poisoned', { poisonCount: 1 }, BOX_GRAPHIC_MARKED],
  ];
  for (const [what, patch, expected] of mouthCases) {
    const champ = Object.assign(healthyChampion(), patch);
    const got = mouthBoxGraphic(champ);
    console.log([what, champ.food, champ.water, champ.poisonCount, got].join('\t'));
    check(got === expected, `mouth box for "${what}" should be graphic ${expected}`);
  }
  console.log('');

  /* ---------------------------------------- the eye predicate -------------------- */

  console.log('=== the eye: any of attributes 1..6 with Current < Maximum ===');
  console.log(['drained attribute', 'graphic'].join('\t'));
  {
    const champ = healthyChampion();
    const got = eyeBoxGraphic(champ);
    console.log(['(none)', got].join('\t'));
    check(got === BOX_GRAPHIC_PLAIN, 'an undrained champion gets the plain eye box');
  }
  for (let i = 0; i < ATTRIBUTE_NAMES.length; i++) {
    const champ = healthyChampion();
    const attr = champ.attributes.stats[i]!;
    setAttributeCurrent(attr, 1);
    const got = eyeBoxGraphic(champ);
    console.log([`${i} ${ATTRIBUTE_NAMES[i]}`, got].join('\t'));
    // Luck is index 0 and CSBWin's loop starts at 1, so it can never mark the eye.
    const expected = i === AttributeIndex.Luck ? BOX_GRAPHIC_PLAIN : BOX_GRAPHIC_MARKED;
    check(got === expected, `a drained ${ATTRIBUTE_NAMES[i]} should give graphic ${expected}`);
  }
  console.log('');

  // The level-gain case, spelled out: raising the maxima alone opens the gap.
  {
    const champ = healthyChampion();
    check(eyeBoxGraphic(champ) === BOX_GRAPHIC_PLAIN, 'before a level gain the eye box is plain');
    const attr = champ.attributes.stats[AttributeIndex.Vitality]!;
    attr.maximum = (attr.maximum + 5) & 0xff; // what LevelUp does — Maximum only
    console.log(`after a level gain raises one Maximum: graphic ${eyeBoxGraphic(champ)}`);
    check(
      eyeBoxGraphic(champ) === BOX_GRAPHIC_MARKED,
      'raising a Maximum alone marks the eye — this is the "red square on level gain"',
    );
  }

  finish();
}

main();
