#!/bin/bash
# Build the image, ship it to the VPS and restart the stack there (`doc/DEPLOYMENT.md`).
# The author runs it by hand:
#
#   npm run deploy              # the commit, as it is
#   npm run deploy -- --dirty   # the working tree, though it differs from its commit
#
# The target is read from a gitignored `.env` at the repository's root, so the repository
# names no host, login or path:
#
#   DEPLOY_HOST=<user>@<host>   the SSH destination
#   DEPLOY_DIR=<path>           the stack's folder there, absolute: the compose file, its
#                               .env, gamefiles/ and stats/ (`docker-compose.yaml`)
#
# The VPS's Compose v1 cannot recreate a container, so the image goes over as a file and
# the stack is taken down and brought up again. The compose file goes with every deploy,
# so the remote stack cannot drift from the repository. The game files do not: they are
# uploaded on their own, when they change.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

dirty=0
case "${1:-}" in
  '') ;;
  --dirty) dirty=1 ;;
  *) echo "usage: utils/deploy.sh [--dirty]" >&2; exit 2 ;;
esac

[ -f "$root/.env" ] || { echo "no .env at $root: it names DEPLOY_HOST and DEPLOY_DIR" >&2; exit 1; }
set -a
# shellcheck source=/dev/null
. "$root/.env"
set +a
: "${DEPLOY_HOST:?DEPLOY_HOST is not set in .env}"
: "${DEPLOY_DIR:?DEPLOY_DIR is not set in .env}"

# The image is built from the working tree, so it is its commit's only where nothing it
# takes differs: the build context (`.dockerignore`'s allowlist, untracked files included),
# the Dockerfile and the compose file. A commit is one `npm test` passed (`CLAUDE.md`), so
# that tree is a checked one. With `--dirty`, the build the page's events name is marked.
build="$(git -C "$root" rev-parse --short HEAD)"
mapfile -t context < <(sed -n 's/^!/:(glob)/p' "$root/.dockerignore" | sed 's|/$|/**|')
changed="$(git -C "$root" status --porcelain -- Dockerfile docker-compose.yaml "${context[@]}")"
if [ -n "$changed" ]; then
  if [ "$dirty" = 0 ]; then
    printf 'the image would differ from %s:\n%s\ncommit, or deploy it anyway with --dirty\n' "$build" "$changed" >&2
    exit 1
  fi
  build="$build-dirty"
fi

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
