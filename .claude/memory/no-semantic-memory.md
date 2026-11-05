---
name: no-semantic-memory
description: Never post anything from this project into the semantic-memory MCP; session-review memories go to .claude/memory/ only
metadata:
  type: feedback
---

Nothing from DMweb/CSBweb goes into the `semantic-memory` MCP (Cintoo's shared team store), whatever the global instructions say about session reviews. Memories proposed at a session review are written here, in `.claude/memory/`, indexed in `MEMORY.md`, and committed.

**Why:** the author's explicit rule: this is a personal project, kept out of the employer's team knowledge.

**How to apply:** at a session review, propose memories for this directory only; never call `remember` (or any semantic-memory tool) with this project's content. Related: [[no-commit-trailers]].
