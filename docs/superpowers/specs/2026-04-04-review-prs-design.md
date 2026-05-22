# review-prs Skill Design

**Date:** 2026-04-04  
**Location:** `TytaniumDev/TytaniumAgentSkills` plugin — `plugins/TytaniumAgentSkills/skills/review-prs/SKILL.md`  
**Trigger:** `/review-prs`

## Purpose

A shared skill that triages all open PRs in the current repo, reviews them for quality, fixes issues, and sets up approved PRs for automerge. Designed to be hands-off — run it and come back to a summary.

## Overall Flow

```
/review-prs
    |
    +- 1. List open non-draft PRs via `gh pr list --state open --draft=false`
    +- 2. If none -> report "no open PRs" and exit
    +- 3. For each PR, dispatch ONE parallel haiku subagent (in a worktree):
    |     Each subagent owns the full lifecycle for its PR, escalating model as needed.
    |     +- a. Create git worktree for the PR branch (isolation: "worktree")
    |     +- b. Rebase onto latest main. If merge conflicts -> dispatch a sonnet subagent to resolve.
    |     +- c. Force-push the rebased branch
    |     +- d. Run quality gate checks:
    |     |     - Code review quality
    |     |     - Duplication scan
    |     |     - CI naming preservation check
    |     +- e. If NOT worthy -> comment on PR with concerns, return result
    |     +- f. If worthy:
    |     |     +- Check CI status + review comments
    |     |     +- If fixes needed -> dispatch a sonnet subagent (in same worktree) to fix, commit, push (up to 5 cycles)
    |     |     +- Enable automerge: `gh pr merge --auto --squash`
    |     +- g. Clean up worktree, return structured result
    +- 4. Collect results, present summary to user
```

## Quality Gate: "Worthy of Merge" Criteria

A PR must pass all three checks to be considered worthy.

### Check 1: Code Review Quality

- Read the full PR diff via `gh pr diff`
- Holistic evaluation: Do the changes make sense? Is the code correct, reasonably clean, not introducing bugs or security issues?
- Judgment call — not a checklist, but "would a competent reviewer approve this?"

### Check 2: No Duplication of Existing Functionality

- Search the codebase (Grep/Glob) for functions, components, or patterns that overlap with what the PR introduces
- Flag if the PR adds something that already exists or reimplements existing utility code

### Check 3: No CI Naming Changes

- Read the PR diff filtered to `.github/workflows/**` files
- If workflow files are modified, check specifically for changes to `name:` fields on jobs or workflows
- Renaming CI jobs/workflows = automatic rejection (breaks existing automations)
- Adding new workflows or modifying non-name fields is fine

### Failure Behavior

If any check fails, post a review comment on the PR explaining which check(s) failed and why. Return the PR as "not worthy" with the reason.

## Rebase Phase (Every PR)

Before quality checks, every PR gets rebased onto latest main to ensure checks reflect the current codebase:

- **Haiku subagent** performs the rebase when there are no conflicts
- If merge conflicts arise, **escalate to sonnet subagent** for conflict resolution
- Force-push the updated branch so CI runs against latest main

This also ensures that as earlier PRs get automerged, later PRs in the batch don't fail due to stale branches.

## Fix Phase

### Trigger Conditions (any of)

- CI checks are failing
- Unresolved review comments from human or bot reviewers

### Process

1. Sonnet subagent operates in the PR's worktree
2. Read CI failure logs via `gh pr checks` and `gh run view --log-failed`
3. Read unresolved review comments via `gh api`
4. Fix issues, commit, push
5. Wait for CI, check results
6. Repeat up to **5 fix-push cycles**
7. If still failing after 5 attempts: stop, leave a comment summarizing what was tried and what's still broken

### What It Handles

- CI failures (lint, type-check, build, test)
- Review comment feedback
- Merge conflicts (sonnet subagent)

### After 5 Failed Cycles

- Leave a PR comment summarizing attempts and remaining failures
- Report as "needs human attention" in the summary

## Automerge

- Once a PR is worthy and CI is green: `gh pr merge --auto --squash`
- GitHub's branch protection rules control when the actual merge happens

## End-of-Run Summary

Presented to the user after all subagents complete:

```
## PR Review Summary -- <repo name>

### Automerge Enabled (N)
- #42 -- "feat: add deck export" -- CI green, automerge set
- #38 -- "fix: null check in resolver" -- fixed 1 CI issue, automerge set

### Not Worthy (N)
- #40 -- "feat: add logging util" -- duplicates existing logger.ts -- <link>
- #37 -- "chore: rename CI jobs" -- modifies CI workflow names -- <link>

### Needs Human Attention (N)
- #33 -- "feat: new auth flow" -- CI still failing after 5 fix attempts -- <link>
```

Each rejected/attention-needed PR includes a clickable GitHub link. Comments have already been posted on those PRs.

## Model Strategy (Cost Optimization)

The parent agent dispatches **one haiku subagent per PR**. That haiku subagent owns the full PR lifecycle and escalates to sonnet by dispatching nested subagents when reasoning-heavy work is needed. The parent agent specifies `model: "haiku"` on the per-PR Agent calls. The haiku subagent specifies `model: "sonnet"` when dispatching fix/conflict-resolution sub-subagents.

| Task | Model | Rationale |
|------|-------|-----------|
| List PRs, dispatch subagents | Parent agent | Orchestration only |
| Rebase onto main (no conflicts) | Haiku | Mechanical git operation |
| Merge conflict resolution | Sonnet (nested) | Requires reasoning about code intent |
| Quality gate checks (3 checks) | Haiku | Read + evaluate, low-complexity judgment |
| CI/review fix cycles | Sonnet (nested) | Needs reasoning to fix real code issues |
| Automerge command | Haiku | Single `gh` command |

## Skill Metadata

```yaml
name: review-prs
description: Review all open PRs in the current repo, triage for quality, fix issues, and enable automerge.
disable-model-invocation: true
allowed-tools:
  - Agent
  - Bash(gh *)
  - Bash(git *)
  - Read
  - Grep
  - Glob
  - Edit
  - Write
```

## Plugin Location

Lives in `TytaniumDev/TytaniumAgentSkills`:
- `plugins/TytaniumAgentSkills/skills/review-prs/SKILL.md`
- Shared across all repos via the plugin system
