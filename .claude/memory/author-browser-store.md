---
name: author-browser-store
description: How to read the author's own browser saves and recordings (production's IndexedDB in Windows Chrome) from WSL, read-only, to replay a reported recording
metadata:
  type: reference
---

The author tests on production (`https://csbweb.looten.net`), in Windows Chrome, and allows peeking at its store. From WSL:

- The store: `/mnt/c/Users/ThomasLooten/AppData/Local/Google/Chrome/User Data/Default/IndexedDB/https_csbweb.looten.net_0.indexeddb.leveldb/` (the dev server's is `http_localhost_9000…`, stale). Copy the `*.log` (and any `.ldb`) out; never write there.
- A copied folder renamed into a scratch Chrome profile is wiped on open: parse it instead. LevelDB log = 32 KiB blocks of `[crc4][len2][type1]` records (1 full, 2/3/4 first/middle/last); each a WriteBatch `[seq8][count4]` then `tag, varint key, varint value`; keep the last put per key.
- A value is `varint, ff 15 fe <8 bytes>, ff 10 …`: from the `ff` after the `fe` trailer, Node's `v8.Deserializer` reads it once the version byte 0x10 is patched to 0x0f (Node 24's V8 writes 15). Rows come out as the store's objects: recording rows, parts (`seq`), save rows, save files (`bytes`).
- Rebuild with `assembleRecording` and a `{list, read}` store over them, then `readRecordingPath`/`pointPath`; replay in `standInPage`.
- **Production's sets are not the local fixtures by id**: match by the recording's `files` digests (production's `dm-atari@4` is the local `dm-atari-1.2`; local `dm-atari` is 1.1's). Fetch a set's files from `gamefiles/<dir>/` (`dir` from `api/data-sets`) if needed.

**Why:** two drift reports this session only reproduced on the author's real data; my synthetic repros all passed.

**How to apply:** when a recording bug is reported on the site, ask for nothing: read the store as above, replay over the set its digests name, and keep a minimal package in the corpus as the regression. Related: [[recording-cut-at-save]].
