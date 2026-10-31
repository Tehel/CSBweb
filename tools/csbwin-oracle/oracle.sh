#!/bin/bash
# CSBWin 2023 as an oracle for `DEBT.md` F24: its Linux build, from `doc/CSBwin-src/`, playing a
# `playfile.log` headless and as fast as it runs, and writing its own draws. Not evidence:
# what it prints is compared by hand with `tools/play-csbwin-log.ts --trace`.
#
#   bash tools/csbwin-oracle/oracle.sh build
#   bash tools/csbwin-oracle/oracle.sh play <run folder> [<from>-<to>]
#
# `build` copies `doc/CSBwin-src/` (`npm run fetch-csbwin-src`) to `doc/CSBwin-src-oracle/`,
# applies `oracle.patch`, and compiles it against the SDL2 and GLib headers, which
# `apt-get download` fetches into the build folder: nothing is installed. It needs Debian's
# or Ubuntu's apt, g++, and the SDL2 and GLib runtimes (`libSDL2-2.0.so.0`, `libglib-2.0.so.0`).
# The patch changes no game code: it forces every VBL unpaced, silences the sound, prints
# where play meets a "Sequence/timing error" and the playfile's end (`Recording.cpp`), and
# adds the trace (`CSB_DRAWS`, `TraceDraw` and `TraceLine` in `CSBCode.cpp`).
#
# `play` copies the run folder's files (its `playfile.log`, `dungeon.dat`, `graphics.dat`,
# `config.txt`, …) to a scratch folder, plays the log with `--play`, and prints CSBWin's own
# messages (a file it cannot find, a line it cannot read), whether the playfile was closed at
# its end (a won game stops at the credits first: then a folder whose `config.txt` records
# shows its record's last line), and where it met each "Sequence/timing error", which the
# build answers OK, so play goes on from the recorded random.
# With `<from>-<to>`, `d.Time` in hex, every call of the generator in that range is listed
# with its callers in `draws.txt`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
build="$root/doc/CSBwin-src-oracle"

case "${1:-}" in
build)
  [ -f "$root/doc/CSBwin-src/CSBCode.cpp" ] || { echo "doc/CSBwin-src/ is missing: npm run fetch-csbwin-src" >&2; exit 1; }
  rm -rf "$build" && cp -r "$root/doc/CSBwin-src" "$build"
  patch -s -p1 -d "$build" < "$here/oracle.patch"
  mkdir -p "$build/debs" "$build/sysroot"
  (cd "$build/debs" && apt-get download -q libsdl2-dev libgio-2.0-dev >/dev/null)
  for deb in "$build"/debs/*.deb; do dpkg -x "$deb" "$build/sysroot"; done
  sr="$build/sysroot"
  inc=(-I"$sr/usr/include/SDL2" -I"$sr/usr/include/glib-2.0" -I"$sr/usr/lib/x86_64-linux-gnu/glib-2.0/include"
       -I"$sr/usr/include/x86_64-linux-gnu" -I"$sr/usr/include")
  cd "$build"
  # The makefile's objects (`target = Ubuntu_SDL20`), with debug information for the callers.
  objs=(DSA data Code11f52 Graphics Magic CSBCode Timer Character system SmartDiscard VBL Mouse
        Recording LinCSBUI CSBlinux Code51a4 CSBUI MoveObject Hint Monster Code17818 Viewport
        AsciiDump Menu Chaos SaveGame Translation Bitmaps md5C utility WinScreen Code13ea4
        Codea59a RC4 Attack Sound Code1f9e6 Code390e Code222ea Statistics SoundMixer)
  for o in "${objs[@]}"; do
    g++ -g -O0 -D_LINUX -DRGB655 -DSDL20 -w -fpermissive -c "$o.cpp" "${inc[@]}" -o "$o.o" &
  done
  wait
  ln -sf /usr/lib/x86_64-linux-gnu/libSDL2-2.0.so.0 libSDL2.so
  ln -sf /usr/lib/x86_64-linux-gnu/libglib-2.0.so.0 libglib-2.0.so
  g++ -rdynamic "${objs[@]/%/.o}" -L. -lSDL2 -lglib-2.0 -o CSBwin-oracle
  echo "built $build/CSBwin-oracle"
  ;;
play)
  folder="${2:?a run folder}"
  [ -x "$build/CSBwin-oracle" ] || { echo "not built: bash tools/csbwin-oracle/oracle.sh build" >&2; exit 1; }
  run="$(mktemp -d)"
  # In lower case and in upper case: the Linux build folds no case, and asks for
  # `graphics.dat` but for `CSBGAME.DAT` (`_SelectSaveGame`), where folders have either.
  find "$folder" -maxdepth 1 -type f ! -iname '*.exe' -print0 |
    while IFS= read -r -d '' file; do
      b="$(basename "$file")"; cp "$file" "$run/${b,,}"; [ "${b^^}" = "${b,,}" ] || ln -sf "${b,,}" "$run/${b^^}"
    done
  log="$(cd "$run" && ls | grep -i '^playfile\.log$' | head -1)"
  [ -n "$log" ] || { echo "no playfile.log in $folder" >&2; exit 1; }
  rm -f "$run"/[Rr]ecord*.log
  (cd "$run" && CSB_DRAWS="${3:-}" SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
    exec stdbuf -oL "$build/CSBwin-oracle" --play "$log" > out.txt 2>&1) &
  pid=$!
  # CSBWin plays on past the log's end, on the credits or waiting for input: it is stopped
  # at the end of the playfile, or once neither its output nor its record has grown for
  # thirty seconds (a whole run plays in about twenty).
  size=-1 still=0
  while kill -0 "$pid" 2>/dev/null && ! grep -q '^End of the playfile' "$run/out.txt" 2>/dev/null; do
    timeout 1 tail -f /dev/null || true
    now=$( { cat "$run/out.txt" "$run/Record00000.log" 2>/dev/null || true; } | wc -c)
    if [ "$now" = "$size" ]; then still=$((still + 1)); [ $still -ge 30 ] && break; else still=0; fi
    size=$now
  done
  kill -9 "$pid" 2>/dev/null || true # SIGTERM only queues an SDL quit, which the game ignores
  wait "$pid" 2>/dev/null || true
  echo "playfile:  $(grep -v '^#' "$run/$log" | tail -1)"
  # CSBWin's own message boxes, printed: a file it cannot find, a line it cannot read, a `die`.
  grep "Message = " "$run/out.txt" | grep -v "Sequence/timing\|End Of PlaybackFile" |
    sed 's/^ *Message = /message:   /' || true
  # A won game stops at the credits, before the playfile is closed: its record's last line
  # (a run folder with a `config.txt` that records) is then where it got to.
  echo "end:       $(grep -m1 '^End of the playfile' "$run/out.txt" || echo "the playfile not closed")"
  if [ -f "$run/Record00000.log" ]; then echo "recorded:  $(tail -1 "$run/Record00000.log")"; fi
  grep -m5 "^Sequence/timing error at" "$run/out.txt" || echo "no Sequence/timing error"
  echo "errors:    $(grep -c "^Sequence/timing error at" "$run/out.txt" || true)"
  if [ -n "${3:-}" ]; then echo "draws:     $run/draws.txt (c++filt demangles)"; fi
  echo "folder:    $run"
  ;;
*)
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
