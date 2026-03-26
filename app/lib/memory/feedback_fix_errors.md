---
name: Fix errors don't ignore them
description: User expects all type errors to be fixed, not dismissed as pre-existing
type: feedback
---

When encountering type errors during a refactor, fix them — don't classify them as "pre-existing" to skip over them.

**Why:** The user views type errors as the problem to solve, not noise to explain away. Checking whether errors are "new vs old" is wasted effort.

**How to apply:** When typecheck fails, fix all errors in files you're touching. Don't spend time comparing error counts or stashing to check baselines.
