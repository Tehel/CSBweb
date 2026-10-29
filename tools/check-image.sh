#!/bin/bash
# The golden frames against the image (`doc/DEPLOYMENT.md`): proof that the built
# page, served by `server/` in its container, draws what the dev server draws.
#
# Builds the image with CSBWEB_PROBE=1 (the probes' handle, which a deployed image never
# has) as csbweb:probe, runs it over the checkout's game files and a throwaway stats folder,
# its store filled from their manifest (`tools/data-sets.json`, by `tools/fill-data-sets.ts`), runs `check-frames.sh --url` against it, and removes the container.
# The game files' folder is throwaway too, each entry of `tools/fixtures/gamefiles/` mounted in it
# read-only, so that the probe's publish (`server/publish.ts`) writes its set's folder
# there and leaves the checkout as it was.
# Before the frames, it runs the server's check of a player's set (`dist/server/`,
# `server/app.ts` → `READERS_MODULE`) in the container, on DM's own files, and its reader
# of a recording's package, on a gzipped JSON that is none: the server loads them at
# start-up, and the image's Node must also run them. And it has the store
# (`server/store.ts`) update many rows in a transaction, in a scratch file beside the stats,
# as a migration of a deployed store does: on the read-only file system, the statement's
# temporary journal has nowhere to go but memory. The throwaway store, which holds no event,
# never needs one.
#
#   bash tools/check-image.sh
#
# IMAGE_PORT overrides the host port (8088). It needs Docker and Chrome, so it is not part
# of `npm test`.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
port="${IMAGE_PORT:-8088}"
name="csbweb-check-$$"
stats="$(mktemp -d)"
gamefiles="$(mktemp -d)"
mounts=()
for entry in "$root"/tools/fixtures/gamefiles/*; do mounts+=(-v "$entry:/data/gamefiles/$(basename "$entry"):ro"); done

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1
  rm -rf "$stats" "$gamefiles"
}
trap cleanup EXIT

echo "building csbweb:probe"
docker build -q --build-arg CSBWEB_BUILD=check --build-arg CSBWEB_PROBE=1 -t csbweb:probe "$root" >/dev/null || exit 1
# The moderator is the dev server's own (`DEV_MODERATOR_PLAYER_ID`, `vite.config.mts`),
# whom `probe-frames.ts` plays to moderate the set it publishes.
(cd "$root" && npx tsx tools/fill-data-sets.ts "$stats/stats.db") || exit 1
# With the limits `docker-compose.yaml` sets, so that the frames, and the probe's publish,
# run as the deployed container does.
docker run -d --name "$name" -p "127.0.0.1:$port:8085" \
  --memory 512m --pids-limit 100 --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$gamefiles:/data/gamefiles" "${mounts[@]}" -v "$stats:/data/stats" \
  -e MODERATOR_PLAYER_IDS=00000000-0000-4000-8000-000000000001 csbweb:probe >/dev/null || exit 1
i=0
until curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:$port/api/health"; do
  i=$((i + 1))
  if [ "$i" -ge 50 ]; then echo "the container did not answer:" >&2; docker logs "$name" >&2; exit 1; fi
  sleep 0.2
done
docker logs "$name"
docker exec "$name" node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { gzipSync } from "node:zlib";
  const { checkLocalDataSet, readRecordingPackage } = await import("/app/dist/server/PageReaders.js");
  const dir = "/data/gamefiles/dm-atari";
  const blob = (name) => new Blob([readFileSync(`${dir}/${name}`)]);
  const draft = { id: "dm", name: "DM", description: "", authors: [], dmRules: true, baseSet: "dm-atari",
    files: { "dungeon.dat": blob("dungeon.dat"), "graphics.dat": blob("graphics.dat") } };
  const { problems, record } = await checkLocalDataSet(draft, new Set(), () => null, 0);
  if (!record) { console.error("the server'"'"'s check refused DM:", JSON.stringify(problems)); process.exit(1); }
  console.log(`the server'"'"'s check: DM makes a record, signature ${record.dungeonSignature[0].slice(0, 12)}…`);
  const refusal = await readRecordingPackage(new Uint8Array(gzipSync("{}")), 1024).then(() => "read", (error) => error.message);
  if (!refusal.startsWith("not a package of version")) { console.error(`the server'"'"'s reader of a package: ${refusal}`); process.exit(1); }
  console.log(`the server'"'"'s reader of a package: {} unzipped and refused, ${refusal}`);
' || exit 1
docker exec "$name" node --input-type=module -e '
  import { rmSync } from "node:fs";
  const { openStore } = await import("/app/server/store.ts");
  const path = "/data/stats/check-temp.db";
  const db = openStore(path);
  try {
    db.exec("CREATE TABLE t (x INTEGER NOT NULL, payload TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO t VALUES (?, ?)");
    for (let i = 0; i < 2000; i++) insert.run(i * 7, "x".repeat(100));
    db.exec("BEGIN; UPDATE t SET x = x - x % 10 WHERE x % 10 <> 0; COMMIT");
    console.log("the store: a transaction'"'"'s update of many rows runs on the read-only file system");
  } catch (error) {
    console.error(`the store cannot update many rows in a transaction: ${error.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
    for (const file of [path, `${path}-wal`, `${path}-shm`]) rmSync(file, { force: true });
  }
' || exit 1
bash "$root/tools/check-frames.sh" --url "http://localhost:$port/"
