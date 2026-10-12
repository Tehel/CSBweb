#!/bin/bash
# The golden frames against the image (`doc/DEPLOYMENT.md`): proof that the built
# page, served by `server/` in its container, draws what the dev server draws.
#
# Builds the image with CSBWEB_PROBE=1 (the probes' handle, which a deployed image never
# has) as csbweb:probe, runs it over the checkout's game files, their manifest
# (`tools/data-sets.json`) and a throwaway stats folder, runs `check-frames.sh --url` against it, and removes the container.
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

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1
  rm -rf "$stats"
}
trap cleanup EXIT

echo "building csbweb:probe"
docker build -q --build-arg CSBWEB_BUILD=check --build-arg CSBWEB_PROBE=1 -t csbweb:probe "$root" >/dev/null || exit 1
docker run -d --name "$name" -p "127.0.0.1:$port:8085" \
  -v "$root/static/gamefiles:/data/gamefiles:ro" -v "$root/tools/data-sets.json:/data/data-sets.json:ro" \
  -e MANIFEST_FILE=/data/data-sets.json -v "$stats:/data/stats" csbweb:probe >/dev/null || exit 1
i=0
until curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:$port/api/health"; do
  i=$((i + 1))
  if [ "$i" -ge 50 ]; then echo "the container did not answer:" >&2; docker logs "$name" >&2; exit 1; fi
  sleep 0.2
done
docker logs "$name"
bash "$root/tools/check-frames.sh" --url "http://localhost:$port/"
