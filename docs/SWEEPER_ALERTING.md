# Sweeper liveness alerting

The stale-job sweeper (see [STALE_SWEEPER.md](./STALE_SWEEPER.md)) is the
only recovery path for stuck jobs after PR #151 removed per-GET recovery.
If Cloud Scheduler silently stops invoking `POST /api/admin/sweep-stale-jobs`
— paused job, expired OIDC token, IAM regression — jobs can accumulate in
a stuck state for hours before anyone notices.

This document sets up a Cloud Monitoring alert that fires when the
sweeper hasn't completed a successful run in the last 30 minutes.

## How it works

On every successful sweep, the route handler
(`api/app/api/admin/sweep-stale-jobs/route.ts`) writes a structured log
line with `event: "sweep-complete"` and the sweep's result counts.

Cloud Monitoring builds a **log-based metric** that counts these entries,
and an **alert policy** fires on the metric's absence (i.e., count == 0)
over a 30-minute rolling window. That's longer than the 15-minute schedule
interval so a single missed invocation doesn't page.

## Deployment

Prerequisites:
- `gcloud` CLI authenticated against the `magic-bracket-simulator` project
- A notification channel already exists (email, Slack, PagerDuty, etc.)

### 1. Create the log-based metric

```bash
gcloud logging metrics create sweeper_completions \
  --project=magic-bracket-simulator \
  --description="Count of successful stale-sweeper runs" \
  --log-filter='jsonPayload.component="stale-sweeper" AND jsonPayload.event="sweep-complete"'
```

### 2. Create the alert policy

Save [`sweeper-alert-policy.yaml`](./sweeper-alert-policy.yaml) and apply
it — update the notification channel ID first:

```bash
# Find your notification channel ID
gcloud alpha monitoring channels list --project=magic-bracket-simulator

# Edit docs/sweeper-alert-policy.yaml and replace the notificationChannels
# entry with the ID from above, then apply:
gcloud alpha monitoring policies create \
  --project=magic-bracket-simulator \
  --policy-from-file=docs/sweeper-alert-policy.yaml
```

### 3. Verify

Wait 15 minutes for the next scheduled sweeper run, then run:

```bash
gcloud logging read \
  'jsonPayload.component="stale-sweeper" AND jsonPayload.event="sweep-complete"' \
  --project=magic-bracket-simulator \
  --limit=5 \
  --format='value(timestamp,jsonPayload.durationMs,jsonPayload.scanned)'
```

You should see one entry per scheduler run. If you see nothing, the
sweeper is not running — which is exactly the condition the alert is
designed to catch.

## Testing the alert

To force a fire without actually breaking the sweeper, temporarily edit
the log-based metric filter to something that never matches (e.g.
`jsonPayload.event="intentionally-nonexistent"`), wait 30 minutes, and
confirm the alert opens. Revert the filter to restore normal operation.

## Known limitations

- **Cold start**: the very first sweep after an API deploy may take
  longer than 30 minutes if Cloud Run scales to zero and the scheduler
  invocation coincides with a deploy window. If this becomes noisy,
  widen the alert's `duration` field in `sweeper-alert-policy.yaml`.
- **One signal**: the alert only checks liveness, not correctness. A
  sweeper that runs but always throws would still emit error logs and
  fire Sentry alerts; those are tracked separately.
