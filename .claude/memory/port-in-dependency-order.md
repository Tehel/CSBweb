---
name: port-in-dependency-order
description: Read the CSBWin function before committing to a porting order — its first lines usually reveal a prerequisite that reorders the phase
metadata:
  type: feedback
---

Before porting a CSBWin function, **read it first and let its dependencies set the
order**, rather than following `PLAN.md`'s numbered steps literally.

Phase 12 was planned as steps 1→6, but `InitialChecks`'s first real act is to call
`DamageMonster`, a step-4 function. The real order was: monster `MoveObject` →
`DamageMonster` → `InitialChecks` → the AI body → attacks.

Tiebreak when two prerequisites compete: **prefer the one that also retires a stub
already live in the shipping path** — it pays twice.

**Why:** the call graph is much flatter in the plan than in reality, and a function
written against a stub is written twice.

**How to apply:** before starting a step, read the target function's first 40 lines and
check what it calls. If a call belongs to a later step, do that step first and record
the reordering in `PLAN.md`.
