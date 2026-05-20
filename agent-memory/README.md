# agent-memory/

Persistent state for the `/overnight` autonomous improvement skill.

This directory is **checked into git on purpose**. It accumulates the agent's understanding of the codebase across runs, lessons from past attempts, and decisions that should not be re-litigated.

## Files

- `codebase-map.md` — the agent's evolving model of the architecture. Read at the start of each run.
- `style-decisions.md` — consistency choices that have been made. **These are LAW.** The agent never reproposes anything contradicting these.
- `avoid-list.md` — refactors that were attempted and failed. Entries have a 7-day TTL — older entries are pruned by the historian.
- `open-backlog.md` — known issues found by past runs but not yet addressed. Pre-seeded into each new run as critic findings.
- `summaries/` — one markdown file per overnight run. Permanent record. Read the most recent few at the start of each run.

## Editing

You (Tyler) can edit any of these manually to steer the agent — for example, to add a style decision the agent should follow, or to add an item to the avoid list. The agent will read your changes on the next run.

The agent writes most of its updates via the historian role at the end of each run.

## What's NOT in here

Runtime state (the per-run backlog of proposals being deliberated, PR counters, deadlines) lives in `/tmp/overnight-<RUN_ID>/` outside the repo and is deleted at the end of each run.
