---
name: commit-push
description: Commit and push to main
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git push:*), Bash(git commit:*)
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Your task

Based on the above changes:

1. Stage all changed files
2. Create a single commit with an appropriate message
3. Push to origin main

You have the capability to call multiple tools in a single response. You MUST do all of the above in a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls.
