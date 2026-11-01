#!/bin/bash
# Build the image, ship it to the server and restart the stack there (`doc/DEPLOYMENT.md`).
# Its maintainer runs it by hand:
#
#   npm run deploy                  # the commit, as it is
#   npm run deploy -- --dirty       # the working tree, though it differs from its commit
#   npm run deploy -- --no-replay   # without replaying the site's recordings: the first deploy
#
# The target is read from a gitignored `.env` at the repository's root, so the repository
# names no host, login or path:
#
#   DEPLOY_HOST=<user>@<host>   the SSH destination
#   DEPLOY_DIR=<path>           the stack's folder there, absolute: the compose file, its
#                               .env, gamefiles/ and stats/ (`docker-compose.yaml`)
#   DEPLOY_INSTANCE=<url>       the site, whose shared recordings the build must play
#   DEPLOY_PLAYER=<playerId>    one of its moderators (`MODERATOR_PLAYER_IDS`)
#
# Before anything is built, the working tree's engine replays every recording the site
# shares (`utils/replay-recordings.ts`), and one that drifts refuses the deploy: it is a
# change of play made without its flag (`doc/RECORDING.md` → "A recording's level").
# `--no-replay` skips it, for the first deploy, which has no site to ask yet.
#
# The image goes over as a file, and the stack is taken down and brought up again, since
# Compose v1 cannot recreate a container there. `docker-compose` runs it where the
# server has it, else Compose v2's `docker compose`. The compose file goes with every
# deploy, so the remote stack cannot drift from the repository. The game files do not:
# they are uploaded on their own, when they change (`utils/install-official-sets.ts`).
#
# The stack's `.env` there must exist first (`doc/SETUP.md`): Compose refuses a stack
# without it, and this stops before shipping anything.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

dirty=0
replay=1
for arg in "$@"; do
  case "$arg" in
    --dirty) dirty=1 ;;
    --no-replay) replay=0 ;;
    *) echo "usage: utils/deploy.sh [--dirty] [--no-replay]" >&2; exit 2 ;;
  esac
done

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

# The site's recordings, played by the engine about to be built: a drift refuses the deploy.
if [ "$replay" = 1 ]; then
  : "${DEPLOY_INSTANCE:?DEPLOY_INSTANCE is not set in .env: the site whose recordings to replay (or --no-replay, for a first deploy)}"
  : "${DEPLOY_PLAYER:?DEPLOY_PLAYER is not set in .env: the playerId of a moderator (or --no-replay, for a first deploy)}"
  (cd "$root" && npx tsx utils/replay-recordings.ts --instance "$DEPLOY_INSTANCE" --player "$DEPLOY_PLAYER" < /dev/null) \
    || { echo "not deployed: the build does not play every recording $DEPLOY_INSTANCE shares" >&2; exit 1; }
fi

echo "building csbweb:latest ($build)"
docker build --build-arg CSBWEB_BUILD="$build" -t csbweb:latest "$root"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
docker save csbweb:latest | gzip > "$tmp/csbweb.tar.gz"

echo "shipping to $DEPLOY_HOST:$DEPLOY_DIR"
# The folders are made here, by the login user, so that the container's uid 1000 can write
# them: one Docker made for a missing mount would be root's.
ssh "$DEPLOY_HOST" "cd '$DEPLOY_DIR' 2>/dev/null && [ -f .env ] || { echo 'no $DEPLOY_DIR/.env on $DEPLOY_HOST: make it first (doc/SETUP.md)' >&2; exit 1; }
  mkdir -p stats gamefiles files"
scp "$tmp/csbweb.tar.gz" "$root/docker-compose.yaml" "$DEPLOY_HOST:$DEPLOY_DIR/"
compose='compose() { if command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"; else docker compose "$@"; fi; }'
ssh "$DEPLOY_HOST" "$compose; cd '$DEPLOY_DIR' && gunzip -c csbweb.tar.gz | docker load && rm csbweb.tar.gz \
  && compose down && compose up -d && compose ps"
echo "deployed $build"
