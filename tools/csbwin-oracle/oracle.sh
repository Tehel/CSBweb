#!/bin/bash
# CSBWin as an oracle for `DEBT.md` F24 and R18: its Linux build, playing a `playfile.log`
# headless and as fast as it runs, and writing its own draws. Not evidence: what it prints is
# compared by hand with `tools/play-csbwin-log.ts --trace`.
#
#   bash tools/csbwin-oracle/oracle.sh build [--version=11.014]
#   bash tools/csbwin-oracle/oracle.sh play [--version=11.014] <run folder> [<from>-<to>]
#
# Without `--version`, it is CSBWin 2023, from `doc/CSBwin-src/` (`npm run fetch-csbwin-src`),
# built into `doc/CSBwin-src-oracle/` with `oracle.patch`. With `--version=11.014`, it is
# 11.014, from `doc/CSBwin-src-11.014/` (`npm run fetch-csbwin-src -- --version=11.014`),
# built into `doc/CSBwin-src-11.014-oracle/` with `oracle-11.014.patch`.
#
# `build` copies the source to the build folder, applies the patch, and compiles it against
# the headers `apt-get download` fetches into the build folder: nothing is installed. It needs
# Debian's or Ubuntu's apt and g++. 2023 is CSBWin's makefile's objects (`target =
# Ubuntu_SDL20`) over SDL2 and GLib, and needs their runtimes (`libSDL2-2.0.so.0`,
# `libglib-2.0.so.0`). 11.014 is `CMakeLists.txt`'s objects over SDL 1.2, for which the
# folder gets sdl12-compat (`libsdl1.2debian`); it is built 32-bit, as CSBWin then always
# ran, because it keeps pointers in 32-bit words. The 32-bit toolchain's pieces are fetched
# too, and it needs the i386 runtimes: `libc6:i386`, `libstdc++6:i386`, and GLib's and
# SDL2's. `<sys/stat.h>` is included first in every file, because the source includes it
# under `CSBTypes.h`'s `#pragma pack(1)`, which on i386 shrinks the `struct stat` that
# `stat()` fills (`MODIFIEDTIME`, `LinuxFileName.inl`).
#
# The patches change no game code: they force every VBL unpaced, silence the sound, print
# where play meets a "Sequence/timing error" and the playfile's end (2023's `Recording.cpp`,
# 11.014's `data.cpp`) and CSBWin's message boxes, and add the trace (`CSB_DRAWS`, `TraceDraw`
# and `TraceLine` in `CSBCode.cpp`). 11.014's also makes it compile under today's g++, as
# 2023's own source does it: `(int)` in `DSA.cpp`'s `abs`, `NULL` for a pointer's `false` in
# `Viewport.cpp`'s `MaskExists`.
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

command="${1:-}"; shift || true
version=2023
if [ "${1:-}" = "--version=11.014" ]; then version=11.014; shift; fi
case "${1:-}" in --version=*) echo "unknown version: ${1#--version=} (2023 or 11.014)" >&2; exit 1 ;; esac
if [ $version = 2023 ]; then
  source="$root/doc/CSBwin-src" build="$root/doc/CSBwin-src-oracle" fetch="npm run fetch-csbwin-src"
else
  source="$root/doc/CSBwin-src-$version" build="$root/doc/CSBwin-src-$version-oracle"
  fetch="npm run fetch-csbwin-src -- --version=$version"
fi

case "$command" in
build)
  [ -f "$source/CSBCode.cpp" ] || { echo "${source#$root/}/ is missing: $fetch" >&2; exit 1; }
  rm -rf "$build" && cp -r "$source" "$build"
  cd "$build"
  mkdir -p debs sysroot
  if [ $version = 2023 ]; then
    patch -s -p1 < "$here/oracle.patch"
    (cd debs && apt-get download -q libsdl2-dev libgio-2.0-dev >/dev/null)
    for deb in debs/*.deb; do dpkg -x "$deb" sysroot; done
    sr="$build/sysroot"
    inc=(-I"$sr/usr/include/SDL2" -I"$sr/usr/include/glib-2.0" -I"$sr/usr/lib/x86_64-linux-gnu/glib-2.0/include"
         -I"$sr/usr/include/x86_64-linux-gnu" -I"$sr/usr/include")
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
  else
    patch -s -p1 < "$here/oracle-$version.patch"
    (cd debs && apt-get download -q libsdl1.2-dev:i386 libsdl1.2debian:i386 libgio-2.0-dev:i386 \
       lib32stdc++-15-dev lib32gcc-15-dev lib32gcc-s1 lib32stdc++6 libc6-dev-i386 >/dev/null)
    for deb in debs/*.deb; do dpkg -x "$deb" sysroot; done
    sr="$build/sysroot" gcc32="$build/sysroot/usr/lib/gcc/x86_64-linux-gnu/15/32"
    # The extracted `libc.so` and `libm.so` are scripts naming `/usr/lib32/`; these name the
    # installed `libc6:i386`'s libraries.
    mkdir -p ld
    printf 'OUTPUT_FORMAT(elf32-i386)\nGROUP ( /usr/lib/i386-linux-gnu/libc.so.6 %s/usr/lib32/libc_nonshared.a AS_NEEDED ( /lib/ld-linux.so.2 ) )\n' "$sr" > ld/libc.so
    printf 'OUTPUT_FORMAT(elf32-i386)\nGROUP ( /usr/lib/i386-linux-gnu/libm.so.6 )\n' > ld/libm.so
    m32=(-m32 -isystem "$sr/usr/include/x86_64-linux-gnu/c++/15/32" -isystem "$sr/usr/include/x86_64-linux-gnu"
         -idirafter /usr/include/x86_64-linux-gnu)
    inc=(-I"$sr/usr/include" -I"$sr/usr/include/glib-2.0" -I"$sr/usr/lib/i386-linux-gnu/glib-2.0/include")
    # `CMakeLists.txt`'s objects, with debug information for the callers.
    objs=(LinScreen CSBlinux LinCSBUI AsciiDump Attack Bitmaps CSBCode CSBUI Chaos Character Code11f52
          Code13ea4 Code17818 Code1f9e6 Code222ea Code390e Code51a4 Codea59a DSA Graphics Hint Magic
          Menu Monster Mouse MoveObject NewBugs OldBugs RC4 SaveGame SmartDiscard Sound Statistics
          Stdafx Timer Translation VBL Viewport WinScreen data md5C system utility)
    for o in "${objs[@]}"; do
      g++ "${m32[@]}" -include sys/stat.h -g -O0 -D_LINUX -w -fpermissive -c "$o.cpp" "${inc[@]}" -o "$o.o" &
    done
    wait
    g++ "${m32[@]}" -B"$sr/usr/lib32" -B"$gcc32" -L"$build/ld" -L"$sr/usr/lib32" -L"$gcc32" -rdynamic \
      "${objs[@]/%/.o}" "$sr/usr/lib/i386-linux-gnu/libSDL-1.2.so.0" /usr/lib/i386-linux-gnu/libglib-2.0.so.0 \
      -Wl,-rpath,"$sr/usr/lib/i386-linux-gnu" -o CSBwin-oracle
  fi
  echo "built $build/CSBwin-oracle"
  ;;
play)
  folder="${1:?a run folder}"
  [ -x "$build/CSBwin-oracle" ] || {
    echo "not built: bash tools/csbwin-oracle/oracle.sh build$([ $version = 2023 ] || echo " --version=$version")" >&2; exit 1; }
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
  # 2023 is line-buffered by `stdbuf`; 11.014, whose 32-bit build `stdbuf` cannot preload
  # into, flushes each line its patch prints.
  buffer=(stdbuf -oL); [ $version = 2023 ] || buffer=()
  (cd "$run" && CSB_DRAWS="${2:-}" SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
    exec "${buffer[@]}" "$build/CSBwin-oracle" --play "$log" > out.txt 2>&1) &
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
  if [ -n "${2:-}" ]; then echo "draws:     $run/draws.txt (c++filt demangles)"; fi
  echo "folder:    $run"
  ;;
*)
  sed -n '5,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
