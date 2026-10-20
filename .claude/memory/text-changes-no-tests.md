---
name: text-changes-no-tests
description: A prose-only change (Markdown docs, or welcome-page copy and its CSS) needs no `npm test` nor golden-frame run
metadata:
  type: feedback
---

Don't run `npm test` or `--frames` for a change that is only prose:

- Markdown documents (`CLAUDE.md`, `PLAN.md`, `DEBT.md`, `doc/`, memories). No tool
  reads them, so the gate cannot fail on them; commit straight away.
- Welcome-page copy: a text block and its styling. A screenshot is enough to check the
  layout.

**Why:** the author stopped a `npm test -- --frames` run on a new Credits block ("it's a
damn text block"), and questioned an `npm test` run before a commit of three Markdown
files. `CLAUDE.md`'s "`npm test` must pass before any commit" is about code.

**How to apply:** keep the full gate for code, the engine, the tools and the game's
screen. For prose, check it by reading it, then stop.
