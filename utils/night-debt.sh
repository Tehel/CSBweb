#!/bin/bash
# Pay DEBT.md's items unattended, while the author sleeps: one fresh headless /pay-debt
# session at a time, each under an ID chosen here so it can be resumed. The author runs
# it by hand, in a terminal left open:
#
#   bash utils/night-debt.sh 07:00 10:00
#
# The first time is the quota's reset: no session starts after it. The second is a hard
# stop: a session still running then (one waiting on the quota) is killed. The loop stops
# as soon as a session leaves the tree dirty, which it prints with the line to resume it,
# or commits nothing (the quota spent before its first edit). It refuses to start on a
# dirty tree. OPEN_SOURCE_PLAN.md is the author's and never counts.
# Each decision is printed and kept in driver.log, beside each session's own output, in
# ${XDG_STATE_HOME:-~/.local/state}/csbweb/night-debt, outside the repository.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd)
RESET=$(date -d "${1:-07:00}" +%s)
HARD_STOP=$(date -d "${2:-10:00}" +%s)
LOG=${XDG_STATE_HOME:-$HOME/.local/state}/csbweb/night-debt
mkdir -p "$LOG"
cd "$REPO" || exit 1

say() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG/driver.log"; }
status() { git status --porcelain -- . ':!OPEN_SOURCE_PLAN.md'; }

say "start; no session after $(date -d @"$RESET" +%H:%M), kill at $(date -d @"$HARD_STOP" +%H:%M)"
if [ -n "$(status)" ]; then
  say "STOP: the tree is not clean before the first session:"; status | tee -a "$LOG/driver.log"
  exit 1
fi

for i in $(seq 1 30); do
  now=$(date +%s)
  if [ "$now" -ge "$RESET" ]; then say "STOP: the reset time has passed, starting no session $i"; break; fi
  id=$(cat /proc/sys/kernel/random/uuid)
  before=$(git rev-parse HEAD)
  say "session $i: $id (log $LOG/item-$i.log)"
  timeout --kill-after=60 $(( HARD_STOP - now )) \
    claude -p --permission-mode auto --session-id "$id" "/pay-debt" >"$LOG/item-$i.log" 2>&1
  code=$?
  if [ $code -eq 124 ]; then say "session $i was killed at the hard stop"; else say "session $i exited with $code"; fi
  commits=$(git log --oneline "$before"..HEAD)
  if [ -n "$commits" ]; then say "session $i committed:"; echo "$commits" | tee -a "$LOG/driver.log"; fi
  if [ -n "$(status)" ]; then
    say "STOP: session $i left the tree dirty:"; status | tee -a "$LOG/driver.log"
    say "to finish it: cd $REPO && claude --resume $id"
    break
  fi
  if [ -z "$commits" ]; then
    say "STOP: session $i committed nothing, its log ends:"; tail -n 15 "$LOG/item-$i.log" | tee -a "$LOG/driver.log"
    break
  fi
  say "session $i: clean, next"
done
say "done"
