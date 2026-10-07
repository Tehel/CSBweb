#!/bin/bash
# Build the image, ship it to the VPS and restart the stack there (PLAN.md Phase 17,
# step 6). The author runs it by hand, after `npm test`.
#
# The target is read from a gitignored `.env` at the repository's root, so the repository
# names no host, login or path:
#
#   DEPLOY_HOST=<user>@<host>   the SSH destination
#   DEPLOY_DIR=<path>           the stack's folder there: app/, gamefiles/ and stats/
#                               (`docker-compose.yaml`)
#
# The VPS's Compose v1 cannot recreate a container, so the image goes over as a file and
# the stack is taken down and brought up again. The compose file goes with every deploy,
# so the remote stack cannot drift from the repository. The game files do not: they are
# uploaded on their own, when they change.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

[ -f "$root/.env" ] || { echo "no .env at $root: it names DEPLOY_HOST and DEPLOY_DIR" >&2; exit 1; }
set -a
# shellcheck source=/dev/null
. "$root/.env"
set +a
: "${DEPLOY_HOST:?DEPLOY_HOST is not set in .env}"
: "${DEPLOY_DIR:?DEPLOY_DIR is not set in .env}"

# The build the page's events name: the commit, marked when the tracked files differ from it.
build="$(git -C "$root" rev-parse --short HEAD)"
[ -z "$(git -C "$root" status --porcelain --untracked-files=no)" ] || build="$build-dirty"

echo "building csbweb:latest ($build)"
docker build --build-arg CSBWEB_BUILD="$build" -t csbweb:latest "$root"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
docker save csbweb:latest | gzip > "$tmp/csbweb.tar.gz"

echo "shipping to $DEPLOY_HOST:$DEPLOY_DIR"
# stats/ is made here, by the login user, so that the container's uid 1000 can write it.
ssh "$DEPLOY_HOST" "mkdir -p '$DEPLOY_DIR/stats'"
scp "$tmp/csbweb.tar.gz" "$root/docker-compose.yaml" "$DEPLOY_HOST:$DEPLOY_DIR/"
ssh "$DEPLOY_HOST" "cd '$DEPLOY_DIR' && gunzip -c csbweb.tar.gz | docker load && rm csbweb.tar.gz \
  && docker-compose down && docker-compose up -d && docker-compose ps"
echo "deployed $build"
