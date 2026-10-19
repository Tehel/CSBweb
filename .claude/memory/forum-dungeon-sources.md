---
name: forum-dungeon-sources
description: Where the community's custom dungeons are — the forum's list, its shared OneDrive (read without logging in), and why the topics' own links fail
metadata:
  type: reference
---

The Dungeon Master forum's list of custom dungeons,
`https://www.dungeon-master.com/forum/viewtopic.php?t=31516`, is the authority: one line
per dungeon, `[name](topic) [engines] [authors]`, kept up to date by the forum's moderators.

Most download links in the dungeons' own topics are dead (dmjump, nifty, ntlworld,
mediafire, blacksteel, sholing). The list's shared OneDrive,
`https://1drv.ms/f/s!AsBu7boYHQokbYK3rjKY0b5_ra8`, holds every listed dungeon in
`Custom Dungeons/<name> [<engines>] [<authors>]`, often every version. It reads without
logging in through the token OneDrive's web app uses; `api.onedrive.com` answers 401. The
working calls are `oneDrive()` and its neighbours in `utils/submit-forum-dungeons.ts`.

Paul Stevens' `http://dianneandpaul.net/CSBwin/Games/` still serves a few archives
directly, but older versions than the port ships: Towers of Chaos 3.0 (ours is 3.3),
Conflux WIP006 (ours is 3.5 beta 8).

The `@content.downloadUrl` a listing gives takes HTTP Range requests: a file's first bytes,
or a zip's central directory and then an entry's first deflated bytes, read without
downloading the archive (how `doc/RTC/README.md`'s survey of the RTC modules was read).

WSL has no `7z` on the PATH (Black Crypt Level 13 Test is a `.7z`): Windows' 7-Zip is
`/mnt/c/Program Files/7-Zip/7z.exe`, run as `7z.exe x -y -o"$(wslpath -w <dir>)" "$(wslpath -w <archive>)"`.

**How to apply:** for any dungeon's files, list its OneDrive folder before chasing a
topic's links. See [[custom-dungeon-archives]].
