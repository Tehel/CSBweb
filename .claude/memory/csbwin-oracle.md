---
name: csbwin-oracle
description: CSBWin 2023 itself builds and runs here headless (tools/csbwin-oracle/oracle.sh): play a playfile.log, list its draws with callers; settles "port divergence or the run's version?" in seconds
metadata:
  type: project
---

`bash tools/csbwin-oracle/oracle.sh build` compiles `doc/CSBwin-src/`'s Linux build (SDL2 and GLib headers fetched with `apt-get download`, nothing installed) into `doc/CSBwin-src-oracle/`; `play <run folder> [<from>-<to>]` plays its `playfile.log` unpaced (a run in ~20 s) and prints each "Sequence/timing error" with `d.Time`, and every draw in the hex range with its callers (`draws.txt`, `c++filt`).

**Why:** the port's own `--trace` only shows the port's side; diffing the two draw lists per tick found an F24 drift in minutes after hours of guessing. A drift CSBWin 2023 shares at the same place is the run's version's, not the port's.

**How to apply:** for any F24 drift, or any doubt about what CSBWin draws at a moment, run the oracle before reading code. Add a `TraceLine("…", …)` call (declared in `CSBCode.cpp` by the patch) to a scratch copy for state the draws don't show. Don't edit `oracle.sh` while a loop runs it (bash reads scripts as it goes), and don't `pkill -f` a pattern your own command line contains. See [[memmove-source-first]] for reading CSBWin itself.
