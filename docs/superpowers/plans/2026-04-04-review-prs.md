# review-prs Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a shared `/review-prs` skill that triages all open PRs in a repo, reviews them for quality, fixes CI/review issues, and enables automerge.

**Architecture:** Single SKILL.md file in the TytaniumAgentSkills plugin. The skill instructs the parent agent to list PRs, then dispatch parallel haiku subagents (one per PR) that each handle the full rebase-review-fix-automerge lifecycle, escalating to sonnet for merge conflicts and code fixes.

**Tech Stack:** Claude Code skills (SKILL.md markdown), `gh` CLI, `git` CLI, Agent tool with model selection.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `plugins/TytaniumAgentSkills/skills/review-prs/SKILL.md` | Claude Code skill file |
| Create | `plugins/TytaniumAgentSkills/skills-gemini/review-prs/SKILL.md` | Gemini variant (tool name translations) |

**Working directory:** `/Users/tylerholland/Dev/TytaniumAgentSkills`

---

### Task 1: Create the Claude Code SKILL.md

**Files:**
- Create: `plugins/TytaniumAgentSkills/skills/review-prs/SKILL.md`

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p /Users/tylerholland/Dev/TytaniumAgentSkills/plugins/TytaniumAgentSkills/skills/review-prs
```

- [ ] **Step 2: Write the SKILL.md file**

Write the following to `plugins/TytaniumAgentSkills/skills/review-prs/SKILL.md`:

```markdown
---
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
---

# Review PRs: Triage, Fix, and Automerge

Review every open non-draft PR in the current repo. For each PR: rebase onto main, run quality checks, fix CI/review issues, and enable automerge if worthy. Present a summary at the end.

## Step 1: List Open PRs

Run:
```
gh pr list --state open --draft=false --json number,title,headRefName,url --limit 100
```

If no PRs are returned, report "No open non-draft PRs found" and stop.

Save the list. You will need `number`, `title`, `headRefName`, and `url` for each PR.

## Step 2: Get Repo Info

Run:
```
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

Split on `/` to get `OWNER` and `REPO`. You will need these for API calls.

## Step 3: Dispatch One Haiku Subagent Per PR

For EVERY PR from Step 1, dispatch a parallel subagent using the Agent tool with `model: "haiku"` and `isolation: "worktree"`. Send ALL Agent tool calls in a single message so they run concurrently.

Each subagent receives a prompt containing:
- The PR number, title, branch name, and URL
- The OWNER and REPO values
- The full instructions from the "Per-PR Subagent Instructions" section below

Collect the result from each subagent. Each result must be a structured report with:
- `pr_number`, `pr_title`, `pr_url`
- `status`: one of `automerge_enabled`, `not_worthy`, `needs_human_attention`
- `reason`: short explanation

## Step 4: Present Summary

After ALL subagents complete, present a summary to the user:

```
## PR Review Summary -- <OWNER>/<REPO>

### Automerge Enabled (N)
- #<number> -- "<title>" -- <reason> -- <url>

### Not Worthy (N)
- #<number> -- "<title>" -- <reason> -- <url>

### Needs Human Attention (N)
- #<number> -- "<title>" -- <reason> -- <url>
```

If a section has 0 items, omit it.

---

## Per-PR Subagent Instructions

**IMPORTANT:** Copy this entire section into the prompt for each haiku subagent, substituting the PR-specific values.

You are processing PR #<NUMBER> ("<TITLE>") on branch `<BRANCH>` in <OWNER>/<REPO>.
URL: <URL>

Your job: rebase this PR onto main, run quality checks, fix any issues if worthy, and enable automerge. Return a structured result.

### Phase 1: Rebase onto Main

1. Fetch latest main:
   ```
   git fetch origin main
   ```

2. Attempt rebase:
   ```
   git rebase origin/main
   ```

3. If rebase succeeds with no conflicts, force-push:
   ```
   git push --force-with-lease
   ```

4. If rebase fails due to merge conflicts, abort the rebase and dispatch a **sonnet subagent** (using Agent tool with `model: "sonnet"`) with the following instructions:

   > You are in a worktree on branch `<BRANCH>` for PR #<NUMBER> in <OWNER>/<REPO>.
   > A rebase onto origin/main failed with merge conflicts. Resolve them:
   > 1. Run `git rebase --abort` to reset
   > 2. Run `git merge origin/main` instead
   > 3. For each conflicted file, read the file, understand both sides, and resolve the conflict sensibly
   > 4. After resolving all conflicts, run `git add .` and `git commit -m "chore: merge main into <BRANCH>"`
   > 5. Run `git push --force-with-lease`
   > Report "conflicts_resolved" if successful, or "conflicts_unresolvable" with an explanation if not.

   If the sonnet subagent reports "conflicts_unresolvable":
   - Comment on the PR: `gh pr comment <NUMBER> --body "Unable to automatically resolve merge conflicts with main. Manual resolution needed."`
   - Return: `{ status: "needs_human_attention", reason: "Unresolvable merge conflicts" }`

### Phase 2: Quality Gate

Run all three checks. A PR must pass ALL THREE to be worthy.

**Check 1: Code Review Quality**

Read the full PR diff:
```
gh pr diff <NUMBER>
```

Evaluate holistically: Do the changes make sense? Is the code correct, reasonably clean, and not introducing obvious bugs or security issues? Would a competent reviewer approve this?

**Check 2: No Duplication of Existing Functionality**

Look at what the PR adds (new functions, components, utilities, etc). For each significant addition, search the existing codebase using Grep and Glob to check if similar functionality already exists. Flag if the PR reimplements something that's already there.

**Check 3: No CI Naming Changes**

Check if the PR modifies any workflow files:
```
gh pr diff <NUMBER> -- .github/workflows/
```

If workflow files are changed, check specifically for modifications to `name:` fields on jobs or workflows. Renaming CI jobs or workflows is an automatic rejection — it breaks existing automations. Adding new workflows or changing non-name fields is fine.

**If any check fails:**
- Post a review comment explaining which check(s) failed and why:
  ```
  gh pr comment <NUMBER> --body "<explanation of which checks failed and why>"
  ```
- Return: `{ status: "not_worthy", reason: "<brief summary of failures>" }`

### Phase 3: Fix Issues (if worthy)

After passing the quality gate, check for issues that need fixing.

**Check CI status:**
```
gh pr checks <NUMBER>
```

**Check for unresolved review comments:**
```
gh api repos/<OWNER>/<REPO>/pulls/<NUMBER>/comments --jq '[.[] | select(.position != null)] | length'
gh api repos/<OWNER>/<REPO>/pulls/<NUMBER>/reviews --jq '[.[] | select(.state == "CHANGES_REQUESTED")] | length'
```

If CI is green AND there are no unresolved review comments, skip to Phase 4.

If there are issues to fix, dispatch a **sonnet subagent** (using Agent tool with `model: "sonnet"`) with the following instructions:

> You are in a worktree on branch `<BRANCH>` for PR #<NUMBER> in <OWNER>/<REPO>.
> Fix CI failures and/or review comments on this PR. You have up to 5 fix-push cycles.
>
> For each cycle:
> 1. Read CI failure logs: `gh run list --branch <BRANCH> --limit 1 --json databaseId --jq '.[0].databaseId'` then `gh run view <RUN_ID> --log-failed`
> 2. Read unresolved review comments: `gh api repos/<OWNER>/<REPO>/pulls/<NUMBER>/comments`
> 3. Fix the issues in the code using Read/Edit/Write tools
> 4. Commit and push:
>    ```
>    git add -A
>    git commit -m "fix: address CI failures and review feedback"
>    git push
>    ```
> 5. Wait 30 seconds for CI to start, then poll CI status up to 20 times (sleep 15s each):
>    ```
>    gh pr checks <NUMBER>
>    ```
>    Stop polling when all checks complete (pass or fail).
> 6. If CI passes and no more unresolved comments, report "fixed" and stop.
> 7. If CI still fails, start the next cycle.
>
> After 5 failed cycles, report "unfixed" with a summary of what was tried and what's still broken.

If the sonnet subagent reports "unfixed":
- Comment on the PR:
  ```
  gh pr comment <NUMBER> --body "<summary of what was tried and what's still broken>"
  ```
- Return: `{ status: "needs_human_attention", reason: "CI still failing after 5 fix attempts" }`

### Phase 4: Enable Automerge

```
gh pr merge <NUMBER> --auto --squash
```

Return: `{ status: "automerge_enabled", reason: "<brief note, e.g. CI green / fixed N issues>" }`
```

- [ ] **Step 3: Verify the file was written correctly**

Read the file back and check:
- Frontmatter has `name`, `description`, `disable-model-invocation`, `allowed-tools`
- `allowed-tools` includes `Agent` (critical for subagent dispatch)
- All 4 steps of the main flow are present
- Per-PR subagent instructions include all 4 phases
- Model directives are explicit: `model: "haiku"` for per-PR agents, `model: "sonnet"` for fix/conflict agents

- [ ] **Step 4: Commit**

```bash
cd /Users/tylerholland/Dev/TytaniumAgentSkills
git add plugins/TytaniumAgentSkills/skills/review-prs/SKILL.md
git commit -m "feat: add review-prs skill for PR triage and automerge"
```

---

### Task 2: Create the Gemini Variant

**Files:**
- Create: `plugins/TytaniumAgentSkills/skills-gemini/review-prs/SKILL.md`
- Reference: `plugins/TytaniumAgentSkills/skills-gemini/ship-it/SKILL.md` (for tool name conventions)

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p /Users/tylerholland/Dev/TytaniumAgentSkills/plugins/TytaniumAgentSkills/skills-gemini/review-prs
```

- [ ] **Step 2: Write the Gemini SKILL.md**

Copy the Claude Code SKILL.md from Task 1 and apply these transformations:
- Remove `allowed-tools` from frontmatter (Gemini doesn't use this)
- Remove `disable-model-invocation` from frontmatter
- Replace `Read` tool references with `read_file`
- Replace `Edit` tool references with `replace`
- Replace `Write` tool references with `write_file`
- Replace `Bash(...)` references with `run_shell_command`
- Replace `Grep` references with `run_shell_command` using `grep`/`rg`
- Replace `Glob` references with `run_shell_command` using `find`
- Replace `Agent` tool references with the Gemini equivalent (`run_shell_command` dispatching `gemini` CLI subprocesses), or note that parallel subagent dispatch may not be supported and to run sequentially instead
- Update the description to mention Gemini context: "Use this when the user wants to review all open PRs..."

- [ ] **Step 3: Verify the Gemini variant**

Read back and confirm tool name translations are consistent throughout. Compare against `plugins/TytaniumAgentSkills/skills-gemini/ship-it/SKILL.md` for conventions.

- [ ] **Step 4: Commit**

```bash
cd /Users/tylerholland/Dev/TytaniumAgentSkills
git add plugins/TytaniumAgentSkills/skills-gemini/review-prs/SKILL.md
git commit -m "feat: add Gemini variant of review-prs skill"
```

---

### Task 3: Test the Skill Locally

**Files:**
- None (testing only)

- [ ] **Step 1: Verify the plugin cache picks up the new skill**

The local cache is at `/Users/tylerholland/.claude/plugins/cache/tytanium-plugins/tytanium-claude/`. After plugin update, the new skill should appear in the skills list. Run:

```bash
ls /Users/tylerholland/.claude/plugins/cache/tytanium-plugins/tytanium-claude/*/skills/
```

Confirm `review-prs` directory exists alongside `ship-it` and `ship-no-merge`.

If it doesn't appear, the plugin version needs to be updated. Copy the skill manually for local testing:

```bash
mkdir -p /Users/tylerholland/.claude/plugins/cache/tytanium-plugins/tytanium-claude/1.1.0/skills/review-prs
cp /Users/tylerholland/Dev/TytaniumAgentSkills/plugins/TytaniumAgentSkills/skills/review-prs/SKILL.md \
   /Users/tylerholland/.claude/plugins/cache/tytanium-plugins/tytanium-claude/1.1.0/skills/review-prs/SKILL.md
```

- [ ] **Step 2: Smoke test in a repo with open PRs**

Navigate to a repo that has open non-draft PRs and run `/review-prs`. Verify:
- PRs are listed correctly
- Subagents are dispatched in parallel with `model: "haiku"`
- Rebase phase runs for each PR
- Quality gate checks execute (code review, duplication, CI naming)
- Worthy PRs get automerge enabled
- Not-worthy PRs get review comments posted
- Summary is presented at the end with correct categories and links

- [ ] **Step 3: Commit any fixes from smoke testing**

If smoke testing reveals issues in the SKILL.md, fix them and commit:

```bash
cd /Users/tylerholland/Dev/TytaniumAgentSkills
git add -A
git commit -m "fix: address issues found during review-prs smoke testing"
```

---

### Task 4: Push and Publish

**Files:**
- None (git/GitHub operations only)

- [ ] **Step 1: Push to remote**

```bash
cd /Users/tylerholland/Dev/TytaniumAgentSkills
git push origin main
```

The `bump-version.yml` workflow will auto-bump the plugin patch version on merge to main.

- [ ] **Step 2: Verify plugin update propagates**

After pushing, verify that Claude Code picks up the new version on next session start. The plugin cache should update automatically when the version bumps.

```bash
# After restarting Claude Code or waiting for cache refresh:
ls /Users/tylerholland/.claude/plugins/cache/tytanium-plugins/tytanium-claude/*/skills/
```

Confirm `review-prs` appears in the latest version directory.
