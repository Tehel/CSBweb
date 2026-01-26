# CSBWin Movement and Collision Reference (Sourced)

This document captures verified movement/collision rules from the CSBWin C++ source under `doc/CSBwin-src/`.

## Party movement blocking

- Party movement blocks on `roomSTONE`, blocks on `roomDOOR` unless `doorState` is `0`, `1`, or `5`, and blocks on `roomFALSEWALL` when both `(cellFlags & 0x04) == 0` and `(cellFlags & 0x01) == 0` (`doc/CSBwin-src/CSBCode.cpp`).
