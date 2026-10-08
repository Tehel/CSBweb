#!/bin/bash
# Copy the statistics' snapshots off the VPS (`doc/DEPLOYMENT.md`): the cron job's
# `server/backup.ts` writes them into `<DEPLOY_DIR>/stats/backups/`, and this pulls the
# folder to `BACKUP_PULL_DIR` (`../backups/csbweb/`, beside the checkout). The target is
# `.env`'s, as for `deploy.sh`.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

[ -f "$root/.env" ] || { echo "no .env at $root: it names DEPLOY_HOST and DEPLOY_DIR" >&2; exit 1; }
set -a
# shellcheck source=/dev/null
. "$root/.env"
set +a
: "${DEPLOY_HOST:?DEPLOY_HOST is not set in .env}"
: "${DEPLOY_DIR:?DEPLOY_DIR is not set in .env}"
dest="${BACKUP_PULL_DIR:-$root/../backups/csbweb}"

mkdir -p "$dest"
rsync -avz "$DEPLOY_HOST:$DEPLOY_DIR/stats/backups/" "$dest/"
