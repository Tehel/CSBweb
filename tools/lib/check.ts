/**
 * The shared assertion helper for `tools/`.
 *
 * Every verification tool used to hand-roll its own three-line `check()` and its own
 * verdict line, and three of them ended up with no assertions at all — they printed
 * `PROBLEMS: …` and still exited 0, so `tools/run-checks.ts` would have called them
 * green. `finish()` fixes that from one place: it owns the exit code, and it treats a
 * run that made **no** checks as a failure, because a tool that cannot fail is not
 * evidence of anything.
 *
 * Usage:
 *
 *   import { check, finish } from './lib/check';
 *   check(hp === 100, 'Screamer starts at 100 hit points');
 *   finish();
 */

let problems = 0;
let checks = 0;

/** Assert `ok`; on failure print `what` and remember it for the verdict. */
export function check(ok: boolean, what: string): void {
  checks++;
  if (!ok) {
    console.log(`  !! ${what}`);
    problems++;
  }
}

/** Record a failure that has no boolean to test — an unreachable branch, a bad lookup. */
export function fail(what: string): void {
  check(false, what);
}

/**
 * Print the verdict and set `process.exitCode`. Call once, at the end of `main()`.
 *
 * A tool that ran zero checks fails: it means the assertions were lost in a refactor,
 * or the scenario the tool builds never reached the code it meant to exercise.
 */
export function finish(): void {
  if (checks === 0) {
    console.log('NO CHECKS RAN — a tool that cannot fail proves nothing');
    process.exitCode = 1;
    return;
  }
  console.log(problems === 0
    ? `ALL CHECKS PASSED (${checks})`
    : `${problems} CHECK(S) FAILED of ${checks}`);
  process.exitCode = problems === 0 ? 0 : 1;
}
