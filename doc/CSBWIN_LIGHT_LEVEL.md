# CSBWin Light Level (Palette-Based) Reference

## Overview

CSBWin uses a *global* light level for the 2.5D viewport, implemented by
switching the active 16-color palette. There is no per-cell lighting; the
entire viewport uses the same palette index. UI text/portraits use a
separate palette and are not dimmed by the dungeon light level.

Primary sources:
- `doc/CSBwin-src/CSBCode.cpp:7242+` `SelectPaletteForLightLevel`
- `doc/CSBwin-src/Timer.cpp:2835+` `ProcessLightLevelTimer`
- `doc/CSBwin-src/Magic.cpp:828+` `SetBrightnessTimer`
- `doc/CSBwin-src/CSBCode.cpp:980+` VBL palette swap
- `doc/CSBwin-src/Data.h:922+`, `1422+`, `1464+` data layout

## Core Data Fields (from Data.h)

- `d.Brightness` (i16): ambient light accumulator (save-game state)
  - `doc/CSBwin-src/Data.h:767`
- `d.Word1074[16]`: brightness lookup table
  - Used by torches and timed brightness decay
  - `doc/CSBwin-src/Data.h:1424`, swapped in `CSBCode.cpp:10213`
- `d.PaletteBrightness[6]`: brightness thresholds for selecting palette index
  - `doc/CSBwin-src/Data.h:1422`, swapped in `CSBCode.cpp:10212`
- `d.Palette552[6]`: the six 16-color palettes (lightest to darkest)
  - `doc/CSBwin-src/Data.h:1464`, swapped in `CSBCode.cpp:10225`
- `d.CurrentPalette`: index into `Palette552` (0..5)
  - `doc/CSBwin-src/Data.h:922`
- `d.Word11778`: VBL flag that triggers palette update
  - `doc/CSBwin-src/Data.h:879`, set in `SelectPaletteForLightLevel`

The palette tables above are loaded via the expanded graphic block
`0x232` and byte-swapped during initialization
(`doc/CSBwin-src/CSBCode.cpp:10190-10230`).

## How Light Level Is Computed

### 1) Torches in Hands
`SelectPaletteForLightLevel` collects *torch charges* from all hands
(4 characters x 2 hands = 8 slots) and uses the **four brightest**
torches to influence the total light:

- Source: `doc/CSBwin-src/CSBCode.cpp:7242-7322`
- Torch detection: `objNI_Torch_a`..`objNI_Torch_d`
- Charge value: `DB5::charges()`

Algorithm (as implemented):

```
LOCAL_26[8] = torch charges in all hands
Selection-sort the first 4 entries (descending)
D6W = 6
for first 5 entries in LOCAL_26:
  if charge == 0: continue
  brightness = Word1074[charge] * 2^(D6W-6)
  totalLight += brightness
  D6W = max(0, D6W - 1)
```

Note: the comment says "Find four brightest torches" but the code sums
**five** entries after sorting the first four; this appears to be a
legacy quirk in CSBWin (`CSBCode.cpp:7283+`).

Torch charge burn-down:
- `NinetySecondUpdate` decrements torch charges in hands and calls
  `SelectPaletteForLightLevel` afterward
  (`doc/CSBwin-src/CSBCode.cpp:7339-7387`). It runs every 512 ticks,
  `(d.Time & 511) == 0` (`doc/CSBwin-src/CSBCode.cpp:680-683`), and skips a Hall of
  Champions recruit — see `doc/PROVEN_FACTS.md` → "Torches burn down every 512 ticks".

### 2) Ambient Brightness (`d.Brightness`)
After summing torch contributions, CSBWin adds `d.Brightness`:

- `totalLight += d.Brightness`
- `doc/CSBwin-src/CSBCode.cpp:7308`

`d.Brightness` is adjusted by:

- **Illumulet** on equip/unequip
  - Add/subtract `Word1074[2]`
  - `doc/CSBwin-src/Character.cpp:1866-2017`
- **Light/Darkness spells**
  - Increase/decrease `d.Brightness` and schedule decay
  - `doc/CSBwin-src/Magic.cpp:1288-1312`
- **Light attack (torch action)**
  - `d.Brightness += Word1074[2]`, decay over time
  - `doc/CSBwin-src/Attack.cpp:2068-2082`

### 3) Palette Selection (Thresholding)
Once `totalLight` is computed, CSBWin selects one of 6 palettes:

- If current level's `experienceMultiplier == 0`, force palette 0
  (full brightness): `doc/CSBwin-src/CSBCode.cpp:7248-7258`
  - `experienceMultiplier` is `LEVELDESC.word12` bits 12-15
    (`doc/CSBwin-src/CSB.h:2108-2135`). In our TS loader this is exposed
    as `MapDescriptor.difficulty`.
- Else compare to `PaletteBrightness[6]`:

```
if totalLight > 0:
  D4W = 0
  while (PaletteBrightness[D4W] > totalLight) D4W++
else:
  D4W = 5
CurrentPalette = D4W
```

- `doc/CSBwin-src/CSBCode.cpp:7309-7322`

### 4) Apply Palette in VBL
`SelectPaletteForLightLevel` sets `d.Word11778 = 1`. During the VBL
handler, CSBWin copies the selected palette into the active viewport
palette:

- `doc/CSBwin-src/CSBCode.cpp:1004-1024`

```
if Word11778:
  Word11778 = 0
  Palette11946 = Palette552[CurrentPalette]
```

`Palette11946` is the palette used for viewport drawing when
`DynamicPaletteSwitching` is enabled, while portraits/text use
`Palette11978` (`doc/CSBwin-src/Data.h:894-899`).

## Timed Brightness Decay

### SetBrightnessTimer
`SetBrightnessTimer(deltaSteps, timeDelay)` creates a `TT_LIGHT` timer
and calls `SelectPaletteForLightLevel` immediately:

- `doc/CSBwin-src/Magic.cpp:828-839`

### TT_LIGHT Timer Processing
On timer fire, CSBWin runs:

1. `ProcessLightLevelTimer` (Timer.cpp)
2. `SelectPaletteForLightLevel` (CSBCode.cpp)

`ProcessLightLevelTimer` uses the step count to adjust `d.Brightness`
by *difference* between two `Word1074[]` entries, then reschedules
another `TT_LIGHT` in 4 time units if steps remain:

- `doc/CSBwin-src/Timer.cpp:2835-2868`
- `doc/CSBwin-src/CSBCode.cpp:6514-6519`

This is how spells and other effects fade smoothly after their delay.

## Spell Effects (Light / Darkness)

`Magic.cpp` case 3 handles light-related spells (`missileType` values):

- **Light (missileType 0)**
  - `D6W = 4*(spellPower+1)`
  - delay: `10000 + (D6W-8)*512`
  - `D6W = D6W/2 - 1`
  - `d.Brightness += Word1074[D6W]`
  - `SetBrightnessTimer(-D6W, delay)`

- **Magic Torch (missileType 5)**
  - delay: `4000 + 128*(D6W-3)`
  - `D6W = D6W/4 + 1`
  - `d.Brightness += Word1074[D6W]`
  - `SetBrightnessTimer(-D6W, delay)`

- **Darkness (missileType 1)**
  - `D6W = D6W/4`
  - `d.Brightness -= Word1074[D6W]`
  - `SetBrightnessTimer(D6W, 98)`

Source: `doc/CSBwin-src/Magic.cpp:1288-1312`

## Notes / Open Questions

- **Torch types**: `SelectPaletteForLightLevel` accepts
  `objNI_Torch_a..objNI_Torch_d`, but `AddCharacterPossession` only
  auto-lights `objNI_Torch_a` on pickup (`Character.cpp:1988-2001`).
  It is unclear whether the other torch types are intended to contribute
  brightness differently or simply represent variants.
- **"Four brightest" vs five**: selection-sort runs for four entries but
  the summation loop runs five; this is likely intentional legacy logic.
