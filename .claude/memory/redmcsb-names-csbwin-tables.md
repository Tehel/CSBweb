---
name: redmcsb-names-csbwin-tables
description: An anonymous CSBWin `d.ByteNNNN`/`d.PointerNNNN` table is usually named in ReDMCSB: grep `doc/ReDMCSB-src/*.C` for its meaning and its fill code
metadata:
  type: reference
---

CSBWin's tables carry their address for a name (`d.Pointer1864`, `d.Byte5728`), and its
comments often guess (`// ColorMaphow many???`). ReDMCSB names the same table for what
it is, and fills it in one readable place: `d.Pointer1864` is
`G0075_apuc_PaletteChanges_Projectile`, set at `doc/ReDMCSB-src/STARTUP2.C:818-822`
(D3 map, D2 map, no change, no change).

**Why:** one grep of ReDMCSB by role (`PaletteChanges`, `Projectile`, `Explosion`…)
confirms or corrects a reading of CSBWin's anonymous table, where tracing CSBWin's
writers costs several peeks.

**How to apply:** when a CSBWin table's meaning or extent is unclear, grep ReDMCSB's
`G0…` globals near the function's ReDMCSB twin (`DUNVIEW.C` for the viewport) before
tracing CSBWin's writers. CSBWin stays the spec; ReDMCSB is the shortcut to reading it,
and wins only where its Atari branch differs ([[shared-bugs-stay]]).
