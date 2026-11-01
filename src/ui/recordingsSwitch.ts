/**
 * Whether this page records games and lists recordings. Recordings are paused: any change
 * to what the engine does at a tick makes a recording made before it play out differently
 * (`doc/RECORDING.md`), until the engine keeps every behaviour one was made with (`DEBT.md` R18). So a
 * page writes no recording to the store and its book has no RECORDINGS tab, unless it is
 * opened with `?recordings`, which the probes and the recordings' own work use. The page's
 * links keep the parameter (`welcomePageQuery`). A recording's link, `?recording=`, plays
 * whatever the switch.
 */
export function recordingsOn(): boolean {
    return new URLSearchParams(window.location.search).has('recordings');
}
