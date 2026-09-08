/**
 * `CLOUDTYPE` (`doc/CSBwin-src/CSB.h:1320`) — `DB15.word2` bits 0-6.
 *
 * A "cloud" is CSBWin's catch-all for a transient effect sitting in a cell: the burst
 * of a fireball, a lingering poison cloud, the puff a dying monster leaves, and the
 * Fluxcage that pins Lord Chaos. `ProcessTT_25` reads the type to decide how the
 * thing shrinks and what it damages; the renderer reads it to pick the sprite.
 *
 * The gaps in the numbering are CSBWin's: values 1, 2, 5, 6 and 100+ occur in the
 * data and in `ProcessTT_25`'s switch without ever being named in the enum.
 */
export enum CloudType {
  CT_FIREBALL = 0,
  CT_DISPELL = 3,
  CT_OPENDOOR = 4,
  CT_POISON = 7,
  CT_DEATH = 40,
  CT_FLUXCAGE = 50,
}
