---
name: deploy-check
description: Run all CI checks locally before pushing
disable-model-invocation: true
---

# Pre-Deploy Validation

Run the same checks that CI runs on PRs to `main`, catching failures before pushing.

## Steps

Run these checks sequentially, stopping on first failure:

1. **Frontend lint** (ESLint, zero warnings):
   ```bash
   npm run lint --prefix frontend
   ```

2. **Frontend build** (TypeScript + Vite):
   ```bash
   npm run build --prefix frontend
   ```

3. **API lint** (TypeScript type-check):
   ```bash
   npm run lint --prefix api
   ```

4. **API build** (Next.js):
   ```bash
   npm run build --prefix api
   ```

5. **API unit tests**:
   ```bash
   npm run test:unit --prefix api
   ```

## On Failure

- Report which step failed and show the error output.
- Offer to fix the issue if it's something actionable (lint error, type error, test failure).

## On Success

- Report that all CI checks passed and it's safe to push.
